import { useMemo, useRef, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { markdownExcerpt } from '../core/markdown';
import { connectionsFor } from '../state/timeline-model';
import { useTimeline } from '../state/timeline-store';
import { DetailPane } from './DetailPane';
import { MarkdownEditor } from './MarkdownEditor';
import { TagEditor } from './TagEditor';
import { TimeField } from './TimeField';
import { Button, Field, plural } from './controls';
import { useDraft } from './use-draft';

/**
 * The selected event (docs/design.md §5.2).
 *
 * **Editable, which it was not.** The pane showed the title, the date and the
 * tags as text and offered no way to change any of them: a mistyped title from
 * quick-add — the surface the whole app is built around, optimised for speed
 * over accuracy — could be read back and not corrected, and the only route to a
 * fix was delete and retype. The store had `updateEvent` covering all three the
 * whole time.
 *
 * Every field commits on blur or Enter, never per keystroke (§5.5). The date is
 * one text box because `formatTime` round-trips through `parseTime` — see
 * `TimeField` for why that removes the mode selector §2.2 imagined.
 */
export function EventDetail({ onShowOnCanvas }: { onShowOnCanvas?: () => void }) {
  const timeline = useTimeline((state) => state.timeline);
  const selectedId = useTimeline((state) => state.selectedId);

  const event = useMemo(
    () => timeline.events.find((candidate) => candidate.id === selectedId) ?? null,
    [timeline.events, selectedId],
  );

  if (!event) return null;

  /*
   * Keyed on the event, so every draft inside starts again when a different one
   * is selected. Without it the pane is one long-lived component whose state
   * outlives its subject — the note editor kept whichever mode the last event
   * had left it in, so every note-less event after a written one opened on an
   * empty preview with the `write` tab it needed disabled.
   */
  return <EventPane key={event.id} event={event} {...(onShowOnCanvas ? { onShowOnCanvas } : {})} />;
}

function EventPane({
  event,
  onShowOnCanvas,
}: {
  event: TimelineEvent;
  onShowOnCanvas?: () => void;
}) {
  const timeline = useTimeline((state) => state.timeline);
  const select = useTimeline((state) => state.select);
  const selectConnection = useTimeline((state) => state.selectConnection);
  const beginConnect = useTimeline((state) => state.beginConnect);
  const updateEvent = useTimeline((state) => state.updateEvent);
  const setEventTags = useTimeline((state) => state.setEventTags);
  const deleteEvent = useTimeline((state) => state.deleteEvent);

  const titles = useMemo(
    () => new Map(timeline.events.map((candidate) => [candidate.id, candidate.title])),
    [timeline.events],
  );

  const connections = useMemo(() => connectionsFor(timeline, event.id), [timeline, event.id]);

  const [title, setTitle] = useState(event.title);
  const titleRef = useRef<HTMLInputElement>(null);

  // Only the name is edited. Coordinates an older record carries are kept with
  // it, and nothing reads them any more (D70); an emptied box removes the place.
  const place = useDraft(event.place?.name ?? '', (value) => {
    const name = value.trim();
    updateEvent(event.id, { place: name.length > 0 ? { ...event.place, name } : undefined });
  });

  const learnedFrom = useDraft(event.learned_from ?? '', (value) =>
    updateEvent(event.id, { learned_from: value }),
  );

  const commitTitle = () => {
    const trimmed = title.trim();
    // An event with no title is not a shorter event, it is an unfindable one —
    // quick-add refuses one for the same reason. So an emptied box reverts.
    if (trimmed.length === 0 || trimmed === event.title) {
      setTitle(event.title);
      return;
    }
    updateEvent(event.id, { title: trimmed });
  };

  return (
    <DetailPane label="event" onClose={() => select(null)}>
      <div>
        {/*
          Borderless until it is touched: the title is the pane's heading and
          should read as one, but a heading that cannot be clicked into is
          exactly the thing this pane was missing.
        */}
        <input
          ref={titleRef}
          value={title}
          onChange={(change) => setTitle(change.target.value)}
          onBlur={commitTitle}
          onKeyDown={(keyed) => {
            if (keyed.key === 'Enter') {
              commitTitle();
              titleRef.current?.blur();
            }
            if (keyed.key === 'Escape') {
              keyed.preventDefault();
              setTitle(event.title);
            }
          }}
          aria-label="title"
          className="-mx-1 w-[calc(100%+0.5rem)] rounded border border-transparent bg-transparent
                     px-1 py-0.5 text-sm font-semibold text-paper hover:border-line
                     focus:border-accent focus:outline-none"
        />

        {/*
          The way back to the picture. A date in a pane is a fact; where it sits
          among everything else is the thing this project is for, and until this
          existed there was no route from the pane to it at all — selecting from
          the list left the canvas wherever it happened to be.
        */}
        {onShowOnCanvas && (
          <button
            onClick={onShowOnCanvas}
            className="mt-0.5 text-xs text-paper-faint underline decoration-line
                       underline-offset-2 hover:text-paper"
          >
            show on timeline
          </button>
        )}
      </div>

      <TimeField
        label="when"
        value={event.when}
        onCommit={(when) => updateEvent(event.id, { when })}
      />

      <TagEditor
        tags={event.tags}
        onChange={(names) => setEventTags(event.id, names)}
      />

      {/*
        Connections come before the notes field. An event's own notes are the
        ordinary half of this panel; its connections are the half the project
        exists for, and burying them under a textarea says the opposite.
      */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs text-paper-dim">
            connections{connections.length > 0 ? ` (${connections.length})` : ''}
          </h3>
          <Button onClick={() => beginConnect(event.id)} title="connect (c)">
            connect…
          </Button>
        </div>

        {connections.length === 0 ? (
          <p className="text-xs text-paper-faint">
            nothing yet — a connection carries its own argument for why two events belong together
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {connections.map((connection) => {
              const otherId = connection.from === event.id ? connection.to : connection.from;
              const excerpt = markdownExcerpt(connection.note, 70);
              return (
                <li key={connection.id}>
                  <button
                    onClick={() => selectConnection(connection.id)}
                    className="w-full rounded border border-line/60 px-2 py-1.5 text-left
                               hover:border-line hover:bg-line/20"
                  >
                    <span className="block truncate text-xs text-paper-soft">
                      {titles.get(otherId) ?? '(missing event)'}
                    </span>
                    <span className="block truncate text-[11px] text-paper-dim">
                      {excerpt.length > 0 ? excerpt : 'no note yet'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <MarkdownEditor
        label="notes"
        value={event.notes ?? ''}
        onChange={(notes) => updateEvent(event.id, { notes })}
        rows={6}
      />

      <Field
        label="place"
        value={place.value}
        onChange={(change) => place.onChange(change.target.value)}
        onBlur={place.flush}
        placeholder="Constantinople"
      />

      {/*
        D10: when and from where you learned it. Half the point of the project —
        it makes the timeline replayable against your own life — and the fields
        are worth showing rather than hiding in a database.
      */}
      <Field
        label="learned from"
        value={learnedFrom.value}
        onChange={(change) => learnedFrom.onChange(change.target.value)}
        onBlur={learnedFrom.flush}
        placeholder="Gombrich, ch. 4 · conversation with M"
      />

      {event.learned_at && (
        <dl className="space-y-1 text-xs text-paper-dim">
          <div className="flex justify-between gap-2">
            <dt>learned</dt>
            <dd className="tabular-nums">{event.learned_at.slice(0, 10)}</dd>
          </div>
        </dl>
      )}

      <Button
        variant="quiet"
        onClick={() => deleteEvent(event.id)}
        className="mt-auto self-start rounded border border-line px-2 hover:border-[#e66767]
                   hover:text-[#e66767]"
      >
        delete
        {connections.length > 0 ? ` (and ${plural(connections.length, 'connection')})` : ''}
      </Button>
    </DetailPane>
  );
}
