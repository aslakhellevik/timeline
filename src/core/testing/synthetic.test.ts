/**
 * Contract tests for the synthetic generator: determinism, counts, and the invariants
 * the rest of the core is entitled to assume (sorted events, well-formed TimeSpecs,
 * connections that resolve, tags that exist).
 *
 * The distribution — the part that decides whether the density view is worth looking at
 * — is tested separately in `distribution.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { Timeline, TimeSpec } from '../model/types';
import { generateTimeline, makeRng } from './synthetic';

const ISO = /^-?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A small timeline keeps the invariant sweeps fast; shape tests use the full 2000. */
const small: Timeline = generateTimeline({ events: 300, connections: 80, eras: 12, seed: 7 });

function allSpecs(t: Timeline): TimeSpec[] {
  return [...t.events.map((e) => e.when), ...t.eras.map((e) => e.when)];
}

describe('makeRng', () => {
  it('is reproducible for a seed', () => {
    const a = Array.from({ length: 8 }, makeRng(42));
    const b = Array.from({ length: 8 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it('differs between seeds and stays in [0, 1)', () => {
    const a = Array.from({ length: 8 }, makeRng(1));
    const b = Array.from({ length: 8 }, makeRng(2));
    expect(a).not.toEqual(b);
    for (const x of [...a, ...b]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('does not immediately repeat itself', () => {
    const rng = makeRng(3);
    const seen = new Set(Array.from({ length: 500 }, rng));
    expect(seen.size).toBe(500);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    const a = generateTimeline({ events: 200, connections: 50, eras: 8, seed: 5 });
    const b = generateTimeline({ events: 200, connections: 50, eras: 8, seed: 5 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different output for a different seed', () => {
    const a = generateTimeline({ events: 200, connections: 50, eras: 8, seed: 5 });
    const b = generateTimeline({ events: 200, connections: 50, eras: 8, seed: 6 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(a.events.map((e) => e.title)).not.toEqual(b.events.map((e) => e.title));
  });

  it('defaults to seed 1', () => {
    const a = generateTimeline({ events: 50, connections: 10, eras: 4 });
    const b = generateTimeline({ events: 50, connections: 10, eras: 4, seed: 1 });
    expect(a).toEqual(b);
  });
});

describe('counts', () => {
  it('matches the documented defaults', () => {
    const t = generateTimeline();
    expect(t.events).toHaveLength(2000);
    expect(t.connections).toHaveLength(400);
    expect(t.eras).toHaveLength(20);
    expect(t.tags.length).toBeGreaterThan(20);
  });

  it('matches requested counts', () => {
    const t = generateTimeline({ events: 137, connections: 41, eras: 5, seed: 9 });
    expect(t.events).toHaveLength(137);
    expect(t.connections).toHaveLength(41);
    expect(t.eras).toHaveLength(5);
  });

  it('handles an empty timeline', () => {
    const t = generateTimeline({ events: 0, connections: 20, eras: 0, seed: 2 });
    expect(t.events).toEqual([]);
    expect(t.connections).toEqual([]);
    expect(t.eras).toEqual([]);
    expect(t.tags.length).toBeGreaterThan(0);
  });

  it('clamps connections to the number of distinct pairs available', () => {
    const t = generateTimeline({ events: 4, connections: 50, eras: 2, seed: 4 });
    expect(t.connections).toHaveLength(6); // 4 choose 2
    expect(new Set(t.connections.map((c) => [c.from, c.to].sort().join('|'))).size).toBe(6);
  });

  it('generates more eras than there are named periods without repeating ids', () => {
    const t = generateTimeline({ events: 20, connections: 0, eras: 40, seed: 11 });
    expect(t.eras).toHaveLength(40);
    expect(new Set(t.eras.map((e) => e.id)).size).toBe(40);
  });
});

describe('event invariants', () => {
  it('returns events sorted by when.b — the density estimator does not sort', () => {
    const full = generateTimeline({ seed: 3 });
    for (let i = 1; i < full.events.length; i++) {
      const prev = full.events[i - 1];
      const cur = full.events[i];
      if (!prev || !cur) throw new Error('unreachable');
      expect(cur.when.b).toBeGreaterThanOrEqual(prev.when.b);
    }
  });

  it('has unique, sequential, timeline-ordered ids', () => {
    expect(new Set(small.events.map((e) => e.id)).size).toBe(small.events.length);
    expect(small.events[0]?.id).toBe('ev-0001');
    expect(small.events.at(-1)?.id).toBe('ev-0300');
  });

  it('gives every TimeSpec a <= b <= c <= d and sigma > 0', () => {
    for (const w of allSpecs(small)) {
      expect(Number.isFinite(w.a)).toBe(true);
      expect(Number.isFinite(w.d)).toBe(true);
      expect(w.a).toBeLessThanOrEqual(w.b);
      expect(w.b).toBeLessThanOrEqual(w.c);
      expect(w.c).toBeLessThanOrEqual(w.d);
      expect(w.sigma).toBeGreaterThan(0);
      expect(Number.isFinite(w.sigma)).toBe(true);
      expect(['instant', 'interval', 'fuzzy']).toContain(w.mode);
      expect(['day', 'month', 'year', 'decade', 'century']).toContain(w.granularity);
    }
  });

  it('gives every event a non-empty title with no unfilled template slots', () => {
    for (const e of small.events) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.title).not.toContain('{');
      expect(e.title.trim()).toBe(e.title);
    }
  });

  it('varies title length enough to exercise label layout', () => {
    const lengths = small.events.map((e) => e.title.length);
    expect(Math.min(...lengths)).toBeLessThan(20);
    expect(Math.max(...lengths)).toBeGreaterThan(60);
  });

  it('fills provenance', () => {
    for (const e of small.events) {
      expect(['manual', 'import']).toContain(e.provenance.kind);
    }
    expect(small.events.filter((e) => e.provenance.kind === 'manual').length / small.events.length).toBeGreaterThan(0.7);
  });

  it('sets learned_at with learned_from on roughly 60% of events (D10)', () => {
    const full = generateTimeline({ seed: 3 });
    const learned = full.events.filter((e) => e.learned_at !== undefined);
    expect(learned.length / full.events.length).toBeGreaterThan(0.55);
    expect(learned.length / full.events.length).toBeLessThan(0.65);
    for (const e of learned) {
      expect(e.learned_from).toBeDefined();
      expect(e.learned_at).toMatch(ISO);
    }
  });

  it('writes wall-clock ISO timestamps with an offset, updated_at never before created_at', () => {
    for (const e of small.events) {
      expect(e.created_at).toMatch(ISO);
      expect(e.updated_at).toMatch(ISO);
      expect(e.updated_at >= e.created_at).toBe(true);
      expect(e.deleted_at).toBeUndefined();
    }
  });

  it('keeps place coordinates plausible when present', () => {
    const placed = small.events.filter((e) => e.place !== undefined);
    expect(placed.length).toBeGreaterThan(0);
    for (const e of placed) {
      const p = e.place;
      if (!p) throw new Error('unreachable');
      expect(p.name.length).toBeGreaterThan(0);
      expect(Math.abs(p.lat ?? 0)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon ?? 0)).toBeLessThanOrEqual(180);
      expect(p.precision ?? 1).toBeGreaterThan(0);
    }
  });
});

describe('tags', () => {
  it('uses the built-in namespaced id convention for region and theme tags (D20)', () => {
    for (const tag of small.tags) {
      if (tag.kind === 'user') expect(tag.id).toMatch(UUID);
      // Kebab-case throughout, matching the built-in set: tag.region.near-east.
      else expect(tag.id).toMatch(/^tag\.(region|theme)\.[a-z]+(-[a-z]+)*$/);
      expect(tag.name.length).toBeGreaterThan(0);
    }
    expect(small.tags.some((t) => t.id === 'tag.region.europe')).toBe(true);
    expect(small.tags.some((t) => t.id === 'tag.theme.philosophy')).toBe(true);
    expect(small.tags.some((t) => t.kind === 'user')).toBe(true);
  });

  it('resolves every tag parent (D14 rollup)', () => {
    const ids = new Set(small.tags.map((t) => t.id));
    for (const tag of small.tags) {
      if (tag.parent !== undefined) expect(ids.has(tag.parent)).toBe(true);
    }
  });

  it('only ever references tags that exist', () => {
    const ids = new Set(small.tags.map((t) => t.id));
    for (const e of small.events) for (const t of e.tags) expect(ids.has(t)).toBe(true);
    for (const c of small.connections) for (const t of c.tags) expect(ids.has(t)).toBe(true);
    for (const e of small.eras) for (const t of e.tags) expect(ids.has(t)).toBe(true);
  });

  it('assigns 0–3 distinct tags per event', () => {
    for (const e of small.events) {
      expect(e.tags.length).toBeLessThanOrEqual(3);
      expect(new Set(e.tags).size).toBe(e.tags.length);
    }
    expect(small.events.some((e) => e.tags.length === 0)).toBe(true);
    expect(small.events.some((e) => e.tags.length === 3)).toBe(true);
  });
});

describe('connections', () => {
  it('resolves both endpoints to real events, with no self-connections or duplicates', () => {
    const full = generateTimeline({ seed: 3 });
    const ids = new Set(full.events.map((e) => e.id));
    const pairs = new Set<string>();
    for (const c of full.connections) {
      expect(ids.has(c.from)).toBe(true);
      expect(ids.has(c.to)).toBe(true);
      expect(c.from).not.toBe(c.to);
      const key = [c.from, c.to].sort().join('|');
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
  });

  it('gives every connection a Markdown note and unique id', () => {
    for (const c of small.connections) {
      expect(c.note.length).toBeGreaterThan(0);
      expect(c.note).not.toContain('{');
      expect(c.provenance.kind).toBeTruthy();
    }
    expect(new Set(small.connections.map((c) => c.id)).size).toBe(small.connections.length);
  });

  it('assigns at most 2 tags, drawn from the endpoints so filters stay coherent (D22)', () => {
    const byId = new Map(small.events.map((e) => [e.id, e]));
    for (const c of small.connections) {
      expect(c.tags.length).toBeLessThanOrEqual(2);
      const endpointTags = new Set([...(byId.get(c.from)?.tags ?? []), ...(byId.get(c.to)?.tags ?? [])]);
      for (const t of c.tags) expect(endpointTags.has(t)).toBe(true);
    }
  });
});

describe('eras', () => {
  it('mixes canonical and personal, and overlaps enough to need lanes (D15)', () => {
    const t = generateTimeline({ seed: 3 });
    expect(t.eras.some((e) => e.kind === 'canonical')).toBe(true);
    expect(t.eras.some((e) => e.kind === 'personal')).toBe(true);

    let overlaps = 0;
    for (let i = 0; i < t.eras.length; i++) {
      for (let j = i + 1; j < t.eras.length; j++) {
        const x = t.eras[i];
        const y = t.eras[j];
        if (!x || !y) continue;
        if (x.when.b < y.when.c && y.when.b < x.when.c) overlaps++;
      }
    }
    expect(overlaps).toBeGreaterThan(5);
  });

  it('names every era and sorts them by when.b', () => {
    for (let i = 0; i < small.eras.length; i++) {
      const e = small.eras[i];
      if (!e) throw new Error('unreachable');
      expect(e.name.length).toBeGreaterThan(0);
      const prev = small.eras[i - 1];
      if (prev) expect(e.when.b).toBeGreaterThanOrEqual(prev.when.b);
    }
  });
});
