import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotDirectory, SnapshotFile, SnapshotWritable } from './backup';
import {
  BACKUP_STALE_DAYS,
  SNAPSHOT_RETENTION,
  backupStatus,
  backupSupport,
  createBackupManager,
  daysSince,
  downloadExport,
  isBackupSupported,
  isSnapshotName,
  snapshotFilename,
  snapshotsToPrune,
  writeSnapshot,
  writeSnapshotTo,
} from './backup';
import { fromDocument, parseDocument } from './serialise';
import { sampleTimeline } from './fixtures';

/**
 * A directory in memory. Structural typing means this is exactly as much of the
 * File System Access API as the snapshot writer is allowed to use.
 */
class FakeDirectory implements SnapshotDirectory {
  readonly name = 'Backups';
  readonly files = new Map<string, string>();
  failWrites = false;

  constructor(seed: readonly string[] = []) {
    for (const filename of seed) this.files.set(filename, '{}');
  }

  getFileHandle(filename: string, options?: { create?: boolean }): Promise<SnapshotFile> {
    if (!this.files.has(filename) && options?.create !== true) {
      return Promise.reject(new Error(`no such file: ${filename}`));
    }
    const directory = this;
    const file: SnapshotFile = {
      createWritable(): Promise<SnapshotWritable> {
        let buffer = '';
        let aborted = false;
        return Promise.resolve({
          write(data: string): Promise<void> {
            if (directory.failWrites) return Promise.reject(new Error('disk full'));
            buffer += data;
            return Promise.resolve();
          },
          close(): Promise<void> {
            // Atomic, like the real thing: nothing is visible until close.
            if (!aborted) directory.files.set(filename, buffer);
            return Promise.resolve();
          },
          abort(): Promise<void> {
            aborted = true;
            return Promise.resolve();
          },
        });
      },
    };
    return Promise.resolve(file);
  }

  removeEntry(filename: string): Promise<void> {
    if (!this.files.delete(filename)) return Promise.reject(new Error('no such entry'));
    return Promise.resolve();
  }

  async *keys(): AsyncGenerator<string> {
    for (const filename of [...this.files.keys()]) yield filename;
  }
}

const AUGUST = new Date(2026, 7, 15, 12, 0, 0);
let counter = 0;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('support reporting', () => {
  it('says layer 2 is unavailable when there is no directory picker', () => {
    expect(isBackupSupported()).toBe(false);
    const support = backupSupport();
    expect(support.supported).toBe(false);
    expect(support.message).toMatch(/export/i);
  });

  it('says layer 2 is available when the picker exists', () => {
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve({}));
    expect(isBackupSupported()).toBe(true);
    expect(backupSupport().supported).toBe(true);
  });
});

describe('snapshot names', () => {
  it('names a snapshot for the local day', () => {
    expect(snapshotFilename(AUGUST)).toBe('timeline-2026-08-15.json');
    expect(snapshotFilename(new Date(2026, 0, 3))).toBe('timeline-2026-01-03.json');
  });

  it('recognises its own names and nothing else', () => {
    expect(isSnapshotName('timeline-2026-08-15.json')).toBe(true);
    expect(isSnapshotName('timeline-2026-8-5.json')).toBe(false);
    expect(isSnapshotName('timeline.json')).toBe(false);
    expect(isSnapshotName('my-thesis.json')).toBe(false);
  });
});

describe('snapshotsToPrune', () => {
  const names = Array.from(
    { length: 25 },
    (_, i) => `timeline-2026-07-${String(i + 1).padStart(2, '0')}.json`,
  );

  it('keeps the newest and prunes the rest', () => {
    const pruned = snapshotsToPrune(names, 20);
    expect(pruned).toHaveLength(5);
    expect(pruned).toEqual([
      'timeline-2026-07-05.json',
      'timeline-2026-07-04.json',
      'timeline-2026-07-03.json',
      'timeline-2026-07-02.json',
      'timeline-2026-07-01.json',
    ]);
  });

  it('prunes nothing below the retention limit', () => {
    expect(snapshotsToPrune(names.slice(0, 3), 20)).toEqual([]);
  });

  it('never returns a file it did not write', () => {
    const pruned = snapshotsToPrune(
      [...names, 'thesis.json', 'timeline.json', 'notes.md', 'timeline-2026-07.json'],
      1,
    );
    expect(pruned).toHaveLength(24);
    expect(pruned).not.toContain('thesis.json');
    expect(pruned).not.toContain('timeline.json');
    expect(pruned).not.toContain('notes.md');
    expect(pruned).not.toContain('timeline-2026-07.json');
  });

  it('defaults to the documented retention', () => {
    expect(SNAPSHOT_RETENTION).toBe(20);
    expect(snapshotsToPrune(names)).toHaveLength(5);
  });
});

