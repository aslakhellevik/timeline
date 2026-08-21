/**
 * The world's coastlines, decoded from TopoJSON (docs/design.md §11).
 *
 * ## Land, not countries — deliberately
 *
 * The data could as easily have been `countries-110m`, and drawing borders would
 * look richer. It would also be a lie on this particular map. A timeline that
 * runs from the Bronze Age to last week cannot draw the borders of 2026 across
 * it and call the result a picture of anything: the README says as much —
 * "the hard part is not the map; it is that borders and place names move".
 *
 * Coastlines move too, but on a scale of millennia rather than decades, so a
 * single outline is an honest backdrop for the whole span. What the map shows is
 * where things happened, on the ground that was there.
 *
 * ## Why the decoder is written here
 *
 * TopoJSON's quantised delta encoding is what keeps the file to fifty kilobytes,
 * and undoing it is twenty lines. `topojson-client` was used once, to confirm
 * this agrees with it, and then removed — a runtime dependency for twenty lines
 * of arithmetic is not a trade worth making, and the data now lives in the repo
 * rather than in a package that could change under it.
 *
 * Source: Natural Earth (public domain) via world-atlas, ISC-licensed; see
 * `land-110m.LICENSE`.
 */

import topology from './land-110m.json';

/** A closed ring of `[lon, lat]` pairs. */
export type Ring = readonly (readonly [number, number])[];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: { land: { type: string; geometries: { type: string; arcs: number[][][] }[] } };
}

/**
 * Absolute `[lon, lat]` positions for one arc.
 *
 * TopoJSON stores each arc as a starting position followed by deltas, all in
 * quantised integer space; this walks the deltas and applies the transform.
 */
function decodeArc(source: number[][], transform: Topology['transform']): [number, number][] {
  const [scaleX, scaleY] = transform.scale;
  const [translateX, translateY] = transform.translate;

  let x = 0;
  let y = 0;
  const points: [number, number][] = [];

  for (const delta of source) {
    x += delta[0] as number;
    y += delta[1] as number;
    points.push([x * scaleX + translateX, y * scaleY + translateY]);
  }

  return points;
}

function buildRings(): Ring[] {
  const source = topology as unknown as Topology;
  const arcs = source.arcs.map((arc) => decodeArc(arc, source.transform));
  const rings: Ring[] = [];

  for (const geometry of source.objects.land.geometries) {
    // The land object is a MultiPolygon: polygons, each a list of rings, each a
    // list of arc indices. A negative index means the arc traversed backwards,
    // encoded as the ones' complement — `~i` recovers the index.
    for (const polygon of geometry.arcs) {
      for (const ring of polygon) {
        const points: [number, number][] = [];
        for (const index of ring) {
          const arc = arcs[index < 0 ? ~index : index];
          if (!arc) continue;
          const ordered = index < 0 ? [...arc].reverse() : arc;
          // Arcs share endpoints, so the join would be duplicated.
          for (let i = points.length > 0 ? 1 : 0; i < ordered.length; i++) {
            points.push(ordered[i] as [number, number]);
          }
        }
        if (points.length > 2) rings.push(points);
      }
    }
  }

  return rings;
}

/**
 * Every coastline ring, decoded once on first use.
 *
 * Lazy because the decode is a few milliseconds and the map is one view of
 * three — a user who never opens it should never pay for it.
 */
let cached: Ring[] | null = null;

export function landRings(): Ring[] {
  cached ??= buildRings();
  return cached;
}
