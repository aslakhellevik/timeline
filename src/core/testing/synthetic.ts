/**
 * Seeded synthetic timeline generator (design.md §6.1, M0).
 *
 * The density view (§3) cannot be developed or judged against an empty timeline, and it
 * cannot be judged against *uniform* data either: the whole claim of the far view is that
 * your knowledge has shape — clumps where you have read, gaps where you have not. A
 * generator that scattered events evenly would make a correct renderer look broken and a
 * broken one look fine. So the distribution here is deliberate, not incidental:
 *
 *   - A mixture of Gaussians over the year axis, one component per period a reasonably
 *     read person actually knows about (antiquity, Rome, the high middle ages, the
 *     Renaissance, the Revolution, the wars, the Cold War, living memory).
 *   - Weights heavily skewed to the last two centuries (~72% after 1800), thinning fast
 *     before 1500, sparse before year 0, a thin scatter back to −3000.
 *   - Real gaps, because gaps are the point: the early middle ages get one small
 *     component, so c. 600–1050 is thin rather than empty, and the long BC stretches
 *     carry a handful of events across a millennium.
 *   - Uncertainty rising with age. Modern events are `instant`s at day granularity;
 *     ancient ones are wide `fuzzy` trapezoids at century granularity. This is what
 *     exercises the estimator's σ_eff = √(σ² + h²) handling — certain events must sharpen
 *     as you zoom while uncertain ones stay smeared.
 *   - Tags correlated with the cluster, so filtering to "philosophy" or "Mediterranean"
 *     visibly *redistributes* mass rather than thinning it uniformly (§3.5).
 *
 * Ids are deterministic sequences (`ev-0001`, `cx-0001`, `era-01`), not UUIDv7 as D9
 * requires of real records. Determinism is worth more than realism in test data — a
 * generator whose output changes shape run to run is useless for eyeballing a renderer,
 * and byte-identical output makes regressions in the density code obvious. Built-in tags
 * carry their real namespaced ids (D20); the few user tags get deterministic
 * UUIDv7-shaped ids so that "built-in iff the id is not a UUID" stays true of this data.
 *
 * Every temporal value is built through `../time`; this module never does calendar
 * arithmetic of its own.
 */

import type {
  Connection,
  Days,
  Era,
  Granularity,
  Id,
  Place,
  Provenance,
  Source,
  Tag,
  Timeline,
  TimelineEvent,
  TimeSpec,
} from '../model/types';
import { compareTime, fromGregorian, fuzzy, instant, interval, toGregorian } from '../time';

// ---------------------------------------------------------------------------
// Options and PRNG
// ---------------------------------------------------------------------------

export interface SyntheticOptions {
  events?: number;
  connections?: number;
  eras?: number;
  seed?: number;
}

type Rng = () => number;

/**
 * mulberry32 — 32-bit state, passes gjrand's smallcrush, and is four lines. Seeded so
 * every run of the app or the test suite sees the same timeline.
 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal, Box–Muller. Consumes two draws. */
function gaussian(rng: Rng): number {
  const u1 = 1 - rng(); // in (0,1], so log() is finite
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  const x = xs[Math.floor(rng() * xs.length)];
  if (x === undefined) throw new Error('pick() from an empty pool');
  return x;
}

/** Picks from a pool where earlier entries are likelier (weight 1/(i+1)). */
function pickRanked<T>(rng: Rng, xs: readonly T[]): T {
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += 1 / (i + 1);
  let r = rng() * total;
  for (let i = 0; i < xs.length; i++) {
    r -= 1 / (i + 1);
    if (r <= 0) {
      const x = xs[i];
      if (x !== undefined) return x;
    }
  }
  return pick(rng, xs);
}

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

function intBetween(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Code-unit comparison, not `localeCompare` — collation varies with the host's ICU data,
 * and "same seed, same bytes" has to hold on every machine, not just this one.
 */
function compareStrings(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function seqId(prefix: string, index: number, total: number): string {
  const width = Math.max(4, String(Math.max(total, 1)).length);
  return `${prefix}-${String(index + 1).padStart(width, '0')}`;
}

/** Deterministic UUIDv7-shaped id, so user tags are distinguishable from built-ins (D20). */
function pseudoUuid7(rng: Rng): string {
  const hex = (n: number): string => {
    let s = '';
    for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rng() * 16)] ?? '0';
    return s;
  };
  return `${hex(8)}-${hex(4)}-7${hex(3)}-${'89ab'[Math.floor(rng() * 4)] ?? 'a'}${hex(3)}-${hex(12)}`;
}

// ---------------------------------------------------------------------------
// Reference frame
// ---------------------------------------------------------------------------

/** "Now" for this data set. Fixed, so output does not drift with the wall clock. */
const REFERENCE_YEAR = 2026;
const REFERENCE_MONTH = 8;
const REFERENCE_DAY = 15;

/** Nothing is generated outside these years (design.md §2.4 zooms out to −4000). */
const EARLIEST_YEAR = -3000;
const LATEST_YEAR = 2026.5;

// ---------------------------------------------------------------------------
// Tags (D14, D20, §5)
// ---------------------------------------------------------------------------

/**
 * Tag ids come from the app's built-in set — one source of truth, so the corpus
 * exercises the same tags the real timeline ships with (D20).
 */
import {
  BUILTIN_TAGS,
  R_AFRICA,
  R_AMERICAS,
  R_ASIA,
  R_BRITAIN,
  R_CHINA,
  R_EUROPE,
  R_FRANCE,
  R_GERMANY,
  R_INDIA,
  R_ITALY,
  R_MEDITERRANEAN,
  R_NEAR_EAST,
  R_NORDICS,
  R_RUSSIA,
  T_ART,
  T_ECONOMICS,
  T_EXPLORATION,
  T_LITERATURE,
  T_MEDICINE,
  T_PHILOSOPHY,
  T_POLITICS,
  T_RELIGION,
  T_SCIENCE,
  T_TECHNOLOGY,
  T_WAR,
} from '../model/builtin-tags';

type TagSeed = (typeof BUILTIN_TAGS)[number];

/**
 * The corpus only uses the regions and themes its clusters actually reference;
 * shipping a tag no event carries would leave a dead filter in the UI, and one
 * of the shape tests asserts against exactly that.
 */
const USED_TAG_IDS = new Set<Id>([
  R_EUROPE, R_BRITAIN, R_FRANCE, R_GERMANY, R_ITALY, R_NORDICS, R_RUSSIA,
  R_MEDITERRANEAN, R_NEAR_EAST, R_ASIA, R_CHINA, R_INDIA, R_AFRICA, R_AMERICAS,
  T_WAR, T_POLITICS, T_PHILOSOPHY, T_SCIENCE, T_ART, T_LITERATURE, T_RELIGION,
  T_ECONOMICS, T_TECHNOLOGY, T_MEDICINE, T_EXPLORATION,
]);

