import { describe, expect, it } from 'vitest';
import type { Era, Id } from '../core/model/types';
import { fuzzy, interval } from '../core/time';
import { hitTestLanes, layoutLanes } from './lanes';
import type { LaneOptions } from './lanes';

const OPTIONS: LaneOptions = {
  gap: 6,
  maxLanes: 6,
  canonicalColour: '#555555',
  personalColour: '#ffd43b',
};

/** `when` is read straight back as pixels, so these tests talk in pixels. */
function era(
  id: string,
  from: number,
  to: number,
  kind: Era['kind'] = 'canonical',
  tags: Id[] = [],
): Era {
  return {
    id,
    created_at: '2026-01-01T00:00:00+01:00',
    updated_at: '2026-01-01T00:00:00+01:00',
    name: id,
    when: interval(from, to),
    kind,
    tags,
  };
}

const layout = (eras: readonly Era[], width = 1000, options: Partial<LaneOptions> = {}) =>
  layoutLanes(eras, (t) => t, width, { ...OPTIONS, ...options });

describe('lane allocation', () => {
  it('puts disjoint eras in the same lane', () => {
    const { bars, laneCount } = layout([era('a', 0, 100), era('b', 200, 300)]);
    expect(bars.map((bar) => bar.lane)).toEqual([0, 0]);
    expect(laneCount).toBe(1);
  });

  it('pushes overlapping eras into separate lanes', () => {
    const { bars, laneCount } = layout([era('a', 0, 300), era('b', 200, 500), era('c', 250, 600)]);
    expect(bars.map((bar) => bar.lane)).toEqual([0, 1, 2]);
    expect(laneCount).toBe(3);
  });

  it('keeps a gap, so two touching eras do not read as one bar', () => {
    // "The Cold War" running straight into "the Nineties" is a false statement
    // about the world, not a cosmetic problem.
    const { bars } = layout([era('a', 0, 100), era('b', 100, 200)]);
    expect(bars.map((bar) => bar.lane)).toEqual([0, 1]);
  });

  it('reuses a lane once the gap is cleared', () => {
    const { bars, laneCount } = layout([era('a', 0, 100), era('b', 110, 200)]);
    expect(bars.map((bar) => bar.lane)).toEqual([0, 0]);
    expect(laneCount).toBe(1);
  });

  it('gives personal eras the lanes nearest the axis', () => {
    const eras = [
      era('canonical-early', 0, 900),
      era('my-life', 100, 800, 'personal'),
      era('canonical-late', 200, 700),
    ];
    const { bars } = layout(eras);
    const lane = (id: string) => bars.find((bar) => bar.era.id === id)?.lane;
    expect(lane('my-life')).toBe(0);
    expect(lane('canonical-early')).toBeGreaterThan(0);
    expect(lane('canonical-late')).toBeGreaterThan(0);
  });

  it('lets a distant canonical era share a lane with a personal one', () => {
    /*
     * Personal eras take priority, not a reservation. A real corpus has several
     * overlapping personal eras crammed into the last few decades; holding those
     * rows clear across the whole axis pushed the canonical eras down and dropped
     * the ones that no longer fitted. Two bars a thousand pixels apart share a
     * row happily.
     */
    const { bars, laneCount } = layout([era('mine', 900, 1000, 'personal'), era('theirs', 0, 100)]);
    expect(bars.find((bar) => bar.era.id === 'mine')?.lane).toBe(0);
    expect(bars.find((bar) => bar.era.id === 'theirs')?.lane).toBe(0);
    expect(laneCount).toBe(1);
  });

  it('still gives the personal era the lower lane where they do collide', () => {
    const { bars } = layout([era('theirs', 0, 900), era('mine', 100, 800, 'personal')]);
    expect(bars.find((bar) => bar.era.id === 'mine')?.lane).toBe(0);
    expect(bars.find((bar) => bar.era.id === 'theirs')?.lane).toBe(1);
  });

  it('packs four overlapping personal eras without starving the canonical ones', () => {
    // The case that forced the rule change: a life, a schooling and two reading
    // periods, all inside the last two decades of a four-thousand-year axis.
    const eras = [
      era('life', 940, 1000, 'personal'),
      era('school', 950, 990, 'personal'),
      era('reading', 960, 980, 'personal'),
      era('university', 970, 1000, 'personal'),
      era('antiquity', 0, 300),
      era('middle-ages', 310, 600),
      era('renaissance', 610, 800),
      era('modern', 810, 930),
    ];
    const { bars, laneCount, dropped } = layout(eras, 1000, { maxLanes: 6 });
    expect(dropped).toBe(0);
    expect(bars).toHaveLength(8);
    // The four canonical eras are disjoint, so they all fit in lane 0 alongside
    // nothing; the personal pile needs four rows only where it actually sits.
    expect(laneCount).toBe(4);
    for (const id of ['antiquity', 'middle-ages', 'renaissance', 'modern']) {
      expect(bars.find((bar) => bar.era.id === id)?.lane).toBe(0);
    }
  });

  it('reports how many eras it had to drop', () => {
    const eras = Array.from({ length: 10 }, (_, i) => era(`e${i}`, i, 900));
    expect(layout(eras, 1000, { maxLanes: 3 }).dropped).toBe(7);
  });

  it('drops eras beyond the lane cap rather than shrinking every row', () => {
    const eras = Array.from({ length: 10 }, (_, i) => era(`e${i}`, i, 900));
    const { bars, laneCount } = layout(eras, 1000, { maxLanes: 3 });
    expect(laneCount).toBe(3);
    expect(bars).toHaveLength(3);
  });

  it('culls eras outside the viewport', () => {
    const { bars } = layout([era('left', -500, -100), era('right', 1500, 2000), era('in', 10, 20)]);
    expect(bars.map((bar) => bar.era.id)).toEqual(['in']);
  });

  it('keeps an era that spans the whole viewport, and says it is clipped', () => {
    const [bar] = layout([era('long', -500, 1500)]).bars;
    expect(bar).toBeDefined();
    expect(bar?.clippedLeft).toBe(true);
    expect(bar?.clippedRight).toBe(true);
  });

  it('ignores tombstoned eras', () => {
    const dead = { ...era('gone', 0, 100), deleted_at: '2026-02-01T00:00:00+01:00' };
    expect(layout([dead]).bars).toHaveLength(0);
  });

  it('is stable frame to frame for eras that start together', () => {
    const same = [era('zzz', 0, 100), era('aaa', 0, 100)];
    const first = layout(same).bars.map((bar) => bar.era.id);
    const second = layout([...same].reverse()).bars.map((bar) => bar.era.id);
    expect(second).toEqual(first);
  });
});

