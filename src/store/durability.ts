/**
 * Layer 1 of docs/design.md §7.3: ask the browser not to throw the data away.
 *
 * IndexedDB is durable in the ordinary sense — it survives reloads, crashes and
 * reboots. It is not durable against the browser reclaiming space (§7.2), and
 * `navigator.storage.persist()` is the only lever the page has over that. It is
 * a request, not a guarantee, so everything here reports rather than promises.
 *
 * Nothing in this module throws. It runs on browsers where none of these APIs
 * exist, and a settings panel that explodes on Firefox is worse than one that
 * says "not available here".
 */

/**
 * A guess, and labelled as one. There is no reliable private-browsing test in
 * any current browser; the quota heuristic below is the least-bad signal.
 */
export type PrivateBrowsingGuess = 'likely' | 'unlikely' | 'unknown';

export interface PersistenceResult {
  /** Whether the browser exposes the storage-persistence API at all. */
  supported: boolean;
  /** Whether storage is currently exempt from eviction. */
  persisted: boolean;
  /** Whether this call actually asked, as opposed to only reporting the state. */
  requested: boolean;
  privateBrowsing: PrivateBrowsingGuess;
  /** Ready to render in settings. */
  message: string;
}

export interface StorageEstimateResult {
  supported: boolean;
  /** Bytes used by this origin, when the browser will say. */
  usage?: number;
  /** Bytes this origin may use. Chromium reports a large fraction of free disk. */
  quota?: number;
  /** `usage / quota`, when both are known. */
  ratio?: number;
  message: string;
}

/**
 * Chromium's incognito quota is a small fixed cap rather than a share of the
 * disk. A normal window on any modern machine reports far more than this.
 */
const PRIVATE_QUOTA_CEILING = 300 * 1024 * 1024;

/**
 * Asks the browser to keep this origin's storage until the user deletes it
 * (§7.3, layer 1). Call it on first write — Chromium grants it silently for
 * installed or high-engagement sites, so asking early and asking once is right.
 */
export async function requestPersistence(): Promise<PersistenceResult> {
  const storage = getStorageManager();
  const privateBrowsing = await guessPrivateBrowsing();

  if (!storage || typeof storage.persist !== 'function') {
    return {
      supported: false,
      persisted: false,
      requested: false,
      privateBrowsing,
      message: unsupportedMessage(privateBrowsing),
    };
  }

  try {
    let persisted = await queryPersisted(storage);
    let requested = false;
    if (!persisted) {
      persisted = await storage.persist();
      requested = true;
    }
    return {
      supported: true,
      persisted,
      requested,
      privateBrowsing,
      message: persistenceMessage(persisted, privateBrowsing),
    };
  } catch {
    return {
      supported: true,
      persisted: false,
      requested: true,
      privateBrowsing,
      message:
        'The browser refused to say whether it will keep this timeline. ' +
        'Treat it as temporary and keep a backup folder.',
    };
  }
}

/**
 * The same report without asking — for rendering settings, which should not
 * fire a permission request every time the panel opens.
 */
export async function persistenceState(): Promise<PersistenceResult> {
  const storage = getStorageManager();
  const privateBrowsing = await guessPrivateBrowsing();

  if (!storage || typeof storage.persisted !== 'function') {
    return {
      supported: false,
      persisted: false,
      requested: false,
      privateBrowsing,
      message: unsupportedMessage(privateBrowsing),
    };
  }

  const persisted = await queryPersisted(storage);
  return {
    supported: true,
    persisted,
    requested: false,
    privateBrowsing,
    message: persistenceMessage(persisted, privateBrowsing),
  };
}

/** How much room the timeline is using, when the browser will say. */
export async function storageEstimate(): Promise<StorageEstimateResult> {
  const storage = getStorageManager();
  if (!storage || typeof storage.estimate !== 'function') {
    return { supported: false, message: 'This browser does not report storage use.' };
  }

  try {
    const estimate = await storage.estimate();
    const result: StorageEstimateResult = { supported: true, message: '' };
    if (typeof estimate.usage === 'number') result.usage = estimate.usage;
    if (typeof estimate.quota === 'number') result.quota = estimate.quota;
    if (
      typeof estimate.usage === 'number' &&
      typeof estimate.quota === 'number' &&
      estimate.quota > 0
    ) {
      result.ratio = estimate.usage / estimate.quota;
    }
    result.message =
      result.usage === undefined || result.quota === undefined
        ? 'This browser does not report storage use.'
        : `Using ${formatBytes(result.usage)} of about ${formatBytes(result.quota)} available.`;
    return result;
  } catch {
    return { supported: false, message: 'This browser does not report storage use.' };
  }
}

/**
 * Best-effort private-window detection (§7.2: "detect and warn"). A small quota
 * is the signal Chromium gives; Safari and Firefox private windows are not
 * distinguishable from the page, so `'unknown'` is an honest answer and the UI
 * should word it as a possibility, never a finding.
 */
export async function guessPrivateBrowsing(): Promise<PrivateBrowsingGuess> {
  const storage = getStorageManager();
  if (!storage || typeof storage.estimate !== 'function') return 'unknown';
  try {
    const { quota } = await storage.estimate();
    if (typeof quota !== 'number') return 'unknown';
    return quota < PRIVATE_QUOTA_CEILING ? 'likely' : 'unlikely';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getStorageManager(): StorageManager | null {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const storage = nav?.storage as StorageManager | undefined;
  return storage ?? null;
}

async function queryPersisted(storage: StorageManager): Promise<boolean> {
  if (typeof storage.persisted !== 'function') return false;
  try {
    return await storage.persisted();
  } catch {
    return false;
  }
}

function persistenceMessage(persisted: boolean, guess: PrivateBrowsingGuess): string {
  if (guess === 'likely') {
    return (
      'This looks like a private window. Anything saved here is deleted when ' +
      'you close it — export the timeline before you finish.'
    );
  }
  return persisted
    ? 'Your browser has agreed to keep this timeline until you delete it.'
    : 'Your browser may delete this timeline if it needs space. Choose a backup ' +
        'folder, or install the app to your home screen, to keep it safe.';
}

function unsupportedMessage(guess: PrivateBrowsingGuess): string {
  if (guess === 'likely') {
    return (
      'This looks like a private window. Anything saved here is deleted when ' +
      'you close it — export the timeline before you finish.'
    );
  }
  return (
    'This browser cannot promise to keep the timeline. Export it regularly, ' +
    'and on iOS add the app to your home screen.'
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