const TAG_SEEDS: readonly TagSeed[] = BUILTIN_TAGS.filter((t) => USED_TAG_IDS.has(t.id));

/** User tags — the ones a real user would type. UUID-shaped ids, per D20. */
const USER_TAG_NAMES: readonly string[] = ['reading list', 'told to me', 'worth revisiting'];

// ---------------------------------------------------------------------------
// The mixture (§3, and the reason this file exists)
// ---------------------------------------------------------------------------

type Register = 'ancient' | 'medieval' | 'earlyModern' | 'modern';

interface Cluster {
  readonly key: string;
  /** Gaussian centre, in years (astronomical numbering: 0 = 1 BC). */
  readonly centre: number;
  /** Gaussian sigma, in years. */
  readonly sigma: number;
  /** Unnormalised mixture weight — this is where the recency skew lives. */
  readonly weight: number;
  /** Hard bounds, so tight periods cannot leak into their neighbours. */
  readonly min: number;
  readonly max: number;
  readonly register: Register;
  /** Ranked: the first is likeliest. Drives tag/place correlation. */
  readonly regions: readonly Id[];
  readonly themes: readonly Id[];
}

const CLUSTERS: readonly Cluster[] = [
  {
    key: 'deep-antiquity',
    centre: -2600, sigma: 460, weight: 3, min: EARLIEST_YEAR, max: -1700,
    register: 'ancient',
    regions: [R_NEAR_EAST, R_AFRICA, R_ASIA, R_INDIA],
    themes: [T_RELIGION, T_TECHNOLOGY, T_WAR],
  },
  {
    key: 'bronze-age',
    centre: -1250, sigma: 340, weight: 7, min: -2000, max: -750,
    register: 'ancient',
    regions: [R_NEAR_EAST, R_MEDITERRANEAN, R_AFRICA, R_INDIA, R_CHINA],
    themes: [T_WAR, T_RELIGION, T_POLITICS, T_TECHNOLOGY],
  },
  {
    key: 'classical-antiquity',
    centre: -400, sigma: 85, weight: 16, min: -700, max: -150,
    register: 'ancient',
    regions: [R_MEDITERRANEAN, R_EUROPE, R_NEAR_EAST, R_ITALY],
    themes: [T_PHILOSOPHY, T_WAR, T_POLITICS, T_ART, T_LITERATURE],
  },
  {
    key: 'rome',
    centre: 40, sigma: 85, weight: 20, min: -250, max: 260,
    register: 'ancient',
    regions: [R_MEDITERRANEAN, R_ITALY, R_EUROPE, R_NEAR_EAST, R_AFRICA],
    themes: [T_WAR, T_POLITICS, T_RELIGION, T_ECONOMICS],
  },
  {
    key: 'fall-of-rome',
    centre: 440, sigma: 50, weight: 18, min: 280, max: 600,
    register: 'ancient',
    regions: [R_MEDITERRANEAN, R_ITALY, R_EUROPE, R_NEAR_EAST],
    themes: [T_WAR, T_RELIGION, T_POLITICS],
  },
  {
    // Deliberately small: the early middle ages are the canonical gap in a general
    // reader's knowledge, and a visible gap is the point of the far view.
    key: 'early-middle-ages',
    centre: 800, sigma: 55, weight: 9, min: 640, max: 1010,
    register: 'medieval',
    regions: [R_EUROPE, R_GERMANY, R_FRANCE, R_NORDICS, R_NEAR_EAST],
    themes: [T_WAR, T_RELIGION, T_POLITICS],
  },
  {
    key: 'high-middle-ages',
    centre: 1230, sigma: 70, weight: 34, min: 1020, max: 1420,
    register: 'medieval',
    regions: [R_EUROPE, R_FRANCE, R_BRITAIN, R_ITALY, R_GERMANY, R_NEAR_EAST],
    themes: [T_WAR, T_RELIGION, T_ECONOMICS, T_ART, T_PHILOSOPHY],
  },
  {
    key: 'age-of-discovery',
    centre: 1495, sigma: 14, weight: 20, min: 1440, max: 1560,
    register: 'earlyModern',
    regions: [R_EUROPE, R_AMERICAS, R_AFRICA, R_INDIA, R_ASIA],
    themes: [T_EXPLORATION, T_ECONOMICS, T_WAR],
  },
  {
    key: 'renaissance',
    centre: 1530, sigma: 32, weight: 38, min: 1420, max: 1640,
    register: 'earlyModern',
    regions: [R_ITALY, R_EUROPE, R_GERMANY, R_BRITAIN],
    themes: [T_ART, T_RELIGION, T_PHILOSOPHY, T_LITERATURE, T_SCIENCE],
  },
  {
    key: 'scientific-revolution',
    centre: 1645, sigma: 30, weight: 40, min: 1560, max: 1740,
    register: 'earlyModern',
    regions: [R_EUROPE, R_BRITAIN, R_FRANCE, R_GERMANY, R_ITALY],
    themes: [T_SCIENCE, T_WAR, T_PHILOSOPHY, T_RELIGION],
  },
  {
    key: 'enlightenment',
    centre: 1755, sigma: 22, weight: 45, min: 1690, max: 1800,
    register: 'earlyModern',
    regions: [R_FRANCE, R_BRITAIN, R_GERMANY, R_EUROPE, R_AMERICAS],
    themes: [T_PHILOSOPHY, T_SCIENCE, T_POLITICS, T_LITERATURE],
  },
  {
    key: 'french-revolution',
    centre: 1791, sigma: 4, weight: 45, min: 1786, max: 1801,
    register: 'modern',
    regions: [R_FRANCE, R_EUROPE],
    themes: [T_POLITICS, T_WAR, T_PHILOSOPHY],
  },
  {
    key: 'napoleonic',
    centre: 1806, sigma: 6, weight: 55, min: 1795, max: 1822,
    register: 'modern',
    regions: [R_FRANCE, R_EUROPE, R_GERMANY, R_RUSSIA, R_BRITAIN],
    themes: [T_WAR, T_POLITICS],
  },
  {
    key: 'long-nineteenth-century',
    centre: 1848, sigma: 13, weight: 70, min: 1815, max: 1885,
    register: 'modern',
    regions: [R_EUROPE, R_GERMANY, R_BRITAIN, R_FRANCE, R_ITALY, R_AMERICAS],
    themes: [T_POLITICS, T_ECONOMICS, T_TECHNOLOGY, T_LITERATURE, T_SCIENCE],
  },
  {
    key: 'industrial-age',
    centre: 1882, sigma: 17, weight: 100, min: 1845, max: 1918,
    register: 'modern',
    regions: [R_BRITAIN, R_EUROPE, R_AMERICAS, R_GERMANY, R_ASIA, R_AFRICA],
    themes: [T_TECHNOLOGY, T_ECONOMICS, T_SCIENCE, T_MEDICINE, T_POLITICS],
  },
  {
    key: 'great-war',
    centre: 1919, sigma: 6, weight: 95, min: 1905, max: 1935,
    register: 'modern',
    regions: [R_EUROPE, R_GERMANY, R_FRANCE, R_BRITAIN, R_RUSSIA, R_NEAR_EAST],
    themes: [T_WAR, T_POLITICS, T_TECHNOLOGY, T_MEDICINE],
  },
  {
    key: 'second-world-war',
    centre: 1942, sigma: 2.6, weight: 130, min: 1936, max: 1949,
    register: 'modern',
    regions: [R_EUROPE, R_GERMANY, R_RUSSIA, R_BRITAIN, R_ASIA, R_AFRICA],
    themes: [T_WAR, T_TECHNOLOGY, T_POLITICS],
  },
  {
    key: 'early-cold-war',
    centre: 1957, sigma: 9, weight: 90, min: 1945, max: 1975,
    register: 'modern',
    regions: [R_RUSSIA, R_AMERICAS, R_EUROPE, R_ASIA, R_AFRICA],
    themes: [T_POLITICS, T_WAR, T_TECHNOLOGY, T_SCIENCE],
  },
  {
    key: 'late-cold-war',
    centre: 1980, sigma: 11, weight: 120, min: 1960, max: 2000,
    register: 'modern',
    regions: [R_EUROPE, R_AMERICAS, R_RUSSIA, R_ASIA, R_NORDICS],
    themes: [T_POLITICS, T_TECHNOLOGY, T_ECONOMICS, T_SCIENCE],
  },
  {
    key: 'living-memory',
    centre: 2008, sigma: 12, weight: 140, min: 1990, max: LATEST_YEAR,
    register: 'modern',
    regions: [R_EUROPE, R_NORDICS, R_AMERICAS, R_ASIA, R_AFRICA, R_CHINA],
    themes: [T_TECHNOLOGY, T_POLITICS, T_ECONOMICS, T_SCIENCE, T_MEDICINE],
  },
];

