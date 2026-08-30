/**
 * Batches record writes to the store (docs/design.md §8.1).
 *
 * Typing in a note fires a mutation per keystroke; writing each one straight
 * through would mean a transaction per character. The queue coalesces by record
 * id, so the last version of each touched record within the window is what
 * lands, and a burst of edits costs one transaction per kind.
 */

import type { Base } from '../core/model/types';
import type { RecordKind, Store } from '../store/contract';
import type { Touched } from './timeline-model';

/** Ceiling on the retry backoff, so a store that is simply full stops thrashing. */
const MAX_RETRY_MS = 30_000;

export class PersistQueue {
  private readonly pending = new Map<RecordKind, Map<string, Base>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /** Zero while healthy; doubles per consecutive failure. */
  private retryMs = 0;

  constructor(
    private readonly store: Store,
    private readonly delayMs = 200,
    /**
     * Reports a failed write, and `null` once a later one succeeds. Without the
     * second half the app shows "quota exceeded" for the rest of the session,
     * long after the write it refers to has landed.
     */
    private readonly onError?: (error: unknown | null) => void,
  ) {}

  enqueue(touched: readonly Touched[]): void {
    for (const group of touched) {
      let bucket = this.pending.get(group.kind);
      if (!bucket) {
        bucket = new Map();
        this.pending.set(group.kind, bucket);
      }
      // Later versions of the same record replace earlier ones — only the final
      // state needs to reach disk.
      for (const record of group.records) bucket.set(record.id, record);
    }
    this.schedule(this.delayMs);
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** Writes everything pending. Safe to call at any time; used on unload. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialise flushes so two overlapping bursts cannot interleave transactions.
    this.inFlight = (this.inFlight ?? Promise.resolve()).then(() => this.writePending());
    return this.inFlight;
  }

  /**
   * Drops everything pending and cancels the timer.
   *
   * For "start over" (§8.7a): a record still queued when the database is
   * emptied is written back a moment later and resurrects on the next load,
   * which is the one way to lose the reset the user just asked for.
   */
  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    this.retryMs = 0;
  }

  private async writePending(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = [...this.pending.entries()];
    this.pending.clear();

    try {
      for (const [kind, records] of batch) {
        await this.store.put(kind, [...records.values()]);
      }
    } catch (error) {
      // Put the batch back so the next flush retries rather than losing edits.
      for (const [kind, records] of batch) {
        const bucket = this.pending.get(kind) ?? new Map<string, Base>();
        for (const [id, record] of records) if (!bucket.has(id)) bucket.set(id, record);
        this.pending.set(kind, bucket);
      }
      this.onError?.(error);
      // Re-queueing alone only helps if something else writes later. A tab left
      // idle after a failed write would never try again and would lose the
      // batch on close, so the retry is scheduled here, backing off because the
      // usual causes — quota, a blocked upgrade — do not clear in a moment.
      this.retryMs = Math.min(
        this.retryMs === 0 ? Math.max(this.delayMs, 1) * 2 : this.retryMs * 2,
        MAX_RETRY_MS,
      );
      this.schedule(this.retryMs);
      return;
    }

    if (this.retryMs !== 0) {
      this.retryMs = 0;
      this.onError?.(null);
    }
  }

  get size(): number {
    let total = 0;
    for (const bucket of this.pending.values()) total += bucket.size;
    return total;
  }
}