describe('writeSnapshotTo', () => {
  it('writes a readable document named for the day', async () => {
    const directory = new FakeDirectory();
    const original = sampleTimeline();

    const result = await writeSnapshotTo(directory, original, { now: AUGUST });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe('timeline-2026-08-15.json');

    const written = directory.files.get('timeline-2026-08-15.json');
    expect(written).toBeDefined();
    expect(fromDocument(parseDocument(written ?? ''))).toEqual(original);
  });

  it('overwrites, rather than duplicates, a second write on the same day', async () => {
    const directory = new FakeDirectory();
    await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST });
    await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST });

    expect([...directory.files.keys()]).toEqual(['timeline-2026-08-15.json']);
  });

  it('prunes to the retention limit and leaves everything else alone', async () => {
    const seed = Array.from(
      { length: 25 },
      (_, i) => `timeline-2026-07-${String(i + 1).padStart(2, '0')}.json`,
    );
    const directory = new FakeDirectory([...seed, 'thesis.json', 'notes.md']);

    const result = await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pruned).toHaveLength(6);

    const remaining = [...directory.files.keys()];
    expect(remaining.filter(isSnapshotName)).toHaveLength(20);
    expect(remaining).toContain('timeline-2026-08-15.json');
    expect(remaining).toContain('thesis.json');
    expect(remaining).toContain('notes.md');
    expect(remaining).not.toContain('timeline-2026-07-01.json');
  });

  it('honours a custom retention', async () => {
    const directory = new FakeDirectory([
      'timeline-2026-07-01.json',
      'timeline-2026-07-02.json',
      'timeline-2026-07-03.json',
    ]);

    await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST, retain: 2 });

    expect([...directory.files.keys()].filter(isSnapshotName).sort()).toEqual([
      'timeline-2026-07-03.json',
      'timeline-2026-08-15.json',
    ]);
  });

  it('reports a failed write instead of throwing, and leaves the old file intact', async () => {
    const directory = new FakeDirectory(['timeline-2026-08-15.json']);
    directory.files.set('timeline-2026-08-15.json', '{"kept": true}');
    directory.failWrites = true;

    const result = await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('write-failed');
    expect(result.message).toContain('disk full');
    expect(directory.files.get('timeline-2026-08-15.json')).toBe('{"kept": true}');
  });

  it('still counts as a success when pruning fails', async () => {
    const directory = new FakeDirectory(
      Array.from({ length: 25 }, (_, i) => `timeline-2026-07-${String(i + 1).padStart(2, '0')}.json`),
    );
    directory.removeEntry = () => Promise.reject(new Error('permission lost'));

    const result = await writeSnapshotTo(directory, sampleTimeline(), { now: AUGUST });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pruned).toEqual([]);
  });
});

describe('the backup manager', () => {
  function manager() {
    return createBackupManager(`backup-test-${counter++}`);
  }

  it('remembers when the timeline was last backed up', async () => {
    const backup = manager();
    expect(await backup.lastBackupAt()).toBeNull();

    await backup.markBackedUp('2026-08-15T09:00:00.000Z');
    expect(await backup.lastBackupAt()).toBe('2026-08-15T09:00:00.000Z');

    backup.close();
  });

  it('has no folder until one is chosen', async () => {
    const backup = manager();
    expect(await backup.getFolder()).toBeNull();
    expect(await backup.folderPermission()).toBe('none');
    backup.close();
  });

  it('refuses to write a snapshot where the API does not exist', async () => {
    const backup = manager();
    const result = await backup.writeSnapshot(sampleTimeline());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
    backup.close();
  });

  it('reports no folder where the API exists but none was chosen', async () => {
    vi.stubGlobal('showDirectoryPicker', () => Promise.resolve({}));
    const backup = manager();
    const result = await backup.writeSnapshot(sampleTimeline());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-folder');
    backup.close();
  });

  it('treats a cancelled folder picker as a cancellation, not a failure', async () => {
    vi.stubGlobal('showDirectoryPicker', () => {
      const error = new Error('The user aborted a request.');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const backup = manager();
    const result = await backup.chooseFolder();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cancelled');
    backup.close();
  });

  it('reports the state the settings panel renders', async () => {
    const backup = manager();
    await backup.markBackedUp(new Date(Date.now() - 3 * 86_400_000).toISOString());

    const status = await backup.status();
    expect(status.supported).toBe(false);
    expect(status.folder).toBeNull();
    expect(status.permission).toBe('none');
    expect(status.daysSinceBackup).toBe(3);
    expect(status.stale).toBe(false);
    expect(status.message).toBe('Backed up 3 days ago.');

    backup.close();
  });

  it('goes stale past a week', async () => {
    const backup = manager();
    await backup.markBackedUp(
      new Date(Date.now() - (BACKUP_STALE_DAYS + 1) * 86_400_000).toISOString(),
    );

    const status = await backup.status();
    expect(status.stale).toBe(true);
    backup.close();
  });

  it('counts never having been backed up as stale', async () => {
    const backup = manager();
    const status = await backup.status();

    expect(status.lastBackupAt).toBeNull();
    expect(status.daysSinceBackup).toBeNull();
    expect(status.stale).toBe(true);
    expect(status.message).toMatch(/not backed up yet/i);
    backup.close();
  });
});

describe('daysSince', () => {
  it('counts whole days', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    expect(daysSince('2026-08-15T09:00:00Z', now)).toBe(0);
    expect(daysSince('2026-08-14T09:00:00Z', now)).toBe(1);
    expect(daysSince('2026-07-15T12:00:00Z', now)).toBe(31);
  });

  it('is null when there is nothing to count from', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince('not a date')).toBeNull();
  });

  it('never goes negative on a clock that has moved backwards', () => {
    expect(daysSince('2026-08-20T00:00:00Z', new Date('2026-08-15T00:00:00Z'))).toBe(0);
  });
});

describe('downloadExport', () => {
  it('reports that there is nowhere to download to, rather than throwing', async () => {
    const result = await downloadExport(sampleTimeline());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported');
  });
});

describe('the module-level surface', () => {
  it('answers without a chosen folder and without throwing', async () => {
    const result = await writeSnapshot(sampleTimeline());
    expect(result.ok).toBe(false);

    const status = await backupStatus();
    expect(status.supported).toBe(false);
    expect(typeof status.message).toBe('string');
  });
});
