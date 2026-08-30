import { describe, expect, it, vi } from 'vitest';
import type { ContainerLike, RegistrationLike, WorkerLike } from './service-worker';
import { onUpdateReady, trackUpdates } from './service-worker';

/**
 * The worker replaces itself and deletes the cache the running tab is using
 * (§7.2), so "a newer build is installed" is a state the app has to notice.
 * These are the three ways it can find out, each of which the other two miss.
 */
function fakes(controlled: boolean) {
  const listeners = new Map<string, (() => void)[]>();
  const on = (type: string, listener: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  const fire = (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener());

  /** A worker whose `statechange` can be fired by hand. */
  const worker = (): WorkerLike & { fire: () => void } => {
    const own: (() => void)[] = [];
    return {
      state: 'installing',
      addEventListener: (_type, listener) => own.push(listener),
      fire: () => own.forEach((listener) => listener()),
    };
  };

  const registration: RegistrationLike & { updates: number } = {
    installing: null,
    waiting: null,
    addEventListener: on,
    updates: 0,
    update() {
      registration.updates += 1;
      return Promise.resolve();
    },
  };
  const container: ContainerLike = {
    controller: controlled ? {} : null,
    addEventListener: on,
  };
  return { container, registration, fire, worker };
}

describe('trackUpdates', () => {
  const never = () => 0;

  it('reports a worker that was already waiting when the tab opened', () => {
    const { container, registration } = fakes(true);
    registration.waiting = { state: 'installed', addEventListener: () => {} };
    const ready = vi.fn();
    trackUpdates(container, registration, ready, never);
    expect(ready).toHaveBeenCalled();
  });

  it('reports one that installs while the tab is open', () => {
    const { container, registration, fire, worker } = fakes(true);
    const ready = vi.fn();
    trackUpdates(container, registration, ready, never);

    const arriving = worker();
    registration.installing = arriving;
    fire('updatefound');
    expect(ready).not.toHaveBeenCalled();

    arriving.state = 'installed';
    arriving.fire();
    expect(ready).toHaveBeenCalled();
  });

  it('reports one activated by another tab', () => {
    const { container, registration, fire } = fakes(true);
    const ready = vi.fn();
    trackUpdates(container, registration, ready, never);
    fire('controllerchange');
    expect(ready).toHaveBeenCalled();
  });

  it('says nothing on the very first install', () => {
    // An uncontrolled page being claimed is the app arriving, not a new version
    // of it — and "a new version is ready" on a first visit is a lie.
    const { container, registration, fire, worker } = fakes(false);
    const ready = vi.fn();
    trackUpdates(container, registration, ready, never);

    const arriving = worker();
    registration.installing = arriving;
    fire('updatefound');
    arriving.state = 'installed';
    arriving.fire();
    fire('controllerchange');
    expect(ready).not.toHaveBeenCalled();
  });

  it('ignores a worker that installs and then goes redundant', () => {
    const { container, registration, fire, worker } = fakes(true);
    const ready = vi.fn();
    trackUpdates(container, registration, ready, never);

    const arriving = worker();
    registration.installing = arriving;
    fire('updatefound');
    arriving.state = 'redundant';
    arriving.fire();
    expect(ready).not.toHaveBeenCalled();
  });

  it('keeps asking, hourly', () => {
    const { container, registration } = fakes(true);
    const scheduled: { task?: () => void; ms?: number } = {};
    trackUpdates(
      container,
      registration,
      () => {},
      (task, ms) => {
        scheduled.task = task;
        scheduled.ms = ms;
        return 0;
      },
    );
    expect(scheduled.ms).toBe(60 * 60 * 1000);
    scheduled.task?.();
    expect(registration.updates).toBe(1);
  });
});

describe('onUpdateReady', () => {
  it('answers immediately, so a late subscriber cannot miss the edge', () => {
    const seen: boolean[] = [];
    const stop = onUpdateReady((ready) => seen.push(ready));
    expect(seen).toHaveLength(1);
    stop();
  });
});
