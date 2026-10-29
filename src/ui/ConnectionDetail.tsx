import { useMemo } from 'react';
import type { Connection } from '../core/model/types';
import { formatTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';
import { DetailPane } from './DetailPane';
import { MarkdownEditor } from './MarkdownEditor';
import { Button } from './controls';

/**
 * A connection's own document.
 *
 * "A connection is an object in its own right, not just an edge: it has its own
 * document — notes, an explanation, an argument for why these two things belong
 * together." So this pane is mostly the note, and the two events are the header
 * above it rather than the subject of the panel.
 *
 * The editor opens in write mode on an empty note, which is the state a
 * just-created connection is in: finishing the pick puts the cursor where the
 * argument goes (§5.4).
 */
export function ConnectionDetail() {
  const timeline = useTimeline((state) => state.timeline);
  const selectedConnectionId = useTimeline((state) => state.selectedConnectionId);

  const connection = useMemo(
    () => timeline.connections.find((candidate) => candidate.id === selectedConnectionId) ?? null,
    [timeline.connections, selectedConnectionId],
  );

  if (!connection) return null;
  /*
   * Keyed, so the note editor's mode and its draft belong to *this* connection.
   * It is also what keeps §5.4's promise: a freshly made connection mounts a
   * fresh editor, which is the only way `autoFocus` fires on the second one.
   */
  return <ConnectionPane key={connection.id} connection={connection} />;
}

function ConnectionPane({ connection }: { connection: Connection }) {
  const timeline = useTimeline((state) => state.timeline);
  const selectConnection = useTimeline((state) => state.selectConnection);
  const select = useTimeline((state) => state.select);
  const updateConnection = useTimeline((state) => state.updateConnection);
  const deleteConnection = useTimeline((state) => state.deleteConnection);

  const events = useMemo(
    () => new Map(timeline.events.map((event) => [event.id, event])),
    [timeline.events],
  );

  const from = events.get(connection.from);
  const to = events.get(connection.to);

  return (
    <DetailPane label="connection" onClose={() => selectConnection(null)}>
      <div className="flex flex-col gap-1.5">
        {[from, to].map((event, index) => (
          <div key={event?.id ?? index} className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 w-3 shrink-0 text-center text-xs text-paper-dim">
              {index === 0 ? '┌' : '└'}
            </span>
            {event ? (
              <button
                onClick={() => select(event.id)}
                className="min-w-0 flex-1 text-left hover:underline"
              >
                <span className="block truncate text-sm text-paper">{event.title}</span>
                <span className="block text-xs tabular-nums text-paper-dim">
                  {formatTime(event.when)}
                </span>
              </button>
            ) : (
              <span className="text-sm text-paper-dim">(missing event)</span>
            )}
          </div>
        ))}
      </div>

      {/*
        The point of the whole feature. Everything above is context for it: "the
        interesting content of a personal timeline is not the events but the
        reasoning between them."
      */}
      <MarkdownEditor
        label="why these belong together"
        value={connection.note}
        onChange={(note) => updateConnection(connection.id, { note })}
        placeholder={
          from && to
            ? `What links ${from.title} to ${to.title}? Causal, thematic, ironic, personal — Markdown works here.`
            : 'Markdown works here.'
        }
        rows={12}
        autoFocus={connection.note.length === 0}
      />

      <dl className="space-y-1 text-xs text-paper-dim">
        <div className="flex justify-between gap-2">
          <dt>made</dt>
          <dd className="tabular-nums">{connection.created_at.slice(0, 10)}</dd>
        </div>
      </dl>

      <Button
        variant="quiet"
        onClick={() => deleteConnection(connection.id)}
        className="mt-auto self-start rounded border border-line px-2 hover:border-[#e66767]
                   hover:text-[#e66767]"
      >
        delete connection
      </Button>
    </DetailPane>
  );
}