const CLUSTER_WEIGHTS: readonly number[] = CLUSTERS.map((c) => c.weight);

/** Draws a year from the mixture. Rejection against the cluster's bounds, then a clamp. */
function sampleYear(rng: Rng, cluster: Cluster): number {
  const lo = Math.max(cluster.min, EARLIEST_YEAR);
  const hi = Math.min(cluster.max, LATEST_YEAR);
  for (let attempt = 0; attempt < 8; attempt++) {
    const y = cluster.centre + cluster.sigma * gaussian(rng);
    if (y >= lo && y <= hi) return y;
  }
  return clamp(cluster.centre, lo, hi);
}

// ---------------------------------------------------------------------------
// Vagueness: how sure a person is about a date, as a function of its age
// ---------------------------------------------------------------------------

/**
 * 0 = this year, 1 = five thousand years ago. Log-scaled, because the loss of precision
 * with age is multiplicative: last decade is to a lifetime as a lifetime is to a
 * millennium. Everything downstream — mode, granularity, interval length, trapezoid
 * margins — is a function of this one number, which is what makes σ rise smoothly with
 * age instead of stepping at arbitrary boundaries.
 */
function vagueness(year: number): number {
  const age = Math.max(REFERENCE_YEAR - year, 1);
  return clamp((Math.log10(age) - 1) / (Math.log10(5000) - 1), 0, 1);
}

/** Log-normal draw with median `median`, spread `s` in log space. */
function logNormal(rng: Rng, median: number, s: number): number {
  return median * Math.exp(s * gaussian(rng));
}

/** Typical length in years of a "period" an event of this vagueness might span. */
function typicalSpan(rng: Rng, v: number): number {
  return clamp(logNormal(rng, 1.4 + 62 * v * v * v, 0.85), 0.08, 900);
}

/** Half-width in years of the outer, "could be as early/late as" margins. */
function typicalMargin(rng: Rng, v: number): number {
  const scale = 0.4 * (1 + 220 * Math.pow(v, 4));
  return clamp(logNormal(rng, scale, 0.5), 0.02, 400);
}

function instantGranularity(rng: Rng, v: number): Granularity {
  if (v < 0.2) return pick(rng, ['day', 'day', 'day', 'day', 'day', 'day', 'month', 'year', 'year']);
  if (v < 0.4) return pick(rng, ['day', 'day', 'day', 'month', 'year', 'year', 'year', 'year']);
  if (v < 0.58) return pick(rng, ['year', 'year', 'year', 'year', 'year', 'month', 'decade', 'decade']);
  if (v < 0.75) return pick(rng, ['year', 'year', 'decade', 'decade', 'decade', 'century']);
  return pick(rng, ['decade', 'century', 'century', 'century']);
}

// ---------------------------------------------------------------------------
// Days conversions — everything goes through ../time
// ---------------------------------------------------------------------------

/** Fractional year → Days, interpolating within the year so months land plausibly. */
function yearToDays(fy: number): Days {
  const y = Math.floor(fy);
  const start = fromGregorian(y, 1, 1);
  const nextStart = fromGregorian(y + 1, 1, 1);
  return start + (fy - y) * (nextStart - start);
}

const NOW_DAYS: Days = fromGregorian(REFERENCE_YEAR, REFERENCE_MONTH, REFERENCE_DAY);
const CEILING_DAYS: Days = yearToDays(LATEST_YEAR + 0.12);

/** Builds the TimeSpec for an event at `year`, with uncertainty appropriate to its age. */
function buildWhen(rng: Rng, year: number): TimeSpec {
  const v = vagueness(year);
  const pFuzzy = 0.02 + 0.7 * v * v;
  const pInterval = 0.14 + 0.12 * v;
  const roll = rng();

  if (roll < pFuzzy) {
    // Unconstrained trapezoid: "some time around then, give or take". Each bound is
    // clamped against the previous one, so a <= b <= c <= d holds by construction rather
    // than by argument about the clamp at the present day.
    const span = typicalSpan(rng, v) * 0.6;
    const margin = typicalMargin(rng, v);
    const granularity: Granularity = v < 0.5 ? 'year' : v < 0.75 ? 'decade' : 'century';
    const a = yearToDays(year - span / 2 - margin);
    const b = Math.max(a, yearToDays(year - span / 2));
    const c = Math.max(b, Math.min(yearToDays(year + span / 2), CEILING_DAYS));
    const d = Math.max(c, Math.min(yearToDays(year + span / 2 + margin), CEILING_DAYS));
    return fuzzy(a, b, c, d, { granularity });
  }

  if (roll < pFuzzy + pInterval) {
    // A war, a reign, a period of building. The known date is the start.
    const span = typicalSpan(rng, v);
    const granularity: Granularity =
      v < 0.2 && chance(rng, 0.4) ? 'day' : v < 0.55 ? 'year' : v < 0.8 ? 'decade' : 'century';
    const start = yearToDays(year);
    const end = Math.min(yearToDays(year + span), CEILING_DAYS);
    return interval(start, Math.max(start, end), { granularity });
  }

  // An instant, widened by its granularity.
  const granularity = instantGranularity(rng, v);
  if (granularity === 'day' || granularity === 'month') {
    const t = yearToDays(year);
    const g = toGregorian(t);
    return granularity === 'day'
      ? instant(g.year, g.month, g.day, { granularity })
      : instant(g.year, g.month, undefined, { granularity });
  }
  const y = Math.floor(year);
  const anchor =
    granularity === 'century' ? Math.floor(y / 100) * 100 : granularity === 'decade' ? Math.floor(y / 10) * 10 : y;
  return instant(anchor, undefined, undefined, { granularity });
}

