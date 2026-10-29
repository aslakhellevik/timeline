import { describe, expect, it } from 'vitest';
import type { Connection, TimelineEvent } from '../core/model/types';
import { interval } from '../core/time';
import { DEFAULT_ARC_LIMIT, buildArcIndex, hitTestArc, layoutArcs } from './arcs';

/**
 * The stated budget (design.md §5.1): 50k events, 10k connections, 60 fps.
 *
 * Warmed up before timing, because a first pass through an unoptimised function
 * measures the JIT rather than the code.
 *
 * Measured on the development machine: 0.3ms to lay out a full frame of arcs,
 * 0.3ms to hit-test one, 0.5ms for a zoomed-in frame that culls almost
 * everything. The bounds below leave roughly six times that, which is slack for
 * slower hardware without being so loose that a regression slips through — an
 * earlier version of this file resolved colours and looked up events per frame
 * and cost ten times as much.
 */
describe('the frame budget', () => {
  const EVENTS = 50_000;
  const CONNECTIONS = 10_000;
  const SPAN = EVENTS * 30;

  const events: TimelineEvent[] = Array.from({ length: EVENTS }, (_, i) => ({
    id: `e${i}`,
    created_at: '2026-01-01T00:00:00+01:00',
    updated_at: '2026-01-01T00:00:00+01:00',
    title: `event ${i}`,
    when: interval(i * 30, i * 30),
    tags: [],
    provenance: { kind: 'manual' as const },
  }));
  const byId = new Map(events.map((event) => [event.id, event]));

  /** Endpoints scattered across the whole corpus: the worst case for culling. */
  const scattered: Connection[] = Array.from({ length: CONNECTIONS }, (_, i) => ({
    id: `c${i}`,
    created_at: '2026-01-01T00:00:00+01:00',
    updated_at: '2026-01-01T00:00:00+01:00',
    from: `e${(i * 7) % EVENTS}`,
    to: `e${(i * 13 + 5) % EVENTS}`,
    note: '',
    tags: [],
    provenance: { kind: 'manual' as const },
  }));

  /** Endpoints near each other, which is what a real timeline mostly has. */
  const local: Connection[] = Array.from({ length: CONNECTIONS }, (_, i) => ({
    ...(scattered[i] as Connection),
    from: `e${(i * 5) % EVENTS}`,
    to: `e${((i * 5) % EVENTS) + 20}`,
  }));

  const timeOf = (event: TimelineEvent) => event.when.b;
  const scatteredIndex = buildArcIndex(scattered, byId, timeOf, new Map(), '#888888');
  const localIndex = buildArcIndex(local, byId, timeOf, new Map(), '#888888');
  const options = { baselineY: 600, maxApex: 500 };

  /** Whole corpus in view. */
  const wide = (t: number) => (t / SPAN) * 1400;
  /** Zoomed to about a decade in the middle. */
  const narrow = (t: number) => ((t - SPAN / 2) / 3650) * 1400;

  const measure = (run: () => unknown, iterations = 30): number => {
    for (let i = 0; i < 3; i++) run();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) run();
    return (performance.now() - start) / iterations;
  };

  it('bounds a full-extent frame by the arc limit, not by the corpus size', () => {
    const arcs = layoutArcs(scatteredIndex, wide, 1400, options);
    expect(arcs).toHaveLength(DEFAULT_ARC_LIMIT);

    const perFrame = measure(() => layoutArcs(scatteredIndex, wide, 1400, options));
    console.log(`layout at full extent: ${arcs.length} arcs, ${perFrame.toFixed(2)}ms`);
    expect(perFrame).toBeLessThan(3);
  });

  it('hit-tests a full frame of arcs well inside one', () => {
    const arcs = layoutArcs(scatteredIndex, wide, 1400, options);
    const perHit = measure(() => hitTestArc(arcs, 700, 400, 600));
    console.log(`hit-test: ${arcs.length} arcs, ${perHit.toFixed(2)}ms`);
    expect(perHit).toBeLessThan(3);
  });

  it('culls local connections outside the viewport almost entirely', () => {
    const arcs = layoutArcs(localIndex, narrow, 1400, options);
    expect(arcs.length).toBeLessThan(CONNECTIONS / 20);

    const perFrame = measure(() => layoutArcs(localIndex, narrow, 1400, options));
    console.log(`layout zoomed in: ${arcs.length} arcs, ${perFrame.toFixed(2)}ms`);
    expect(perFrame).toBeLessThan(3);
  });

  it('cannot cull long-range arcs, because they cross the viewport', () => {
    /*
     * Worth stating as a test rather than as a comment. Zooming in does not
     * reduce the number of *long* arcs on screen: an arc with one endpoint on
     * each side still crosses the window, and with endpoints scattered at random
     * about half of them do. Culling is therefore no defence at this scale and
     * the limit is what bounds the frame — which is why the limit exists.
     */
    const uncapped = { ...options, limit: CONNECTIONS * 2 };
    const surviving = layoutArcs(scatteredIndex, narrow, 1400, uncapped).length;
    expect(surviving).toBeGreaterThan(CONNECTIONS / 4);

    expect(layoutArcs(scatteredIndex, narrow, 1400, options)).toHaveLength(DEFAULT_ARC_LIMIT);
  });

  it('keeps the same arcs frame to frame when the limit bites', () => {
    // The index is ordered longest-first, so the cap keeps the arcs carrying the
    // structure — and keeps the same ones, which is what stops the frame flickering.
    const first = layoutArcs(scatteredIndex, wide, 1400, options).map((a) => a.connection.id);
    const second = layoutArcs(scatteredIndex, wide, 1400, options).map((a) => a.connection.id);
    expect(second).toEqual(first);
  });
});
