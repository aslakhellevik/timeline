import { useEffect, useMemo, useRef, useState } from 'react';
import { applyFilter } from '../core/filter';
import { searchEvents } from '../core/search';
import { formatTime } from '../core/time';
import { findConnectionBetween } from '../state/timeline-model';
import { useTimeline } from '../state/timeline-store';

/**
 * Picking the second event of a connection (§6.2).
 *
 * Search, not the canvas: "creating a connection means picking a second event,
 * and picking it by scrubbing a density plot is absurd." The canvas route still
 * exists — dismissing this leaves the pick armed — but it is the alternative,
 * not the default.
 *
 * Events already connected to the source stay in the list rather than being
 * filtered out, marked as such. Their absence would read as a search failure,
 * and choosing one is a reasonable thing to want: it opens what you already
 * wrote about the pair.
 */
const MAX_RESULTS = 40;

export function ConnectPicker() {
  const timeline = useTimeline((state) => state.timeline);
  const filter = useTimeline((state) => state.filter);
  const connectFrom = useTimeline((state) => state.connectFrom);
  const cancelConnect = useTimeline((state) => state.cancelConnect);
  const closePicker = useTimeline((state) => state.closePicker);
  const connectTo = useTimeline((state) => state.connectTo);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const source = timeline.events.find((event) => event.id === connectFrom) ?? null;

  const tagNames = useMemo(
    () => new Map(timeline.tags.map((tag) => [tag.id, tag.name])),
    [timeline.tags],
  );

  const results = useMemo(() => {
    if (!source) return [];
    const candidates = applyFilter(timeline, filter).events.filter(
      (event) => event.id !== source.id,
    );
    const matched =
      query.trim().length === 0
        ? candidates
        : searchEvents(candidates, query, { tagNames, limit: MAX_RESULTS }).map((hit) => hit.event);
    return matched.slice(0, MAX_RESULTS).map((event) => ({
      event,
      already: findConnectionBetween(timeline, source.id, event.id) !== undefined,
    }));
  }, [timeline, filter, query, tagNames, source]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!source) return null;

  const choose = (index: number) => {
    const target = results[index]?.event;
    if (target) connectTo(target.id);
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 pt-[12vh]"
      onClick={cancelConnect}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose the other event"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border
                   border-line bg-ink shadow-2xl"
      >
        <div className="border-b border-line px-4 py-3">
          <p className="text-xs text-paper-dim">connect</p>
          <p className="truncate text-sm text-paper">{source.title}</p>
          <p className="mt-0.5 text-xs tabular-nums text-paper-dim">{formatTime(source.when)}</p>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(change) => setQuery(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((current) => Math.min(results.length - 1, current + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(cursor);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelConnect();
            }
          }}
          placeholder="search for the other event"
          aria-label="Search for the other event"
          className="border-b border-line bg-transparent px-4 py-2.5 text-sm text-paper
                     placeholder:text-paper-dim/70 focus:outline-none"
        />

        <ul ref={listRef} role="listbox" aria-label="Matching events" className="min-h-0 flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-paper-dim">
              {timeline.events.length < 2
                ? 'add another event first — a connection needs two'
                : 'nothing matches'}
            </li>
          ) : (
            results.map((result, index) => (
              <li
                key={result.event.id}
                role="option"
                aria-selected={index === cursor}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(index)}
                className={`flex cursor-default items-center gap-3 px-4 py-2 text-sm ${
                  index === cursor ? 'bg-line/50 text-paper' : 'text-paper-soft'
                }`}
              >
                <span className="w-28 shrink-0 tabular-nums text-xs text-paper-dim">
                  {formatTime(result.event.when)}
                </span>
                <span className="min-w-0 flex-1 truncate">{result.event.title}</span>
                {result.already && (
                  <span className="shrink-0 text-[11px] text-paper-dim">connected</span>
                )}
              </li>
            ))
          )}
        </ul>

        <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-paper-dim">
          <span>↑↓ to move · ⏎ to connect · esc to cancel</span>
          <button onClick={closePicker} className="hover:text-paper">
            pick on the timeline instead
          </button>
        </footer>
      </div>
    </div>
  );
}
