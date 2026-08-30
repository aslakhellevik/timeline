import { useMemo } from 'react';
import type { Era } from '../core/model/types';
import { useTimeline } from '../state/timeline-store';
import { DetailPane } from './DetailPane';
import { MarkdownEditor } from './MarkdownEditor';
import { TimeField } from './TimeField';
import { Button, Field } from './controls';
import { useDraft } from './use-draft';

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
 * that cannot express any of them. That field is now `TimeField`, shared with
 * the event pane, which is where it had been about to be copied to.
 */
export function EraDetail() {
  const timeline = useTimeline((state) => state.timeline);
  const selectedEraId = useTimeline((state) => state.selectedEraId);

  const era = useMemo(
    () => timeline.eras.find((candidate) => candidate.id === selectedEraId) ?? null,
    [timeline.eras, selectedEraId],
  );

  if (!era) return null;
  // Keyed for the reason the event pane is: the drafts inside belong to this
  // era, and the note editor's mode belongs to this era's note.
  return <EraPane key={era.id} era={era} />;
}

function EraPane({ era }: { era: Era }) {
  const selectEra = useTimeline((state) => state.selectEra);
  const updateEra = useTimeline((state) => state.updateEra);
  const deleteEra = useTimeline((state) => state.deleteEra);

  const name = useDraft(era.name, (value) => {
    // A nameless era is a coloured band with nothing to say; reverting is
    // kinder than storing the blank.
    if (value.trim().length > 0) updateEra(era.id, { name: value.trim() });
  });

  return (
    <DetailPane label="era" onClose={() => selectEra(null)}>
      <Field
        label="name"
        value={name.value}
        onChange={(change) => name.onChange(change.target.value)}
        onBlur={name.flush}
      />

      <TimeField
        label="span"
        value={era.when}
        onCommit={(when) => updateEra(era.id, { when })}
        placeholder="1837–1901 · the 1960s · c. 1900"
      />

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
        <p className="text-[11px] text-paper-faint">
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

      <Button
        variant="quiet"
        onClick={() => deleteEra(era.id)}
        className="mt-auto self-start rounded border border-line px-2 hover:border-[#e66767]
                   hover:text-[#e66767]"
      >
        delete era
      </Button>
    </DetailPane>
  );
}
