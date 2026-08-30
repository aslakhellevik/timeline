/**
 * Layers 2 and 3 of docs/design.md §8.3.
 *
 * Layer 2 — automatic file backup. The user picks a folder once; the
 * `FileSystemDirectoryHandle` is structured-cloneable, so it lives in IndexedDB
 * and survives reloads, and permission is re-granted with one click per
 * session. Snapshots are `timeline-YYYY-MM-DD.json`, the most recent ~20 kept —
 * which is twenty *days*, since a second write on the same day overwrites the
 * first. Scheduling lives in `auto-backup.ts`; this file only writes.
 *
 * Layer 3 — a plain download, plus the "last backed up N days ago" figure that
 * gives the export button a conscience. The two are stamped separately: a
 * snapshot is a file this app wrote, an export is one the browser was asked to
 * save, and only the first of those is something the app can be sure of.
 *
 * The File System Access API is Chromium-desktop only. Everything here reports
 * its own availability instead of assuming it, because on Safari and Firefox
 * layer 2 simply does not exist and the UI has to offer layer 3 instead.
 *
 * The one destructive operation in this file is pruning. It only ever removes
 * entries whose names match the snapshot pattern exactly — the backup folder
 * belongs to the user and may contain anything else.
 */

import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { Timeline } from '../core/model/types';
import { serialiseDocument, toDocument } from './serialise';

export const DEFAULT_BACKUP_DB_NAME = 'arlinje-backup';
const META_STORE = 'meta';
const FOLDER_KEY = 'backup-folder';
const LAST_BACKUP_KEY = 'last-backup-at';
const LAST_EXPORT_KEY = 'last-export-at';

/**
 * Snapshots kept, which is **twenty days, not twenty saves**: the filename is
 * the local date, so every write after the first on a given day overwrites that
 * day's file (§8.3).
 */
export const SNAPSHOT_RETENTION = 20;

/** The indicator turns amber past this (§8.3). */
export const BACKUP_STALE_DAYS = 7;

const SNAPSHOT_PATTERN = /^timeline-\d{4}-\d{2}-\d{2}\.json$/;

// ---------------------------------------------------------------------------
// The slice of the File System Access API this module uses
// ---------------------------------------------------------------------------

/**
 * Structural, not `FileSystemDirectoryHandle` itself: it keeps the snapshot
 * writer testable without a browser, and independent of which DOM lib version
 * happens to declare the async iterators.
 */
export interface SnapshotDirectory {
  readonly name?: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<SnapshotFile>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

export interface SnapshotFile {
  createWritable(options?: { keepExistingData?: boolean }): Promise<SnapshotWritable>;
  /**
   * Optional, and probed rather than assumed: it is only used to tell an empty
   * snapshot from a real one, and a directory implementation without it simply
   * loses that check.
   */
  getFile?(): Promise<{ size: number }>;
}

export interface SnapshotWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

type DirectoryPicker = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: string;
}) => Promise<FileSystemDirectoryHandle>;