// ---------------------------------------------------------------------------
// ISO timestamps (metadata, not the time axis — D2 keeps JS Date out of the core)
// ---------------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** Wall-clock ISO with offset (see the conventions list in design.md §1). */
function isoAt(t: Days, hour: number, minute: number): string {
  const g = toGregorian(Math.floor(t));
  // Norway: CEST from April to October, CET otherwise. Close enough for test data.
  const offset = g.month >= 4 && g.month <= 10 ? '+02:00' : '+01:00';
  return (
    `${pad(g.year, 4)}-${pad(g.month, 2)}-${pad(g.day, 2)}` +
    `T${pad(hour, 2)}:${pad(minute, 2)}:${pad((hour * 7 + minute * 13) % 60, 2)}${offset}`
  );
}

function isoFrom(rng: Rng, t: Days): string {
  return isoAt(t, intBetween(rng, 7, 23), intBetween(rng, 0, 59));
}

// ---------------------------------------------------------------------------
// Invented names — typographically realistic, historically fictional
// ---------------------------------------------------------------------------

interface PlaceSeed {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly region: Id;
}

const PLACES: readonly PlaceSeed[] = [
  { name: 'Ashcombe', lat: 52.1, lon: -1.6, region: R_BRITAIN },
  { name: 'Wraythorpe', lat: 54.0, lon: -2.4, region: R_BRITAIN },
  { name: 'Dunmarrow', lat: 53.3, lon: -3.9, region: R_BRITAIN },
  { name: 'Ellerby Sands', lat: 53.7, lon: 0.1, region: R_BRITAIN },
  { name: 'Vorsanne', lat: 47.4, lon: 1.9, region: R_FRANCE },
  { name: 'Chaumelle', lat: 45.8, lon: 3.1, region: R_FRANCE },
  { name: 'Saint-Ravier', lat: 44.2, lon: 0.7, region: R_FRANCE },
  { name: 'Montrelle', lat: 48.6, lon: 2.2, region: R_FRANCE },
  { name: 'Kaltheim', lat: 49.9, lon: 9.1, region: R_GERMANY },
  { name: 'Erzmund', lat: 51.4, lon: 12.3, region: R_GERMANY },
  { name: 'Falkburg', lat: 48.4, lon: 11.2, region: R_GERMANY },
  { name: 'Neuhalde', lat: 50.6, lon: 7.9, region: R_GERMANY },
  { name: 'Castelmura', lat: 43.2, lon: 12.1, region: R_ITALY },
  { name: 'Porto Ilvano', lat: 40.7, lon: 14.5, region: R_ITALY },
  { name: 'Vallenza', lat: 45.1, lon: 9.4, region: R_ITALY },
  { name: 'Jarnholm', lat: 59.2, lon: 10.7, region: R_NORDICS },
  { name: 'Skarvik', lat: 63.4, lon: 10.2, region: R_NORDICS },
  { name: 'Ostravig', lat: 55.9, lon: 12.4, region: R_NORDICS },
  { name: 'Verinsk', lat: 56.9, lon: 40.3, region: R_RUSSIA },
  { name: 'Tarnogol', lat: 51.2, lon: 46.8, region: R_RUSSIA },
  { name: 'Halikarnia', lat: 37.0, lon: 27.4, region: R_MEDITERRANEAN },
  { name: 'Pyrrhaea', lat: 38.6, lon: 23.1, region: R_MEDITERRANEAN },
  { name: 'Thalassiri', lat: 35.4, lon: 24.9, region: R_MEDITERRANEAN },
  { name: 'Kalymnos Bay', lat: 36.9, lon: 26.9, region: R_MEDITERRANEAN },
  { name: 'Nuzarra', lat: 33.4, lon: 43.9, region: R_NEAR_EAST },
  { name: 'Tell Ishmar', lat: 36.2, lon: 40.1, region: R_NEAR_EAST },
  { name: 'Karmesh', lat: 32.1, lon: 36.5, region: R_NEAR_EAST },
  { name: 'Ur-Sabath', lat: 30.9, lon: 46.2, region: R_NEAR_EAST },
  { name: 'Ophara', lat: 31.2, lon: 29.9, region: R_AFRICA },
  { name: 'Zamrekh', lat: 12.6, lon: 8.0, region: R_AFRICA },
  { name: 'Tessaline', lat: 33.9, lon: 6.9, region: R_AFRICA },
  { name: 'Bekwa Falls', lat: -1.9, lon: 30.1, region: R_AFRICA },
  { name: 'Liangfu', lat: 34.2, lon: 108.9, region: R_CHINA },
  { name: 'Anhe', lat: 30.6, lon: 114.3, region: R_CHINA },
  { name: 'Sarnavati', lat: 25.3, lon: 82.9, region: R_INDIA },
  { name: 'Vishalgarh', lat: 18.5, lon: 73.9, region: R_INDIA },
  { name: 'Konsari', lat: 6.2, lon: 106.8, region: R_ASIA },
  { name: 'Tanabe-no-ura', lat: 34.8, lon: 135.4, region: R_ASIA },
  { name: 'Puerto Vela', lat: 10.4, lon: -66.9, region: R_AMERICAS },
  { name: 'Fort Merrow', lat: 42.4, lon: -71.1, region: R_AMERICAS },
  { name: 'Rio Sandoval', lat: -23.5, lon: -46.6, region: R_AMERICAS },
  { name: 'New Halbrook', lat: 39.9, lon: -75.2, region: R_AMERICAS },
];

