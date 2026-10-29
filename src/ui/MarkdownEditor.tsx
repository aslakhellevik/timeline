import { useId, useMemo, useState } from 'react';
import { renderMarkdown } from '../core/markdown';
import { useDraft } from './use-draft';

/**
 * Write / read on one field.
 *
 * Two tabs rather than a live side-by-side preview, because the pane is three
 * hundred pixels wide and half of that is not an editor. The default lands on
 * whichever mode the content implies: an empty note wants a cursor, a written
 * one wants to be read.
 *
 * The HTML comes from `core/markdown`, which escapes its input before parsing
 * and emits a fixed set of tags — see the file for why that is the whole of the
 * sanitisation story.
 *
 * The initial mode is read **once**, so the caller must key this on whatever it
 * is editing; every one of them now keys the whole pane. Without that the mode
 * is sticky across selections, and the symptom is specific: read one event's
 * note and the next event without one opens on an empty preview beside a
 * `write` tab that is disabled — a pane that cannot be typed into and shows
 * nothing.
 */
export interface MarkdownEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder,
  rows = 8,
  autoFocus = false,
}: MarkdownEditorProps) {
  const [chosen, setChosen] = useState<'write' | 'read'>(
    value.trim().length > 0 && !autoFocus ? 'read' : 'write',
  );
  // A note is committed when the typing stops, not per keystroke (§5.5) — see
  // `use-draft` for what was wrong with a database write per character.
  const draft = useDraft(value, onChange);
  const id = useId();

  /*
   * Read is only a mode when there is something to read, and the tab that is
   * *selected* is never the disabled one. Emptying a note used to leave the
   * pane in read mode with its own tab greyed out and nothing but a border on
   * screen: a selected tab that cannot be selected is not a state, it is a bug
   * with an outline round it.
   */
  const readable = draft.value.trim().length > 0;
  const mode = chosen === 'read' && !readable ? 'write' : chosen;

  // The draft, not the stored value: switching to read before the debounce has
  // fired would otherwise preview the previous sentence.
  const html = useMemo(
    () => (mode === 'read' ? renderMarkdown(draft.value) : ''),
    [mode, draft.value],
  );

  /*
   * Two fixes to the same mistake: the tabs were not wired to anything.
   *
   * `role="tab"` without `aria-controls` and without a `tabpanel` to point at is
   * a button announced as a tab that governs nothing, and the `<label htmlFor>`
   * addressed a textarea that does not exist in read mode — so in the mode where
   * the field is *read*, its name pointed at nothing at all. Both modes now sit
   * inside one panel: the tabs control it, and the label names whichever of the
   * two is in it.
   */
  const panelId = `${id}-panel`;
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={mode === 'write' ? id : undefined}
          id={`${id}-label`}
          className="text-xs text-paper-dim"
        >
          {label}
        </label>
        <div className="flex gap-1" role="tablist" aria-label={`${label} mode`}>
          {(['write', 'read'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              id={`${id}-tab-${option}`}
              aria-selected={mode === option}
              aria-controls={panelId}
              onClick={() => {
                // Leaving the textarea commits what is in it, so the preview is
                // of the note as saved rather than of a draft nothing has seen.
                draft.flush();
                setChosen(option);
              }}
              disabled={option === 'read' && !readable}
              className={`rounded px-1.5 py-0.5 text-[11px] disabled:opacity-30 ${
                mode === option ? 'bg-line text-paper' : 'text-paper-dim hover:text-paper'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${id}-tab-${mode}`}
        className="flex flex-col"
      >
        {mode === 'write' ? (
          <textarea
            id={id}
            value={draft.value}
            onChange={(change) => draft.onChange(change.target.value)}
            onBlur={draft.flush}
            rows={rows}
            autoFocus={autoFocus}
            placeholder={placeholder}
            className="resize-y rounded border border-line bg-surface px-2 py-1.5 font-mono text-[13px]
                       leading-relaxed text-paper placeholder:text-paper-dim
                       focus:border-accent focus:outline-none"
          />
        ) : (
          <div
            aria-labelledby={`${id}-label`}
            className="prose-note min-h-24 rounded border border-line/60 bg-surface/60 px-2 py-1.5
                       text-sm text-paper-soft"
            // Safe by construction: see core/markdown.ts. No input path produces
            // markup; the tags below are the ones that module emits itself.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </section>
  );
}
