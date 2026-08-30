/**
 * The schedule that makes layer 2 automatic (docs/design.md §8.3).
 *
 * Everything here is about *when* a snapshot is taken, never about what one
 * contains — `writeSnapshotTo` owns that, and is tested in `backup.test.ts`.
 * The rules worth holding still are the three the module exists to keep: never
 * prompt, only write when something changed, and flush first.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Timeline } from '../core/model/types';
import { AUTO_BACKUP_INTERVAL_MS, startAutoBackup } from './auto-backup';
import type { AutoBackupOptions } from './auto-backup';
import type { BackupStatus, SnapshotResult } from './backup';
import { sampleTimeline } from './fixtures';

function status(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    supported: true,
    folder: 'Backups',
    permission: 'granted',
    lastBackupAt: null,
    daysSinceBackup: null,
    lastExportAt: null,
    daysSinceExport: null,
    lastCopyAt: null,
    lastCopyKind: null,
    daysSinceCopy: null,
    stale: true,
    message: '',
    ...overrides,
  };
}

const ok: SnapshotResult = {
  ok: true,
  filename: 'timeline-2026-08-15.json',
  at: '2026-08-15T12:00:00.000Z',
  pruned: [],
};

const failed: SnapshotResult = {
  ok: false,
  reason: 'write-failed',
  message: 'disk full',
};

/** A schedule with everything injected, and a long interval so nothing fires. */
function harness(overrides: Partial<AutoBackupOptions> = {}) {
  const written: Timeline[] = [];
  let dirty: number | null = null;
  const write = vi.fn((timeline: Timeline) => {
    written.push(timeline);
    return Promise.resolve(ok);
  });
  const seen = vi.fn(() => Promise.resolve(status()));

  const backups = startAutoBackup({
    timeline: () => sampleTimeline(),
    dirtyAt: () => dirty,
    intervalMs: 60_000_000,
    status: seen,
    write,
    ...overrides,
  });

  return {
    backups,
    written,
    write,
    status: seen,
    touch: () => {
      dirty = (dirty ?? 0) + 1;
    },
  };
}

describe('startAutoBackup', () => {
  it('takes a snapshot on open, before anything has been changed', async () => {
    // The copy in the folder may be from another machine or a session that
    // ended in a crash; what has just loaded is the state worth having.
    const h = harness();
    await h.backups.tick('interval');

    expect(h.write).toHaveBeenCalledTimes(1);
    h.backups.stop();
  });

  it('does nothing on an interval when nothing has changed since', async () => {
    const h = harness();
    await h.backups.tick('interval');
    expect(await h.backups.tick('interval')).toBeNull();

    expect(h.write).toHaveBeenCalledTimes(1);
    // Not even a permission query: an idle tab left open overnight costs nothing.
    expect(h.status).toHaveBeenCalledTimes(1);
    h.backups.stop();
  });

  it('writes again once the timeline has changed', async () => {
    const h = harness();
    await h.backups.tick('interval');
    h.touch();
    await h.backups.tick('interval');

    expect(h.write).toHaveBeenCalledTimes(2);
    h.backups.stop();
  });

  it('writes on the way out when there is something new to save', async () => {
    const h = harness();
    await h.backups.tick('interval');
    h.touch();

    const result = await h.backups.tick('hide');
    expect(result?.ok).toBe(true);
    h.backups.stop();
  });

  it('never writes, and never asks, without permission already granted', async () => {
    // Browsers only prompt for folder access on a user gesture, and a dialog
    // raised by a ten-minute timer is how an app gets denied permanently.
    const h = harness({ status: () => Promise.resolve(status({ permission: 'prompt' })) });
    expect(await h.backups.tick('open')).toBeNull();
    expect(h.write).not.toHaveBeenCalled();
    h.backups.stop();
  });

  it('does nothing where layer 2 does not exist at all', async () => {
    const h = harness({
      status: () => Promise.resolve(status({ supported: false, permission: 'none', folder: null })),
    });
    expect(await h.backups.tick('open')).toBeNull();
    expect(h.write).not.toHaveBeenCalled();
    h.backups.stop();
  });

  it('flushes the write queue before taking the snapshot', async () => {
    // The debounce window is the likeliest data-loss path (§8.7): a snapshot
    // taken without flushing can be missing the edits it exists to protect.
    const order: string[] = [];
    const h = harness({
      flush: () => {
        order.push('flush');
        return Promise.resolve();
      },
      write: () => {
        order.push('write');
        return Promise.resolve(ok);
      },
    });
    await h.backups.tick('interval');

    expect(order).toEqual(['flush', 'write']);
    h.backups.stop();
  });

  it('stays dirty after a failed write, so the next cycle tries again', async () => {
    // Only a completed write clears the flag. A cycle that cleared it on
    // failure would leave the change unsaved until the *next* edit.
    const write = vi.fn(() => Promise.resolve(failed));
    const h = harness({ write });
    await h.backups.tick('interval'); // the snapshot on open, which fails
    h.touch();
    await h.backups.tick('interval');
    await h.backups.tick('interval');

    expect(write).toHaveBeenCalledTimes(3);
    h.backups.stop();
  });

  it('reports every write it makes, so the footer can catch up', async () => {
    const results: SnapshotResult[] = [];
    const h = harness({ onResult: (result) => results.push(result) });
    await h.backups.tick('interval');

    expect(results).toEqual([ok]);
    h.backups.stop();
  });

  it('runs on the interval, and stops when stopped', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      h.touch();
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.write).toHaveBeenCalledTimes(2);

      h.backups.stop();
      h.touch();
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.write).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes nothing after being stopped mid-cycle', async () => {
    // StrictMode mounts twice, so a stopped schedule really does have a cycle
    // in flight; finishing it would write from a schedule nobody is holding.
    const h = harness({
      flush: () => {
        h.backups.stop();
        return Promise.resolve();
      },
    });
    expect(await h.backups.tick('open')).toBeNull();
    expect(h.write).not.toHaveBeenCalled();
  });

  it('keeps §8.3’s ten minutes', () => {
    expect(AUTO_BACKUP_INTERVAL_MS).toBe(10 * 60_000);
  });
});
