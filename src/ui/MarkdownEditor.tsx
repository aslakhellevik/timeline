import { useId, useMemo, useState } from 'react';
import { renderMarkdown } from '../core/markdown';

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
  const [mode, setMode] = useState<'write' | 'read'>(
    value.trim().length > 0 && !autoFocus ? 'read' : 'write',
  );
  const id = useId();
  const html = useMemo(() => (mode === 'read' ? renderMarkdown(value) : ''), [mode, value]);

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
              onClick={() => setMode(option)}
              disabled={option === 'read' && value.trim().length === 0}
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
            value={value}
            onChange={(change) => onChange(change.target.value)}
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
