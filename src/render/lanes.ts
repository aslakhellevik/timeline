/**
 * Era lanes below the axis (docs/design.md §6.1, D15).
 *
 * Eras are spans, and spans overlap — the Victorian era, the Meiji period and
 * your grandmother's childhood all cover 1890 — so they need rows. Allocation is
 * greedy interval-graph colouring: walk them in start order and drop each into
 * the lowest row it clears.
 *
 * Pure, like `arcs.ts`: this computes a layout in pixels and the renderer draws
 * it. No canvas, no framework.
 */

import type { Days, Era, Id } from '../core/model/types';

/** One era bar, in device-independent pixels. */
export interface EraBar {
  era: Era;
  /** 0 is the row nearest the axis. */
  lane: number;
  /** Certain extent, `b`→`c`. */
  x1: number;
  x2: number;
  /** Ramp widths for the uncertain flanks `a`→`b` and `c`→`d`, in pixels. */
  fadeLeft: number;
  fadeRight: number;
  colour: string;
  /** Whether the span continues beyond the viewport, so the bar can say so. */
  clippedLeft: boolean;
  clippedRight: boolean;
}

export interface LaneLayout {
  bars: EraBar[];
  /** Rows actually used, which is what the renderer reserves height for. */
  laneCount: number;
  /** Eras that would not fit under the lane cap. Nonzero means the view is lying. */
  dropped: number;
}

export interface LaneOptions {
  /**
   * Pixels of clear space required between two bars in the same lane.
   *
   * Not zero: two eras that merely touch would render as one continuous bar, and
   * "the Cold War" running straight into "the Nineties" is a false statement
   * about the world rather than a cosmetic problem.
   */
  gap?: number;
  /** Beyond this, further eras are dropped rather than shrinking every row. */
  maxLanes?: number;
  tagColours?: ReadonlyMap<Id, string>;
  /** Eras with no tag colour of their own. */
  canonicalColour: string;
  /** Personal eras — your life, other people's — get their own hue. */
  personalColour: string;
}

const DEFAULT_GAP = 6;
const DEFAULT_MAX_LANES = 6;

/**
 * Assigns lanes and computes bar geometry for the current viewport.
 *
 * **Personal eras are allocated first**, so wherever one exists it takes the
 * lane nearest the axis and the frame of reference you read the timeline against
 * is the first thing under it.
 *
 * They do not *reserve* those lanes along the rest of the axis, though, and the
 * difference matters more than it sounds. A real corpus has several overlapping
 * personal eras — a life, a schooling, a couple of years of reading — all inside
 * the last few decades. Holding four rows clear across four thousand years for
 * bars twenty pixels wide pushed every canonical era down four rows and dropped
 * the ones that no longer fit. So a canonical era may share lane 0 with "my
 * life" when the two are millennia apart, which nobody can misread.
 */
export function layoutLanes(
  eras: readonly Era[],
  toPx: (t: Days) => number,
  width: number,
  options: LaneOptions,
): LaneLayout {
  const gap = options.gap ?? DEFAULT_GAP;
  const maxLanes = options.maxLanes ?? DEFAULT_MAX_LANES;
  const tagColours = options.tagColours ?? new Map<Id, string>();

  const visible = eras.filter((era) => !era.deleted_at && overlaps(era, toPx, width));
  // Start order is what makes the greedy allocation optimal for interval graphs;
  // the id tiebreak keeps it from reshuffling between frames.
  const sorted = [...visible].sort(
    (a, b) => a.when.a - b.when.a || a.when.d - b.when.d || (a.id < b.id ? -1 : 1),
  );

  const personal = sorted.filter((era) => era.kind === 'personal');
  const canonical = sorted.filter((era) => era.kind !== 'personal');

  /**
   * Spans taken in each lane.
   *
   * The intervals themselves, not just the rightmost edge. The cheap version is
   * only correct if eras arrive in start order, and they do not: personal ones
   * are placed first so they get the lowest lanes. Tracking the last edge under
   * that ordering means one personal era at 2002 blocks lane 0 for everything
   * earlier — which is the starvation this ordering exists to avoid.
   */
  const occupied: { left: number; right: number }[][] = [];
  const bars: EraBar[] = [];
  let dropped = 0;

  const place = (era: Era): void => {
    const left = toPx(era.when.a);
    const right = toPx(era.when.d);

    let lane = -1;
    for (let candidate = 0; candidate < maxLanes; candidate++) {
      const taken = occupied[candidate];
      if (taken === undefined) {
        lane = candidate;
        break;
      }
      if (taken.every((span) => left >= span.right + gap || right + gap <= span.left)) {
        lane = candidate;
        break;
      }
    }
    if (lane === -1) {
      dropped++;
      return;
    }

    (occupied[lane] ??= []).push({ left, right });
    bars.push({
      era,
      lane,
      x1: clamp(toPx(era.when.b), width),
      x2: clamp(toPx(era.when.c), width),
      // The flanks are the era's own uncertainty, drawn as a fade rather than an
      // edge: "the years I was reading Russian novels" has no first day.
      fadeLeft: Math.max(0, toPx(era.when.b) - left),
      fadeRight: Math.max(0, right - toPx(era.when.c)),
      colour: colourOf(era, tagColours, options),
      clippedLeft: left < 0,
      clippedRight: right > width,
    });
  };

  for (const era of personal) place(era);
  for (const era of canonical) place(era);

  return { bars, laneCount: occupied.length, dropped };
}

function overlaps(era: Era, toPx: (t: Days) => number, width: number): boolean {
  return toPx(era.when.d) >= 0 && toPx(era.when.a) <= width;
}

/** Keeps coordinates finite when an era extends far outside the viewport. */
function clamp(x: number, width: number): number {
  return Math.min(width * 2, Math.max(-width, x));
}

function colourOf(
  era: Era,
  tagColours: ReadonlyMap<Id, string>,
  options: LaneOptions,
): string {
  for (const tag of era.tags) {
    const colour = tagColours.get(tag);
    if (colour) return colour;
  }
  return era.kind === 'personal' ? options.personalColour : options.canonicalColour;
}

/** The era bar under a point, or null. Lane 0 is nearest `top`. */
export function hitTestLanes(
  layout: LaneLayout,
  x: number,
  y: number,
  top: number,
  laneHeight: number,
): EraBar | null {
  const lane = Math.floor((y - top) / laneHeight);
  if (lane < 0 || lane >= layout.laneCount) return null;

  for (const bar of layout.bars) {
    if (bar.lane !== lane) continue;
    // The fades are part of the era, so they are part of its hit target.
    if (x >= bar.x1 - bar.fadeLeft && x <= bar.x2 + bar.fadeRight) return bar;
  }
  return null;
}
