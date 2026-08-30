import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A text field that commits when you stop typing, not while you type.
 *
 * Every text field in the panes wrote straight through to the store on every
 * keystroke — the note editor, `learned from`, the era name, a connection's
 * argument. Three things go wrong with that, in ascending order of seriousness:
 * a database write per character, a re-render of the whole app per character,
 * and a `updated_at` that says the note was edited at the moment of the last
 * letter rather than the moment of the thought. W1 coalesced the *undo* entries
 * so that undoing a sentence does not undo it one letter at a time, but the
 * writes themselves were still per keystroke.
 *
 * So the draft is held here and committed on ~500 ms of idle, and on blur —
 * which is what `PlaceField` had always done, and what the rest of the panes
 * copied nothing from. The two together mean nothing is ever lost: leaving the
 * field commits immediately, and staying in it commits half a second later.
 *
 * The debounce **complements** the undo coalescing rather than replacing it: an
 * undo window is one second per `(kind, id, field)`, so a slow typist still gets
 * one undo entry per sentence rather than one per pause.
 */
export interface Draft {
  value: string;
  onChange: (next: string) => void;
  /** Commits now. Bound to `onBlur` at every call site. */
  flush: () => void;
}

export function useDraft(value: string, commit: (next: string) => void, delayMs = 500): Draft {
  const [draft, setDraft] = useState(value);
  /*
   * Whether the draft holds an edit the store has not seen.
   *
   * It is what decides whether an incoming `value` is news or an echo. Without
   * it, the commit's own re-render arrives as an external change and the field
   * resets to whatever the store made of the text — which, mid-sentence, is a
   * cursor jump and a lost word. Dirty also means an edit from another tab loses
   * to the one being typed here, which is the right way round: the merge rule
   * can sort it out on the next write, and nobody's keystrokes disappear.
   */
  const dirty = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (dirty.current) return;
    setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    commitRef.current(draftRef.current);
  }, []);

  const onChange = useCallback(
    (next: string) => {
      dirty.current = true;
      setDraft(next);
      draftRef.current = next;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  // Unmounting mid-sentence must not lose it. In practice the blur that
  // precedes any click gets there first — including the click on `delete`,
  // which is why this cannot resurrect a record that has just been tombstoned.
  useEffect(() => flush, [flush]);

  return { value: draft, onChange, flush };
}