/** Non-standard, and absent from the DOM lib, so it is declared and probed. */
interface PermissionCapableHandle {
  queryPermission?(descriptor: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface BackupSupport {
  supported: boolean;
  message: string;
}

export type HandlePermission = 'granted' | 'prompt' | 'denied';

export type ChooseFolderResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed'; message: string };

export type SnapshotResult =
  | { ok: true; filename: string; at: string; pruned: string[] }
  | {
      ok: false;
      reason: 'unsupported' | 'no-folder' | 'permission' | 'write-failed';
      message: string;
    };

export type ExportResult =
  | { ok: true; filename: string; at: string }
  | { ok: false; reason: 'unsupported' | 'failed'; message: string };

/**
 * A copy of the timeline outside the browser, and which kind it was.
 *
 * `'backup'` is a file this app wrote into the folder itself, and is a fact.
 * `'export'` is a download the user was offered; whether they saved it is not
 * knowable from here, so it is reported as what it is.
 */
export type CopyKind = 'backup' | 'export';

export interface BackupStatus {
  /** Whether layer 2 is available at all in this browser. */
  supported: boolean;
  /** The chosen folder's name, or null if none has been chosen. */
  folder: string | null;
  /** `'none'` when there is no folder to have permission for. */
  permission: HandlePermission | 'none';
  /** ISO instant of the last snapshot written into the backup folder. */
  lastBackupAt: string | null;
  daysSinceBackup: number | null;
  /** ISO instant of the last export handed to the browser. */
  lastExportAt: string | null;
  daysSinceExport: number | null;
  /** The more recent of the two, which is what the indicator counts from. */
  lastCopyAt: string | null;
  lastCopyKind: CopyKind | null;
  daysSinceCopy: number | null;
  /** Past `BACKUP_STALE_DAYS`, or no copy of any kind. */
  stale: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

function getDirectoryPicker(): DirectoryPicker | null {
  const scope = globalThis as { showDirectoryPicker?: DirectoryPicker };
  return typeof scope.showDirectoryPicker === 'function'
    ? scope.showDirectoryPicker.bind(globalThis)
    : null;
}

export function isBackupSupported(): boolean {
  return getDirectoryPicker() !== null;
}

/** So the caller knows whether to offer a backup folder or only manual export. */
export function backupSupport(): BackupSupport {
  return isBackupSupported()
    ? {
        supported: true,
        message: 'This browser can back the timeline up to a folder on your computer.',
      }
    : {
        supported: false,
        message:
          'This browser cannot write to a folder automatically. ' +
          'Export the timeline yourself now and then — the button is always there.',
      };
}

// ---------------------------------------------------------------------------
// Snapshot naming and rotation (pure, so the destructive part is testable)
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `timeline-YYYY-MM-DD.json`, in local time: the user's today, not UTC's. */
export function snapshotFilename(date: Date = new Date()): string {
  return `timeline-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/**
 * `timeline-YYYY-MM-DD-HHMM.json` — the same name with a time on it.
 *
 * Exports land in the downloads folder, where a second export on the same day
 * used to arrive as `timeline-2026-08-15 (1).json` and leave the user guessing
 * which of the two was newer. The minute is in the name instead.
 *
 * The extra part also keeps an export out of `isSnapshotName`, which matters if
 * the backup folder and the downloads folder are ever the same one: pruning
 * must never delete a file the user asked for by hand.
 */
export function exportFilename(date: Date = new Date()): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `timeline-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_PATTERN.test(name);
}

/** A name, and its size when the directory will say (see `SnapshotFile.getFile`). */
export interface SnapshotEntry {
  name: string;
  size?: number;
}

/**
 * Which snapshots to delete, keeping the newest `retain`. Names are
 * zero-padded ISO dates, so lexicographic order is chronological order.
 *
 * Anything that is not a snapshot is ignored, never returned: the folder is the
 * user's, and this function decides what gets deleted from it.
 *
 * **An empty snapshot is not a snapshot.** A zero-byte file is what a failed
 * write leaves behind, and it sorts as the newest one — so it would hold the
 * top of the rotation while restoring nothing, and push a real snapshot off the
 * bottom. Those are pruned whatever the retention, and never counted towards it.
 */
export function snapshotsToPrune(
  entries: readonly (string | SnapshotEntry)[],
  retain: number = SNAPSHOT_RETENTION,
): string[] {
  const snapshots = entries
    .map((entry) => (typeof entry === 'string' ? { name: entry } : entry))
    .filter((entry) => isSnapshotName(entry.name))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  const empty = snapshots.filter((entry) => entry.size === 0).map((entry) => entry.name);
  const real = snapshots.filter((entry) => entry.size !== 0).map((entry) => entry.name);
  return [...real.slice(Math.max(retain, 0)), ...empty];
}

// ---------------------------------------------------------------------------
// Writing a snapshot
// ---------------------------------------------------------------------------

export interface WriteSnapshotOptions {
  /** Injectable clock, so the filename is deterministic in tests. */
  now?: Date;
  retain?: number;
}

/**
 * Writes one snapshot into an already-permitted directory and prunes the old
 * ones. Split out from `writeSnapshot` so the file-level behaviour can be
 * tested without a picker, a permission prompt or a real disk.
 *
 * Writing through `createWritable` is atomic — the browser writes a swap file
 * and moves it into place on close — so a crash mid-write cannot corrupt
 * yesterday's snapshot. Two writes on the same day overwrite the same file.
 *
 * `getFileHandle(…, { create: true })` is not part of that atomicity, though:
 * it creates an empty file *before* `createWritable` is called, so a failure in
 * between — permission withdrawn, disk full — left a zero-byte file that sorted
 * as the newest snapshot and would restore nothing. A file this call created
 * and then failed to fill is removed again.
 */
export async function writeSnapshotTo(
  directory: SnapshotDirectory,
  timeline: Timeline,
  options: WriteSnapshotOptions = {},
): Promise<SnapshotResult> {
  const now = options.now ?? new Date();
  const filename = snapshotFilename(now);
  const contents = serialiseDocument(toDocument(timeline, { exportedAt: now.toISOString() }));

  // Whether today's snapshot already exists, so a failure knows whether it is
  // undoing its own mess or would be deleting yesterday's good copy.
  let existed = true;
  try {
    await directory.getFileHandle(filename);
  } catch {
    existed = false;
  }

  let writable: SnapshotWritable | null = null;
  try {
    const file = await directory.getFileHandle(filename, { create: true });
    writable = await file.createWritable();
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    if (writable?.abort) await writable.abort(error).catch(() => undefined);
    if (!existed) await directory.removeEntry(filename).catch(() => undefined);
    return {
      ok: false,
      reason: 'write-failed',
      message: `The backup could not be written: ${describe(error)}`,
    };
  }

  // Pruning is best-effort. A snapshot that was written is a success even if
  // clearing out an old one fails.
  let pruned: string[] = [];
  try {
    const entries: SnapshotEntry[] = [];
    for await (const name of directory.keys()) {
      if (!isSnapshotName(name)) continue;
      entries.push({ name, ...(await sizeOf(directory, name)) });
    }
    const doomed = snapshotsToPrune(entries, options.retain ?? SNAPSHOT_RETENTION);
    for (const name of doomed) {
      try {
        await directory.removeEntry(name);
        pruned.push(name);
      } catch {
        // Leave it; too many snapshots is not a failure worth reporting.
      }
    }
  } catch {
    pruned = [];
  }

  return { ok: true, filename, at: now.toISOString(), pruned };
}

/** `{ size }` when the directory will say, `{}` when it will not. */
async function sizeOf(
  directory: SnapshotDirectory,
  name: string,
): Promise<{ size?: number }> {
  try {
    const handle = await directory.getFileHandle(name);
    if (typeof handle.getFile !== 'function') return {};
    return { size: (await handle.getFile()).size };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — manual export
// ---------------------------------------------------------------------------

export interface DownloadExportOptions {
  filename?: string;
  now?: Date;
  /** Whether this counts towards "last exported". */
  record?: boolean;
}

/**
 * Hands the browser a file to save (§8.3, layer 3). Available everywhere; on
 * Safari and Firefox it is the whole backup story.
 *
 * **What this records is an export, not a backup, and the difference is not
 * pedantry.** All the page can do is click an anchor; whether a file was ever
 * written is decided afterwards, in a dialog this code cannot see. Counting
 * that as a backup meant a cancelled save-as cleared the amber "not backed up"
 * warning — the indicator confidently reporting a copy that does not exist. It
 * is stamped under its own key and the panel says "exported", which is exactly
 * as much as is actually known.
 */
export async function downloadExport(
  timeline: Timeline,
  options: DownloadExportOptions = {},
): Promise<ExportResult> {
  const scope = globalThis as { document?: Document; URL?: typeof URL; Blob?: typeof Blob };
  const doc = scope.document;
  if (!doc || typeof scope.URL?.createObjectURL !== 'function' || typeof scope.Blob !== 'function') {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'There is nowhere to download to from here.',
    };
  }

  const now = options.now ?? new Date();
  const filename = options.filename ?? exportFilename(now);
  const at = now.toISOString();

  try {
    const contents = serialiseDocument(toDocument(timeline, { exportedAt: at }));
    const blob = new scope.Blob([contents], { type: 'application/json' });
    const url = scope.URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    doc.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on a later task: revoking synchronously can cancel the download.
    setTimeout(() => scope.URL?.revokeObjectURL(url), 0);
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: `The export could not be prepared: ${describe(error)}`,
    };
  }

  if (options.record !== false) await markExported(at);
  return { ok: true, filename, at };
}

// ---------------------------------------------------------------------------
// The manager: folder handle, permission, and the "last backed up" figure
// ---------------------------------------------------------------------------

export interface BackupManager {
  chooseFolder(): Promise<ChooseFolderResult>;
  getFolder(): Promise<FileSystemDirectoryHandle | null>;
  forgetFolder(): Promise<void>;
  /** Queries permission; `request` prompts, and must be called from a user gesture. */
  folderPermission(options?: { request?: boolean }): Promise<HandlePermission | 'none'>;
  writeSnapshot(timeline: Timeline, options?: WriteSnapshotOptions): Promise<SnapshotResult>;
  lastBackupAt(): Promise<string | null>;
  markBackedUp(at?: string): Promise<void>;
  lastExportAt(): Promise<string | null>;
  markExported(at?: string): Promise<void>;
  status(): Promise<BackupStatus>;
  close(): void;
}

export function createBackupManager(name: string = DEFAULT_BACKUP_DB_NAME): BackupManager {
  let db: Promise<IDBPDatabase<unknown>> | null = null;

  const open = (): Promise<IDBPDatabase<unknown>> => {
    db ??= openDB(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
      },
    });
    return db;
  };

  const readMeta = async <T>(key: string): Promise<T | null> => {
    try {
      const database = await open();
      const value = (await database.get(META_STORE, key)) as T | undefined;
      return value ?? null;
    } catch {
      // No IndexedDB (private windows on some browsers) is not a crash.
      return null;
    }
  };

  const writeMeta = async (key: string, value: unknown): Promise<boolean> => {
    try {
      const database = await open();
      await database.put(META_STORE, value, key);
      return true;
    } catch {
      return false;
    }
  };

  const manager: BackupManager = {
    async chooseFolder() {
      const picker = getDirectoryPicker();
      if (!picker) return { ok: false, reason: 'unsupported', message: backupSupport().message };

      let handle: FileSystemDirectoryHandle;
      try {
        handle = await picker({ id: 'arlinje-backup', mode: 'readwrite', startIn: 'documents' });
      } catch (error) {
        if (isAbort(error)) {
          return { ok: false, reason: 'cancelled', message: 'No folder was chosen.' };
        }
        return {
          ok: false,
          reason: 'failed',
          message: `The folder could not be opened: ${describe(error)}`,
        };
      }

      // Handles are structured-cloneable, which is the whole reason this works
      // across reloads. If a browser disagrees, say so rather than pretending.
      const stored = await writeMeta(FOLDER_KEY, handle);
      if (!stored) {
        return {
          ok: false,
          reason: 'failed',
          message: 'This browser would not remember the folder, so backups cannot be automatic.',
        };
      }
      return { ok: true, name: handle.name };
    },

    getFolder() {
      return readMeta<FileSystemDirectoryHandle>(FOLDER_KEY);
    },

    async forgetFolder() {
      try {
        const database = await open();
        await database.delete(META_STORE, FOLDER_KEY);
      } catch {
        // Nothing stored, or no IndexedDB: either way there is no folder now.
      }
    },

    async folderPermission(options = {}) {
      const handle = await manager.getFolder();
      if (!handle) return 'none';
      return permissionFor(handle, options.request === true);
    },

    async writeSnapshot(timeline, options = {}) {
      if (!isBackupSupported()) {
        return { ok: false, reason: 'unsupported', message: backupSupport().message };
      }

      const handle = await manager.getFolder();
      if (!handle) {
        return {
          ok: false,
          reason: 'no-folder',
          message: 'No backup folder has been chosen yet.',
        };
      }

      // Permission lapses every session; ask again, and if the browser wants a
      // click first, let the caller do it.
      const permission = await permissionFor(handle, true);
      if (permission !== 'granted') {
        return {
          ok: false,
          reason: 'permission',
          message: 'The backup folder needs permission again — one click, once per session.',
        };
      }

      const result = await writeSnapshotTo(
        handle as unknown as SnapshotDirectory,
        timeline,
        options,
      );
      if (result.ok) await manager.markBackedUp(result.at);
      return result;
    },

    lastBackupAt() {
      return readMeta<string>(LAST_BACKUP_KEY);
    },

    async markBackedUp(at: string = new Date().toISOString()) {
      await writeMeta(LAST_BACKUP_KEY, at);
    },

    lastExportAt() {
      return readMeta<string>(LAST_EXPORT_KEY);
    },

    async markExported(at: string = new Date().toISOString()) {
      await writeMeta(LAST_EXPORT_KEY, at);
    },

    async status() {
      const supported = isBackupSupported();
      const handle = await manager.getFolder();
      const backedUp = await manager.lastBackupAt();
      const exported = await manager.lastExportAt();
      const permission = handle ? await permissionFor(handle, false) : 'none';

      // The most recent copy of either kind is what the indicator counts from,
      // and its kind is what the wording has to follow.
      const kind: CopyKind | null =
        backedUp === null && exported === null
          ? null
          : compareInstants(backedUp, exported) >= 0
            ? 'backup'
            : 'export';
      const lastCopyAt = kind === 'backup' ? backedUp : kind === 'export' ? exported : null;
      const days = daysSince(lastCopyAt);

      return {
        supported,
        folder: handle?.name ?? null,
        permission,
        lastBackupAt: backedUp,
        daysSinceBackup: daysSince(backedUp),
        lastExportAt: exported,
        daysSinceExport: daysSince(exported),
        lastCopyAt,
        lastCopyKind: kind,
        daysSinceCopy: days,
        stale: days === null || days >= BACKUP_STALE_DAYS,
        message: statusMessage(supported, handle !== null, days, kind),
      };
    },

    close() {
      const pending = db;
      db = null;
      if (pending) void pending.then((database) => database.close()).catch(() => undefined);
    },
  };

  return manager;
}

// ---------------------------------------------------------------------------
// The default manager, and the module-level surface bound to it
// ---------------------------------------------------------------------------

let defaultManager: BackupManager | null = null;

function shared(): BackupManager {
  defaultManager ??= createBackupManager();
  return defaultManager;
}

export function chooseBackupFolder(): Promise<ChooseFolderResult> {
  return shared().chooseFolder();
}

export function getBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  return shared().getFolder();
}

