import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { applyFilter } from '../core/filter';
import { interval } from '../core/time';
import { backupStatus, createIndexedDbStore, startAutoBackup } from '../store';
import type { BackupStatus } from '../store';
import { useTimeline } from '../state/timeline-store';
import { ConnectPicker } from './ConnectPicker';
import { ConnectionDetail } from './ConnectionDetail';
import { DataPanel } from './DataPanel';
import { DepthView } from './DepthView';
import { EraDetail } from './EraDetail';
import { EventDetail } from './EventDetail';
import { EventList } from './EventList';
import { FilterBar } from './FilterBar';
import { FirstRun } from './FirstRun';
import { MapView } from './MapView';
import { PackPanel } from './PackPanel';
import { QuickAdd } from './QuickAdd';
import { TimelineView } from './TimelineView';
import { decodeUrlState, encodeUrlState } from './url-state';
import type { UrlState } from './url-state';

/**
 * How long the hash waits before catching up.
 *
 * Long enough that a pan is one `replaceState` rather than one per frame, short
 * enough that the address bar is right by the time anyone reads it.
 */
const HASH_DEBOUNCE_MS = 300;

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
  const revealRequest = useTimeline((state) => state.revealRequest);
  const revealSelected = useTimeline((state) => state.revealSelected);
  const restoreBookmark = useTimeline((state) => state.restoreBookmark);
  const undo = useTimeline((state) => state.undo);
  const undoDepth = useTimeline((state) => state.undoStack.length);
  const attach = useTimeline((state) => state.attach);
  const flush = useTimeline((state) => state.flush);
  const error = useTimeline((state) => state.error);

  const initial = useMemo(() => decodeUrlState(window.location.hash), []);
  const [view, setView] = useState<'timeline' | 'depth' | 'map' | 'list'>(
    initial.view ?? 'timeline',
  );
  /*
   * Seeded from the URL, not left null.
   *
   * The views only report a viewport once the user moves one, so on a fresh load
   * this stayed null until the first interaction — and the effect below then
   * rewrote the hash *without* `c` and `s`, destroying the bookmark that had just
   * been used to restore the view. Bookmarkable periods are the whole of D24.
   */
  const viewportRef = useRef<{ centre: number; span: number } | null>(
    initial.centre !== undefined && initial.span !== undefined
      ? { centre: initial.centre, span: initial.span }
      : null,
  );
  const [dataOpen, setDataOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  // Held separately from `isFirstRun`, which flips as soon as the birth year is
  // answered — the pack offer that follows it has to survive that.
  const [onboarding, setOnboarding] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  // Open the database and load whatever is there.
  //
  // StrictMode mounts twice, and the old cleanup read a variable that was still
  // null while the open was in flight — so the first database was never closed
  // and its channel went on listening for the life of the tab. The close now
  // waits on the open *and* on this effect's own attach: closing a database
  // half-way through `load` fails the transaction already in flight.
  useEffect(() => {
    const attached = createIndexedDbStore().then((store) => attach(store).then(() => store));
    attached.catch((error: unknown) => {
      useTimeline.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      void attached.then((store) => store.close()).catch(() => {});
    };
  }, [attach]);

  // Restore the bookmarked filter and selection, once, on mount.
  //
  // The dependency list is empty on purpose. It used to include
  // `filter.includePacks`, so ticking the packs checkbox re-ran the whole
  // restore — re-applying the bookmarked tags, and re-selecting the bookmarked
  // event, which while a pick was armed silently wrote a connection.
  useEffect(() => {
    restoreBookmark({
      ...(initial.tags ? { tags: initial.tags } : {}),
      ...(initial.selectedId ? { selectedId: initial.selectedId } : {}),
    });
  }, []);

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

  /*
   * Mirror state into the hash. `replaceState`, not `pushState` — panning should
   * not fill the back button with hundreds of entries.
   *
   * Everything the write needs is read at write time, from refs and from the
   * store, so panning can schedule one without React re-rendering. That is the
   * property the renderer depends on (§6.1) and the reason a pan never reached
   * the hash before: the effect only fired on selection, tags and view, and
   * "the 1840s, art history only" is supposed to be a link (D24).
   */
  const viewRef = useRef(view);
  const hashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * The canvas the user was last on, so "show on timeline" from the list has
   * somewhere to go.
   *
   * Remembered rather than fixed to `timeline`: someone reading the map who
   * looks an event up in the list means "put it back on the map", and sending
   * them to a view they did not choose is a worse answer than any default.
   */
  const lastCanvasView = useRef<'timeline' | 'depth' | 'map'>(
    initial.view && initial.view !== 'list' ? initial.view : 'timeline',
  );

  const scheduleHashWrite = useCallback(() => {
    if (hashTimer.current !== null) clearTimeout(hashTimer.current);
    hashTimer.current = setTimeout(() => {
      hashTimer.current = null;
      const { selectedId: id, filter: current } = useTimeline.getState();
      const state: UrlState = {
        ...(viewportRef.current ?? {}),
        ...(id ? { selectedId: id } : {}),
        ...(current.tags.length > 0 ? { tags: [...current.tags] } : {}),
        view: viewRef.current,
      };
      history.replaceState(null, '', `${window.location.pathname}${encodeUrlState(state)}`);
    }, HASH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    viewRef.current = view;
    if (view !== 'list') lastCanvasView.current = view;
    scheduleHashWrite();
    return () => {
      if (hashTimer.current !== null) {
        clearTimeout(hashTimer.current);
        hashTimer.current = null;
      }
    };
  }, [selectedId, filter.tags, view, scheduleHashWrite]);

  const onViewportChange = useCallback(
    (viewport: { centre: number; span: number }) => {
      viewportRef.current = viewport;
      scheduleHashWrite();
    },
    [scheduleHashWrite],
  );

  /**
   * "show on timeline": go to the last canvas and put the selection on screen.
   *
   * The request is a counter in the store rather than a call into a view,
   * because the view that has to act on it may not be mounted yet — pressing
   * this from the list mounts a canvas, and a freshly mounted one reveals the
   * selection anyway.
   */
  const showOnCanvas = useCallback(() => {
    setView(lastCanvasView.current);
    revealSelected();
  }, [revealSelected]);

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
      if (event.key === 'Escape' && connectFrom) {
        event.preventDefault();
        cancelConnect();
        return;
      }

      // Both shortcuts stand down while something is being typed into. A
      // single-letter `c` firing inside quick-add would make capture — the
      // thing the app is built around — impossible; and Ctrl+Z belongs to the
      // text field the cursor is in, which the app's own undo used to steal by
      // calling `preventDefault` before this test was ever reached.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      // Shift is redo's key everywhere else, so Ctrl+Shift+Z must not undo.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z' && !typing) {
        event.preventDefault();
        undo();
        return;
      }

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

  /*
   * Layer 2's schedule (§8.3): a snapshot once the store is ready, then every
   * ten minutes while there is something new to save, and one on the way out.
   *
   * Everything it reads is read at the moment of the write, through
   * `getState()`, so the schedule does not re-mount when the timeline changes —
   * which it would do on every keystroke, and each remount would take another
   * snapshot on 'open'.
   */
  useEffect(() => {
    if (status !== 'ready') return;
    const backups = startAutoBackup({
      timeline: () => useTimeline.getState().timeline,
      dirtyAt: () => useTimeline.getState().lastMutationAt,
      flush: () => useTimeline.getState().flush(),
      onResult: () => void backupStatus().then(setBackup),
    });
    return () => backups.stop();
  }, [status]);

  useEffect(() => {
    if (status === 'ready' && isFirstRun) setOnboarding(true);
  }, [status, isFirstRun]);

  const visible = useMemo(() => applyFilter(timeline, filter), [timeline, filter]);

  /*
   * Where a freshly mounted view starts.
   *
   * Each view reads the prop once, at mount — which is exactly when a switch
   * between them happens — so it has to be where the user last was, not where
   * the URL said when the tab opened. Panning the timeline and then pressing
   * "depth" used to land back at the load-time viewport. The ref is seeded from
   * the hash, so a fresh load still honours the bookmark.
   */
  const startViewport = viewportRef.current;

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
          {(['timeline', 'depth', 'map', 'list'] as const).map((option) => (
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

      {onboarding ? (
        <FirstRun onDone={() => setOnboarding(false)} />
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
                revealRequest={revealRequest}
                {...(startViewport ? { initialViewport: startViewport } : {})}
                onViewportChange={onViewportChange}
              />
            ) : view === 'depth' ? (
              <DepthView
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
                revealRequest={revealRequest}
                {...(startViewport ? { initialViewport: startViewport } : {})}
                onViewportChange={onViewportChange}
              />
            ) : view === 'map' ? (
              <MapView
                events={visible.events}
                tags={visible.tags}
                allEvents={timeline.events}
                selectedId={selectedId}
                connectFrom={connectFrom}
                onSelectEvent={select}
                revealRequest={revealRequest}
                {...(startViewport ? { initialViewport: startViewport } : {})}
                onViewportChange={onViewportChange}
              />
            ) : (
              <EventList events={visible.events} onShowOnCanvas={showOnCanvas} />
            )}
          </main>
          {selectedConnectionId ? (
            <ConnectionDetail />
          ) : selectedEraId ? (
            <EraDetail />
          ) : (
            selectedId && <EventDetail onShowOnCanvas={showOnCanvas} />
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
        <button onClick={() => setPacksOpen(true)} className="hover:text-paper">
          {timeline.packs.length > 0
            ? `${timeline.packs.length} pack${timeline.packs.length === 1 ? '' : 's'}`
            : 'packs'}
        </button>
        <button
          onClick={() => setDataOpen(true)}
          className={backup?.stale ? 'text-[#c98500] hover:underline' : 'hover:text-paper'}
        >
          {/*
            "exported" and "backed up" are not the same claim: the first is a
            file the browser was asked to save, the second one this app wrote.
          */}
          {backup
            ? backup.daysSinceCopy === null
              ? 'never backed up'
              : `${backup.lastCopyKind === 'export' ? 'exported' : 'backed up'} ${
                  backup.daysSinceCopy === 0 ? 'today' : `${backup.daysSinceCopy}d ago`
                }`
            : 'your data'}
        </button>
        {error && <span className="text-[#e66767]">{error}</span>}
      </footer>

      {dataOpen && <DataPanel onClose={() => setDataOpen(false)} />}
      {packsOpen && <PackPanel onClose={() => setPacksOpen(false)} />}
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
