import { describe, expect, it, vi } from 'vitest';
import type { RecordKind, Store, StoreChange } from '../store/contract';
import type { Timeline } from '../core/model/types';
import { PersistQueue } from './persist-queue';
import { EMPTY_TIMELINE } from './timeline-model';

function fakeStore(overrides: Partial<Store> = {}): Store & { writes: [RecordKind, string[]][] } {
  const writes: [RecordKind, string[]][] = [];
  return {
    writes,
    load: async (): Promise<Timeline> => EMPTY_TIMELINE,
    put: async (kind, records) => {
      writes.push([kind, records.map((r) => r.id)]);
    },
    replaceAll: async () => {},
    subscribe: (_: (change: StoreChange) => void) => () => {},
    close: () => {},
    ...overrides,
  };
}

const record = (id: string) => ({ id, created_at: 'x', updated_at: 'x' });

describe('PersistQueue', () => {
  it('coalesces repeated edits of one record into a single write', async () => {
    const store = fakeStore();
    const queue = new PersistQueue(store, 0);

    for (let i = 0; i < 20; i++) {
      queue.enqueue([{ kind: 'events', records: [record('ev-1')] }]);
    }
    await queue.flush();

    expect(store.writes).toEqual([['events', ['ev-1']]]);
  });

  it('groups by kind', async () => {
    const store = fakeStore();
    const queue = new PersistQueue(store, 0);

    queue.enqueue([
      { kind: 'events', records: [record('ev-1'), record('ev-2')] },
      { kind: 'tags', records: [record('tag-1')] },
    ]);
    await queue.flush();

    expect(store.writes).toHaveLength(2);
    expect(store.writes.find(([kind]) => kind === 'events')?.[1]).toEqual(['ev-1', 'ev-2']);
    expect(store.writes.find(([kind]) => kind === 'tags')?.[1]).toEqual(['tag-1']);
  });

  it('keeps the latest version of a record, not the first', async () => {
    const store = fakeStore();
    const captured: unknown[] = [];
    const spying = fakeStore({
      put: async (_kind, records) => {
        captured.push(...records);
      },
    });
    void store;

    const queue = new PersistQueue(spying, 0);
    queue.enqueue([{ kind: 'events', records: [{ ...record('ev-1'), updated_at: 'first' }] }]);
    queue.enqueue([{ kind: 'events', records: [{ ...record('ev-1'), updated_at: 'second' }] }]);
    await queue.flush();

    expect(captured).toHaveLength(1);
    expect((captured[0] as { updated_at: string }).updated_at).toBe('second');
  });

  it('retries rather than losing edits when a write fails', async () => {
    let failNext = true;
    const seen: string[][] = [];
    const store = fakeStore({
      put: async (_kind, records) => {
        if (failNext) {
          failNext = false;
          throw new Error('quota exceeded');
        }
        seen.push(records.map((r) => r.id));
      },
    });

    const onError = vi.fn();
    const queue = new PersistQueue(store, 0, onError);

    queue.enqueue([{ kind: 'events', records: [record('ev-1')] }]);
    await queue.flush();

    expect(onError).toHaveBeenCalledOnce();
    expect(queue.size).toBe(1); // still pending, not dropped

    await queue.flush();
    expect(seen).toEqual([['ev-1']]);
    expect(queue.size).toBe(0);
  });

  it('reports nothing pending once flushed', async () => {
    const queue = new PersistQueue(fakeStore(), 0);
    queue.enqueue([{ kind: 'eras', records: [record('era-1')] }]);
    expect(queue.size).toBe(1);
    await queue.flush();
    expect(queue.size).toBe(0);
  });

  it('flushing an empty queue is a no-op', async () => {
    const store = fakeStore();
    await new PersistQueue(store, 0).flush();
    expect(store.writes).toHaveLength(0);
  });
});
