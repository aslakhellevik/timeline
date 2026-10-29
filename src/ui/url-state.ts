/**
 * Viewport, selection and filter in the URL hash (docs/design.md §5.6, D24).
 *
 * Cheap now, awkward to retrofit once React state and the renderer's viewport
 * have grown into each other. It buys bookmarkable periods immediately — "the
 * 1840s, art history only" is a link — and shareable links for free when the
 * social layer arrives.
 *
 * Encoding and decoding are pure so they can be tested without a browser.
 */

export interface UrlState {
  /** Viewport centre, in days on the numeric axis. */
  centre?: number;
  /** Viewport span, in days. */
  span?: number;
  selectedId?: string;
  tags?: string[];
  view?: 'timeline' | 'list';
}

export function encodeUrlState(state: UrlState): string {
  const parts = new URLSearchParams();
  // Three decimals is well under a second, and keeps the URL short.
  if (state.centre !== undefined) parts.set('c', trim(state.centre));
  if (state.span !== undefined) parts.set('s', trim(state.span));
  if (state.selectedId) parts.set('e', state.selectedId);
  if (state.tags && state.tags.length > 0) parts.set('tags', state.tags.join(','));
  if (state.view && state.view !== 'timeline') parts.set('v', state.view);
  const encoded = parts.toString();
  return encoded.length > 0 ? `#${encoded}` : '';
}

export function decodeUrlState(hash: string): UrlState {
  const parts = new URLSearchParams(hash.replace(/^#/, ''));
  const state: UrlState = {};

  const centre = numeric(parts.get('c'));
  if (centre !== undefined) state.centre = centre;

  // A non-positive span would produce an inverted or degenerate viewport.
  const span = numeric(parts.get('s'));
  if (span !== undefined && span > 0) state.span = span;

  const selected = parts.get('e');
  if (selected) state.selectedId = selected;

  const tags = parts.get('tags');
  if (tags) {
    const list = tags.split(',').filter((tag) => tag.length > 0);
    if (list.length > 0) state.tags = list;
  }

  const view = parts.get('v');
  // Anything else — including `depth` and `map`, from links made before those
  // views were removed (D70) — opens the timeline.
  if (view === 'list') state.view = view;

  return state;
}

function trim(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function numeric(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
