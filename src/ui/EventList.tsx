import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { searchEvents } from '../core/search';
import { formatTime } from '../core/time';
import { useTagNames } from '../state/tag-names';
import { useTimeline } from '../state/timeline-store';
import { Field } from './controls';

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

export interface EventListProps {
  /**
   * The filtered corpus, from `App`.
   *
   * A prop rather than a second `applyFilter` here: the list used to run the
   * whole filter inside the same memo as the search, so every keystroke in the
   * search box re-filtered the entire timeline before searching it — twice the
   * work of any other view, for an answer `App` had already computed.
   */
  events: readonly TimelineEvent[];
  /** Puts the selection back on the canvas — `Enter` on a row (§6.1). */
  onShowOnCanvas?: () => void;
}

export function EventList({ events, onShowOnCanvas }: EventListProps) {
  const query = useTimeline((state) => state.query);
  const setQuery = useTimeline((state) => state.setQuery);
  const selectedId = useTimeline((state) => state.selectedId);
  const select = useTimeline((state) => state.select);
  const connectFrom = useTimeline((state) => state.connectFrom);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const rowId = useId();

  const tagNames = useTagNames();

  const rows = useMemo(() => {
    if (query.trim().length === 0) return events;
    return searchEvents(events, query, { tagNames }).map((hit) => hit.event);
  }, [events, query, tagNames]);

  /**
   * Where the keyboard is, while a connection is pending.
   *
   * Null the rest of the time, when the selection *is* the cursor. It has to
   * stop being the selection while a pick is armed: `select` completes the
   * pending connection (§6.4), so arrowing down the list wrote one connection
   * per keypress and left a trail of them behind the cursor. `Enter` commits,
   * which is what the picker's own footer promises.
   */
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    if (!connectFrom) {
      setCursor(null);
      return;
    }
    // Seeded from the selection, which `beginConnect` has just set to the first
    // endpoint — so the pick starts where the user was, not at the top.
    const from = rows.findIndex((row) => row.id === selectedId);
    setCursor(from < 0 ? 0 : from);
    // Only when the pick is armed or disarmed: re-seeding on every keystroke
    // would drag the cursor back to the source event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectFrom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const cursorId = cursor === null ? null : (rows[cursor]?.id ?? null);

  /**
   * Follows a selection that arrived from somewhere else.
   *
   * Only `move` scrolled, so opening `#e=…` — or picking an event on the canvas
   * and switching to the list — left the window at the top with the selected row
   * a thousand rows below it, and on a phone the sheet opened over a list that
   * was not showing the row it described.
   */
  useEffect(() => {
    const index = rows.findIndex((row) => row.id === (cursorId ?? selectedId));
    if (index >= 0) scrollRowIntoView(scrollRef.current, index, 'top');
  }, [selectedId, cursorId, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const windowed = rows.slice(first, last);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const from = cursor ?? rows.findIndex((row) => row.id === selectedId);
    const next = Math.min(rows.length - 1, Math.max(0, (from < 0 ? -1 : from) + delta));
    const row = rows[next];
    if (!row) return;

    if (connectFrom) setCursor(next);
    else select(row.id);
    // Directly as well as through the effect: the effect cannot see a move that
    // lands on the row already selected, and the cursor is expected to scroll.
    scrollRowIntoView(scrollRef.current, next, 'nearest');
  };

  /** Enter: commit the pending connection, or put the row back on the canvas. */
  const commit = () => {
    const row = cursor === null ? null : rows[cursor];
    // Through `select`, not `connectTo`: the rule that a selection completes a
    // pending connection lives in the store, and the list does not repeat it.
    if (row) select(row.id);
    // Never while a pick is armed, even if the cursor has fallen off the end of
    // a narrowed search: leaving for the canvas mid-pick is not what Enter said.
    else if (!connectFrom && selectedId) onShowOnCanvas?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Field
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          // What it actually searches (§6.3). It used to promise "sources",
          // which is a field on an event that the index does not read; what it
          // does read is where you learned the thing.
          placeholder="search titles, notes, tags and where you learned it"
          aria-label="search events"
          className="w-full max-w-md"
        />
        <span className="whitespace-nowrap text-xs text-paper-dim">
          {rows.length.toLocaleString('en-GB')}
          {query.trim().length > 0 ? ' matching' : ''}
        </span>
      </div>

      {/*
        A listbox, not a grid (D23).

        `role="grid"` over rows of bare `<span>`s announced nothing at all: a
        grid promises cells, there were none, and there was no
        `aria-activedescendant` either — so the one view that exists to be the
        accessible presentation of the canvas was the least accessible thing in
        the app. A single-column list of options is what this is, and it is what
        the connect picker already declares.
      */}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="listbox"
        aria-label="events"
        aria-activedescendant={
          (cursorId ?? selectedId) ? `${rowId}-${cursorId ?? selectedId}` : undefined
        }
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
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1
                   focus-visible:ring-paper-dim/40"
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-paper-dim">
            {/* An empty state that says what to do next, rather than restating
                that there is nothing here — which the reader can see. */}
            {query.trim().length > 0
              ? 'nothing matches that search'
              : 'nothing here yet — type an event into the box at the top'}
          </p>
        ) : (
          /*
            The two elements the windowing needs are not part of the list: a
            listbox owns its options directly, and `presentation` is how a
            wrapper says it is only holding them up.
          */
          <div role="presentation" style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
            <div role="presentation" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
              {windowed.map((event) => (
                <Row
                  key={event.id}
                  id={`${rowId}-${event.id}`}
                  event={event}
                  selected={event.id === selectedId}
                  cursored={event.id === cursorId}
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

/**
 * Scrolls the row at `index` into the window, if it is not already in it.
 *
 * One copy of the test, used by the arrows and by an arriving selection alike:
 * two of them would be two chances for the list to disagree with itself about
 * where a row is. They differ only in where a row that is *out* of the window
 * lands. Stepping moves as little as possible, or the list would jump a page
 * per keypress. A selection that arrived from somewhere else goes to the top,
 * because on a phone the detail sheet covers the bottom two thirds of this
 * scroller and it does not know: "just inside the window" is behind the sheet
 * describing the very row it is hiding.
 */
function scrollRowIntoView(
  element: HTMLElement | null,
  index: number,
  anchor: 'nearest' | 'top',
): void {
  if (!element) return;
  const top = index * ROW_HEIGHT;
  const above = top < element.scrollTop;
  const below = top + ROW_HEIGHT > element.scrollTop + element.clientHeight;
  if (!above && !below) return;
  if (anchor === 'top' || above) element.scrollTop = top;
  else element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
}

function Row({
  id,
  event,
  selected,
  cursored,
  tagNames,
  onSelect,
}: {
  /** Stable per event, because `aria-activedescendant` points at it by name. */
  id: string;
  event: TimelineEvent;
  selected: boolean;
  /** Where the keyboard is while a pick is armed — not a selection yet. */
  cursored: boolean;
  tagNames: ReadonlyMap<string, string>;
  onSelect: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      // Not a second `aria-selected`: while a pick is armed the selection is
      // still the connection's first endpoint, and the cursor is only where the
      // keyboard has got to. "Current within the set" is exactly that.
      aria-current={cursored ? true : undefined}
      onClick={onSelect}
      style={{ height: ROW_HEIGHT }}
      className={`flex cursor-default items-center gap-4 border-b border-line/40 px-4 text-sm
                  ${selected ? 'bg-line/40 text-paper' : 'text-paper-soft hover:bg-line/20'}
                  ${cursored ? 'ring-1 ring-inset ring-[#ffd43b]/70' : ''}`}
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