const PERSONS: Record<Register, readonly string[]> = {
  ancient: ['Vareon', 'Kleistes', 'Thurmen', 'Ashuraya', 'Menekar', 'Sabbaeus', 'Ninshara', 'Alkaios of Pyrrhaea'],
  medieval: [
    'Odo of Kaltheim',
    'Aldruna the Younger',
    'Guiscard of Vallenza',
    'Sister Marthild',
    'Bishop Rannulf',
    'Hakon Jarnholm',
  ],
  earlyModern: [
    'Cornelis van Drenthaven',
    'Isabella Vallenzi',
    'Johann Erzmund',
    'Marguerite de Vorsanne',
    'Thomas Ashcombe',
    'Lucia Castelmura',
  ],
  modern: [
    'Elsa Hovden',
    'Piers Ashcombe',
    'Nadia Kestrel',
    'Tomás Vela',
    'Ruth Merrow',
    'Anselm Kaltheim',
    'Irina Verinskaya',
    'H. J. Wraythorpe',
    'Amina Zamrekh',
  ],
};

const PEOPLES: readonly string[] = [
  'Kessarids',
  'Vaunar',
  'Ostragoths of the delta',
  'Halbrin confederacy',
  'Marren tribes',
  'sea peoples of Thalassiri',
];

const WORKS: Record<Register, readonly string[]> = {
  ancient: ['On the Nature of Cities', 'the Halikarnian Chronicle', 'the Book of Ninshara'],
  medieval: ['the Kaltheim Annals', 'the Rule of Saint Aldruna', 'the Vallenza Cadastre'],
  earlyModern: [
    'On the Motion of Falling Bodies',
    'A Treatise on the Passions',
    'the Vorsanne Herbal',
    'Letters on the Government of Cities',
  ],
  modern: [
    'The Machinery of Consent',
    'Notes on the Labour Question',
    'A Short History of the Nordics',
    'The Grammar of Colour',
    'Memory and the Modern State',
  ],
};

const THINGS: readonly string[] = [
  'a working steam turbine',
  'wireless telegraphy across open water',
  'the first electric tram line',
  'a vaccine for cattle plague',
  'a mechanical calculating engine',
  'the transatlantic cable repeater',
  'a synthetic dye that does not fade',
  'the first colour photograph of a harbour',
];

/** Templates per register. Lengths vary on purpose — label layout must cope with both. */
const TITLES: Record<Register, readonly string[]> = {
  ancient: [
    'the siege of {place}',
    'the fall of {place}',
    '{place} burns',
    'the sack of {place} by the {people}',
    'the founding of {place}',
    'the battle of {place}',
    '{ruler} takes the throne at {place}',
    "{ruler}'s campaign against the {people}",
    'the flooding of the lower {place} valley',
    'the treaty between {place} and {place2}',
    '{ruler} dies on campaign',
    'the earthquake that levels {place} and closes its harbour for a generation',
    'the {people} are recorded for the first time in the annals of {place}',
    'the last inscription that names a king at {place}, after which the record simply stops',
  ],
  medieval: [
    'the council of {place}',
    'the crowning of {ruler}',
    '{place} charters its first market',
    'the {people} raid the coast near {place}',
    'the plague reaches {place}',
    'the abbey of {place} is founded',
    '{place} falls',
    'the {place} rising',
    '{ruler} endows the cathedral school at {place}',
    'the long dispute between {place} and {place2} over grazing rights on the moor is settled',
    'a chronicler at {place} records three winters without a thaw',
  ],
  earlyModern: [
    'the treaty of {place}',
    '{person} publishes {work}',
    'the siege of {place}',
    '{person} is tried for heresy at {place}',
    'the {place} company receives its charter',
    'the printing of {work} at {place}',
    '{place} revolts',
    'the fire at {place}',
    '{person} maps the coast beyond {place2}',
    '{person} presents {work} to the academy at {place} and is politely ignored for a decade',
    'the {place} conference breaks up without agreement',
  ],
  modern: [
    '{person} publishes {work}',
    'the treaty of {place}',
    'the {place} conference',
    '{person} demonstrates {thing}',
    'the {place} strike',
    '{place} declares independence',
    'the {place} accords collapse',
    'the {place} fire',
    '{place} is bombed',
    'the opening of the {place} line',
    'the {place} commission reports',
    '{person} resigns',
    'the first crossing from {place} to {place2} without refuelling',
    'the commission of inquiry into the {place} colliery disaster publishes its final report',
    'the treaty of {place} is signed, ending eleven years of intermittent fighting between {place2} and the {people}',
    '{person} is awarded the {place} prize for work on {thing} carried out twenty years earlier',
  ],
};

interface TitleContext {
  place: string;
  place2: string;
  person: string;
  work: string;
  thing: string;
  people: string;
  ruler: string;
}

function fill(template: string, ctx: TitleContext): string {
  return template.replace(/\{(\w+)\}/g, (_m: string, key: string) => {
    const value = ctx[key as keyof TitleContext];
    return value === undefined ? `{${key}}` : value;
  });
}

const NOTE_TEMPLATES: readonly string[] = [
  'Sources disagree by about a decade — see the note in *{work}*.',
  'Worth checking: the standard account leans entirely on one chronicle.',
  '**Not** the version I was taught at school.',
  'The interesting part is the aftermath, not the event.',
  'Follows directly from the harbour works at {place}.',
  'See [the summary](https://example.invalid/{slug}) for the argument against.',
  'I keep confusing this with the later rising at {place2}.',
  'Dated by a single coin hoard, which is thin evidence for a claim this load-bearing.',
];

const LEARNED_FROM: readonly string[] = [
  'Marlanne, *A Short History of the Vorsanne*, ch. 4',
  'conversation with M',
  'a footnote in {work}',
  'the museum at {place}',
  'podcast, ep. 212',
  'lecture notes, week 6',
  'Wraythorpe, *Memory and the Modern State*, pp. 88–91',
  'a plaque at {place}',
  'my grandmother',
  'reading group, {place2} evening',
];

const SOURCE_REFS: readonly string[] = [
  'Ashcombe, *The Long Peace*',
  'Verinskaya, *Winter Archives*',
  'the {place} municipal records',
  'Kaltheim Annals, vol. II',
  'https://example.invalid/archive/{slug}',
];

