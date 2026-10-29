import { useMemo, useState } from 'react';
import type { TagKind } from '../core/model/types';
import { tagUsage } from '../core/filter';
import { useTimeline } from '../state/timeline-store';
import { plural } from './controls';

/**
 * Tag filtering (docs/design.md §3.5).
 *
 * The point is not the control but what it does to the canvas: "switching from
 * 'all' to 'history of ideas' visibly redistributes the weight of the timeline."
 * So the counts shown here are rolled-up counts (D14) — the number filtering by
 * that tag would actually reveal, not the number carrying it directly — because
 * offering "Europe · 3" and then showing thirty is a lie told every time.
 *
 * Unused premade tags are hidden behind a toggle. There are thirty-odd of them
 * and a wall of zeroes is not a filter, it is a catalogue.
 */
const GROUPS: { kind: TagKind; label: string }[] = [
  { kind: 'region', label: 'regions' },
  { kind: 'theme', label: 'themes' },
  { kind: 'user', label: 'yours' },
];

export function FilterBar({ onAddLife }: { onAddLife?: () => void }) {
  const timeline = useTimeline((state) => state.timeline);
  const filter = useTimeline((state) => state.filter);
  const toggleTag = useTimeline((state) => state.toggleTag);
  const clearTags = useTimeline((state) => state.clearTags);

  const [showUnused, setShowUnused] = useState(false);
  // Collapsed on a phone, where thirty tags is five rows and most of the screen.
  // Always open from `sm` up, where they cost one row and save a tap.
  const [expanded, setExpanded] = useState(false);

  const usage = useMemo(() => tagUsage(timeline), [timeline]);

  const selected = new Set(filter.tags);
  const visible = usage.filter((entry) => entry.total > 0 || selected.has(entry.tag.id));
  const hidden = usage.length - visible.length;
  /*
   * The frame of reference, or the offer to make one (§9, D26).
   *
   * Skipping the birth-year question now creates nothing rather than inventing a
   * year, so the app has to leave the offer somewhere — and this row, which is
   * about what the canvas is showing, is where it belongs. Any personal era
   * counts: someone who drew their own is not missing anything.
   */
  const hasLife = timeline.eras.some((era) => era.kind === 'personal' && !era.deleted_at);

  if (usage.length === 0) return null;

  const shown = showUnused ? usage : visible;

  return (
    <section
      aria-label="Filter by tag"
      className="flex items-start gap-3 border-b border-line px-4 py-1.5"
    >
      {/*
        The only route to filtering on a phone, and it measured 27×17 — so the
        hit area is a real one even though the word stays small (§7.1).
      */}
      <button
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="inline-flex min-h-11 shrink-0 items-center pr-1 text-[11px] text-paper-dim
                   hover:text-paper sm:hidden"
      >
        {filter.tags.length > 0 ? `filters · ${filter.tags.length}` : 'filters'}
      </button>

      <div
        className={`min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:flex ${
          expanded ? 'flex' : 'hidden'
        }`}
      >
        {GROUPS.map(({ kind, label }) => {
          const group = shown
            .filter((entry) => entry.tag.kind === kind)
            .sort((a, b) => b.total - a.total || a.tag.name.localeCompare(b.tag.name, 'en-GB'));
          if (group.length === 0) return null;

          return (
            <div key={kind} className="flex flex-wrap items-center gap-1">
              {/* Lower case, and the faint token rather than a fade of the dim
                  one: at ten pixels the alpha measured 3.2:1 (§6.2). */}
              <span className="mr-0.5 text-[11px] tracking-wide text-paper-faint">{label}</span>
              {group.map(({ tag, total }) => {
                const on = selected.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={on}
                    title={`${tag.name} — ${plural(total, 'event')}`}
                    className={`flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-0.5
                      text-[11px] sm:min-h-0 sm:px-2
                      ${
                        on
                          ? 'border-transparent text-ink'
                          : 'border-line text-paper-soft hover:border-paper-dim'
                      }`}
                    style={on ? { backgroundColor: tag.color ?? '#c3c2b7' } : undefined}
                  >
                    {/* A dot rather than a coloured label: the canvas uses these
                        colours for arcs and eras, and the two should agree. */}
                    {!on && tag.color && (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    {tag.name}
                    <span className={on ? 'opacity-70' : 'text-paper-dim'}>{total}</span>
                  </button>
                );
              })}
            </div>
          );
        })}

        {hidden > 0 && (
          <button
            onClick={() => setShowUnused((current) => !current)}
            className="inline-flex min-h-8 items-center text-[11px] text-paper-dim
                       hover:text-paper sm:min-h-0"
          >
            {showUnused ? 'hide unused' : `+${hidden} unused`}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {!hasLife && onAddLife && (
          <button
            onClick={onAddLife}
            className="inline-flex min-h-11 items-center whitespace-nowrap text-[11px]
                       text-paper-dim underline decoration-line underline-offset-2
                       hover:text-paper sm:min-h-0"
          >
            add my life
          </button>
        )}
        {filter.tags.length > 0 && (
          <button
            onClick={clearTags}
            className="inline-flex min-h-11 items-center text-[11px] text-paper-dim
                       hover:text-paper sm:min-h-0"
          >
            clear ({filter.tags.length})
          </button>
        )}
      </div>
    </section>
  );
}
