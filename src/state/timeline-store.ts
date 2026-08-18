/**
 * The application store: canonical timeline in memory, persisted behind it.
 *
 * All the rules live in `timeline-model.ts`; this is the wiring — it holds the
 * current state, routes mutations through the model, queues the resulting
 * records for the database, and keeps an undo stack.
 */

import { create } from 'zustand';
import type { Filter, Id, Timeline, TimelineEvent } from '../core/model/types';
import { NO_FILTER } from '../core/filter';
import { parseQuickAdd } from '../core/quick-add';
import { findPossibleDuplicates } from '../core/search';
import { fromGregorian, interval } from '../core/time';
import type { Store } from '../store/contract';
import { PersistQueue } from './persist-queue';
import {
  EMPTY_TIMELINE,
  applyUndo,
  createEra,
  createEvent,
  editEvent,
  ensureTags,
  removeEvent,
  sortEvents,
} from './timeline-model';
import type { EventDraft, Mutation, UndoStep } from './timeline-model';

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

  seedLife(birthYear: number): void;
  replaceTimeline(timeline: Timeline): void;

  setFilter(filter: Filter): void;
  setQuery(query: string): void;
  select(id: Id | null): void;
}

let backing: Store | null = null;
let queue: PersistQueue | null = null;

export const useTimeline = create<TimelineStoreState>((set, get) => {
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

    updateEvent(id, patch) {
      commit(editEvent(get().timeline, id, patch));
    },

    deleteEvent(id) {
      commit(removeEvent(get().timeline, id));
      if (get().selectedId === id) set({ selectedId: null });
    },

    undo() {
      const stack = get().undoStack;
      const steps = stack[stack.length - 1];
      if (!steps) return;

      const mutation = applyUndo(get().timeline, steps);
      queue?.enqueue(mutation.touched);
      set({ timeline: mutation.timeline, undoStack: stack.slice(0, -1) });
    },

    /**
     * First run (D26): one question, and the timeline is never blank — the
     * personal frame of reference exists before the user has added anything.
     */
    seedLife(birthYear) {
      const thisYear = new Date().getFullYear();
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
    setQuery(query) {
      set({ query });
    },
    select(id) {
      set({ selectedId: id });
    },
  };
});
