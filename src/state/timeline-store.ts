/**
 * The application store: canonical timeline in memory, persisted behind it.
 *
 * All the rules live in `timeline-model.ts`; this is the wiring — it holds the
 * current state, routes mutations through the model, queues the resulting
 * records for the database, and keeps an undo stack.
 */

import { create } from 'zustand';
import type { Base, Era, Filter, Id, Timeline, TimelineEvent } from '../core/model/types';
import { NO_FILTER } from '../core/filter';
import { parseQuickAdd } from '../core/quick-add';
import { findPossibleDuplicates } from '../core/search';
import { fromGregorian, interval } from '../core/time';
import type { RecordKind, Store, StoreChange } from '../store/contract';
import { requestPersistence } from '../store/durability';
import type { PersistenceResult } from '../store/durability';
import { compareTimestamps } from '../store/serialise';
import { PersistQueue } from './persist-queue';
import {
  EMPTY_TIMELINE,
  applyUndo,
  createConnection,
  createEra,
  createEvent,
  editConnection,
  editEra,
  editEvent,
  ensureTags,
  findConnectionBetween,
  installBuiltinTags,
  pushUndo,
  removeConnection,
  removeEra,
  removeEvent,
  sortEvents,
} from './timeline-model';
import type {
  ConnectionDraft,
  EraDraft,
  EventDraft,
  Mutation,
  Patch,
  UndoEntry,
} from './timeline-model';

/** How many undo entries to keep. Beyond this, soft deletes are the safety net. */
const UNDO_DEPTH = 50;

/** Write debounce (§7.1): long enough to coalesce typing, short enough to lose little. */
const PERSIST_DELAY_MS = 200;

/**
 * How long cross-tab announcements are gathered before one reload.
 *
 * `replaceAll` announces once per record kind, and each arrives as its own
 * message, so without this an import in another tab costs five reloads.
 */
const REMOTE_COALESCE_MS = 50;

/** The era first run creates (D26). Named so `seedLife` can tell it is already there. */
const LIFE_ERA_NAME = 'my life';

export interface QuickAddOutcome {
  ok: boolean;
  event?: TimelineEvent;
  /** Existing events that look like the same thing (§5.3 duplicate guard). */
  duplicates?: TimelineEvent[];
  reason?: string;
}

interface TimelineStoreState {
  status: 'loading' | 'ready' | 'error';
  timeline: Timeline;
  filter: Filter;
  selectedId: Id | null;
  /** The connection whose document the detail pane is showing, if any. */
  selectedConnectionId: Id | null;
  /** The era whose detail the pane is showing, if any. */
  selectedEraId: Id | null;
  /**
   * The first endpoint of a connection being made. While this is set the whole
   * app is in "pick a second event" mode: the canvas draws a pending arc to the
   * cursor, and a click anywhere that selects an event completes it instead.
   */
  connectFrom: Id | null;
  /**
   * Whether the search picker is showing. Separate from `connectFrom` so that
   * dismissing the picker can leave the pick armed — the "pick on the timeline
   * instead" escape hatch, which is the only way the canvas route is reachable.
   */
  pickerOpen: boolean;
  query: string;
  /**
   * Bumped whenever something asks the views to bring the selection into view
   * (§5.1) — "show on timeline", or `Enter` on a list row.
   *
   * A counter rather than an id, because the request is not always a *change*:
   * pressing "show on timeline" on the event that is already selected has to
   * reveal it again, and nothing in the selection moves when it does.
   */
  revealRequest: number;
  undoStack: UndoEntry[];
  /** What the next undo would take back, e.g. "delete event". Null when empty. */
  undoLabel: string | null;
  error: string | null;
  /** True until the user has anything of their own — drives first run (D26). */
  isFirstRun: boolean;
  /**
   * When the timeline last changed, as `Date.now()`. Null until it has.
   *
   * The dirty signal the automatic backup runs on (§7.3): a cycle that finds
   * this unchanged since the last snapshot skips the write. Deliberately a
   * stamp rather than a boolean — nothing has to reset it, so the flag cannot
   * be cleared by one reader and missed by another.
   */
  lastMutationAt: number | null;
  /**
   * The outcome of the one automatic `navigator.storage.persist()` request
   * (§7.3, layer 1), or null before the first write.
   *
   * Kept so the data panel can tell "never asked" from "asked and refused" —
   * `persistenceState()` reports both as simply not persisted, and only one of
   * them is worth offering a button for.
   */
  persistence: PersistenceResult | null;

