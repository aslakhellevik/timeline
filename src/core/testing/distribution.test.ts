/**
 * Shape tests.
 *
 * These are the tests that matter for M1. A generator that satisfies every contract in
 * `synthetic.test.ts` and scatters events uniformly would be worse than useless: the far
 * view would look like noise, and a developer could not tell a correct density render
 * from a broken one. So the distribution itself is asserted — recency weighting, real
 * gaps, uncertainty rising with age, and tags that redistribute mass rather than thin it.
 *
 * Thresholds are deliberately loose (the mixture is random), but every one of them fails
 * for a uniform generator.
 */

import { describe, expect, it } from 'vitest';
import type { Timeline, TimelineEvent } from '../model/types';
import { toGregorian } from '../time';
import { generateTimeline } from './synthetic';

const SEEDS = [1, 2, 3] as const;
const timelines: Timeline[] = SEEDS.map((seed) => generateTimeline({ seed }));

/** Nominal year of an event: the likely start, which is what the sort key uses. */
function yearOf(e: TimelineEvent): number {
  return toGregorian(e.when.b).year;
}

function share(t: Timeline, predicate: (year: number) => boolean): number {
  return t.events.filter((e) => predicate(yearOf(e))).length / t.events.length;
}

function countIn(t: Timeline, from: number, to: number): number {
  return t.events.filter((e) => yearOf(e) >= from && yearOf(e) < to).length;
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe('recency weighting', () => {
  it.each(SEEDS.map((s, i) => [s, timelines[i]] as const))('seed %i puts the bulk after 1800', (_seed, t) => {
    if (!t) throw new Error('unreachable');
    expect(share(t, (y) => y >= 1800)).toBeGreaterThan(0.5);
    // Not merely over half — the great bulk, as a real reader's knowledge is.
    expect(share(t, (y) => y >= 1800)).toBeGreaterThan(0.6);
    expect(share(t, (y) => y >= 1900)).toBeGreaterThan(0.35);
  });

  it('thins fast before 1500 and is sparse before year 0', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    expect(share(t, (y) => y < 1500)).toBeLessThan(0.2);
    expect(share(t, (y) => y < 0)).toBeLessThan(0.06);
    expect(share(t, (y) => y < -1000)).toBeLessThan(0.02);
  });

  it('still scatters a few events back to about -3000', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const ancient = t.events.filter((e) => yearOf(e) < 0);
    expect(ancient.length).toBeGreaterThan(10);
    const earliest = Math.min(...t.events.map(yearOf));
    expect(earliest).toBeLessThan(-1200);
    expect(earliest).toBeGreaterThanOrEqual(-3200);
  });

  it('never generates anything in the future', () => {
    for (const t of timelines) {
      expect(Math.max(...t.events.map(yearOf))).toBeLessThanOrEqual(2026);
    }
  });
});

describe('clumps and gaps', () => {
  it('clumps around the periods people actually know', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    // Each of these windows must hold visibly more than its width alone would give.
    expect(countIn(t, 1939, 1946)).toBeGreaterThan(60); // the Second World War
    expect(countIn(t, 1914, 1919)).toBeGreaterThan(30); // the Great War
    expect(countIn(t, 1789, 1816)).toBeGreaterThan(40); // Revolution and Napoleon
    expect(countIn(t, 1947, 1992)).toBeGreaterThan(150); // the Cold War
    expect(countIn(t, -500, -300)).toBeGreaterThan(3); // classical antiquity
  });

  it('leaves the early middle ages thin but not empty — the gap is the point', () => {
    for (const t of timelines) {
      const earlyMedievalPerCentury = countIn(t, 600, 1000) / 4;
      const twentiethPerCentury = countIn(t, 1900, 2000);
      expect(earlyMedievalPerCentury).toBeGreaterThan(0);
      expect(earlyMedievalPerCentury).toBeLessThan(twentiethPerCentury * 0.05);
    }
  });

  it('leaves long BC stretches nearly empty', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    expect(countIn(t, -1700, -700) / 10).toBeLessThan(countIn(t, 1900, 2000) * 0.02);
  });
});

