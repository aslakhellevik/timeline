import { useEffect, useRef, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { parseQuickAdd } from '../core/quick-add';
import { formatTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';
import { useTagNames } from '../state/tag-names';
import { Field } from './controls';
import { modalIsOpen } from './use-focus-trap';

/**
 * Capture (docs/design.md §9).
 *
 * This is the highest-stakes surface in the app. If adding an event while
 * reading takes more than a few seconds the timeline never gets dense enough to
 * have mass, and the whole premise fails. So: one line, no form, no modal, and a
 * keyboard shortcut from anywhere.
 *
 * **The parse is shown before it is saved, which is what the lenient grammar was
 * sold on.** §2.2 justifies a parser that guesses — the rightmost of two years,
 * a period phrase as a fuzzy span — by promising that "the quick-add UI shows
 * the parsed date back, so the rare wrong guess is visible before it is saved".
 * It was shown only *after*, in a panel reporting a fact. The date and the tags
 * now appear in the box's right gutter as you type, from the same pure
 * `parseQuickAdd` the store calls, so a misread year is caught by the person who
 * typed it while the cursor is still in the box.
 *
 * **Success is a line, trouble is a panel.** The two outcomes are not the same
 * kind of news and had the same shape: one absolutely-positioned dropdown that
 * cleared only on the next keystroke, so "added · 1571" sat over ten filter
 * chips until the box was typed into again. A confirmation is worth four seconds
 * in a gutter, with the undo beside it; a duplicate warning is worth blocking
 * the chips and waiting to be dismissed on purpose.
 */

/** How long a confirmation stays. Long enough to read and to undo, no longer. */
const STATUS_MS = 4000;
/** The preview's debounce: fast enough to feel live, slow enough not to thrash. */
const PREVIEW_MS = 100;

interface Problem {
  tone: 'warn' | 'error';
  text: string;
  duplicates?: TimelineEvent[];
}

export function QuickAdd() {
  const quickAdd = useTimeline((state) => state.quickAdd);
  const undo = useTimeline((state) => state.undo);
  const select = useTimeline((state) => state.select);
  const tagNames = useTagNames();

  const [value, setValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typingElsewhere =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
      if (typingElsewhere) return;
      // Not from under a dialog: `/` used to focus this box behind the overlay,
      // so the next keystrokes went into a field nobody could see (§6.4).
      if (modalIsOpen()) return;

      if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key === 'k')) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The live parse. Pure: `parseQuickAdd` decides nothing about storage and
  // touches no state, which is exactly why it can be run on every pause.
  useEffect(() => {
    if (value.trim().length === 0) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      const draft = parseQuickAdd(value);
      const parts = [
        draft.when ? formatTime(draft.when) : 'no date yet',
        ...(draft.tagNames.length > 0
          ? [draft.tagNames.map((name) => `#${name}`).join(' ')]
          : []),
      ];
      setPreview(parts.join(' · '));
    }, PREVIEW_MS);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const submit = () => {
    if (value.trim().length === 0) return;
    const outcome = quickAdd(value);

    if (!outcome.ok) {
      setStatus(null);
      setProblem({ tone: 'error', text: outcome.reason ?? 'could not add that' });
      return;
    }

    setValue('');
    setPreview(null);
    if (outcome.duplicates && outcome.duplicates.length > 0) {
      setStatus(null);
      setProblem({
        tone: 'warn',
        text: 'added — but this looks like something you already have',
        duplicates: outcome.duplicates,
      });
      return;
    }

    setProblem(null);
    const event = outcome.event;
    // Everything the line claimed, read back: what it made of the title, the
    // date and the tags. The tags matter most — a `#europe` that silently became
    // a private tag rather than the built-in region is invisible otherwise.
    setStatus(
      event
        ? ['added', event.title, formatTime(event.when), ...tagLabels(event, tagNames)].join(' · ')
        : 'added',
    );
  };

  return (
    <div className="relative flex-1">
      <Field
        inputRef={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setStatus(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') {
            // Claimed, so that clearing the box does not also close whatever
            // pane is open behind it (§6.4).
            event.preventDefault();
            setValue('');
            setStatus(null);
            setProblem(null);
            event.currentTarget.blur();
          }
        }}
        placeholder="battle of lepanto 1571 #europe #war"
        aria-label="add an event"
        inputClassName="pr-8"
      />

      {/*
        The gutter: one confirmation, or the live parse, or the shortcut that
        gets you here. `paper-dim` rather than the faint token because this sits
        on the input's own surface, where dim is the contrast floor (D62).
      */}
      <div
        className="pointer-events-none absolute inset-y-0 right-2.5 flex max-w-[70%]
                   items-center gap-2 text-[11px]"
      >
        <span role="status" className="truncate bg-surface pl-2 text-paper-soft">
          {status ?? ''}
        </span>
        {status !== null ? (
          <button
            onClick={() => {
              undo();
              setStatus(null);
            }}
            className="pointer-events-auto shrink-0 bg-surface text-paper-dim underline
                       decoration-line underline-offset-2 hover:text-paper"
          >
            undo
          </button>
        ) : preview !== null ? (
          <span aria-hidden className="truncate bg-surface pl-2 text-paper-dim">
            {preview}
          </span>
        ) : (
          // The shortcut, where the shortcut takes you. A key that exists only
          // in a window listener is a key nobody finds.
          <span aria-hidden className="text-paper-faint">
            /
          </span>
        )}
      </div>

      {problem && (
        <div
          role="status"
          className={`absolute left-0 top-full z-10 mt-1 w-full rounded border border-line
                      bg-surface px-3 py-2 text-xs ${
                        problem.tone === 'error' ? 'text-[#e66767]' : 'text-[#c98500]'
                      }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span>{problem.text}</span>
            {/*
              Dismissed on purpose. This panel covers the filter chips, and the
              thing it is warning about — the same event entered twice, which
              §6.3 calls the obvious failure mode of a capture-optimised tool —
              is worth a deliberate act to put away.
            */}
            <button
              onClick={() => setProblem(null)}
              aria-label="dismiss"
              className="-my-0.5 shrink-0 px-1 text-paper-dim hover:text-paper"
            >
              ×
            </button>
          </div>
          {problem.duplicates && (
            <ul className="mt-1 space-y-0.5">
              {problem.duplicates.slice(0, 3).map((duplicate) => (
                <li key={duplicate.id}>
                  {/* The warning's whole purpose is to get you to look at the
                      one you already have, and it was not a link to it. */}
                  <button
                    onClick={() => {
                      select(duplicate.id);
                      setProblem(null);
                    }}
                    className="w-full truncate text-left text-paper-dim hover:text-paper
                               hover:underline"
                  >
                    {duplicate.title} · {formatTime(duplicate.when)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function tagLabels(event: TimelineEvent, names: ReadonlyMap<string, string>): string[] {
  const labels = event.tags.flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [`#${name}`];
  });
  return labels.length > 0 ? [labels.join(' ')] : [];
}