  attach(store: Store): Promise<void>;
  flush(): Promise<void>;

  quickAdd(input: string): QuickAddOutcome;
  addEvent(draft: EventDraft): TimelineEvent;
  updateEvent(id: Id, patch: Patch<Omit<TimelineEvent, 'id' | 'created_at' | 'updated_at'>>): void;
  /** Replaces an event's tags from names, inventing or resolving each (D20, D44). */
  setEventTags(id: Id, names: readonly string[]): void;
  deleteEvent(id: Id): void;
  undo(): void;

  beginConnect(from: Id): void;
  cancelConnect(): void;
  /** Hides the picker, leaving the pick armed for a canvas or list click. */
  closePicker(): void;
  /** Completes the pending connection. Returns the connection id, or null. */
  connectTo(to: Id): Id | null;
  addConnection(draft: ConnectionDraft): Id | null;
  updateConnection(id: Id, patch: { note?: string; tags?: Id[] }): void;
  deleteConnection(id: Id): void;

  addEra(draft: EraDraft): Id | null;
  updateEra(id: Id, patch: Patch<Omit<Era, 'id' | 'created_at' | 'updated_at'>>): void;
  deleteEra(id: Id): void;
  selectEra(id: Id | null): void;

  seedLife(birthYear: number): void;
  /** The premade vocabulary alone (D39) — what skipping the question leaves. */
  seedTags(): void;
  replaceTimeline(timeline: Timeline): Promise<void>;
  /** Empties everything and returns to first run. Unrecoverable. */
  resetAll(): Promise<void>;
  /** Applies a bookmarked filter and selection (D24). Mount-only. */
  restoreBookmark(bookmark: { tags?: readonly Id[]; selectedId?: Id }): void;

  setFilter(filter: Filter): void;
  /** Adds or removes one tag, leaving the rest of the filter alone. */
  toggleTag(id: Id): void;
  clearTags(): void;
  setQuery(query: string): void;
  select(id: Id | null): void;
  selectConnection(id: Id | null): void;
  /** Asks whichever canvas is showing to bring the selected event into view. */
  revealSelected(): void;
}

let backing: Store | null = null;
let queue: PersistQueue | null = null;
/** Undoes `store.subscribe`, so re-attaching does not leave the old one running. */
let unsubscribe: (() => void) | null = null;
/** Cross-tab changes gathered since the last reload, by kind (§7.7). */
let incoming: Map<RecordKind, Set<Id>> | null = null;
let incomingTimer: ReturnType<typeof setTimeout> | null = null;
/** Attaches run one at a time; StrictMode starts two before either finishes. */
let attaching: Promise<unknown> = Promise.resolve();
/**
 * Whether a persistence request is in flight. The *answer* is kept in state, so
 * "have we asked?" is a state question; this only stops two writes in the same
 * tick from both asking before either has an answer to record.
 */
let claimingPersistence = false;

/**
 * Merges one record kind after another tab's write (§7.7).
 *
 * Only the announced ids are considered: an id the database no longer has is
 * dropped, one it has is taken unless the local copy is newer — an edit typed
 * here a moment ago and not yet flushed. Returns `null` when nothing changed,
 * so a change this tab already knew about costs no re-render.
 */
