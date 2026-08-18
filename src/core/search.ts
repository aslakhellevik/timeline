/**
 * Search over the in-memory store (design.md §6.2–6.3).
 *
 * Two jobs, one file, because they are the same matching problem:
 *
 *  - `searchEvents` is what makes the list view usable, and is the event picker
 *    the connection flow (M3) will pick a second event with. Scrubbing a density
 *    plot to find "that event I added in March" is absurd; this is the answer.
 *  - `findPossibleDuplicates` is the capture-time guard. A tool optimised for
 *    fast capture will otherwise collect the Battle of Lepanto twice, and the
 *    density is corrupted quietly — no error, just a slightly wrong picture of
 *    what someone knows.
 *
 * **A linear scan is the right implementation at this size** (§6.3). 50k events
 * per keystroke is a few milliseconds, and there is a test that says so rather
 * than an assumption that it is true. No index, no worker, until measurement
 * says otherwise.
 *
 * The one concession to speed is memoising the folded form of each event's text,
 * keyed weakly by the event object. That is not an index: it caches a pure
 * function of a record, and because the store replaces records on edit rather
 * than mutating them, the cache invalidates itself.
 */

import type { Id, TimeSpec, TimelineEvent } from './model/types';
import { DAYS_PER_YEAR, midpoint } from './time';

export interface SearchHit {
  event: TimelineEvent;
  score: number;
}

export interface SearchOptions {
  /** Tag id → display name, so a query can match a tag the event carries. */
  tagNames?: ReadonlyMap<Id, string>;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Combining marks, so `Tarnógol` folds to `tarnogol` after NFD. */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Letters that carry no combining mark to strip, so NFD leaves them alone. A
 * Norwegian user types "blabaer" for "blåbær" and expects a hit: `å` decomposes
 * and is handled above, but `æ` and `ø` are letters in their own right and have
 * to be spelled out by hand.
 */
const FOLDABLE = /[æøœßðþđłıĳŧ]/g;
const FOLDED: Readonly<Record<string, string>> = {
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  đ: 'd',
  ł: 'l',
  ı: 'i',
  ĳ: 'ij',
  ŧ: 't',
};

/** Fast path: ASCII text needs no decomposition, and nearly all of it is ASCII. */
const NON_ASCII = /[^\u0000-\u007F]/;

/**
 * Case- and diacritic-insensitive comparison form. Everything — queries, titles,
 * notes, tag names — passes through here, so "tarnogol" finds "Tarnógol" and
 * "TARNOGOL" finds it too.
 */
function fold(text: string): string {
  const lower = text.toLowerCase();
  if (!NON_ASCII.test(lower)) return lower;
  return lower
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(FOLDABLE, (ch: string): string => FOLDED[ch] ?? ch);
}

const LOWER_A = 97;
const LOWER_Z = 122;

/**
 * One bit per letter a–z present in the text. A subsequence match needs every
 * letter of the query to be somewhere in the title, so one integer test rejects
 * almost every candidate before the fuzzy scan walks a single character.
 * Anything that is not an ASCII letter contributes no bit, which can only make
 * the test weaker — never wrong.
 */
function letterMask(text: string): number {
  let mask = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= LOWER_A && code <= LOWER_Z) mask |= 1 << (code - LOWER_A);
  }
  return mask;
}

interface FoldedEvent {
  /** The record this was folded from. Identity is what validates the cache. */
  event: TimelineEvent;
  title: string;
  titleLetters: number;
  notes: string | null;
  learnedFrom: string | null;
}

function foldEvent(event: TimelineEvent): FoldedEvent {
  const title = fold(event.title);
  return {
    event,
    title,
    titleLetters: letterMask(title),
    notes: event.notes === undefined ? null : fold(event.notes),
    learnedFrom: event.learned_from === undefined ? null : fold(event.learned_from),
  };
}

/**
 * Folded text for a whole corpus, cached against the array it came from.
 *
 * A `WeakMap` keyed by each *event* is the obvious shape and is the wrong one:
 * measured at 50k records it costs around 400 ns per lookup, which is most of a
 * keystroke's budget spent before any matching happens. Keyed by the array
 * instead, it costs one lookup per search and the per-event check becomes an
 * identity comparison.
 *
 * Staleness is handled by that same comparison rather than by invalidation:
 * every entry remembers the record it was built from, so an edited event — the
 * store replaces records rather than mutating them — simply re-folds on the next
 * search. Nothing has to remember to clear anything.
 */