export function forgetBackupFolder(): Promise<void> {
  return shared().forgetFolder();
}

/** Call from a click: browsers only prompt for file permission on a gesture. */
export function requestBackupPermission(): Promise<HandlePermission | 'none'> {
  return shared().folderPermission({ request: true });
}

export function writeSnapshot(
  timeline: Timeline,
  options?: WriteSnapshotOptions,
): Promise<SnapshotResult> {
  return shared().writeSnapshot(timeline, options);
}

/** ISO instant of the last successful backup, for the "N days ago" indicator. */
export function lastBackupAt(): Promise<string | null> {
  return shared().lastBackupAt();
}

export function markBackedUp(at?: string): Promise<void> {
  return shared().markBackedUp(at);
}

/** ISO instant of the last export offered. A request to save, not a saved file. */
export function lastExportAt(): Promise<string | null> {
  return shared().lastExportAt();
}

export function markExported(at?: string): Promise<void> {
  return shared().markExported(at);
}

export function backupStatus(): Promise<BackupStatus> {
  return shared().status();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Whole days between an ISO instant and now; null if there is no instant. */
export function daysSince(at: string | null, now: Date = new Date()): number | null {
  if (!at) return null;
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return null;
  const elapsed = now.getTime() - then;
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

async function permissionFor(
  handle: FileSystemDirectoryHandle,
  request: boolean,
): Promise<HandlePermission> {
  const capable = handle as unknown as PermissionCapableHandle;
  try {
    if (typeof capable.queryPermission === 'function') {
      const state = await capable.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return 'granted';
      if (state === 'denied') return 'denied';
    } else if (typeof capable.requestPermission !== 'function') {
      // An implementation without the permission extension grants by holding
      // the handle. Let the write itself be the test.
      return 'granted';
    }

    if (request && typeof capable.requestPermission === 'function') {
      const state = await capable.requestPermission({ mode: 'readwrite' });
      if (state === 'granted') return 'granted';
      if (state === 'denied') return 'denied';
    }
    return 'prompt';
  } catch {
    // Requesting without a user gesture throws; that is a prompt still owed,
    // not a refusal.
    return 'prompt';
  }
}

/** Later of two instants: 1 if `a`, -1 if `b`, 0 if neither or both are absent. */
function compareInstants(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left)) return Number.isFinite(right) ? -1 : 0;
  if (!Number.isFinite(right)) return 1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function statusMessage(
  supported: boolean,
  hasFolder: boolean,
  days: number | null,
  kind: CopyKind | null,
): string {
  if (days === null || kind === null) {
    return supported && !hasFolder
      ? 'Not backed up yet. Choose a folder and it will keep itself up to date.'
      : 'Not backed up yet. Export the timeline to keep a copy outside the browser.';
  }
  // An export is a file the browser was asked to save, and the app never learns
  // whether it was. Saying "exported" rather than "backed up" is the whole of
  // the distinction, and the one the user needs to judge the figure by.
  const verb = kind === 'backup' ? 'Backed up' : 'Exported';
  if (days === 0) return `${verb} today.`;
  if (days === 1) return `${verb} yesterday.`;
  return `${verb} ${days} days ago.`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
