/**
 * The map projection (docs/design.md §11).
 *
 * **Equal Earth** (Šavrič, Patterson & Jenny, 2018) — equal-area, closed-form
 * forward, and it looks like a world map rather than a diagram.
 *
 * Equal-area is not an aesthetic choice here. The map answers "where do I know
 * about", which is a question about *how much*, and Mercator inflates Greenland
 * to the size of Africa. A view whose whole point is comparing quantities cannot
 * sit on a projection that distorts them by an order of magnitude at the
 * latitudes most European users care about.
 *
 * Pure maths, no canvas, no framework — the same rule the rest of `core` follows.
 */

/** Longitude and latitude in degrees. */
export interface LonLat {
  lon: number;
  lat: number;
}

/** Projected coordinates, in the projection's own units. */
export interface Point {
  x: number;
  y: number;
}

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const SQRT3_2 = Math.sqrt(3) / 2;

const RADIANS = Math.PI / 180;

/**
 * Equal Earth forward projection, in radians of longitude at the equator.
 *
 * `x` spans roughly ±2.71, `y` roughly ±1.34 — the natural extent of the
 * projection, which the renderer scales into pixels.
 */
export function project(lon: number, lat: number): Point {
  const phi = clampLat(lat) * RADIANS;
  const lambda = lon * RADIANS;

  const theta = Math.asin(SQRT3_2 * Math.sin(phi));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;

  return {
    x:
      (lambda * Math.cos(theta)) /
      (SQRT3_2 * (A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2))),
    y: theta * (A1 + A2 * theta2 + theta6 * (A3 + A4 * theta2)),
  };
}

/**
 * The inverse, by Newton–Raphson on `y`.
 *
 * The paper gives no closed form and iterating is the standard answer; twelve
 * rounds is far more than the six or so it actually needs, and costs nothing at
 * the rate this is called — once per click, not once per point.
 */
export function unproject(x: number, y: number): LonLat {
  let theta = y;

  for (let i = 0; i < 12; i++) {
    const theta2 = theta * theta;
    const theta6 = theta2 * theta2 * theta2;
    const f = theta * (A1 + A2 * theta2 + theta6 * (A3 + A4 * theta2)) - y;
    const df = A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2);
    const step = f / df;
    theta -= step;
    if (Math.abs(step) < 1e-12) break;
  }

  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const lambda =
    (x * SQRT3_2 * (A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2))) /
    Math.cos(theta);

  const sinPhi = Math.sin(theta) / SQRT3_2;
  return {
    lon: lambda / RADIANS,
    lat: Math.asin(Math.max(-1, Math.min(1, sinPhi))) / RADIANS,
  };
}

/** Half-extent of the projected world, so a renderer can fit it to a canvas. */
export const PROJECTED_HALF_WIDTH = project(180, 0).x;
export const PROJECTED_HALF_HEIGHT = project(0, 90).y;

/**
 * Latitudes are clamped just inside the poles.
 *
 * At exactly ±90° the forward projection's `cos(theta)` term goes to zero and
 * `x` becomes 0/0. Nothing in a historical timeline sits at a pole, and a
 * hundredth of a degree is a kilometre.
 */
function clampLat(lat: number): number {
  return Math.max(-89.99, Math.min(89.99, lat));
}

