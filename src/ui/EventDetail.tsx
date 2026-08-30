import { useMemo } from 'react';
import { markdownExcerpt } from '../core/markdown';
import { formatTime } from '../core/time';
import { connectionsFor } from '../state/timeline-model';
import { useTimeline } from '../state/timeline-store';
import { useTagNames } from '../state/tag-names';
import { DetailPane } from './DetailPane';
import { MarkdownEditor } from './MarkdownEditor';
import { PlaceField } from './PlaceField';

/** The selected event, with the fields the concept actually cares about. */
export function EventDetail({ onShowOnCanvas }: { onShowOnCanvas?: () => void }) {
  const timeline = useTimeline((state) => state.timeline);
  const selectedId = useTimeline((state) => state.selectedId);
  const select = useTimeline((state) => state.select);
  const selectConnection = useTimeline((state) => state.selectConnection);
  const beginConnect = useTimeline((state) => state.beginConnect);
  const updateEvent = useTimeline((state) => state.updateEvent);
  const deleteEvent = useTimeline((state) => state.deleteEvent);

  const event = useMemo(
    () => timeline.events.find((candidate) => candidate.id === selectedId) ?? null,
    [timeline.events, selectedId],
  );

  const tagNames = useTagNames();

  const titles = useMemo(
    () => new Map(timeline.events.map((candidate) => [candidate.id, candidate.title])),
    [timeline.events],
  );

  const connections = useMemo(
    () => (event ? connectionsFor(timeline, event.id) : []),
    [timeline, event],
  );

  if (!event) return null;

  return (
    <DetailPane label="event" onClose={() => select(null)}>
      <div>
        <h2 className="text-sm font-semibold text-paper">{event.title}</h2>
        <p className="mt-0.5 flex items-baseline gap-2 text-xs text-paper-dim">
          <span className="tabular-nums">{formatTime(event.when)}</span>
          {/*
            The way back to the picture. A date in a pane is a fact; where it
            sits among everything else is the thing this project is for, and
            until this existed there was no route from the pane to it at all —
            selecting from the list left the canvas wherever it happened to be.
          */}
          {onShowOnCanvas && (
            <button
              onClick={onShowOnCanvas}
              className="text-paper-faint underline decoration-line
                         underline-offset-2 hover:text-paper"
            >
              show on timeline
            </button>
          )}
        </p>
        {event.pack && (
          <p className="mt-1 text-[11px] text-paper-dim">
            from a pack — editing or connecting it makes it yours
          </p>
        )}
      </div>

      {event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.tags.map((tag) => (
            <span key={tag} className="rounded bg-line/60 px-1.5 py-0.5 text-xs text-paper-soft">
              {tagNames.get(tag) ?? tag}
            </span>
          ))}
        </div>
      )}

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
          <button
            onClick={() => beginConnect(event.id)}
            title="connect (c)"
            className="rounded border border-line px-1.5 py-0.5 text-[11px] text-paper-soft
                       hover:border-accent hover:text-paper"
          >
            connect…
          </button>
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

      <PlaceField event={event} />

      {/*
        D10: when and from where you learned it. Half the point of the project —
        it makes the timeline replayable against your own life — and the fields
        are worth showing rather than hiding in a database.
      */}
      <label className="flex flex-col gap-1 text-xs text-paper-dim">
        learned from
        <input
          value={event.learned_from ?? ''}
          onChange={(change) => updateEvent(event.id, { learned_from: change.target.value })}
          placeholder="Gombrich, ch. 4 · conversation with M"
          className="rounded border border-line bg-surface px-2 py-1 text-sm text-paper
                     placeholder:text-paper-dim focus:border-accent focus:outline-none"
        />
      </label>

      <dl className="space-y-1 text-xs text-paper-dim">
        {event.learned_at && (
          <div className="flex justify-between gap-2">
            <dt>learned</dt>
            <dd className="tabular-nums">{event.learned_at.slice(0, 10)}</dd>
          </div>
        )}
        {event.pack && (
          <div className="flex justify-between gap-2">
            <dt>from pack</dt>
            <dd>{event.pack}</dd>
          </div>
        )}
      </dl>

      <button
        onClick={() => deleteEvent(event.id)}
        className="mt-auto self-start rounded border border-line px-2 py-1 text-xs
                   text-paper-dim hover:border-[#e66767] hover:text-[#e66767]"
      >
        delete
        {connections.length > 0
          ? ` (and ${connections.length} connection${connections.length === 1 ? '' : 's'})`
          : ''}
      </button>
    </DetailPane>
  );
}
