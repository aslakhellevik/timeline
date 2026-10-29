/**
 * Layer 2's schedule (docs/design.md §7.3): "on open and every ~10 minutes when
 * dirty".
 *
 * The layer §7.3 calls "the one that matters" was, for a while, entirely manual
 * — every part of it existed except the thing that runs it, so a folder chosen
 * in January still held January's snapshot in August unless the user remembered
 * to press "back up now". A backup that depends on being remembered is layer 3
 * with extra steps.
 *
 * Three rules the schedule keeps:
 *
 *   - **It never prompts.** Browsers only grant folder permission on a user
 *     gesture; asking from a timer would fail anyway, and a dialog raised by a
 *     ten-minute timer while someone is typing is the behaviour that gets an app
 *     denied permanently. If permission is not already granted, the cycle does
 *     nothing and the panel goes on saying so.
 *   - **It writes only when something changed.** The store stamps every
 *     mutation, and a cycle that finds the stamp unchanged since the last
 *     snapshot skips the write entirely — an idle tab left open overnight costs
 *     nothing and does not churn the folder.
 *   - **It flushes first.** The debounce window is the likeliest data-loss path
 *     (§7.7), so a snapshot taken without flushing could be missing the very
 *     edits it was scheduled to protect.
 *
 * No React, no store import: this module is driven from `App`, which hands it
 * the two things it cannot know — what the timeline currently is, and when it
 * last changed.
 */

import type { Timeline } from '../core/model/types';
import { backupStatus, writeSnapshot } from './backup';
import type { BackupStatus, SnapshotResult } from './backup';

/** §7.3's "every ~10 minutes". */
export const AUTO_BACKUP_INTERVAL_MS = 10 * 60_000;

/** Why a cycle ran. Only `'interval'` and `'hide'` require the timeline to be dirty. */
export type AutoBackupReason = 'open' | 'interval' | 'hide';

export interface AutoBackupOptions {
  /** The timeline as it is *now*, read at the moment of writing. */
  timeline(): Timeline;
  /**
   * A stamp that changes on every local mutation, or null when nothing has been
   * changed yet. Compared by value, never interpreted — a counter would do.
   */
  dirtyAt(): number | null;
  /** Pending writes reach the database before the snapshot is taken. */
  flush?(): Promise<void>;
  intervalMs?: number;
  /** Called after every cycle that actually wrote, so the footer can catch up. */
  onResult?(result: SnapshotResult): void;
  /** Injectable, for tests: the real ones talk to IndexedDB and a real folder. */
  status?(): Promise<BackupStatus>;
  write?(timeline: Timeline): Promise<SnapshotResult>;
}

export interface AutoBackup {
  /** Runs one cycle now. Resolves to null when the cycle decided not to write. */
  tick(reason: AutoBackupReason): Promise<SnapshotResult | null>;
  stop(): void;
}

/**
 * Starts the schedule: one snapshot on open, then one every `intervalMs` when
 * the timeline has changed since the last, and one more on `pagehide`.
 *
 * Returns a handle whose `stop` clears both the timer and the listener — the
 * app mounts twice under StrictMode, and two schedules on one folder would
 * write the same file twice a cycle.
 */
export function startAutoBackup(options: AutoBackupOptions): AutoBackup {
  const interval = options.intervalMs ?? AUTO_BACKUP_INTERVAL_MS;
  const status = options.status ?? backupStatus;
  const write = options.write ?? ((timeline: Timeline) => writeSnapshot(timeline));

  /** The mutation stamp the last successful snapshot covered. */
  let backedUpAt: number | null = null;
  let stopped = false;
  /** Cycles never overlap: a slow disk must not start a second write. */
  let running: Promise<SnapshotResult | null> = Promise.resolve(null);

  const cycle = async (reason: AutoBackupReason): Promise<SnapshotResult | null> => {
    if (stopped) return null;

    const dirty = options.dirtyAt();
    // "On open" is unconditional — the copy in the folder may be from another
    // machine, another tab, or a session that ended in a crash, and the state
    // just loaded is the one worth having.
    if (reason !== 'open' && dirty === backedUpAt) return null;

    // Asked before writing rather than let the write fail, because this is the
    // path that must never prompt: `writeSnapshot` requests permission, which
    // is right for a button and wrong for a timer.
    const current = await status();
    if (!current.supported || current.permission !== 'granted') return null;

    await options.flush?.();
    if (stopped) return null;

    const result = await write(options.timeline());
    // Only a completed write clears the dirty flag; a failed one leaves the
    // timeline dirty so the next cycle tries again.
    if (result.ok) backedUpAt = dirty;
    options.onResult?.(result);
    return result;
  };

  const tick = (reason: AutoBackupReason): Promise<SnapshotResult | null> => {
    running = running.then(
      () => cycle(reason),
      () => cycle(reason),
    );
    return running;
  };

  const timer = setInterval(() => void tick('interval'), interval);
  // Node keeps the event loop alive for a pending interval; browsers have no
  // `unref`, and a test that starts a schedule must not hang the run.
  (timer as { unref?: () => void }).unref?.();

  // `pagehide`, not `beforeunload`: the latter is unreliable on mobile, which is
  // where a tab is most likely to be discarded without warning (§7.7).
  const onHide = (): void => void tick('hide');
  const scope = globalThis as {
    addEventListener?: typeof addEventListener;
    removeEventListener?: typeof removeEventListener;
  };
  scope.addEventListener?.('pagehide', onHide);

  void tick('open');

  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
      scope.removeEventListener?.('pagehide', onHide);
    },
  };
}
