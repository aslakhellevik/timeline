/**
 * Identifiers. See docs/design.md D9 and D20.
 *
 * User-created records get a UUIDv7: time-ordered, so ids sort by creation and
 * index locality is good, and collision-free without coordination — which is
 * what makes offline creation and any later sync possible.
 *
 * Built-in records (the premade tags) instead get fixed namespaced ids like
 * `tag.region.europe`. This is what lets a pack say "Europe" and attach to the
 * Europe you already have, rather than silently creating a second one.
 */

import type { Id } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A record is built-in iff its id is not a UUID. No extra field needed, and no
 * way for the two id spaces to collide.
 */
export function isBuiltinId(id: Id): boolean {
  return !UUID_RE.test(id);
}

/**
 * UUIDv7: 48-bit big-endian millisecond timestamp, 4-bit version, 12 bits of
 * randomness, 2-bit variant, 62 bits of randomness. RFC 9562 §5.7.
 *
 * `now` is injectable so tests can pin the timestamp.
 */
export function uuidv7(now: number = Date.now()): Id {
  const bytes = new Uint8Array(16);

  // 48-bit timestamp, big-endian, into bytes 0..5.
  // Number is exact to 2^53, so ms timestamps are safe for another 200k years.
  const ts = Math.floor(now);
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  crypto.getRandomValues(bytes.subarray(6));

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  // RFC 4122 variant in the top two bits of byte 8.
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((bytes[i] as number).toString(16).padStart(2, '0'));
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** ISO instant with offset, local wall clock — the format used by all timestamps. */
export function nowIso(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}${offset}`
  );
}
