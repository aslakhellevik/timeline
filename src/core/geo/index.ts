/**
 * The spatial view's pure core (docs/design.md §11, D17).
 *
 * Projection, coastlines, region placement and clustering — all framework-free
 * and testable without a canvas, the same as `time` and `density`.
 */

export { PROJECTED_HALF_HEIGHT, PROJECTED_HALF_WIDTH, project, unproject } from './projection';
export type { LonLat, Point } from './projection';
export { landRings } from './land';
export type { Ring } from './land';
export { REGION_PLACES, isPlaceableTag, locate } from './regions';
export type { RegionPlace } from './regions';
export { findPlace, gazetteerSize, searchPlaces } from './gazetteer';
export type { GazetteerPlace } from './gazetteer';
export { clusterEvents } from './cluster';
export type { Cluster } from './cluster';