describe('uncertainty correlates with age', () => {
  it('gives ancient events far wider sigma than modern ones', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const ancient = mean(t.events.filter((e) => yearOf(e) < 500).map((e) => e.when.sigma));
    const modern = mean(t.events.filter((e) => yearOf(e) > 1900).map((e) => e.when.sigma));
    expect(ancient).toBeGreaterThan(modern);
    expect(ancient / modern).toBeGreaterThan(10);
  });

  it('is monotone across the axis, not just at the extremes', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const bands: [number, number][] = [
      [-3200, 0],
      [0, 1000],
      [1000, 1500],
      [1500, 1800],
      [1800, 1950],
      [1950, 2027],
    ];
    const sigmas = bands.map(([lo, hi]) =>
      mean(t.events.filter((e) => yearOf(e) >= lo && yearOf(e) < hi).map((e) => e.when.sigma)),
    );
    for (let i = 1; i < sigmas.length; i++) {
      const prev = sigmas[i - 1];
      const cur = sigmas[i];
      if (prev === undefined || cur === undefined) throw new Error('unreachable');
      expect(cur).toBeLessThan(prev);
    }
  });

  it('makes modern events mostly instants and ancient ones mostly fuzzy or interval', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const modern = t.events.filter((e) => yearOf(e) > 1950);
    const ancient = t.events.filter((e) => yearOf(e) < 0);
    expect(modern.filter((e) => e.when.mode === 'instant').length / modern.length).toBeGreaterThan(0.7);
    expect(ancient.filter((e) => e.when.mode !== 'instant').length / ancient.length).toBeGreaterThan(0.7);
  });

  it('uses day granularity for modern instants and coarse granularity for ancient ones', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const modern = t.events.filter((e) => yearOf(e) > 1990 && e.when.mode === 'instant');
    const ancient = t.events.filter((e) => yearOf(e) < 500);
    expect(modern.filter((e) => e.when.granularity === 'day').length / modern.length).toBeGreaterThan(0.5);
    expect(
      ancient.filter((e) => e.when.granularity === 'century' || e.when.granularity === 'decade').length /
        ancient.length,
    ).toBeGreaterThan(0.5);
  });
});

describe('tags redistribute mass rather than thinning it (§3.5)', () => {
  it('correlates region tags with period', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const overallAncient = share(t, (y) => y < 500);
    const med = t.events.filter((e) => e.tags.includes('tag.region.mediterranean'));
    const ancientAmongMed = med.filter((e) => yearOf(e) < 500).length / med.length;
    expect(med.length).toBeGreaterThan(20);
    expect(ancientAmongMed).toBeGreaterThan(overallAncient * 4);
  });

  it('correlates theme tags with period', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const all = mean(t.events.map(yearOf));
    const tech = mean(t.events.filter((e) => e.tags.includes('tag.theme.technology')).map(yearOf));
    const religion = mean(t.events.filter((e) => e.tags.includes('tag.theme.religion')).map(yearOf));
    const philosophy = mean(t.events.filter((e) => e.tags.includes('tag.theme.philosophy')).map(yearOf));
    expect(tech).toBeGreaterThan(all);
    expect(religion).toBeLessThan(all - 200);
    expect(philosophy).toBeLessThan(all);
  });

  it('keeps every theme tag in use, so no filter is dead', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const used = new Set(t.events.flatMap((e) => e.tags));
    for (const tag of t.tags) {
      if (tag.kind === 'theme') expect(used.has(tag.id)).toBe(true);
    }
  });
});

describe('connections form structure', () => {
  it('is mostly local with a real minority of long-range arcs', () => {
    const t = timelines[0];
    if (!t) throw new Error('unreachable');
    const index = new Map(t.events.map((e, i) => [e.id, i]));
    const spans = t.connections.map((c) => Math.abs((index.get(c.to) ?? 0) - (index.get(c.from) ?? 0)));
    const localShare = spans.filter((s) => s < t.events.length * 0.02).length / spans.length;
    const longShare = spans.filter((s) => s > t.events.length * 0.25).length / spans.length;
    expect(localShare).toBeGreaterThan(0.3);
    expect(longShare).toBeGreaterThan(0.05);
    expect(longShare).toBeLessThan(0.5);
  });
});
