import { useEffect, useMemo, useState } from 'react';
import { formatTime, parseTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';
import { MarkdownEditor } from './MarkdownEditor';

/**
 * An era's detail (docs/design.md D15).
 *
 * Eras are the personal frame of reference — "an event is not just in 1847, it
 * is during your great-grandmother's childhood" — so the editable fields are the
 * name, the span, and which kind it is. `personal` is not cosmetic: personal
 * eras survive every filter (§3.5) and take the lanes nearest the axis.
 *
 * The span is edited as text through the same parser quick-add uses, so
 * `1837–1901`, `c. 1900` and `the 1960s` all work here without a date picker
 * that cannot express any of them.
 */
export function EraDetail() {
  const timeline = useTimeline((state) => state.timeline);
  const selectedEraId = useTimeline((state) => state.selectedEraId);
  const selectEra = useTimeline((state) => state.selectEra);
  const updateEra = useTimeline((state) => state.updateEra);
  const deleteEra = useTimeline((state) => state.deleteEra);

  const era = useMemo(
    () => timeline.eras.find((candidate) => candidate.id === selectedEraId) ?? null,
    [timeline.eras, selectedEraId],
  );

  const [span, setSpan] = useState('');
  const [spanError, setSpanError] = useState<string | null>(null);

  // Reset the draft when a different era is opened, not on every keystroke.
  useEffect(() => {
    setSpan(era ? formatTime(era.when) : '');
    setSpanError(null);
  }, [era?.id, era?.when]);

  if (!era) return null;

  const commitSpan = () => {
    const trimmed = span.trim();
    if (trimmed.length === 0 || trimmed === formatTime(era.when)) {
      setSpanError(null);
      return;
    }
    const parsed = parseTime(trimmed);
    if (!parsed.ok) {
      // The parser's own reason, not a generic one: it distinguishes "31 June"
      // from "could not read this at all", and the difference is what tells the
      // user whether to fix the date or the phrasing.
      setSpanError(parsed.reason);
      return;
    }
    setSpanError(null);
    updateEra(era.id, { when: parsed.value });
  };

  return (
    <aside
      aria-label="Era detail"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-paper-dim">era</h2>
        <button
          onClick={() => selectEra(null)}
          aria-label="Close era"
          className="rounded px-1.5 text-paper-dim hover:text-paper"
        >
          ×
        </button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-paper-dim">
        name
        <input
          value={era.name}
          onChange={(change) => updateEra(era.id, { name: change.target.value })}
          className="rounded border border-line bg-surface px-2 py-1 text-sm text-paper
                     focus:border-accent focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-paper-dim">
        span
        <input
          value={span}
          onChange={(change) => setSpan(change.target.value)}
          onBlur={commitSpan}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSpan();
            if (event.key === 'Escape') setSpan(formatTime(era.when));
          }}
          placeholder="1837–1901 · the 1960s · c. 1900"
          className={`rounded border bg-surface px-2 py-1 text-sm tabular-nums text-paper
                      placeholder:text-paper-dim/60 focus:outline-none
                      ${spanError ? 'border-[#e66767]' : 'border-line focus:border-accent'}`}
        />
        {spanError && <span className="text-[11px] text-[#e66767]">{spanError}</span>}
      </label>

      {/*
        Personal versus canonical decides whether the era survives a tag filter
        and where it sits, so it is a real choice rather than metadata.
      */}
      <fieldset className="flex flex-col gap-1 text-xs text-paper-dim">
        <legend className="mb-1">kind</legend>
        <div className="flex gap-1">
          {(['personal', 'canonical'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => updateEra(era.id, { kind })}
              aria-pressed={era.kind === kind}
              className={`rounded px-2 py-0.5 text-[11px] ${
                era.kind === kind ? 'bg-line text-paper' : 'text-paper-dim hover:text-paper'
              }`}
            >
              {kind}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-paper-dim/80">
          {era.kind === 'personal'
            ? 'always visible, whatever the tag filter, and drawn nearest the axis'
            : 'filtered by its own tags, like everything else'}
        </p>
      </fieldset>

      <MarkdownEditor
        label="notes"
        value={era.notes ?? ''}
        onChange={(notes) => updateEra(era.id, { notes })}
        rows={6}
      />

      <button
        onClick={() => deleteEra(era.id)}
        className="mt-auto self-start rounded border border-line px-2 py-1 text-xs
                   text-paper-dim hover:border-[#e66767] hover:text-[#e66767]"
      >
        delete era
      </button>
    </aside>
  );
}
