/**
 * The application store: canonical timeline in memory, persisted behind it.
 *
 * All the rules live in `timeline-model.ts`; this is the wiring — it holds the
 * current state, routes mutations through the model, queues the resulting
 * records for the database, and keeps an undo stack.
 */

import { create } from 'zustand';
import type { Era, Filter, Id, Timeline, TimelineEvent } from '../core/model/types';
import { adoptRecord, expandPack, uninstallPack } from '../core/packs';
import type { PackBundle } from '../core/packs';
import { NO_FILTER } from '../core/filter';
import { nowIso } from '../core/model/ids';
import { parseQuickAdd } from '../core/quick-add';
import { findPossibleDuplicates } from '../core/search';
import { fromGregorian, interval } from '../core/time';
import type { Store, TimelineDocument } from '../store/contract';
import { SCHEMA_VERSION } from '../store/contract';
import { mergeDocument } from '../store/serialise';
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
  removeConnection,
  removeEra,
  removeEvent,
  sortEvents,
} from './timeline-model';
import type { ConnectionDraft, EraDraft, EventDraft, Mutation, UndoStep } from './timeline-model';

/** How many undo steps to keep. Beyond this, soft deletes are the safety net. */
const UNDO_DEPTH = 50;

export interface QuickAddOutcome {
  ok: boolean;
  event?: TimelineEvent;
  /** Existing events that look like the same thing (§6.3 duplicate guard). */
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
  undoStack: UndoStep[][];
  error: string | null;
  /** True until the user has anything of their own — drives first run (D26). */
  isFirstRun: boolean;

  attach(store: Store): Promise<void>;
  flush(): Promise<void>;

  quickAdd(input: string): QuickAddOutcome;
  addEvent(draft: EventDraft): TimelineEvent;
  updateEvent(id: Id, patch: Partial<Omit<TimelineEvent, 'id' | 'created_at' | 'updated_at'>>): void;
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

  installPack(bundle: PackBundle): void;
  removePack(packId: Id): void;

  addEra(draft: EraDraft): Id | null;
  updateEra(id: Id, patch: Partial<Omit<Era, 'id' | 'created_at' | 'updated_at'>>): void;
  deleteEra(id: Id): void;
  selectEra(id: Id | null): void;

  seedLife(birthYear: number): void;
  replaceTimeline(timeline: Timeline): void;

  setFilter(filter: Filter): void;
  /** Adds or removes one tag, leaving the rest of the filter alone. */
  toggleTag(id: Id): void;
  clearTags(): void;
  setIncludePacks(includePacks: boolean): void;
  setQuery(query: string): void;
  select(id: Id | null): void;
  selectConnection(id: Id | null): void;
}

let backing: Store | null = null;
let queue: PersistQueue | null = null;

/**
 * Clears `pack` on one record, in place in a new timeline, and queues the
 * adopted copy for the database.
 *
 * Returns the timeline unchanged when the record is not a pack record, so
 * callers adopt unconditionally rather than testing first.
 */
function adoptIn(
  timeline: Timeline,
  kind: 'events' | 'connections' | 'eras',
  id: Id,
  queue: PersistQueue | null,
  now: string,
): Timeline {
  const records = timeline[kind];
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return timeline;

  const adopted = adoptRecord(records[index] as never, now);
  if (!adopted) return timeline;

  const next = records.slice();
  next[index] = adopted;
  queue?.enqueue([{ kind, records: [adopted] }]);
  return { ...timeline, [kind]: next };
}

