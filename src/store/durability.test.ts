import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  guessPrivateBrowsing,
  persistenceState,
  requestPersistence,
  storageEstimate,
} from './durability';

const GIGABYTE = 1024 * 1024 * 1024;

interface FakeStorage {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

function stubStorage(storage: FakeStorage | null): void {
  vi.stubGlobal('navigator', storage === null ? {} : { storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistence', () => {
  it('reports the browser cannot be asked, rather than throwing', async () => {
    stubStorage(null);
    const result = await requestPersistence();

    expect(result.supported).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.requested).toBe(false);
    expect(result.message).toMatch(/\S/);
  });

  it('asks when storage is not yet persistent', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({
      persist,
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ usage: 1, quota: 100 * GIGABYTE }),
    });

    const result = await requestPersistence();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ supported: true, persisted: true, requested: true });
    expect(result.message).toMatch(/keep this timeline/i);
  });

  it('does not ask again when the browser has already agreed', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({
      persist,
      persisted: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ quota: 100 * GIGABYTE }),
    });

    const result = await requestPersistence();

    expect(persist).not.toHaveBeenCalled();
    expect(result).toMatchObject({ persisted: true, requested: false });
  });

  it('says plainly what a refusal means for the data', async () => {
    stubStorage({
      persist: () => Promise.resolve(false),
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ quota: 100 * GIGABYTE }),
    });

    const result = await requestPersistence();

    expect(result.persisted).toBe(false);
    expect(result.message).toMatch(/may delete/i);
    expect(result.message).toMatch(/backup folder|home screen/i);
  });

  it('survives an API that throws', async () => {
    stubStorage({
      persist: () => Promise.reject(new Error('nope')),
      persisted: () => Promise.reject(new Error('nope')),
      estimate: () => Promise.reject(new Error('nope')),
    });

    const result = await requestPersistence();

    expect(result.persisted).toBe(false);
    expect(result.message).toMatch(/\S/);
  });

  it('warns about a private window instead of promising durability', async () => {
    stubStorage({
      persist: () => Promise.resolve(false),
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ usage: 0, quota: 100 * 1024 * 1024 }),
    });

    const result = await requestPersistence();

    expect(result.privateBrowsing).toBe('likely');
    expect(result.message).toMatch(/private window/i);
  });
});

describe('persistenceState', () => {
  it('reports without asking, so opening settings prompts nobody', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({
      persist,
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ quota: 100 * GIGABYTE }),
    });

    const result = await persistenceState();

    expect(persist).not.toHaveBeenCalled();
    expect(result).toMatchObject({ supported: true, persisted: false, requested: false });
  });

  it('reports cleanly on a browser without the API', async () => {
    stubStorage(null);
    const result = await persistenceState();
    expect(result.supported).toBe(false);
  });
});

describe('storageEstimate', () => {
  it('reports usage, quota and the ratio between them', async () => {
    stubStorage({ estimate: () => Promise.resolve({ usage: 2 * 1024 * 1024, quota: 4 * 1024 * 1024 }) });

    const result = await storageEstimate();

    expect(result.supported).toBe(true);
    expect(result.usage).toBe(2 * 1024 * 1024);
    expect(result.quota).toBe(4 * 1024 * 1024);
    expect(result.ratio).toBeCloseTo(0.5);
    expect(result.message).toBe('Using 2.0 MB of about 4.0 MB available.');
  });

  it('omits what the browser will not say', async () => {
    stubStorage({ estimate: () => Promise.resolve({}) });

    const result = await storageEstimate();

    expect(result.usage).toBeUndefined();
    expect(result.quota).toBeUndefined();
    expect(result.ratio).toBeUndefined();
  });

  it('reports unsupported where there is no storage manager', async () => {
    stubStorage(null);
    expect((await storageEstimate()).supported).toBe(false);
  });

  it('survives an estimate that throws', async () => {
    stubStorage({ estimate: () => Promise.reject(new Error('nope')) });
    await expect(storageEstimate()).resolves.toMatchObject({ supported: false });
  });
});

describe('guessPrivateBrowsing', () => {
  it('calls a tiny quota likely private', async () => {
    stubStorage({ estimate: () => Promise.resolve({ quota: 120 * 1024 * 1024 }) });
    expect(await guessPrivateBrowsing()).toBe('likely');
  });

  it('calls a disk-sized quota unlikely', async () => {
    stubStorage({ estimate: () => Promise.resolve({ quota: 200 * GIGABYTE }) });
    expect(await guessPrivateBrowsing()).toBe('unlikely');
  });

  it('admits it does not know when the browser says nothing', async () => {
    stubStorage(null);
    expect(await guessPrivateBrowsing()).toBe('unknown');

    stubStorage({ estimate: () => Promise.resolve({}) });
    expect(await guessPrivateBrowsing()).toBe('unknown');
  });
});
