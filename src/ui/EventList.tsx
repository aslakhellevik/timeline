import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { applyFilter } from '../core/filter';
import { searchEvents } from '../core/search';
import { formatTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';

/**
 * The list view (docs/design.md §6.2, D23) — v1 scope for two independent
 * reasons, either of which would be sufficient.
 *
 * It is the accessible presentation of the same data: a canvas is opaque to
 * screen readers and to keyboard navigation, and this is not a lesser
 * alternative to it. It is also simply how you find things — creating a
 * connection means picking a second event, and picking it by scrubbing a density
 * plot is absurd.
 *
 * Rows are windowed, so fifty thousand events cost the same as fifty.
 */

const ROW_HEIGHT = 38;
const OVERSCAN = 8;

export function EventList() {
  const timeline = useTimeline((state) => state.timeline);
  const filter = useTimeline((state) => state.filter);
  const query = useTimeline((state) => state.query);
  const setQuery = useTimeline((state) => state.setQuery);
  const selectedId = useTimeline((state) => state.selectedId);
  const select = useTimeline((state) => state.select);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  const tagNames = useMemo(
    () => new Map(timeline.tags.map((tag) => [tag.id, tag.name])),
    [timeline.tags],
  );

  const rows = useMemo(() => {
    const visible = applyFilter(timeline, filter).events;
    if (query.trim().length === 0) return visible;
    return searchEvents(visible, query, { tagNames }).map((hit) => hit.event);
  }, [timeline, filter, query, tagNames]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const windowed = rows.slice(first, last);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.id === selectedId);
    const next = Math.min(rows.length - 1, Math.max(0, (current < 0 ? -1 : current) + delta));
    const row = rows[next];
    if (!row) return;
    select(row.id);

    // Keep the cursor in view, the way a list is expected to behave.
    const element = scrollRef.current;
    if (!element) return;
    const top = next * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            }
          }}
          placeholder="search titles, notes, sources and tags"
          aria-label="Search events"
          className="w-full max-w-md rounded border border-line bg-surface px-3 py-1.5 text-sm
                     text-paper placeholder:text-paper-dim/70 focus:border-accent focus:outline-none"
        />
        <span className="whitespace-nowrap text-xs text-paper-dim">
          {rows.length.toLocaleString('en-GB')}
          {query.trim().length > 0 ? ' matching' : ''}
        </span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={rows.length}
        aria-label="Events"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            move(-rows.length);
          } else if (event.key === 'End') {
            event.preventDefault();
            move(rows.length);
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1
                   focus-visible:ring-paper-dim/40"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-paper-dim">
            {query.trim().length > 0 ? 'nothing matches' : 'no events yet'}
          </p>
        ) : (
          <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
              {windowed.map((event, index) => (
                <Row
                  key={event.id}
                  event={event}
                  rowIndex={first + index}
                  selected={event.id === selectedId}
                  tagNames={tagNames}
                  onSelect={() => select(event.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  event,
  rowIndex,
  selected,
  tagNames,
  onSelect,
}: {
  event: TimelineEvent;
  rowIndex: number;
  selected: boolean;
  tagNames: ReadonlyMap<string, string>;
  onSelect: () => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      aria-selected={selected}
      onClick={onSelect}
      style={{ height: ROW_HEIGHT }}
      className={`flex cursor-default items-center gap-4 border-b border-line/40 px-4 text-sm
                  ${selected ? 'bg-line/40 text-paper' : 'text-paper-soft hover:bg-line/20'}`}
    >
      <span className="w-32 shrink-0 tabular-nums text-xs text-paper-dim">
        {formatTime(event.when)}
      </span>
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      <span className="hidden shrink-0 gap-1.5 text-xs text-paper-dim sm:flex">
        {event.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tagNames.get(tag) ?? tag}</span>
        ))}
      </span>
    </div>
  );
}
