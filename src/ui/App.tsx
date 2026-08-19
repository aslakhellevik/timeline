import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { applyFilter } from '../core/filter';
import { interval } from '../core/time';
import { backupStatus, createIndexedDbStore } from '../store';
import type { BackupStatus } from '../store';
import { useTimeline } from '../state/timeline-store';
import { ConnectPicker } from './ConnectPicker';
import { ConnectionDetail } from './ConnectionDetail';
import { DataPanel } from './DataPanel';
import { EraDetail } from './EraDetail';
import { EventDetail } from './EventDetail';
import { EventList } from './EventList';
import { FilterBar } from './FilterBar';
import { FirstRun } from './FirstRun';
import { QuickAdd } from './QuickAdd';
import { TimelineView } from './TimelineView';
import { decodeUrlState, encodeUrlState } from './url-state';
import type { UrlState } from './url-state';

export function App() {
  const status = useTimeline((state) => state.status);
  const isFirstRun = useTimeline((state) => state.isFirstRun);
  const timeline = useTimeline((state) => state.timeline);
  const filter = useTimeline((state) => state.filter);
  const selectedId = useTimeline((state) => state.selectedId);
  const selectedConnectionId = useTimeline((state) => state.selectedConnectionId);
  const selectedEraId = useTimeline((state) => state.selectedEraId);
  const selectEra = useTimeline((state) => state.selectEra);
  const addEra = useTimeline((state) => state.addEra);
  const connectFrom = useTimeline((state) => state.connectFrom);
  const pickerOpen = useTimeline((state) => state.pickerOpen);
  const cancelConnect = useTimeline((state) => state.cancelConnect);
  const beginConnect = useTimeline((state) => state.beginConnect);
  const select = useTimeline((state) => state.select);
  const selectConnection = useTimeline((state) => state.selectConnection);
  const setFilter = useTimeline((state) => state.setFilter);
  const undo = useTimeline((state) => state.undo);
  const undoDepth = useTimeline((state) => state.undoStack.length);
  const attach = useTimeline((state) => state.attach);
  const flush = useTimeline((state) => state.flush);
  const error = useTimeline((state) => state.error);

  const initial = useMemo(() => decodeUrlState(window.location.hash), []);
  const [view, setView] = useState<'timeline' | 'list'>(initial.view ?? 'timeline');
  const viewportRef = useRef<{ centre: number; span: number } | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  // Open the database and load whatever is there.
  useEffect(() => {
    let store: Awaited<ReturnType<typeof createIndexedDbStore>> | null = null;
    void createIndexedDbStore().then((opened) => {
      store = opened;
      return attach(opened);
    });
    return () => store?.close();
  }, [attach]);

  // Restore the filter from the URL once the tags are known.
  useEffect(() => {
    if (initial.tags && initial.tags.length > 0) {
      setFilter({ tags: initial.tags, includePacks: filter.includePacks });
    }
    if (initial.selectedId) select(initial.selectedId);
    // Deliberately runs once, on mount: this restores a bookmark, it does not
    // track later changes — those flow the other way, into the URL.
  }, [initial, select, setFilter, filter.includePacks]);

  // Anything still queued must reach disk before the tab goes away.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  // Mirror state into the hash. `replaceState`, not `pushState` — panning should
  // not fill the back button with hundreds of entries.
  useEffect(() => {
    const handle = setTimeout(() => {
      const state: UrlState = {
        ...(viewportRef.current ?? {}),
        ...(selectedId ? { selectedId } : {}),
        ...(filter.tags.length > 0 ? { tags: [...filter.tags] } : {}),
        view,
      };
      history.replaceState(null, '', `${window.location.pathname}${encodeUrlState(state)}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [selectedId, filter.tags, view]);

  const onViewportChange = useCallback((viewport: { centre: number; span: number }) => {
    viewportRef.current = viewport;
  }, []);

  /**
   * A new era over the middle half of what is on screen.
   *
   * Deriving the span from the viewport rather than opening an empty date field
   * is the whole trick: you zoom to the period you mean and press the button, so
   * the common case needs no typing. The name and the exact edges are then
   * adjusted in the pane, which opens selected.
   */
  const addEraHere = useCallback(() => {
    const viewport = viewportRef.current;
    const extent = viewport
      ? { centre: viewport.centre, span: viewport.span }
      : spanOf(timeline.events);
    if (!extent) return;
    addEra({
      name: 'new era',
      when: interval(extent.centre - extent.span / 4, extent.centre + extent.span / 4),
      kind: 'personal',
    });
  }, [addEra, timeline.events]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Escape' && connectFrom) {
        event.preventDefault();
        cancelConnect();
        return;
      }

      // `c` connects the selected event, but only when nothing is being typed
      // into — a single-letter shortcut that fires inside quick-add would make
      // capture, the thing the app is built around, impossible.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (event.key === 'c' && !typing && !event.ctrlKey && !event.metaKey && selectedId) {
        event.preventDefault();
        beginConnect(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, connectFrom, cancelConnect, selectedId, beginConnect]);

  // The "last backed up N days ago" indicator (§8.3, layer 3). Re-checked when
  // the panel closes, since that is when it is most likely to have changed.
  useEffect(() => {
    if (status !== 'ready') return;
    void backupStatus().then(setBackup);
  }, [status, dataOpen]);

  const visible = useMemo(() => applyFilter(timeline, filter), [timeline, filter]);

  if (status === 'loading') {
    return <Centred>opening your timeline…</Centred>;
  }
  if (status === 'error') {
    return <Centred>could not open the database{error ? ` — ${error}` : ''}</Centred>;
  }

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="flex items-center gap-4 border-b border-line px-4 py-2">
        <h1 className="shrink-0 text-base font-semibold tracking-tight text-paper">Årlinje</h1>
        <QuickAdd />
        <nav className="flex shrink-0 gap-1" aria-label="View">
          {(['timeline', 'list'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`rounded px-2 py-1 text-xs ${
                view === option ? 'bg-line text-paper' : 'text-paper-dim hover:text-paper'
              }`}
            >
              {option}
            </button>
          ))}
        </nav>
      </header>

      <FilterBar />

      {/*
        The pick stays armed while the picker is dismissed, so the app needs to
        say so somewhere other than inside the modal that is no longer there.
      */}
      {connectFrom && !pickerOpen && (
        <div className="flex items-center gap-3 border-b border-[#ffd43b]/40 bg-[#ffd43b]/10 px-4 py-1.5 text-xs text-paper">
          <span>
            pick the other event — click a mark on the timeline, or a row in the list
          </span>
          <button onClick={cancelConnect} className="text-paper-dim hover:text-paper">
            cancel (esc)
          </button>
        </div>
      )}

      {isFirstRun ? (
        <FirstRun />
      ) : (
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            {view === 'timeline' ? (
              <TimelineView
                events={visible.events}
                connections={visible.connections}
                tags={visible.tags}
                eras={visible.eras}
                allEvents={timeline.events}
                selectedId={selectedId}
                selectedConnectionId={selectedConnectionId}
                selectedEraId={selectedEraId}
                connectFrom={connectFrom}
                onSelectEvent={select}
                onSelectConnection={selectConnection}
                onSelectEra={selectEra}
                {...(initial.centre !== undefined && initial.span !== undefined
                  ? { initialViewport: { centre: initial.centre, span: initial.span } }
                  : {})}
                onViewportChange={onViewportChange}
              />
            ) : (
              <EventList />
            )}
          </main>
          {selectedConnectionId ? (
            <ConnectionDetail />
          ) : selectedEraId ? (
            <EraDetail />
          ) : (
            selectedId && <EventDetail />
          )}
        </div>
      )}

      <footer className="flex items-center gap-4 border-t border-line px-4 py-1.5 text-xs text-paper-dim">
        <span className="tabular-nums">
          {visible.events.length.toLocaleString('en-GB')} events
          {visible.connections.length > 0 &&
            ` · ${visible.connections.length.toLocaleString('en-GB')} connections`}
          {visible.eras.length > 0 && ` · ${visible.eras.length.toLocaleString('en-GB')} eras`}
        </span>
        <button onClick={addEraHere} className="hover:text-paper">
          + era
        </button>
        {undoDepth > 0 && (
          <button onClick={undo} className="hover:text-paper">
            undo
          </button>
        )}
        <button
          onClick={() => setDataOpen(true)}
          className={backup?.stale ? 'text-[#c98500] hover:underline' : 'hover:text-paper'}
        >
          {backup
            ? backup.daysSinceBackup === null
              ? 'never backed up'
              : `backed up ${backup.daysSinceBackup === 0 ? 'today' : `${backup.daysSinceBackup}d ago`}`
            : 'your data'}
        </button>
        {error && <span className="text-[#e66767]">{error}</span>}
      </footer>

      {dataOpen && <DataPanel onClose={() => setDataOpen(false)} />}
      {pickerOpen && <ConnectPicker />}
    </div>
  );
}

/** Centre and span of the whole corpus, for an era added before any panning. */
function spanOf(events: readonly TimelineEvent[]): { centre: number; span: number } | null {
  if (events.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const event of events) {
    if (event.when.a < min) min = event.when.a;
    if (event.when.d > max) max = event.when.d;
  }
  return { centre: (min + max) / 2, span: Math.max(max - min, 365) };
}

function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-sm text-paper-dim">
      {children}
    </div>
  );
}