const corpusCache = new WeakMap<readonly TimelineEvent[], FoldedEvent[]>();

function foldedCorpus(events: readonly TimelineEvent[]): FoldedEvent[] {
  const cached = corpusCache.get(events);
  if (cached !== undefined) {
    if (cached.length !== events.length) cached.length = events.length;
    return cached;
  }
  const fresh: FoldedEvent[] = new Array<FoldedEvent>(events.length);
  corpusCache.set(events, fresh);
  return fresh;
}

function foldedAt(folded: FoldedEvent[], event: TimelineEvent, index: number): FoldedEvent {
  const cached = folded[index];
  if (cached !== undefined && cached.event === event) return cached;
  const fresh = foldEvent(event);
  folded[index] = fresh;
  return fresh;
}

/** Code unit order, never `localeCompare` — see §1's conventions list. */
function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function startsWord(text: string, index: number): boolean {
  return index === 0 || !isWordChar(text[index - 1]);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The tiers, in the order §6.3 asks for: a title prefix beats a title substring
 * beats a notes match beats a fuzzy-only match. The gaps are wide enough that
 * the within-tier bonus below can never lift one tier into the next, so the
 * ranking is decided by *how* an event matched before anything else is
 * considered.
 *
 * A match at a word boundary sits between prefix and plain substring: most
 * titles in this corpus open with "the", so a strict prefix match is rare and
 * "lepanto" hitting "the battle of lepanto" is what a good result usually looks
 * like.
 */
const TIER = {
  titlePrefix: 1000,
  titleWord: 900,
  titleSubstring: 800,
  tag: 600,
  learnedFrom: 500,
  notes: 400,
  fuzzyTitle: 200,
} as const;

/** Ceiling on the within-tier bonus. Below the 100-point gap between tiers. */
const BONUS = 80;

/** Below three characters a subsequence matches almost everything; substring is enough. */
const MIN_FUZZY_QUERY = 3;

/**
 * How far a fuzzy match may stretch: at most three times the query's length.
 * Fuzzy exists for typos and for half-remembered titles, not to spread five
 * letters across a whole sentence and call it a hit.
 */
const MAX_FUZZY_STRETCH = 3;

/**
 * Width of the tightest window of `hay` containing `needle` as a subsequence, or
 * null if it does not. Greedy forwards to find the earliest end, then backwards
 * from that end to pull the start in as far as it goes — the standard cheap
 * approximation, which can miss a narrower window elsewhere in the string but
 * never reports one that is not there.
 */
function subsequenceSpan(hay: string, needle: string): number | null {
  // charCodeAt rather than indexing: `hay[i]` allocates a one-character string
  // per comparison, and this loop runs over every title that did not match.
  let i = 0;
  let j = 0;
  while (i < hay.length && j < needle.length) {
    if (hay.charCodeAt(i) === needle.charCodeAt(j)) j++;
    i++;
  }
  if (j < needle.length) return null;
  const end = i;
  let k = end - 1;
  let n = needle.length - 1;
  while (k >= 0 && n >= 0) {
    if (hay.charCodeAt(k) === needle.charCodeAt(n)) n--;
    k--;
  }
  return end - (k + 1);
}

/** 0 when the event does not match at all. */
function scoreEvent(
  event: TimelineEvent,
  folded: FoldedEvent,
  needle: string,
  needleLetters: number,
  matchingTags: ReadonlySet<Id> | null,
): number {
  const title = folded.title;
  const at = title.indexOf(needle);
  if (at >= 0) {
    // How much of the title the query accounts for: "lepanto" in "lepanto" is a
    // better hit than "lepanto" in a thirty-word sentence that contains it.
    const bonus = Math.round((BONUS * needle.length) / title.length);
    if (at === 0) return TIER.titlePrefix + bonus;
    return (startsWord(title, at) ? TIER.titleWord : TIER.titleSubstring) + bonus;
  }

  if (matchingTags !== null) {
    for (const id of event.tags) {
      if (matchingTags.has(id)) return TIER.tag;
    }
  }
  if (folded.learnedFrom !== null && folded.learnedFrom.includes(needle)) {
    return TIER.learnedFrom;
  }
  if (folded.notes !== null && folded.notes.includes(needle)) {
    return TIER.notes;
  }

  if (needle.length >= MIN_FUZZY_QUERY && (needleLetters & ~folded.titleLetters) === 0) {
    const span = subsequenceSpan(title, needle);
    if (span !== null && span <= needle.length * MAX_FUZZY_STRETCH) {
      // Tighter matches first: a query that lands nearly contiguously is closer
      // to what was meant than one strung across the title.
      return TIER.fuzzyTitle + Math.round((BONUS * needle.length) / span);
    }
  }
  return 0;
}

/**
 * Tag ids whose display name contains the query. Computed once per search
 * rather than per event: there are tens of tags and tens of thousands of events.
 */
function tagsMatching(tagNames: ReadonlyMap<Id, string>, needle: string): Set<Id> {
  const out = new Set<Id>();
  for (const [id, name] of tagNames) {
    if (fold(name).includes(needle)) out.add(id);
  }
  return out;
}

/**
 * Substring across `title`, `notes`, `learned_from` and tag names, plus fuzzy
 * matching on `title` alone (§6.3). Soft-deleted events never appear. An empty
 * query returns nothing rather than everything — "no query" is not "match all",
 * and the list view shows the unfiltered store itself.
 *
 * Ordering is fully deterministic: score, then the conventional sort key
 * `b → a → title → id`, compared by code unit.
 */
export function searchEvents(
  events: readonly TimelineEvent[],
  query: string,
  options?: SearchOptions,
): SearchHit[] {
  const needle = fold(query.trim());
  if (needle === '') return [];

  const tagNames = options?.tagNames;
  const matchingTags =
    tagNames === undefined || tagNames.size === 0 ? null : tagsMatching(tagNames, needle);

  const needleLetters = letterMask(needle);
  const folded = foldedCorpus(events);
  const hits: SearchHit[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event === undefined || event.deleted_at !== undefined) continue;
    const score = scoreEvent(
      event,
      foldedAt(folded, event, i),
      needle,
      needleLetters,
      matchingTags,
    );
    if (score > 0) hits.push({ event, score });
  }

  hits.sort(
    (x, y) =>
      y.score - x.score ||
      x.event.when.b - y.event.when.b ||
      x.event.when.a - y.event.when.a ||
      compareStrings(x.event.title, y.event.title) ||
      compareStrings(x.event.id, y.event.id),
  );

  const limit = options?.limit;
  return limit !== undefined && limit >= 0 && limit < hits.length ? hits.slice(0, limit) : hits;
}

