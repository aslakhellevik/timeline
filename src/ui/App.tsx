import { useMemo } from 'react';
import { generateTimeline } from '../core/testing';
import { TimelineView } from './TimelineView';

/**
 * M1: the renderer against the synthetic corpus (docs/design.md §9).
 *
 * No persistence and no chrome beyond a title — the question this milestone
 * exists to answer is whether the far view is striking, and everything else
 * would only get in the way of looking at it.
 */
export function App() {
  const timeline = useMemo(() => generateTimeline({ events: 2000, connections: 400 }), []);

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="flex items-baseline justify-between gap-4 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight text-paper">Årlinje</h1>
          <p className="text-xs text-paper-dim">
            synthetic corpus · {timeline.events.length.toLocaleString('en-GB')} events
          </p>
        </div>
        <p className="text-xs text-paper-dim">
          scroll to zoom · drag to pan · arrows and +/− when focused
        </p>
      </header>

      <main className="min-h-0 flex-1">
        <TimelineView events={timeline.events} />
      </main>
    </div>
  );
}