export const useTimeline = create<TimelineStoreState>((set, get) => {
  const adopt = (timeline: Timeline, kind: 'events' | 'connections' | 'eras', id: Id): Timeline =>
    adoptIn(timeline, kind, id, queue, nowIso());

  /** Commits a model mutation: new state, records queued, undo recorded. */
  const commit = (mutation: Mutation | null): void => {
    if (!mutation) return;
    queue?.enqueue(mutation.touched);
    set((state) => ({
      timeline: mutation.timeline,
      undoStack:
        mutation.undo.length > 0
          ? [...state.undoStack, mutation.undo].slice(-UNDO_DEPTH)
          : state.undoStack,
      isFirstRun: false,
    }));
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
    undoStack: [],
    error: null,
    isFirstRun: true,

    async attach(store) {
      backing = store;
      queue = new PersistQueue(store, 200, (error) =>
        set({ error: error instanceof Error ? error.message : String(error) }),
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
      // otherwise overwrite each other silently (§8.1).
      store.subscribe(() => {
        void store.load().then((timeline) => {
          set({ timeline: { ...timeline, events: sortEvents(timeline.events) } });
        });
      });
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

    /**
     * Editing a pack event adopts it (§5): `pack` cleared, provenance manual.
     *
     * Doing it here rather than offering an "adopt" button is what makes the
     * upgrade rule safe without storing install timestamps — a pack upgrade
     * skips any record whose `pack` has been cleared, and every edit clears it.
     */
    updateEvent(id, patch) {
      const timeline = adopt(get().timeline, 'events', id);
      commit(editEvent(timeline, id, patch));
    },

    deleteEvent(id) {
      // Read the doomed connections before the mutation, so a connection the
      // cascade (D21) is about to tombstone does not stay open in the pane.
      const orphaned = new Set(
        get()
          .timeline.connections.filter((c) => c.from === id || c.to === id)
          .map((c) => c.id),
      );

      commit(removeEvent(get().timeline, id));

      const state = get();
      set({
        ...(state.selectedId === id ? { selectedId: null } : {}),
        ...(state.selectedConnectionId && orphaned.has(state.selectedConnectionId)
          ? { selectedConnectionId: null }
          : {}),
        ...(state.connectFrom === id ? { connectFrom: null, pickerOpen: false } : {}),
      });
    },

    undo() {
      const stack = get().undoStack;
      const steps = stack[stack.length - 1];
      if (!steps) return;

      const mutation = applyUndo(get().timeline, steps);
      queue?.enqueue(mutation.touched);
      set({ timeline: mutation.timeline, undoStack: stack.slice(0, -1) });
    },

    beginConnect(from) {
      set({ connectFrom: from, pickerOpen: true, selectedId: from, selectedConnectionId: null });
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

      // Connecting a pack event adopts it too (§5) — a connection is a claim
      // you have made about it, which makes the event yours.
      let timeline = adopt(get().timeline, 'events', draft.from);
      timeline = adopt(timeline, 'events', draft.to);

      const mutation = createConnection(timeline, draft);
      if (!mutation) return null;
      commit(mutation);
      return mutation.undo[0]?.id ?? null;
    },

    updateConnection(id, patch) {
      const timeline = adopt(get().timeline, 'connections', id);
      commit(editConnection(timeline, id, patch));
    },

    deleteConnection(id) {
      commit(removeConnection(get().timeline, id));
      if (get().selectedConnectionId === id) set({ selectedConnectionId: null });
    },

    /**
     * Installs a pack through the merge rule (§5) — the same one import and
     * backup restore use, so there is exactly one place that can lose data.
     *
     * Reinstalling or upgrading is the same call: record ids are derived from
     * the pack id and the author's key, so version two lands on version one's
     * records and `mergeDocument` skips anything the user has adopted.
     */
    installPack(bundle) {
      const expanded = expandPack(bundle, { source: bundle.id });
      const document: TimelineDocument = {
        schema_version: SCHEMA_VERSION,
        exported_at: expanded.pack.installed_at,
        generator: `pack:${bundle.id}@${bundle.version}`,
        events: expanded.events,
        connections: expanded.connections,
        tags: expanded.tags,
        eras: expanded.eras,
        packs: [expanded.pack],
      };

      const merged = mergeDocument(get().timeline, document);
      const sorted = { ...merged.timeline, events: sortEvents(merged.timeline.events) };
      // Undo is not offered for an install: it is a bulk operation with an
      // explicit inverse of its own, and pushing several hundred records onto
      // the undo stack would evict everything the user actually did.
      set({ timeline: sorted, undoStack: [], isFirstRun: false });
      void backing?.replaceAll(sorted);
    },

    /**
     * Uninstalls a pack and everything it still owns.
     *
     * `replaceAll` rather than tombstones, because pack content is not the
     * user's data and a tombstone would carry a newer timestamp than the bundle
     * — reinstalling later would merge into it and restore nothing.
     */
    removePack(packId) {
      const next = uninstallPack(get().timeline, packId);
      const state = get();
      const gone = (id: Id | null) =>
        id !== null && !next.events.some((event) => event.id === id);

      set({
        timeline: next,
        undoStack: [],
        ...(gone(state.selectedId) ? { selectedId: null } : {}),
        ...(state.selectedConnectionId &&
        !next.connections.some((c) => c.id === state.selectedConnectionId)
          ? { selectedConnectionId: null }
          : {}),
        ...(state.selectedEraId && !next.eras.some((e) => e.id === state.selectedEraId)
          ? { selectedEraId: null }
          : {}),
      });
      void backing?.replaceAll(next);
    },

    addEra(draft) {
      const mutation = createEra(get().timeline, draft);
      commit(mutation);
      const id = mutation.undo[0]?.id ?? null;
      if (id) set({ selectedEraId: id, selectedId: null, selectedConnectionId: null });
      return id;
    },

    updateEra(id, patch) {
      const timeline = adopt(get().timeline, 'eras', id);
      commit(editEra(timeline, id, patch));
    },

    deleteEra(id) {
      commit(removeEra(get().timeline, id));
      if (get().selectedEraId === id) set({ selectedEraId: null });
    },

    selectEra(id) {
      set({ selectedEraId: id, selectedId: null, selectedConnectionId: null, connectFrom: null });
    },

    /**
     * First run (D26): one question, and the timeline is never blank — the
     * personal frame of reference exists before the user has added anything.
     */
    seedLife(birthYear) {
      const thisYear = new Date().getFullYear();
      // The premade vocabulary first, so `#war` typed a minute later attaches to
      // the built-in tag rather than inventing a private one beside it.
      commit(installBuiltinTags(get().timeline));
      commit(
        createEra(get().timeline, {
          name: 'my life',
          when: interval(fromGregorian(birthYear, 1, 1), fromGregorian(thisYear + 1, 1, 1)),
          kind: 'personal',
        }),
      );
    },

    replaceTimeline(timeline) {
      const sorted = { ...timeline, events: sortEvents(timeline.events) };
      set({ timeline: sorted, undoStack: [], isFirstRun: false });
      void backing?.replaceAll(sorted);
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

    setIncludePacks(includePacks) {
      set({ filter: { ...get().filter, includePacks } });
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
      set({ selectedId: id, selectedConnectionId: null, selectedEraId: null });
    },

    selectConnection(id) {
      set({ selectedConnectionId: id, selectedEraId: null, connectFrom: null, pickerOpen: false });
    },
  };
});