describe('bar geometry', () => {
  it('draws the certain core between b and c', () => {
    const [bar] = layout([era('a', 100, 400)]).bars;
    expect(bar?.x1).toBe(100);
    expect(bar?.x2).toBe(400);
    expect(bar?.fadeLeft).toBe(0);
    expect(bar?.fadeRight).toBe(0);
  });

  it('turns a fuzzy era into fades on the flanks', () => {
    // "The years I was reading Russian novels" has no first day.
    const vague: Era = {
      ...era('vague', 0, 0),
      when: fuzzy(100, 200, 400, 500),
    };
    const [bar] = layout([vague]).bars;
    expect(bar?.x1).toBe(200);
    expect(bar?.x2).toBe(400);
    expect(bar?.fadeLeft).toBe(100);
    expect(bar?.fadeRight).toBe(100);
  });

  it('colours by tag, then by kind', () => {
    const colours = new Map([['art', '#f76707']]);
    const bars = layout(
      [era('tagged', 0, 100, 'canonical', ['art']), era('mine', 200, 300, 'personal')],
      1000,
      { tagColours: colours },
    ).bars;
    expect(bars.find((bar) => bar.era.id === 'tagged')?.colour).toBe('#f76707');
    expect(bars.find((bar) => bar.era.id === 'mine')?.colour).toBe('#ffd43b');
  });

  it('keeps coordinates finite for an era far outside the viewport', () => {
    const [bar] = layout([era('huge', -1e9, 1e9)]).bars;
    expect(Number.isFinite(bar?.x1 as number)).toBe(true);
    expect(Math.abs(bar?.x1 as number)).toBeLessThan(1e5);
  });
});

describe('hitTestLanes', () => {
  const result = layout([era('a', 100, 400), era('b', 200, 600)]);

  it('finds the bar under a point', () => {
    expect(hitTestLanes(result, 200, 505, 500, 10)?.era.id).toBe('a');
    expect(hitTestLanes(result, 500, 515, 500, 10)?.era.id).toBe('b');
  });

  it('misses above, below and beside', () => {
    expect(hitTestLanes(result, 200, 490, 500, 10)).toBeNull();
    expect(hitTestLanes(result, 200, 560, 500, 10)).toBeNull();
    expect(hitTestLanes(result, 50, 505, 500, 10)).toBeNull();
  });

  it('counts the uncertain flanks as part of the era', () => {
    const vague = layoutLanes(
      [{ ...era('v', 0, 0), when: fuzzy(100, 200, 400, 500) }],
      (t) => t,
      1000,
      OPTIONS,
    );
    expect(hitTestLanes(vague, 150, 505, 500, 10)?.era.id).toBe('v');
    expect(hitTestLanes(vague, 450, 505, 500, 10)?.era.id).toBe('v');
    expect(hitTestLanes(vague, 550, 505, 500, 10)).toBeNull();
  });
});

describe('label reservation', () => {
  // A bar is never widened to fit its name — the width is a claim about how
  // long something lasted — so a name too long for its bar is set beside it,
  // and the room that takes has to be held against the next era in the row.
  const measure = (name: string) => name.length * 6;

  it('marks a name that will not fit inside its bar', () => {
    const { bars } = layout([era('short', 0, 20), era('roomy', 200, 800)], 1000, {
      labelWidth: (e) => measure(e.name),
    });
    expect(bars.find((bar) => bar.era.id === 'short')?.labelOutside).toBe(true);
    expect(bars.find((bar) => bar.era.id === 'roomy')?.labelOutside).toBe(false);
  });

  it('holds the room an outside name takes, so the next era clears it', () => {
    // "short" is 20 px of bar with 30 px of name beside it; "next" starts at 40,
    // which clears the bar and lands on the text.
    const withoutLabels = layout([era('short', 0, 20), era('next', 40, 200)]);
    expect(withoutLabels.bars.map((bar) => bar.lane)).toEqual([0, 0]);

    const withLabels = layout([era('short', 0, 20), era('next', 40, 200)], 1000, {
      labelWidth: () => 30,
    });
    expect(withLabels.bars.map((bar) => bar.lane)).toEqual([0, 1]);
  });

  it('leaves the geometry alone: only the row allocation changes', () => {
    const [plain] = layout([era('a', 100, 400)]).bars;
    const [labelled] = layout([era('a', 100, 400)], 1000, { labelWidth: () => 500 }).bars;
    expect(labelled?.x1).toBe(plain?.x1);
    expect(labelled?.x2).toBe(plain?.x2);
    expect(labelled?.labelWidth).toBe(500);
  });

  it('asks for nothing when the caller cannot measure text', () => {
    const [bar] = layout([era('a', 100, 400)]).bars;
    expect(bar?.labelWidth).toBe(0);
    expect(bar?.labelOutside).toBe(false);
  });
});