// ---------------------------------------------------------------------------
// The duplicate guard (§6.3)
// ---------------------------------------------------------------------------

/**
 * Dice coefficient on character bigrams, at or above which two titles count as
 * the same claim. 0.7 is set by what the failure looks like in both directions:
 * "rome falls" against "rome fell" scores 0.71 and should warn, while
 * "the siege of Tarnogol" against "the siege of Nuzarra" scores 0.61 and must
 * not — a corpus full of shared phrasing would otherwise warn on every entry,
 * and a guard that cries wolf is a guard that gets ignored.
 */
const MIN_SIMILARITY = 0.7;

/**
 * One title containing the other whole ("lepanto" inside "battle of lepanto")
 * is a duplicate the bigram score misses, because the shorter string is too
 * short to overlap much. Only from six characters up, so that a common word
 * inside a longer title does not qualify.
 */
const MIN_CONTAINED = 6;
const CONTAINED_SIMILARITY = 0.8;

/**
 * How close in time two events must be to be the same event. Half of it is
 * fixed — a year and a half, so `1571` and `7 October 1571` count as the same
 * date whatever granularity each was entered at — and half of it scales with
 * what the dates actually claim: `2 * (σ + σ)`, where σ is the spread of each
 * trapezoid.
 *
 * That second term is what makes the rule right at both ends. Two events dated
 * to the year and a century apart are 100 years apart against a 3-year reach, so
 * they are different events, exactly as §6.3 wants. Two events dated only to a
 * century *are* within reach of each other a hundred years apart — and they
 * should be, because at that granularity the dates make no claim that could tell
 * them apart, and only the title is evidence.
 */
