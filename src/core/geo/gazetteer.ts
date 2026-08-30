/**
 * The bundled gazetteer (docs/design.md §11.4).
 *
 * `PlaceField` used to accept coordinates and nothing else, which meant that
 * typing `Constantinople` — a first-class `Place.name` in the data model —
 * reddened the box. The fix needs somewhere to look a name up, and the one thing
 * this app will not do is ask the network at capture time (D25): geocoding a
 * place name is exactly the request that would leak what the user is reading, to
 * a third party, on a timeline they were told never leaves the device.
 *
 * So the gazetteer is bundled — twelve kilobytes of text, next to the fifty-five
 * of coastline already committed for the same reason. It is deliberately small
 * and deliberately biased towards *history*: a modern gazetteer has ten million
 * entries and not one of them is Carthage.
 *
 * A hit is a suggestion, never an autocorrect. Nothing here rewrites what the
 * user typed; the name is stored as authored either way (see `PlaceField`), and
 * choosing a suggestion is what attaches the coordinates.
 */

import { GAZETTEER_PLACES } from './gazetteer-places';

export interface GazetteerPlace {
  name: string;
  lat: number;
  lon: number;
  /** Radius in km within which the point is accurate — the D43 halo's size. */
  precision: number;
}

interface Entry extends GazetteerPlace {
  /** Lower case, diacritics stripped, punctuation collapsed to single spaces. */
  fold: string;
  /** The same with the spaces gone, so `chang'an` finds `Chang'an`. */
  tight: string;
}

/**
 * Case, accents and punctuation are all noise in a place name.
 *
 * `Cordoba` must find "Córdoba" and `chang an` must find "Chang'an" — a user
 * typing a place into a one-line box is not going to reproduce an apostrophe or
 * an acute, and refusing them would send them back to coordinates, which is the
 * failure this whole module exists to fix.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let entries: Entry[] | null = null;

/** Parsed on first use, not at import: most sessions never open a place field. */
function all(): Entry[] {
  if (entries) return entries;
  const parsed: Entry[] = [];
  for (const line of GAZETTEER_PLACES.split('\n')) {
    if (line.length === 0) continue;
    const [name, lat, lon, precision] = line.split('|');
    if (name === undefined || lat === undefined || lon === undefined) continue;
    const folded = fold(name);
    parsed.push({
      name,
      lat: Number(lat),
      lon: Number(lon),
      precision: Number(precision) || 25,
      fold: folded,
      tight: folded.replace(/ /g, ''),
    });
  }
  entries = parsed;
  return parsed;
}

/** How many places the gazetteer holds. Exported for the tests and nothing else. */
export function gazetteerSize(): number {
  return all().length;
}

/**
 * Rank, lowest first. Where the query matched matters more than anything about
 * the place: someone typing `rome` means Rome, not Romefordshire.
 */
function rank(entry: Entry, query: string, tight: string): number {
  if (entry.fold === query) return 0;
  if (entry.fold.startsWith(query)) return 1;
  // A word inside the name: `sudan` should offer "S. Sudan" as well as "Sudan".
  if (entry.fold.includes(` ${query}`)) return 2;
  if (entry.tight.includes(tight)) return 3;
  return Infinity;
}

/**
 * The place a name means exactly, or null.
 *
 * The difference between a name the gazetteer knows and one it does not is the
 * whole of the place field's behaviour: typing `Constantinople` and pressing
 * Enter should put the event on the map, and typing `grandma's house` should
 * store the words and say honestly that it is not on the map. Matching is the
 * same fold `searchPlaces` uses, so the two can never disagree about what
 * counts as the same name.
 */
export function findPlace(name: string): GazetteerPlace | null {
  const folded = fold(name);
  if (folded.length === 0) return null;
  for (const entry of all()) {
    if (entry.fold === folded) {
      return { name: entry.name, lat: entry.lat, lon: entry.lon, precision: entry.precision };
    }
  }
  return null;
}

/**
 * Places whose name matches `query`, best first.
 *
 * Ties break on the shorter name, which is a decent proxy for "the one they
 * meant" — `Congo` before `Dem. Rep. Congo` — and then alphabetically, so the
 * list a user sees does not depend on the order of the data file.
 *
 * A single letter matches too much to be a query, so it returns nothing rather
 * than the first six of two hundred names beginning with `a`.
 */
export function searchPlaces(query: string, limit = 6): GazetteerPlace[] {
  const folded = fold(query);
  if (folded.length < 2) return [];
  const tight = folded.replace(/ /g, '');

  const hits: { entry: Entry; rank: number }[] = [];
  for (const entry of all()) {
    const score = rank(entry, folded, tight);
    if (score < Infinity) hits.push({ entry, rank: score });
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name, 'en-GB'),
  );

  return hits.slice(0, limit).map(({ entry }) => ({
    name: entry.name,
    lat: entry.lat,
    lon: entry.lon,
    precision: entry.precision,
  }));
}
