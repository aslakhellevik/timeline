/**
 * Registering the service worker (docs/design.md §6.2, D40).
 *
 * Production only. In development the worker would cache modules Vite is busy
 * replacing, and the resulting "why is my edit not showing" is the classic way
 * to lose an afternoon.
 *
 * Registration failing is not an error worth surfacing: the app works without
 * it, and every reason it can fail — a private window, a browser that does not
 * support it, an insecure origin — is one the user cannot act on.
 *
 * An *update* is a different matter, and this used to register once and never
 * look again. The generated worker calls `skipWaiting` and deletes the old cache
 * on activate, so a new deployment can take over an open tab and evict the
 * assets that tab is still running: the page keeps working until it asks for
 * something it has not already loaded, and then fails for no visible reason.
 * Nothing here can prevent that — the swap is the worker's own decision — so the
 * app says so instead, and a reload is one click away.
 */

/** How often to ask. Hourly: a deployment is not urgent, a dead tab is. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

type Listener = (ready: boolean) => void;

let updateReady = false;
const listeners = new Set<Listener>();

function announce(): void {
  if (updateReady) return;
  updateReady = true;
  for (const listener of listeners) listener(true);
}

/**
 * Subscribe to "a newer build is installed".
 *
 * Called back immediately with the current answer, because the swap can happen
 * before React has mounted anything and a missed edge would leave the tab
 * running evicted code with nothing on screen to say so.
 */
export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(updateReady);
  return () => listeners.delete(listener);
}

/** The narrow slice of the API this file uses, so the rules can be tested. */
export interface WorkerLike {
  state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}
export interface RegistrationLike {
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
}
export interface ContainerLike {
  controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

/**
 * The update rules, given a registration.
 *
 * Three ways to learn the same thing, because each one alone has a hole: a
 * worker that was already waiting when this tab opened never fires
 * `updatefound`; a worker that installs while the tab is open never fires
 * `controllerchange` until it activates; and a worker activated by *another*
 * tab claims this one with neither. `controllerchange` is filtered on whether
 * the page was controlled to begin with, since the very first install claims an
 * uncontrolled page and that is not an update — it is the app arriving.
 */
export function trackUpdates(
  container: ContainerLike,
  registration: RegistrationLike,
  onReady: () => void = announce,
  schedule: (run: () => void, ms: number) => unknown = setInterval,
): void {
  const wasControlled = container.controller !== null;

  if (wasControlled && registration.waiting) onReady();

  registration.addEventListener('updatefound', () => {
    const arriving = registration.installing;
    if (!arriving) return;
    arriving.addEventListener('statechange', () => {
      if (arriving.state === 'installed' && wasControlled) onReady();
    });
  });

  container.addEventListener('controllerchange', () => {
    if (wasControlled) onReady();
  });

  schedule(() => void registration.update().catch(() => {}), UPDATE_INTERVAL_MS);
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('sw.js', { scope: '.' })
      .then((registration) => trackUpdates(navigator.serviceWorker, registration))
      .catch(() => {
        // Deliberately silent — see above.
      });
  });
}