const NEAR_DAYS = 1.5 * DAYS_PER_YEAR;
const SIGMA_REACH = 2;

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i + 1 < text.length; i++) {
    const gram = text.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

function diceSimilarity(
  reference: ReadonlyMap<string, number>,
  referenceSize: number,
  other: string,
): number {
  const otherSize = other.length - 1;
  if (referenceSize <= 0 || otherSize <= 0) return 0;
  const used = new Map<string, number>();
  let shared = 0;
  for (let i = 0; i + 1 < other.length; i++) {
    const gram = other.slice(i, i + 2);
    const taken = used.get(gram) ?? 0;
    if (taken < (reference.get(gram) ?? 0)) {
      shared++;
      used.set(gram, taken + 1);
    }
  }
  return (2 * shared) / (referenceSize + otherSize);
}

function containsWhole(hay: string, needle: string): boolean {
  if (needle.length < MIN_CONTAINED) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    if (startsWord(hay, at) && !isWordChar(hay[at + needle.length])) return true;
    from = at + 1;
  }
}

function timeSimilarEnough(x: TimeSpec, y: TimeSpec): boolean {
  const gap = Math.abs(midpoint(x) - midpoint(y));
  return gap <= Math.max(NEAR_DAYS, SIGMA_REACH * (x.sigma + y.sigma));
}

/**
 * Capture-time duplicate guard (design.md §6.3): adding the Battle of Lepanto
 * twice six months apart is the obvious failure mode of a capture-optimised
 * tool, and it corrupts the density quietly.
 *
 * A candidate is reported when its title is similar enough *and* its date is
 * close enough — the same title a century apart is probably a different event,
 * the same title in the same year probably is not. With no date parsed yet the
 * title decides alone, since that is all the evidence there is.
 *
 * Most candidates are rejected on an O(1) length bound before any similarity is
 * computed: two bigram sets of very different sizes cannot reach the threshold.
 */
export function findPossibleDuplicates(
  events: readonly TimelineEvent[],
  title: string,
  when: TimeSpec | null,
  options?: { limit?: number },
): TimelineEvent[] {
  const needle = fold(title.trim());
  if (needle === '') return [];
  const reference = bigrams(needle);
  const referenceSize = needle.length - 1;

  const folded = foldedCorpus(events);
  const found: { event: TimelineEvent; similarity: number; gap: number }[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event === undefined || event.deleted_at !== undefined) continue;
    const candidate = foldedAt(folded, event, i).title;

    let similarity: number;
    if (candidate === needle) {
      similarity = 1;
    } else {
      const candidateSize = candidate.length - 1;
      // Upper bound on Dice for these two lengths; skip before allocating.
      const ceiling =
        referenceSize > 0 && candidateSize > 0
          ? (2 * Math.min(referenceSize, candidateSize)) / (referenceSize + candidateSize)
          : 0;
      const contained =
        needle.length <= candidate.length
          ? containsWhole(candidate, needle)
          : containsWhole(needle, candidate);
      if (ceiling < MIN_SIMILARITY && !contained) continue;
      similarity = diceSimilarity(reference, referenceSize, candidate);
      if (contained) similarity = Math.max(similarity, CONTAINED_SIMILARITY);
      if (similarity < MIN_SIMILARITY) continue;
    }

    if (when !== null && !timeSimilarEnough(when, event.when)) continue;
    const gap = when === null ? 0 : Math.abs(midpoint(when) - midpoint(event.when));
    found.push({ event, similarity, gap });
  }

  found.sort(
    (x, y) =>
      y.similarity - x.similarity ||
      x.gap - y.gap ||
      x.event.when.b - y.event.when.b ||
      compareStrings(x.event.title, y.event.title) ||
      compareStrings(x.event.id, y.event.id),
  );

  const limit = options?.limit ?? 5;
  return found.slice(0, Math.max(0, limit)).map((f) => f.event);
}
