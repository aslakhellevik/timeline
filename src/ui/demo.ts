import { createIndexedDbStore } from '../store';
import type { Store } from '../store';

/**
 * The demo timeline: `?demo` (docs/design.md §9, D68).
 *
 * The app starts empty on purpose, which makes it the hardest possible thing to
 * show anyone — and the renderer and the map can only be judged
 * against a corpus with shape. So `?demo` opens a *second* database, filled once
 * from the synthetic generator the renderer was tuned against.
 *
 * A second database, not a second dataset in the first: the demo must be unable
 * to touch the real timeline, and a separate name is the one guarantee that
 * needs no care elsewhere. The cross-tab channel is named after the database, so
 * a demo tab and a real one do not hear each other either. What the two do share
 * is the origin — the backup folder, its timestamps, the persistence grant — and
 * the app keeps the demo away from the first two itself (see `App`, `DataPanel`).
 */

export const DEMO_DB_NAME = 'arlinje-demo';

/** Whether this page load is the demo. A query parameter, because the hash is state (D24). */
export function isDemo(search: string): boolean {
  return new URLSearchParams(search).has('demo');
}

/**
 * Opens the demo database, seeding it if it is empty.
 *
 * Only an *empty* store is seeded, so whatever someone adds while trying the app
 * is still there on reload, and "start over" in the demo gives the first-run
 * screen as it does anywhere else; the next `?demo` load fills it again. The
 * generator is imported lazily so the real app never downloads it.
 */
export async function openDemoStore(name: string = DEMO_DB_NAME): Promise<Store> {
  const store = await createIndexedDbStore(name);
  try {
    const existing = await store.load();
    if (existing.events.length === 0 && existing.eras.length === 0) {
      const { generateTimeline } = await import('../core/testing/synthetic');
      await store.replaceAll(generateTimeline());
    }
  } catch (error) {
    store.close();
    throw error;
  }
  return store;
}
