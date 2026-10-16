import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createIndexedDbStore } from '../store';
import type { Store } from '../store';
import { DEMO_DB_NAME, isDemo, openDemoStore } from './demo';

const open: Store[] = [];
let counter = 0;

afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

async function demo(name: string): Promise<Store> {
  const store = await openDemoStore(name);
  open.push(store);
  return store;
}

describe('isDemo', () => {
  it('reads the query, with or without a value', () => {
    expect(isDemo('?demo')).toBe(true);
    expect(isDemo('?demo=1')).toBe(true);
    expect(isDemo('?x=1&demo')).toBe(true);
  });

  it('is off otherwise', () => {
    expect(isDemo('')).toBe(false);
    expect(isDemo('?demonstration')).toBe(false);
  });
});

describe('openDemoStore', () => {
  it('is not the real database', () => {
    expect(DEMO_DB_NAME).not.toBe('arlinje');
  });

  it('fills an empty store with the synthetic corpus', async () => {
    const store = await demo(`demo-test-${counter++}`);
    const timeline = await store.load();
    expect(timeline.events.length).toBe(2000);
    expect(timeline.connections.length).toBeGreaterThan(0);
    expect(timeline.eras.length).toBeGreaterThan(0);
  });

  it('leaves a store that already has something in it alone', async () => {
    const name = `demo-test-${counter++}`;
    const first = await demo(name);
    const seeded = await first.load();
    const kept = seeded.events.slice(0, 3);
    await first.replaceAll({ ...seeded, events: kept, connections: [] });
    first.close();

    const again = await demo(name);
    expect((await again.load()).events.map((event) => event.id)).toEqual(
      kept.map((event) => event.id),
    );
  });

  it('never writes to the real timeline', async () => {
    await demo(`demo-test-${counter++}`);
    const real = await createIndexedDbStore();
    open.push(real);
    expect((await real.load()).events).toEqual([]);
  });
});
