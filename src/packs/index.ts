/**
 * The bundled pack catalogue (docs/design.md §5).
 *
 * Static imports, so packs ship inside the app and install with no network —
 * the privacy baseline (D25) says the app makes no traffic beyond loading
 * itself, and a pack fetched on demand would break that for a feature that
 * does not need it. It also means packs work offline, which a PWA should.
 *
 * The cost is bundle size, which is why the packs are skeletons of forty events
 * rather than chronicles of four hundred. A pack big enough to matter for size
 * would be a file the user imports, and that path already exists: install and
 * import are one code path (§5).
 */

import type { PackBundle } from '../core/packs';
import { COLD_WAR } from './cold-war';
import { SECOND_WORLD_WAR } from './second-world-war';

export const CATALOGUE: readonly PackBundle[] = [SECOND_WORLD_WAR, COLD_WAR];

export { COLD_WAR, SECOND_WORLD_WAR };
