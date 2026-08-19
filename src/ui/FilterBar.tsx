import { useMemo, useState } from 'react';
import type { TagKind } from '../core/model/types';
import { tagUsage } from '../core/filter';
import { useTimeline } from '../state/timeline-store';

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

export function FilterBar() {
  const timeline = useTimeline((state) => state.timeline);
  const filter = useTimeline((state) => state.filter);
  const toggleTag = useTimeline((state) => state.toggleTag);
  const clearTags = useTimeline((state) => state.clearTags);
  const setIncludePacks = useTimeline((state) => state.setIncludePacks);

  const [showUnused, setShowUnused] = useState(false);

  const usage = useMemo(
    () => tagUsage(timeline, filter.includePacks),
    [timeline, filter.includePacks],
  );

  const selected = new Set(filter.tags);
  const hasPacks = timeline.events.some((event) => event.pack);
  const visible = usage.filter((entry) => entry.total > 0 || selected.has(entry.tag.id));
  const hidden = usage.length - visible.length;

  if (usage.length === 0) return null;

  const shown = showUnused ? usage : visible;

  return (
    <section
      aria-label="Filter by tag"
      className="flex items-start gap-3 border-b border-line px-4 py-1.5"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {GROUPS.map(({ kind, label }) => {
          const group = shown
            .filter((entry) => entry.tag.kind === kind)
            .sort((a, b) => b.total - a.total || a.tag.name.localeCompare(b.tag.name, 'en-GB'));
          if (group.length === 0) return null;

          return (
            <div key={kind} className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[10px] uppercase tracking-wide text-paper-dim/70">
                {label}
              </span>
              {group.map(({ tag, total }) => {
                const on = selected.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={on}
                    title={`${tag.name} — ${total} event${total === 1 ? '' : 's'}`}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]
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
            className="text-[11px] text-paper-dim hover:text-paper"
          >
            {showUnused ? 'hide unused' : `+${hidden} unused`}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 pt-0.5">
        {hasPacks && (
          <label className="flex items-center gap-1.5 text-[11px] text-paper-dim">
            <input
              type="checkbox"
              checked={filter.includePacks}
              onChange={(change) => setIncludePacks(change.target.checked)}
              className="accent-accent"
            />
            packs
          </label>
        )}
        {filter.tags.length > 0 && (
          <button onClick={clearTags} className="text-[11px] text-paper-dim hover:text-paper">
            clear ({filter.tags.length})
          </button>
        )}
      </div>
    </section>
  );
}