function spliceRemote<T extends Base>(
  local: readonly T[],
  remote: readonly T[],
  ids: ReadonlySet<Id>,
): T[] | null {
  const fresh = new Map<Id, T>();
  for (const record of remote) if (ids.has(record.id)) fresh.set(record.id, record);

  const next: T[] = [];
  let changed = false;

  for (const record of local) {
    if (!ids.has(record.id)) {
      next.push(record);
      continue;
    }
    const theirs = fresh.get(record.id);
    if (!theirs) {
      // Gone from the database — a `replaceAll` in the other tab removed it.
      changed = true;
      continue;
    }
    fresh.delete(record.id);
    // Last writer wins by instant, as everywhere else (§7.7).
    if (compareTimestamps(theirs.updated_at, record.updated_at) > 0) {
      next.push(theirs);
      changed = true;
    } else {
      next.push(record);
    }
  }

  for (const record of fresh.values()) {
    next.push(record);
    changed = true;
  }

  return changed ? next : null;
}

export const useTimeline = create<TimelineStoreState>((set, get) => {
  /**
   * The undo stack and its label, always set together — a label kept in step by
   * hand at seven call sites would be out of step at one of them.
   */
  const undoState = (undoStack: UndoEntry[]) => ({
    undoStack,
    undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
  });

  /**
   * Claims persistent storage, once, on the first real write (§7.3, layer 1).
   *
   * `requestPersistence` has said "call it on first write" in its own docstring
   * since it was written and nothing ever did, so the layer the design puts
   * first was the one layer that never ran. Here rather than on load because
   * Chromium weighs engagement: asked as the page opens the answer is often no,
   * asked once there is something to lose it is usually yes. It is a request,
   * not a prompt — nothing is shown to the user either way.
   */
  const claimPersistence = (): void => {
    // Asked exactly once: the recorded answer is what says it has been.
    if (claimingPersistence || get().persistence !== null) return;
    claimingPersistence = true;
    void requestPersistence()
      .then((result) => set({ persistence: result }))
      // Durability is a best effort by definition; failing to ask must not
      // interrupt the write that triggered it.
      .catch(() => undefined)
      .finally(() => {
        claimingPersistence = false;
      });
  };

  /** Every path that changes the timeline stamps it, for the backup schedule. */
  const markDirty = (): { lastMutationAt: number } => ({ lastMutationAt: Date.now() });

  /** Commits a model mutation: new state, records queued, undo recorded. */
  const commit = (mutation: Mutation | null): void => {
    // A mutation that changed nothing — `installBuiltinTags` on a timeline that
    // already has them — is not a write, and enqueuing its empty batch woke the
    // persist timer for no reason.
    if (!mutation || mutation.touched.length === 0) return;

    queue?.enqueue(mutation.touched);
    claimPersistence();

    // `isFirstRun` means "the user has nothing of their own", which `attach`
    // defines over events and eras — so materialising the premade tag set does
    // not end first run halfway through the screen that asks for a birth year.
    const owned = mutation.touched.some(
      (group) => group.kind === 'events' || group.kind === 'eras',
    );

    set((state) => ({
      timeline: mutation.timeline,
      ...markDirty(),
      ...(mutation.undo.length > 0
        ? undoState(
            pushUndo(
              state.undoStack,
              {
                steps: mutation.undo,
                label: mutation.label,
                ...(mutation.coalesce !== undefined ? { coalesce: mutation.coalesce } : {}),
                at: Date.now(),
              },
              UNDO_DEPTH,
            ),
          )
        : {}),
      ...(owned ? { isFirstRun: false } : {}),
    }));
  };

  /** Awaits a wholesale write and reports failure rather than dropping it. */
  const writeAll = async (timeline: Timeline): Promise<boolean> => {
    claimPersistence();
    try {
      await backing?.replaceAll(timeline);
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  /**
   * Applies another tab's write to the in-memory timeline (§7.1, §7.7).
   *
   * The naive answer — reload everything — silently threw away whatever this
   * tab had typed since its last flush. §7.7 states the rule instead: re-read
   * exactly the ids the change names, drop the ones that are gone, and keep the
   * local record where it is the newer of the two.
   */
  const applyRemote = async (store: Store, batch: Map<RecordKind, Set<Id>>): Promise<void> => {
    let remote: Timeline;
    try {
      remote = await store.load();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // Re-attached while the load was in flight: this batch is about a database
    // the store is no longer bound to.
    if (backing !== store) return;

    let { events, connections, tags, eras } = get().timeline;
    let changed = false;

    for (const [kind, ids] of batch) {
      if (ids.size === 0) continue;
      switch (kind) {
        case 'events': {
          const next = spliceRemote(events, remote.events, ids);
          if (next) {
            events = sortEvents(next);
            changed = true;
          }
          break;
        }
        case 'connections': {
          const next = spliceRemote(connections, remote.connections, ids);
          if (next) {
            connections = next;
            changed = true;
          }
          break;
        }
        case 'tags': {
          const next = spliceRemote(tags, remote.tags, ids);
          if (next) {
            tags = next;
            changed = true;
          }
          break;
        }
        case 'eras': {
          const next = spliceRemote(eras, remote.eras, ids);
          if (next) {
            eras = next;
            changed = true;
          }
          break;
        }
      }
    }

    // Every step on the stack was computed against a timeline that no longer
    // exists; replaying one would put a record back over another tab's newer
    // version, which is the failure this whole path is here to prevent.
    const clearing = get().undoStack.length > 0;
    if (!changed && !clearing) return;

    set({
      // Another tab's write changed this timeline too, and the backup folder is
      // per machine rather than per tab: whichever tab holds the folder
      // permission has to notice, or an edit made in the other one is never
      // backed up at all.
      ...(changed ? { timeline: { events, connections, tags, eras }, ...markDirty() } : {}),
      ...(clearing ? undoState([]) : {}),
    });
  };

  const receive = (store: Store, change: StoreChange): void => {
    const batch = (incoming ??= new Map());
    let ids = batch.get(change.kind);
    if (!ids) batch.set(change.kind, (ids = new Set()));
    for (const id of change.ids) ids.add(id);

    if (incomingTimer !== null) return;
    incomingTimer = setTimeout(() => {
      incomingTimer = null;
      const collected = incoming;
      incoming = null;
      if (collected) void applyRemote(store, collected);
    }, REMOTE_COALESCE_MS);
  };

  /** The body of `attach`; called only through the serialising wrapper below. */
  const attachTo = async (store: Store): Promise<void> => {
    await queue?.flush();
    unsubscribe?.();
    unsubscribe = null;
    if (incomingTimer !== null) {
      clearTimeout(incomingTimer);
      incomingTimer = null;
    }
    incoming = null;

    backing = store;
    queue = new PersistQueue(store, PERSIST_DELAY_MS, (error) =>
      set({
        error: error === null ? null : error instanceof Error ? error.message : String(error),
      }),
    );

    try {
      const timeline = await store.load();
      set({
        timeline: { ...timeline, events: sortEvents(timeline.events) },
        status: 'ready',
        isFirstRun: timeline.events.length === 0 && timeline.eras.length === 0,
      });
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }

    // Another tab wrote something; both hold in-memory state and would
    // otherwise overwrite each other silently (§7.1).
    unsubscribe = store.subscribe((change) => receive(store, change));
  };

  return {
    status: 'loading',
    timeline: EMPTY_TIMELINE,
    filter: NO_FILTER,
    selectedId: null,
    selectedConnectionId: null,
    selectedEraId: null,
    connectFrom: null,
    pickerOpen: false,
    query: '',
    revealRequest: 0,
    undoStack: [],
    undoLabel: null,
    error: null,
    isFirstRun: true,
    lastMutationAt: null,
    persistence: null,

    /**
     * Binds the store to a database.
     *
     * Called more than once in practice — StrictMode mounts the app twice — so
     * it takes the previous wiring down first: overwriting `queue` lost whatever
     * it still held, and dropping the subscribe's unsubscribe left a listener
     * writing into this store from a database nobody would close.
     *
     * Attaches are also **serialised**, because the double mount starts the
     * second before the first has finished. Interleaved, the two could leave
     * the store loaded from one database and subscribed to the other.
     */
    attach(store) {
      const run = attaching.then(() => attachTo(store));
      attaching = run.catch(() => {});
      return run;
    },

    async flush() {
      await queue?.flush();
    },

    quickAdd(input) {
      const draft = parseQuickAdd(input);
      if (draft.title.length === 0) {
        return { ok: false, reason: 'needs a title' };
      }
      if (!draft.when) {
        return { ok: false, reason: 'no date found — try adding a year' };
      }

      const state = get();
      const duplicates = findPossibleDuplicates(state.timeline.events, draft.title, draft.when);

      const resolved = ensureTags(state.timeline, draft.tagNames);
      if (resolved.touched.length > 0) {
        queue?.enqueue(resolved.touched);
      }

      const mutation = createEvent(resolved.timeline, {
        title: draft.title,
        when: draft.when,
        tags: resolved.ids,
      });

      // Fold the tag creation into the same undo entry, so one undo removes both
      // the event and any tag it invented.
      commit({ ...mutation, undo: [...resolved.undo, ...mutation.undo] });

      const event = mutation.timeline.events.find((e) => e.id === mutation.undo[0]?.id);
      return {
        ok: true,
        ...(event ? { event } : {}),
        ...(duplicates.length > 0 ? { duplicates } : {}),
      };
    },

    addEvent(draft) {
      const mutation = createEvent(get().timeline, draft);
      commit(mutation);
      return mutation.timeline.events.find((e) => e.id === mutation.undo[0]?.id) as TimelineEvent;
    },

    updateEvent(id, patch) {
      commit(editEvent(get().timeline, id, patch));
    },

    /**
     * The tag editor's one write, folded exactly as `quickAdd` folds its own.
     *
     * It takes **names**, not ids, because that is what both ends of the pane
     * deal in: the chips show names, the `+ tag` box is typed into, and D44's
     * normalisation — case, `-`/`_`/space, a leading article — is what decides
     * whether `#north-america` means the built-in region or a private tag beside
     * it. Resolving that here rather than in the component keeps one answer to
     * "what does this word mean" for capture and for editing.
     *
     * One `commit`, so undoing an added tag also removes the tag record it
     * invented — and the coalescing key is dropped when it invented one, because
     * a coalesced entry keeps the *older* steps and the new tag would otherwise
     * outlive the undo that was meant to take it back.
     */
    setEventTags(id, names) {
      const resolved = ensureTags(get().timeline, names);
      const mutation = editEvent(resolved.timeline, id, { tags: resolved.ids });
      if (!mutation) return;

      const { coalesce, ...rest } = mutation;
      commit({
        ...rest,
        touched: [...resolved.touched, ...mutation.touched],
        undo: [...resolved.undo, ...mutation.undo],
        label: 'tag change',
        ...(resolved.undo.length === 0 && coalesce !== undefined ? { coalesce } : {}),
      });
    },

    deleteEvent(id) {
      const mutation = removeEvent(get().timeline, id);
      // The cascade (D21) is computed once, by the model. A connection it is
      // about to tombstone must not stay open in the detail pane.
      const orphaned = new Set(
        (mutation?.undo ?? [])
          .filter((step) => step.kind === 'connections')
          .map((step) => step.id),
      );

      commit(mutation);

      const state = get();
      const patch = {
        ...(state.selectedId === id ? { selectedId: null } : {}),
        ...(state.selectedConnectionId && orphaned.has(state.selectedConnectionId)
          ? { selectedConnectionId: null }
          : {}),
        ...(state.connectFrom === id ? { connectFrom: null, pickerOpen: false } : {}),
      };
      if (Object.keys(patch).length > 0) set(patch);
    },

    undo() {
      const stack = get().undoStack;
      const entry = stack[stack.length - 1];
      if (!entry) return;

      const mutation = applyUndo(get().timeline, entry.steps);
      queue?.enqueue(mutation.touched);
      set({ timeline: mutation.timeline, ...markDirty(), ...undoState(stack.slice(0, -1)) });
    },

    beginConnect(from) {
      set({
        connectFrom: from,
        pickerOpen: true,
        selectedId: from,
        selectedConnectionId: null,
      });
    },

    cancelConnect() {
      set({ connectFrom: null, pickerOpen: false });
    },

    closePicker() {
      set({ pickerOpen: false });
    },

    /**
     * Completes the pending connection and opens its note.
     *
     * The note is the point — "the interesting content of a personal timeline is
     * not the events but the reasoning between them" — so finishing the pick
     * lands the user in the editor rather than back on the timeline.
     */
    connectTo(to) {
      const from = get().connectFrom;
      if (!from) return null;
      const id = get().addConnection({ from, to });
      set({
        connectFrom: null,
        pickerOpen: false,
        ...(id ? { selectedConnectionId: id, selectedId: to } : {}),
      });
      return id;
    },

    addConnection(draft) {
      // Already connected: select the existing one rather than reporting an
      // error. Wanting to connect two events that are already connected almost
      // always means wanting to read what you wrote last time.
      const existing = findConnectionBetween(get().timeline, draft.from, draft.to);
      if (existing) return existing.id;

      const mutation = createConnection(get().timeline, draft);
      if (!mutation) return null;
      commit(mutation);
      return mutation.undo[0]?.id ?? null;
    },

    updateConnection(id, patch) {
      commit(editConnection(get().timeline, id, patch));
    },

    deleteConnection(id) {
      commit(removeConnection(get().timeline, id));
      if (get().selectedConnectionId === id) set({ selectedConnectionId: null });
    },

    addEra(draft) {
      const mutation = createEra(get().timeline, draft);
      commit(mutation);
      const id = mutation.undo[0]?.id ?? null;
      // A pending pick has to be disarmed with the rest of the selection: the
      // era pane replaces the picker's banner, so the arm would survive
      // invisibly and complete on the next click anywhere.
      if (id) {
        set({
          selectedEraId: id,
          selectedId: null,
          selectedConnectionId: null,
          connectFrom: null,
          pickerOpen: false,
        });
      }
      return id;
    },

    updateEra(id, patch) {
      commit(editEra(get().timeline, id, patch));
    },

    deleteEra(id) {
      commit(removeEra(get().timeline, id));
      if (get().selectedEraId === id) set({ selectedEraId: null });
    },

    selectEra(id) {
      set({
        selectedEraId: id,
        selectedId: null,
        selectedConnectionId: null,
        connectFrom: null,
      });
    },

    /**
     * First run (D26): one question, and the timeline is never blank — the
     * personal frame of reference exists before the user has added anything.
     *
     * Idempotent, because the first-run screen is reachable a second time
     * through "start over" (§7.8) and because StrictMode will happily submit
     * the form's effect twice — two overlapping lives on the axis is a mess
     * only a manual delete gets out of.
     */
    /**
     * The premade vocabulary on its own.
     *
     * Separated from `seedLife` because skipping the birth-year question must
     * create no era — an invented year is the one piece of data in the app the
     * user cannot check — while the tags have nothing to do with the question
     * and everything to do with a typed `#war` finding the built-in tag (D39).
     */
    seedTags() {
      commit(installBuiltinTags(get().timeline));
    },

    seedLife(birthYear) {
      const thisYear = new Date().getFullYear();
      // The premade vocabulary first, so `#war` typed a minute later attaches to
      // the built-in tag rather than inventing a private one beside it.
      get().seedTags();

      const already = get().timeline.eras.some(
        (era) => era.kind === 'personal' && !era.deleted_at && era.name === LIFE_ERA_NAME,
      );
      if (already) return;

      commit(
        createEra(get().timeline, {
          name: LIFE_ERA_NAME,
          when: interval(fromGregorian(birthYear, 1, 1), fromGregorian(thisYear + 1, 1, 1)),
          kind: 'personal',
        }),
      );
    },

    /**
     * Empties the store and puts the app back on the first-run screen.
     *
     * `isFirstRun` has to go back to true, not just the data go away: the
     * onboarding is what makes an empty timeline comprehensible, and dropping
     * someone onto a blank density view is exactly the first screen D26 exists
     * to avoid.
     *
     * The backup folder and its last-written stamp are deliberately kept. They
     * are local settings about *where* copies go, not the data, and forgetting
     * them would quietly disarm the safety net right after the one action that
     * makes it matter.
     */
    async resetAll() {
      // The queue first, and dropped rather than flushed: a record still
      // pending is written back a moment after the database is emptied and
      // resurrects on the next load — verified, and the only way to lose the
      // reset the user just asked for.
      queue?.clear();

      const empty = EMPTY_TIMELINE;
      // Nothing in memory is cleared until the write has actually landed. A
      // failed reset that had already blanked the screen would look exactly
      // like a successful one that lost everything.
      if (!(await writeAll(empty))) return;

      set({
        timeline: empty,
        ...markDirty(),
        ...undoState([]),
        selectedId: null,
        selectedConnectionId: null,
        selectedEraId: null,
        connectFrom: null,
        pickerOpen: false,
        query: '',
        filter: NO_FILTER,
        error: null,
        isFirstRun: true,
      });
    },

    async replaceTimeline(timeline) {
      const sorted = { ...timeline, events: sortEvents(timeline.events) };
      set({ timeline: sorted, ...markDirty(), ...undoState([]), isFirstRun: false });
      await queue?.flush();
      await writeAll(sorted);
    },

    /**
     * Applies a bookmarked filter and selection (D24).
     *
     * Selection is set **directly**, not through `select`: while a connection
     * is pending `select` completes it, so restoring a bookmark used to be able
     * to write a connection between the armed event and whatever the URL named.
     * Restoring a bookmark is not a click.
     */
    restoreBookmark(bookmark) {
      const { tags, selectedId } = bookmark;
      set({
        ...(tags && tags.length > 0 ? { filter: { ...get().filter, tags: [...tags] } } : {}),
        ...(selectedId
          ? { selectedId, selectedConnectionId: null, selectedEraId: null }
          : {}),
      });
    },

    setFilter(filter) {
      set({ filter });
    },

    /**
     * Tags compose as a union: an event passes if it carries *any* selected tag.
     *
     * Intersection would be the other reasonable choice and is the wrong one
     * here. The premade set mixes regions with themes, so the obvious pair to
     * pick — Europe and philosophy — would mean "European philosophy" under
     * intersection and show almost nothing, since an event tagged *philosophy*
     * is rarely also tagged with its region. Union makes selecting more tags
     * show more, which is what the sizes next to them promise.
     */
    toggleTag(id) {
      const { filter } = get();
      const tags = filter.tags.includes(id)
        ? filter.tags.filter((tag) => tag !== id)
        : [...filter.tags, id];
      set({ filter: { ...filter, tags } });
    },

    clearTags() {
      set({ filter: { ...get().filter, tags: [] } });
    },

    setQuery(query) {
      set({ query });
    },
    /**
     * Selecting an event while a connection is pending completes it instead.
     * Every path to a second event — a canvas click, a list row, the picker —
     * goes through here, so the connect flow works from all of them without any
     * of them knowing about it.
     */
    select(id) {
      const pending = get().connectFrom;
      if (pending && id && id !== pending) {
        get().connectTo(id);
        return;
      }
      set({
        selectedId: id,
        selectedConnectionId: null,
        selectedEraId: null,
      });
    },

    selectConnection(id) {
      set({
        selectedConnectionId: id,
        selectedEraId: null,
        connectFrom: null,
        pickerOpen: false,
      });
    },

    revealSelected() {
      set({ revealRequest: get().revealRequest + 1 });
    },
  };
});