const CONNECTION_NOTES: readonly string[] = [
  'The same argument, restated ninety years later and with better data.',
  'Cause and effect, though the chain runs through three intermediaries.',
  'Not causal — but the *rhyme* is too loud to ignore.',
  'One is unthinkable without the other: the technical precondition, not the political one.',
  'Both are downstream of the same harbour closing.',
  'I connected these after reading {work}; I am no longer sure the link holds.',
  'The second is a deliberate imitation of the first, down to the wording.',
  'Same family, two generations apart.',
  '**Contested.** Most accounts treat these as unrelated.',
  'The gap between them is the whole question.',
  'A near-perfect inversion: what worked at {place} failed at {place2}.',
  'Read together, these two make the century make sense.',
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------------------

interface Draft {
  cluster: Cluster;
  year: number;
  when: TimeSpec;
  title: string;
  tags: Id[];
  place?: Place;
  notes?: string;
  sources?: Source[];
  learned_at?: string;
  learned_from?: string;
  provenance: Provenance;
  created_at: string;
  updated_at: string;
}

function chooseTags(rng: Rng, cluster: Cluster, parentOf: ReadonlyMap<Id, Id>, userTagIds: readonly Id[]): Id[] {
  const n = weightedIndex(rng, [8, 30, 37, 25]); // 0..3 tags
  if (n === 0) return [];
  const out: Id[] = [];
  if (chance(rng, 0.85)) {
    const region = pickRanked(rng, cluster.regions);
    out.push(region);
    const parent = parentOf.get(region);
    // Rollup filtering (D14) only matters if some events carry both.
    if (parent !== undefined && out.length < n && chance(rng, 0.25)) out.push(parent);
  }
  for (let guard = 0; out.length < n && guard < 12; guard++) {
    const t = chance(rng, 0.06) && userTagIds.length > 0 ? pick(rng, userTagIds) : pickRanked(rng, cluster.themes);
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, n);
}

function generateDrafts(rng: Rng, count: number, userTagIds: readonly Id[], parentOf: ReadonlyMap<Id, Id>): Draft[] {
  const drafts: Draft[] = [];
  for (let i = 0; i < count; i++) {
    const cluster = CLUSTERS[weightedIndex(rng, CLUSTER_WEIGHTS)];
    if (cluster === undefined) continue;
    const year = sampleYear(rng, cluster);
    const when = buildWhen(rng, year);
    const tags = chooseTags(rng, cluster, parentOf, userTagIds);

    // Keep the place consistent with the region tag where there is one: a Mediterranean
    // event should not be titled after a Norwegian fjord.
    // Rolls up (D14): an event tagged only `tag.region.europe` still gets a European
    // place, because every place carries the *narrow* region tag.
    const region = tags.find((t) => t.startsWith('tag.region.'));
    const regional =
      region === undefined
        ? []
        : PLACES.filter((p) => p.region === region || parentOf.get(p.region) === region);
    const homeRegion = pickRanked(rng, cluster.regions);
    const fallback = PLACES.filter((p) => p.region === homeRegion);
    const pool = regional.length > 0 ? regional : fallback.length > 0 ? fallback : PLACES;
    const primary = pick(rng, pool);
    const secondary = pick(rng, PLACES);

    const ctx: TitleContext = {
      place: primary.name,
      place2: secondary.name === primary.name ? pick(rng, PLACES).name : secondary.name,
      person: pick(rng, PERSONS[cluster.register]),
      work: pick(rng, WORKS[cluster.register]),
      thing: pick(rng, THINGS),
      people: pick(rng, PEOPLES),
      ruler: pick(rng, PERSONS[cluster.register]),
    };
    const title = fill(pick(rng, TITLES[cluster.register]), ctx);
    const withSlug = (s: string): string => fill(s, ctx).replace('{slug}', slugify(title));

    // learned_at (D10) on 60% of events, biased towards the last year or so; the record
    // is created shortly after you learn the thing.
    const hasLearned = chance(rng, 0.6);
    const learnedDays = NOW_DAYS - Math.pow(rng(), 0.7) * 365.25 * 4;
    const createdDays = hasLearned
      ? Math.min(learnedDays + rng() * 14, NOW_DAYS)
      : NOW_DAYS - Math.pow(rng(), 0.7) * 365.25 * 4;
    const created_at = isoFrom(rng, createdDays);
    // At least a full day later, so `updated_at >= created_at` holds as a string compare
    // too — the ISO forms carry a random time of day, and same-day edits would invert it.
    const updatedDays = createdDays + 1 + rng() * 120;
    const updated_at = chance(rng, 0.3) && updatedDays <= NOW_DAYS ? isoFrom(rng, updatedDays) : created_at;

    const provenance: Provenance =
      rng() < 0.9 ? { kind: 'manual' } : { kind: 'import', ref: 'timeline-2025-11-02.json' };

    drafts.push({
      cluster,
      year,
      when,
      title,
      tags,
      provenance,
      created_at,
      updated_at,
      ...(chance(rng, 0.35)
        ? {
            place: {
              name: primary.name,
              lat: primary.lat,
              lon: primary.lon,
              precision: Math.round(clamp(logNormal(rng, 5 + 180 * vagueness(year), 0.6), 1, 800)),
            },
          }
        : {}),
      ...(chance(rng, 0.3) ? { notes: withSlug(pick(rng, NOTE_TEMPLATES)) } : {}),
      ...(chance(rng, 0.25)
        ? {
            sources: Array.from({ length: intBetween(rng, 1, 2) }, () => {
              const ref = withSlug(pick(rng, SOURCE_REFS));
              const kind = ref.startsWith('http') ? 'url' : chance(rng, 0.75) ? 'book' : 'article';
              // A page number on a URL reads as a bug in the list view; a URL locates by
              // fragment or not at all.
              return kind === 'url'
                ? chance(rng, 0.4)
                  ? { kind, ref, locator: `#section-${intBetween(rng, 2, 9)}` }
                  : { kind, ref }
                : chance(rng, 0.6)
                  ? { kind, ref, locator: `p. ${intBetween(rng, 12, 480)}` }
                  : { kind, ref };
            }),
          }
        : {}),
      ...(hasLearned
        ? { learned_at: isoFrom(rng, learnedDays), learned_from: withSlug(pick(rng, LEARNED_FROM)) }
        : {}),
    });
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Connections (D6, D22)
// ---------------------------------------------------------------------------

function generateConnections(
  rng: Rng,
  events: readonly TimelineEvent[],
  drafts: readonly Draft[],
  requested: number,
): Connection[] {
  const n = events.length;
  const maxPairs = n < 2 ? 0 : (n * (n - 1)) / 2;
  const target = Math.min(requested, maxPairs);
  if (target <= 0) return [];

  // Index by tag and by cluster, so "related" can mean either.
  const byTag = new Map<Id, number[]>();
  const byCluster = new Map<string, number[]>();
  events.forEach((ev, i) => {
    for (const t of ev.tags) {
      const bucket = byTag.get(t);
      if (bucket) bucket.push(i);
      else byTag.set(t, [i]);
    }
    const key = drafts[i]?.cluster.key;
    if (key !== undefined) {
      const bucket = byCluster.get(key);
      if (bucket) bucket.push(i);
      else byCluster.set(key, [i]);
    }
  });
  const tagKeys = [...byTag.keys()];
  const clusterKeys = [...byCluster.keys()];

  const seen = new Set<string>();
  const out: Connection[] = [];
  let attempts = 0;
  const budget = target * 40 + 500;

  while (out.length < target && attempts < budget) {
    attempts++;
    const roll = rng();
    let i = -1;
    let j = -1;

    if (roll < 0.45) {
      // Temporally adjacent: short arcs, the visible local texture.
      i = Math.floor(rng() * n);
      const reach = Math.max(2, Math.round(n * 0.01));
      j = i + (chance(rng, 0.5) ? 1 : -1) * intBetween(rng, 1, reach);
    } else if (roll < 0.7) {
      // Same period, any distance within it.
      const bucket = byCluster.get(pick(rng, clusterKeys));
      if (bucket && bucket.length >= 2) {
        i = pick(rng, bucket);
        j = pick(rng, bucket);
      }
    } else if (roll < 0.88) {
      // Same tag: the long thematic arcs — philosophy talking to philosophy across
      // fifteen centuries. This is the structure the far view should make visible.
      const bucket = byTag.get(pick(rng, tagKeys));
      if (bucket && bucket.length >= 2) {
        i = pick(rng, bucket);
        j = pick(rng, bucket);
      }
    } else {
      // The minority of genuinely long-range links.
      i = Math.floor(rng() * n);
      j = Math.floor(rng() * n);
    }

    if (i < 0 || j < 0 || i >= n || j >= n || i === j) continue;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const key = `${lo}|${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const from = events[lo];
    const to = events[hi];
    if (!from || !to) continue;

    // Connection tags narrow the filter further (D22): drawn from what the endpoints
    // share, so a filtered view keeps arcs whose endpoints survive.
    const shared = from.tags.filter((t) => to.tags.includes(t));
    const union = [...new Set([...from.tags, ...to.tags])];
    const pool = shared.length > 0 ? shared : union;
    const tagCount = weightedIndex(rng, [35, 45, 20]);
    const tags: Id[] = [];
    for (let k = 0; k < tagCount && pool.length > 0; k++) {
      const t = pick(rng, pool);
      if (!tags.includes(t)) tags.push(t);
    }

    const ctx: TitleContext = {
      place: pick(rng, PLACES).name,
      place2: pick(rng, PLACES).name,
      person: pick(rng, PERSONS.modern),
      work: pick(rng, WORKS.modern),
      thing: pick(rng, THINGS),
      people: pick(rng, PEOPLES),
      ruler: pick(rng, PERSONS.medieval),
    };
    const note = fill(pick(rng, CONNECTION_NOTES), ctx);
    const createdDays = NOW_DAYS - Math.pow(rng(), 0.7) * 365.25 * 3;
    const created_at = isoFrom(rng, createdDays);
    const updatedDays = createdDays + 1 + rng() * 90;

    out.push({
      id: seqId('cx', out.length, target),
      created_at,
      updated_at: chance(rng, 0.2) && updatedDays <= NOW_DAYS ? isoFrom(rng, updatedDays) : created_at,
      from: from.id,
      to: to.id,
      note,
      tags,
      provenance: chance(rng, 0.92) ? { kind: 'manual' } : { kind: 'import', ref: 'timeline-2025-11-02.json' },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Eras (D15, D26)
// ---------------------------------------------------------------------------

interface EraSeed {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly tags: readonly Id[];
  readonly vague?: boolean;
  readonly notes?: string;
}

const CANONICAL_ERAS: readonly EraSeed[] = [
  { name: 'the Bronze Age collapse', from: -1250, to: -1130, tags: [R_NEAR_EAST, R_MEDITERRANEAN], vague: true },
  { name: 'the Archaic period', from: -800, to: -480, tags: [R_MEDITERRANEAN], vague: true },
  { name: 'classical antiquity', from: -480, to: -30, tags: [R_MEDITERRANEAN, T_PHILOSOPHY], vague: true },
  { name: 'the Roman peace', from: -27, to: 180, tags: [R_MEDITERRANEAN, R_ITALY, T_POLITICS] },
  { name: 'the crisis of the third century', from: 235, to: 284, tags: [R_ITALY, T_POLITICS] },
  { name: 'late antiquity', from: 280, to: 600, tags: [R_MEDITERRANEAN, T_RELIGION], vague: true },
  { name: 'the migration period', from: 375, to: 568, tags: [R_EUROPE, T_WAR], vague: true },
  { name: 'the Carolingian world', from: 751, to: 888, tags: [R_FRANCE, R_GERMANY, T_POLITICS] },
  { name: 'the Viking age', from: 793, to: 1066, tags: [R_NORDICS, R_BRITAIN, T_WAR] },
  { name: 'the high middle ages', from: 1000, to: 1300, tags: [R_EUROPE, T_RELIGION] },
  { name: 'the age of cathedrals', from: 1140, to: 1280, tags: [R_FRANCE, T_ART] },
  { name: 'the calamitous fourteenth century', from: 1315, to: 1400, tags: [R_EUROPE, T_MEDICINE] },
  { name: 'the Renaissance', from: 1400, to: 1600, tags: [R_ITALY, T_ART, T_PHILOSOPHY] },
  { name: 'the age of discovery', from: 1450, to: 1580, tags: [R_EUROPE, T_EXPLORATION] },
  { name: 'the Reformation', from: 1517, to: 1648, tags: [R_GERMANY, T_RELIGION] },
  { name: 'the scientific revolution', from: 1543, to: 1687, tags: [R_EUROPE, T_SCIENCE] },
  { name: 'the Enlightenment', from: 1685, to: 1800, tags: [R_FRANCE, T_PHILOSOPHY], vague: true },
  { name: 'the revolutionary era', from: 1775, to: 1815, tags: [R_FRANCE, R_AMERICAS, T_POLITICS] },
  { name: 'the long nineteenth century', from: 1789, to: 1914, tags: [R_EUROPE, T_POLITICS] },
  { name: 'the industrial age', from: 1830, to: 1914, tags: [R_BRITAIN, T_TECHNOLOGY] },
  { name: 'the First World War', from: 1914, to: 1918, tags: [R_EUROPE, T_WAR] },
  { name: 'the interwar years', from: 1918, to: 1939, tags: [R_EUROPE, T_POLITICS] },
  { name: 'the Second World War', from: 1939, to: 1945, tags: [R_EUROPE, T_WAR] },
  { name: 'the postwar boom', from: 1945, to: 1973, tags: [R_EUROPE, T_ECONOMICS] },
  { name: 'the Cold War', from: 1947, to: 1991, tags: [R_RUSSIA, R_AMERICAS, T_POLITICS] },
  { name: 'the age of the networked computer', from: 1991, to: 2026, tags: [T_TECHNOLOGY] },
];

/** D26: the personal frame of reference the rest of the timeline is read against. */
const PERSONAL_ERAS: readonly EraSeed[] = [
  { name: 'my life', from: 2002, to: 2026, tags: [], notes: 'Created on first run from a birth year.' },
  { name: 'school', from: 2009, to: 2021, tags: [] },
  { name: 'university', from: 2021, to: 2026, tags: [] },
  { name: 'the years I was reading Russian novels', from: 2019, to: 2022, tags: [T_LITERATURE] },
  { name: 'the reading group', from: 2023, to: 2026, tags: [T_PHILOSOPHY] },
  { name: 'living in Kaltheim', from: 2016, to: 2018, tags: [R_GERMANY] },
  { name: 'the summer I read nothing but Roman history', from: 2020.4, to: 2020.7, tags: [R_ITALY] },
  { name: 'the thesis', from: 2025, to: 2026.4, tags: [T_SCIENCE] },
];

function eraWhen(rng: Rng, seed: EraSeed): TimeSpec {
  const v = vagueness(seed.from);
  const granularity: Granularity = v < 0.45 ? 'year' : v < 0.75 ? 'decade' : 'century';
  const start = yearToDays(seed.from);
  const end = Math.min(yearToDays(seed.to), CEILING_DAYS);
  if (seed.vague === true) {
    const margin = typicalMargin(rng, Math.max(v, 0.6));
    const a = yearToDays(seed.from - margin);
    const b = Math.max(a, start);
    const c = Math.max(b, end);
    const d = Math.max(c, Math.min(yearToDays(seed.to + margin), CEILING_DAYS));
    return fuzzy(a, b, c, d, { granularity });
  }
  return interval(start, Math.max(start, end), { granularity });
}

function generateEras(rng: Rng, count: number): Era[] {
  if (count <= 0) return [];
  const personalWanted = clamp(Math.round(count * 0.3), 1, Math.min(PERSONAL_ERAS.length, count));
  const canonicalWanted = count - personalWanted;

  const seeds: { seed: EraSeed; kind: 'canonical' | 'personal' }[] = [];
  for (let i = 0; i < canonicalWanted; i++) {
    // Spread the selection across the whole pool rather than taking a chronological
    // prefix: asking for twelve eras must not leave the dense modern end of the axis
    // — where most of the events are — without a single named period.
    const round = Math.floor(i / CANONICAL_ERAS.length);
    const within = i % CANONICAL_ERAS.length;
    const index =
      canonicalWanted >= CANONICAL_ERAS.length
        ? within
        : Math.floor((within * CANONICAL_ERAS.length) / canonicalWanted);
    const base = CANONICAL_ERAS[index];
    if (base === undefined) break;
    if (round === 0) {
      seeds.push({ seed: base, kind: 'canonical' });
    } else {
      // More eras than named periods: shift a copy so overlap keeps stressing the lanes.
      const shift = round;
      seeds.push({
        seed: {
          name: `${base.name}, ${pick(rng, PLACES).name} view`,
          from: base.from + shift * 7,
          to: base.to + shift * 7,
          tags: base.tags,
        },
        kind: 'canonical',
      });
    }
  }
  for (let i = 0; i < personalWanted; i++) {
    const base = PERSONAL_ERAS[i % PERSONAL_ERAS.length];
    if (base === undefined) break;
    seeds.push({ seed: base, kind: 'personal' });
  }

  const eras: Era[] = seeds.map(({ seed, kind }, index) => {
    const when = eraWhen(rng, seed);
    const createdDays = NOW_DAYS - Math.pow(rng(), 0.7) * 365.25 * 3;
    const created_at = isoFrom(rng, createdDays);
    return {
      id: seqId('era', index, seeds.length),
      created_at,
      updated_at: created_at,
      name: seed.name,
      when,
      kind,
      tags: [...seed.tags],
      ...(seed.notes !== undefined ? { notes: seed.notes } : {}),
    };
  });

  eras.sort((x, y) => compareTime(x.when, y.when) || compareStrings(x.name, y.name));
  return eras;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Builds a complete synthetic Timeline. Same seed, byte-identical output.
 *
 * Events come back sorted by `when.b` (then `a`, `title`, `id` — the conventional sort
 * key in §1), because the density estimator binary-searches the array and does not sort.
 * `connections` is clamped to the number of distinct event pairs available, which only
 * bites for tiny event counts.
 */
export function generateTimeline(options: SyntheticOptions = {}): Timeline {
  const eventCount = Math.max(0, options.events ?? 2000);
  const connectionCount = Math.max(0, options.connections ?? 400);
  const eraCount = Math.max(0, options.eras ?? 20);
  const rng = makeRng(options.seed ?? 1);

  // Tags first: the built-in set is fixed, so its ids are stable across seeds (D20).
  const installed = isoAt(NOW_DAYS - 1200, 9, 14);
  const tags: Tag[] = TAG_SEEDS.map((seed) => ({
    id: seed.id,
    created_at: installed,
    updated_at: installed,
    name: seed.name,
    kind: seed.kind,
    ...(seed.parent !== undefined ? { parent: seed.parent } : {}),
    ...(seed.color !== undefined ? { color: seed.color } : {}),
  }));
  const userTagIds: Id[] = [];
  for (const name of USER_TAG_NAMES) {
    const createdDays = NOW_DAYS - Math.pow(rng(), 0.7) * 365.25 * 3;
    const created_at = isoFrom(rng, createdDays);
    const id = pseudoUuid7(rng);
    userTagIds.push(id);
    tags.push({ id, created_at, updated_at: created_at, name, kind: 'user' });
  }
  const parentOf = new Map<Id, Id>();
  for (const seed of TAG_SEEDS) if (seed.parent !== undefined) parentOf.set(seed.id, seed.parent);

  const drafts = generateDrafts(rng, eventCount, userTagIds, parentOf);

  // Sort before assigning ids, so ev-0001 is the earliest event and the ids read in
  // timeline order when debugging. Sort key per §1: b → a → title → id.
  drafts.sort((x, y) => compareTime(x.when, y.when) || compareStrings(x.title, y.title));

  const events: TimelineEvent[] = drafts.map((d, i) => ({
    id: seqId('ev', i, drafts.length),
    created_at: d.created_at,
    updated_at: d.updated_at,
    title: d.title,
    when: d.when,
    tags: d.tags,
    provenance: d.provenance,
    ...(d.notes !== undefined ? { notes: d.notes } : {}),
    ...(d.place !== undefined ? { place: d.place } : {}),
    ...(d.sources !== undefined ? { sources: d.sources } : {}),
    ...(d.learned_at !== undefined ? { learned_at: d.learned_at } : {}),
    ...(d.learned_from !== undefined ? { learned_from: d.learned_from } : {}),
  }));

  const connections = generateConnections(rng, events, drafts, connectionCount);
  const eras = generateEras(rng, eraCount);

  return { events, connections, tags, eras };
}
