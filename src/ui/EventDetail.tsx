import { useMemo } from 'react';
import { formatTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';

/** The selected event, with the fields the concept actually cares about. */
export function EventDetail() {
  const timeline = useTimeline((state) => state.timeline);
  const selectedId = useTimeline((state) => state.selectedId);
  const select = useTimeline((state) => state.select);
  const updateEvent = useTimeline((state) => state.updateEvent);
  const deleteEvent = useTimeline((state) => state.deleteEvent);

  const event = useMemo(
    () => timeline.events.find((candidate) => candidate.id === selectedId) ?? null,
    [timeline.events, selectedId],
  );

  const tagNames = useMemo(
    () => new Map(timeline.tags.map((tag) => [tag.id, tag.name])),
    [timeline.tags],
  );

  if (!event) return null;

  const connectionCount = timeline.connections.filter(
    (connection) =>
      !connection.deleted_at && (connection.from === event.id || connection.to === event.id),
  ).length;

  return (
    <aside
      aria-label="Event detail"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-paper">{event.title}</h2>
          <p className="mt-0.5 text-xs tabular-nums text-paper-dim">{formatTime(event.when)}</p>
        </div>
        <button
          onClick={() => select(null)}
          aria-label="Close detail"
          className="rounded px-1.5 text-paper-dim hover:text-paper"
        >
          ×
        </button>
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

      <label className="flex flex-col gap-1 text-xs text-paper-dim">
        notes
        <textarea
          value={event.notes ?? ''}
          onChange={(change) => updateEvent(event.id, { notes: change.target.value })}
          rows={6}
          className="resize-none rounded border border-line bg-surface px-2 py-1.5 text-sm
                     text-paper focus:border-accent focus:outline-none"
        />
      </label>

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
                     placeholder:text-paper-dim/60 focus:border-accent focus:outline-none"
        />
      </label>

      <dl className="space-y-1 text-xs text-paper-dim">
        {event.learned_at && (
          <div className="flex justify-between gap-2">
            <dt>learned</dt>
            <dd className="tabular-nums">{event.learned_at.slice(0, 10)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>connections</dt>
          <dd className="tabular-nums">{connectionCount}</dd>
        </div>
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
        delete{connectionCount > 0 ? ` (and ${connectionCount} connection${connectionCount === 1 ? '' : 's'})` : ''}
      </button>
    </aside>
  );
}
