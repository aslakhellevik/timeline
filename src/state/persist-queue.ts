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

export class PersistQueue {
  private readonly pending = new Map<RecordKind, Map<string, Base>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly delayMs = 200,
    private readonly onError?: (error: unknown) => void,
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
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
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
    }
  }

  get size(): number {
    let total = 0;
    for (const bucket of this.pending.values()) total += bucket.size;
    return total;
  }
}
