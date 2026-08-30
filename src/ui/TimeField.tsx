import { useEffect, useState } from 'react';
import type { TimeSpec } from '../core/model/types';
import { formatTime, parseTime } from '../core/time';
import { Field } from './controls';

/**
 * A date, edited as one line of text (docs/design.md §2.2).
 *
 * **There is no mode selector, and none is needed.** D1 says the three modes
 * exist "so the common case stays a single box", and §2.2 then hedges that a
 * selector "exists for editing" — but `formatTime` round-trips through
 * `parseTime` for every shape it can produce: an interval formats as `1914–1918`
 * and parses back as an interval, a century as `12th century`, and where the
 * numbers alone would lose the claim the spec keeps the authored `text` and the
 * formatter uses it. So the text *is* the mode, and a picker offering `instant /
 * interval / fuzzy` would be three controls asking what one line already says.
 *
 * The same reasoning the era span field used, now shared by it and the event
 * pane, which is the only reason this is a component rather than a `<Field>`
 * with two handlers: the parse-commit-revert dance around it is fiddly enough
 * that two copies would drift, and it had already been written twice.
 *
 * Committed on blur and on Enter, never per keystroke — a date half-typed is
 * almost always an invalid one, and reddening the box at `196` while someone is
 * typing `1969` is the parser shouting at work in progress.
 */
export interface TimeFieldProps {
  label?: string;
  value: TimeSpec;
  onCommit: (when: TimeSpec) => void;
  placeholder?: string;
  'aria-label'?: string;
  inputClassName?: string;
}

const DEFAULT_PLACEHOLDER = '20 July 1969 · 1914–1918 · c. 250 BC';

export function TimeField({
  label,
  value,
  onCommit,
  placeholder = DEFAULT_PLACEHOLDER,
  inputClassName,
  ...rest
}: TimeFieldProps) {
  const formatted = formatTime(value);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState<string | null>(null);

  // Reset when a different date arrives — a new selection, or the store's own
  // rewrite of what was just committed. Never on a keystroke.
  useEffect(() => {
    setDraft(formatted);
    setError(null);
  }, [formatted]);

  const commit = () => {
    const trimmed = draft.trim();
    // Nothing typed, or nothing changed. A date cannot be *removed* — §2.2 is
    // explicit that there is no undated state and none is needed — so an empty
    // box reverts rather than clearing anything.
    if (trimmed.length === 0 || trimmed === formatted) {
      setDraft(formatted);
      setError(null);
      return;
    }

    const parsed = parseTime(trimmed);
    if (!parsed.ok) {
      // The parser's own reason, not a generic one: it distinguishes "31 June"
      // from "could not read this at all", and the difference is what tells the
      // user whether to fix the date or the phrasing.
      setError(parsed.reason);
      return;
    }
    setError(null);
    onCommit(parsed.value);
  };

  return (
    <Field
      {...rest}
      {...(label !== undefined ? { label } : {})}
      value={draft}
      error={error}
      onChange={(change) => setDraft(change.target.value)}
      onBlur={commit}
      onKeyDown={(keyed) => {
        if (keyed.key === 'Enter') commit();
        if (keyed.key === 'Escape') {
          // Claimed, so reverting the field does not also close the pane (§6.4).
          keyed.preventDefault();
          setDraft(formatted);
          setError(null);
        }
      }}
      placeholder={placeholder}
      inputClassName={`tabular-nums ${inputClassName ?? ''}`}
    />
  );
}
