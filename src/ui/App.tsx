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
import { isDemo, openDemoStore } from './demo';
import { EraDetail } from './EraDetail';
import { EventDetail } from './EventDetail';
import { EventList } from './EventList';
import { FilterBar } from './FilterBar';
import { FirstRun } from './FirstRun';
import { HelpOverlay } from './HelpOverlay';
import { MapView } from './MapView';
import { PackPanel } from './PackPanel';
import { QuickAdd } from './QuickAdd';
import { TimelineView } from './TimelineView';
import { plural } from './controls';
import { onUpdateReady } from './service-worker';
import { useOnEscape } from './use-escape';
import { modalIsOpen } from './use-focus-trap';
import { decodeUrlState, encodeUrlState } from './url-state';
import type { UrlState } from './url-state';

const VIEWS = ['timeline', 'map', 'list'] as const;
type View = (typeof VIEWS)[number];

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
  const placingId = useTimeline((state) => state.placingId);
  const cancelPlacing = useTimeline((state) => state.cancelPlacing);
  const placeAt = useTimeline((state) => state.placeAt);
  const beginConnect = useTimeline((state) => state.beginConnect);
  const select = useTimeline((state) => state.select);
  const selectConnection = useTimeline((state) => state.selectConnection);
  const revealRequest = useTimeline((state) => state.revealRequest);
  const revealSelected = useTimeline((state) => state.revealSelected);
  const restoreBookmark = useTimeline((state) => state.restoreBookmark);
  const undo = useTimeline((state) => state.undo);
  // The label, not the depth: "undo" alone never said what would come back, and
  // the store has known since W1.
  const undoLabel = useTimeline((state) => state.undoLabel);
  const attach = useTimeline((state) => state.attach);
  const flush = useTimeline((state) => state.flush);
  const error = useTimeline((state) => state.error);

  const initial = useMemo(() => decodeUrlState(window.location.hash), []);
  // Fixed for the life of the page: switching databases under a running app is
  // what a reload is for.
  const demo = useMemo(() => isDemo(window.location.search), []);
  const [view, setView] = useState<View>(initial.view ?? 'timeline');
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  /*
   * Held separately from `isFirstRun`, which flips as soon as the birth year is
   * answered — the pack offer that follows it has to survive that.
   *
   * And it carries *why* the screen is up: the same question is asked again by
   * "add my life", months later, of someone who skipped it and has since filled
   * the timeline. "It starts empty" is the wrong sentence to say to them.
   */
  const [onboarding, setOnboarding] = useState<'first-run' | 'life' | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  // Open the database and load whatever is there.
  //
  // StrictMode mounts twice, and the old cleanup read a variable that was still
  // null while the open was in flight — so the first database was never closed
  // and its channel went on listening for the life of the tab. The close now
  // waits on the open *and* on this effect's own attach: closing a database
  // half-way through `load` fails the transaction already in flight.
  useEffect(() => {
    const opened = demo ? openDemoStore() : createIndexedDbStore();
    const attached = opened.then((store) => attach(store).then(() => store));
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
  const viewRef = useRef<View>(view);
  const hashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * The canvas the user was last on, so "show on timeline" from the list has
   * somewhere to go.
   *
   * Remembered rather than fixed to `timeline`: someone reading the map who
   * looks an event up in the list means "put it back on the map", and sending
   * them to a view they did not choose is a worse answer than any default.
   */
  const lastCanvasView = useRef<'timeline' | 'map'>(
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

  /*
   * Escape cancels an armed pick — but only when nothing is on top of it.
   *
   * Through the shared stack rather than a window listener of its own, which is
   * what it was: an open panel would close *and* the pick would cancel, from two
   * handlers that did not know about each other (§6.4).
   */
  useOnEscape(cancelConnect, connectFrom !== null);
  // The same key for the same kind of thing: an armed mode the user wants out
  // of, above the pane and below any panel (D60).
  useOnEscape(cancelPlacing, placingId !== null);

  /*
   * Placing an event happens on the map, so the app goes there and comes back.
   *
   * The offer is made in the detail pane, which is reachable from every view —
   * so without this, "set on the map" from the list would arm a mode whose
   * only surface was not on screen. Coming back matters as much as going: the
   * user was reading the timeline, and a detour should end where it started.
   */
  const returnView = useRef<View | null>(null);
  useEffect(() => {
    if (placingId !== null) {
      if (returnView.current === null) {
        returnView.current = viewRef.current;
        setView('map');
      }
      return;
    }
    if (returnView.current !== null) {
      const back = returnView.current;
      returnView.current = null;
      setView(back);
    }
  }, [placingId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // All shortcuts stand down while something is being typed into. A
      // single-letter `c` firing inside quick-add would make capture — the
      // thing the app is built around — impossible; and Ctrl+Z belongs to the
      // text field the cursor is in, which the app's own undo used to steal by
      // calling `preventDefault` before this test was ever reached.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing) return;

      // `?` is the one key a modal does not block, because the modal it opens
      // is the only one it can close.
      if (event.key === '?') {
        if (!helpOpen && modalIsOpen()) return;
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      // Nothing else fires underneath a dialog. `c` used to stack a second
      // `aria-modal` picker on top of an open panel, which is not a state the
      // app has any way back out of.
      if (modalIsOpen()) return;

      // Shift is redo's key everywhere else, so Ctrl+Shift+Z must not undo.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key === 'c' && !event.ctrlKey && !event.metaKey && selectedId) {
        event.preventDefault();
        beginConnect(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, selectedId, beginConnect, helpOpen]);

  // A newer build has installed itself under this tab (§7.2).
  useEffect(() => onUpdateReady(setUpdateReady), []);

  // The "last backed up N days ago" indicator (§8.3, layer 3). Re-checked when
  // the panel closes, since that is when it is most likely to have changed.
  // Not in the demo: the figure is about the real timeline, not this one.
  useEffect(() => {
    if (status !== 'ready' || demo) return;
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
   *
   * Never in the demo (D68). The folder is the real timeline's, so a demo
   * snapshot would land among its copies — and stamp "backed up today" on a
   * timeline nobody had backed up.
   */
  useEffect(() => {
    if (status !== 'ready' || demo) return;
    const backups = startAutoBackup({
      timeline: () => useTimeline.getState().timeline,
      dirtyAt: () => useTimeline.getState().lastMutationAt,
      flush: () => useTimeline.getState().flush(),
      onResult: () => void backupStatus().then(setBackup),
    });
    return () => backups.stop();
  }, [status]);

  useEffect(() => {
    if (status === 'ready' && isFirstRun) setOnboarding('first-run');
  }, [status, isFirstRun]);

  const visible = useMemo(() => applyFilter(timeline, filter), [timeline, filter]);

  /*
   * Where a freshly mounted view starts.
   *
   * Each view reads the prop once, at mount — which is exactly when a switch
   * between them happens — so it has to be where the user last was, not where
   * the URL said when the tab opened. Panning the timeline and then pressing
   * "map" used to land back at the load-time viewport. The ref is seeded from
   * the hash, so a fresh load still honours the bookmark.
   */
  const startViewport = viewportRef.current;

  if (status === 'loading') {
    return <Centred>{demo ? 'opening the demo timeline…' : 'opening your timeline…'}</Centred>;
  }
  if (status === 'error') {
    return <Centred>could not open the database{error ? ` — ${error}` : ''}</Centred>;
  }
  /*
   * Onboarding is a takeover, like the loading state above it.
   *
   * It used to render inside the shell, so the header and the footer stayed live
   * behind the one question the app asks: you could add an event, switch views
   * or open the packs panel while being asked your birth year, and "never backed
   * up" glowed amber before there was anything to back up. None of that chrome
   * has anything to act on yet.
   */
  if (onboarding) {
    return <FirstRun mode={onboarding} onDone={() => setOnboarding(null)} />;
  }

  return (
    <div className="flex h-full flex-col bg-ink">
      <header className="flex items-center gap-2 border-b border-line px-3 py-1 sm:gap-4 sm:px-4 sm:py-2">
        {/*
          The wordmark is the first thing to go below `sm`. Capture is the
          surface the whole app is built around (§9) and the placeholder is the
          only place its grammar is written down — `#europe #war` truncating
          away costs more than a name the phone already shows on the tab.
        */}
        <h1 className="hidden shrink-0 text-base font-semibold tracking-tight text-paper sm:block">
          Årlinje
        </h1>
        <QuickAdd />
        {/*
          Actions, not status (§7.1). An era is derived from the viewport — you
          zoom to the period you mean and press the button — which makes it a
          header-level act beside the view nav, not a word in the status bar it
          used to share with the backup age.
        */}
        <button
          onClick={addEraHere}
          title="a new era over the middle of what is on screen"
          className="inline-flex min-h-11 shrink-0 items-center rounded px-2 text-xs
                     text-paper-dim hover:text-paper sm:min-h-0 sm:py-1"
        >
          + era
        </button>
        {/*
          The nav is the first thing off the header on a phone: four words plus
          capture left the placeholder truncating mid-grammar, at `#europe #`,
          and capture is the surface the whole app is built around.
        */}
        <ViewNav view={view} onChange={setView} className="hidden sm:flex" />
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="keyboard shortcuts"
          title="keyboard shortcuts (?)"
          className="inline-flex min-h-11 shrink-0 items-center rounded px-2.5 text-xs
                     text-paper-dim hover:text-paper sm:min-h-0 sm:px-2 sm:py-1"
        >
          ?
        </button>
      </header>

      <FilterBar onAddLife={() => setOnboarding('life')} />

      {/*
        Always on, and not dismissible: the one thing the demo must never be is
        mistaken for someone's own timeline — by them, or by whoever they show.
      */}
      {demo && (
        <div className="flex items-center gap-3 border-b border-accent/40 bg-accent/10 px-4 py-1.5 text-xs text-paper">
          <span>
            demo — a synthetic timeline, invented events and all, kept apart from yours
          </span>
          <a
            href={window.location.pathname}
            className="shrink-0 text-paper-dim underline underline-offset-2 hover:text-paper"
          >
            open my timeline
          </a>
        </div>
      )}

      {/*
        The pick stays armed while the picker is dismissed, so the app needs to
        say so somewhere other than inside the modal that is no longer there.
      */}
      {connectFrom && !pickerOpen && (
        <ArmedBanner onCancel={cancelConnect}>
          pick the other event — click a mark on the timeline, a dot on the map, or a row in the
          list
        </ArmedBanner>
      )}

      {/* The spatial twin of the banner above, in the same yellow for the same
          reason: one mode is armed and the next click belongs to it (D66). */}
      {placingId && (
        <ArmedBanner onCancel={cancelPlacing}>
          click the map where it happened — how close you can point is how precise it will be
        </ArmedBanner>
      )}

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
          ) : view === 'map' ? (
            <MapView
              events={visible.events}
              tags={visible.tags}
              allEvents={timeline.events}
              selectedId={selectedId}
              connectFrom={connectFrom}
              placingId={placingId}
              onPlace={placeAt}
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

      {/*
        Status, and one undo (§7.1).

        Everything that *did* something has left: the footer had `+ era`, `undo`,
        `packs` and `your data` set in the same eleven-pixel word as the event
        count, so a reading and four actions of three different kinds were one
        undifferentiated row. What is left says what the timeline is — how much
        of it is on screen, how long since a copy of it was written, what went
        wrong — plus the two things that are about that state: undoing the last
        change, and the panel that explains the backup.
      */}
      <footer className="border-t border-line text-xs text-paper-dim">
        <ViewNav
          view={view}
          onChange={setView}
          className="flex border-b border-line sm:hidden"
          itemClassName="min-h-11 flex-1 justify-center"
        />
        <div className="flex flex-wrap items-center gap-x-4 px-4 py-1 sm:py-1.5">
          <span className="tabular-nums">
            {plural(visible.events.length, 'event')}
            {visible.connections.length > 0 &&
              ` · ${plural(visible.connections.length, 'connection')}`}
            {visible.eras.length > 0 && ` · ${plural(visible.eras.length, 'era')}`}
          </span>
          <button
            onClick={() => setDataOpen(true)}
            className={`inline-flex min-h-11 items-center sm:min-h-0 ${
              backup?.stale ? 'text-[#c98500] hover:underline' : 'hover:text-paper'
            }`}
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
          {/*
            The worker replaces itself and drops the cache the running tab is
            using, so this is a state the app is in, not an offer (§7.2).
          */}
          {updateReady && (
            <button
              onClick={() => window.location.reload()}
              className="inline-flex min-h-11 items-center text-paper-soft hover:text-paper
                         hover:underline sm:min-h-0"
            >
              a new version is ready · reload
            </button>
          )}
          {error && <span className="text-[#e66767]">{error}</span>}

          <span className="flex-1" />

          {undoLabel && (
            <button
              onClick={undo}
              className="inline-flex min-h-11 items-center hover:text-paper sm:min-h-0"
            >
              undo {undoLabel}
            </button>
          )}
          {/*
            Kept here rather than moved behind `?`: what is installed changes
            what the picture means (D38), which is the same kind of claim as the
            counts beside it. Underlined so it reads as a way in rather than as
            another reading.
          */}
          <button
            onClick={() => setPacksOpen(true)}
            className="inline-flex min-h-11 items-center text-paper-dim underline
                       decoration-line underline-offset-2 hover:text-paper sm:min-h-0"
          >
            {timeline.packs.length > 0 ? plural(timeline.packs.length, 'pack') : 'packs'}
          </button>
        </div>
      </footer>

      {dataOpen && <DataPanel demo={demo} onClose={() => setDataOpen(false)} />}
      {packsOpen && <PackPanel onClose={() => setPacksOpen(false)} />}
      {pickerOpen && <ConnectPicker />}
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** The yellow strip that says one click has been claimed by a pending act. */
function ArmedBanner({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#ffd43b]/40 bg-[#ffd43b]/10 px-4 py-1.5 text-xs text-paper">
      <span>{children}</span>
      <button onClick={onCancel} className="shrink-0 text-paper-dim hover:text-paper">
        cancel (esc)
      </button>
    </div>
  );
}

/**
 * The view switcher, in the header on a desktop and the footer on a phone.
 *
 * One component in two places rather than two copies: the words and the pressed
 * state are the same control, and only where it sits changes.
 */
function ViewNav({
  view,
  onChange,
  className,
  itemClassName,
}: {
  view: View;
  onChange: (view: View) => void;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <nav className={`shrink-0 gap-1 ${className ?? ''}`} aria-label="view">
      {VIEWS.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          className={`inline-flex min-h-11 items-center rounded px-2 text-xs sm:min-h-0 sm:py-1 ${
            view === option ? 'bg-line text-paper' : 'text-paper-dim hover:text-paper'
          } ${itemClassName ?? ''}`}
        >
          {option}
        </button>
      ))}
    </nav>
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
