import { useMemo, useRef, useState } from 'react';
import type { Id, TagKind } from '../core/model/types';
import { normaliseTagName } from '../core/model/builtin-tags';
import { useTimeline } from '../state/timeline-store';
import { useTagNames } from '../state/tag-names';

/**
 * An event's tags, as something you can change (docs/design.md §6.2).
 *
 * The chips were read-only, which made the pane a receipt for what quick-add had
 * understood rather than an editor: a mistyped `#warr` could be seen and not
 * fixed, and a tag thought of afterwards could not be added at all.
 *
 * The suggestions are grouped by kind — regions, themes, yours — since the
 * vocabulary is otherwise thirty flat words with no hint of which are which.
 *
 * Everything is emitted as **names**, never ids: `ensureTags` owns what a word
 * means (D20, D44), and a component that resolved ids itself would be a second
 * answer to that question living next to the first.
 */
export interface TagEditorProps {
  tags: readonly Id[];
  onChange: (names: string[]) => void;
}

const GROUPS: { kind: TagKind; label: string }[] = [
  { kind: 'region', label: 'regions' },
  { kind: 'theme', label: 'themes' },
  { kind: 'user', label: 'yours' },
];

/** How many suggestions are worth showing above a three-hundred-pixel pane. */
const MAX_SUGGESTIONS = 8;

export function TagEditor({ tags, onChange }: TagEditorProps) {
  const allTags = useTimeline((state) => state.timeline.tags);
  const names = useTagNames();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * An id with no tag record behind it is dropped rather than shown.
   *
   * It cannot survive a round trip through names anyway, and it is invisible
   * everywhere else in the app already — the filter bar and the rolled-up counts
   * both work from `timeline.tags`. Showing a raw uuid as a chip would be the
   * only place in the interface where one appears.
   */
  const applied = useMemo(
    () =>
      tags.flatMap((id) => {
        const name = names.get(id);
        return name === undefined ? [] : [{ id, name }];
      }),
    [tags, names],
  );

  const currentNames = applied.map((tag) => tag.name);
  const taken = new Set(applied.map((tag) => normaliseTagName(tag.name)));
  const normalisedQuery = normaliseTagName(query);

  const suggestions = useMemo(() => {
    if (!open) return [];
    const matches = allTags
      .filter((tag) => !taken.has(normaliseTagName(tag.name)))
      .filter(
        (tag) =>
          normalisedQuery.length === 0 || normaliseTagName(tag.name).includes(normalisedQuery),
      );

    const grouped = GROUPS.flatMap(({ kind, label }) => {
      const group = matches
        .filter((tag) => tag.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
      return group.length === 0 ? [] : [{ label, tags: group }];
    });

    // Trimmed to a paneful, in the order the groups are listed.
    let left = MAX_SUGGESTIONS;
    const trimmed: { label: string; tags: typeof allTags }[] = [];
    for (const group of grouped) {
      if (left <= 0) break;
      trimmed.push({ label: group.label, tags: group.tags.slice(0, left) });
      left -= Math.min(group.tags.length, left);
    }
    return trimmed;
  }, [open, allTags, normalisedQuery, tags, names]);

  /** The suggestions as one flat list, which is what the cursor moves over. */
  const flat = suggestions.flatMap((group) => group.tags);
  /*
   * Typing a word no existing tag answers to offers to make one. Without the
   * row, Enter would silently either pick a near-match or do nothing, and which
   * of the two it did would depend on the vocabulary rather than on the input.
   */
  const inventing =
    normalisedQuery.length > 0 &&
    !allTags.some((tag) => normaliseTagName(tag.name) === normalisedQuery) &&
    !taken.has(normalisedQuery);
  const rowCount = flat.length + (inventing ? 1 : 0);
  const active = Math.min(cursor, Math.max(rowCount - 1, 0));

  const add = (name: string) => {
    if (name.trim().length === 0) return;
    onChange([...currentNames, name]);
    setQuery('');
    setCursor(0);
    inputRef.current?.focus();
  };

  const remove = (name: string) => {
    onChange(currentNames.filter((current) => current !== name));
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  };

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {applied.map(({ id, name }) => {
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded bg-line/60 py-0.5 pl-1.5 pr-0.5
                         text-xs text-paper-soft"
            >
              {name}
              <button
                onClick={() => remove(name)}
                aria-label={`remove ${name}`}
                className="inline-flex size-4 items-center justify-center rounded text-paper-dim
                           hover:bg-line hover:text-paper"
              >
                ×
              </button>
            </span>
          );
        })}

        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              queueMicrotask(() => inputRef.current?.focus());
            }}
            className="rounded border border-dashed border-line px-1.5 py-0.5 text-xs
                       text-paper-dim hover:border-paper-dim hover:text-paper"
          >
            + tag
          </button>
        )}
      </div>

      {open && (
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={(change) => {
              setQuery(change.target.value);
              setCursor(0);
            }}
            onBlur={close}
            onKeyDown={(keyed) => {
              if (keyed.key === 'Escape') {
                // Claimed, so closing the box does not also close the pane (§6.4).
                keyed.preventDefault();
                close();
                return;
              }
              if (keyed.key === 'ArrowDown' || keyed.key === 'ArrowUp') {
                if (rowCount === 0) return;
                keyed.preventDefault();
                const step = keyed.key === 'ArrowDown' ? 1 : rowCount - 1;
                setCursor((current) => (Math.min(current, rowCount - 1) + step) % rowCount);
                return;
              }
              if (keyed.key === 'Enter') {
                keyed.preventDefault();
                const chosen = flat[active];
                if (chosen) add(chosen.name);
                else if (inventing) add(query.trim());
                return;
              }
              // A comma is how tags are separated everywhere else they are
              // written down, so it commits rather than landing in the name.
              if (keyed.key === ',') {
                keyed.preventDefault();
                if (inventing) add(query.trim());
              }
            }}
            placeholder="region, theme, or a word of your own"
            aria-label="add a tag"
            className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-paper
                       placeholder:text-paper-dim focus:border-accent focus:outline-none"
          />

          {rowCount > 0 && (
            <ul
              className="absolute left-0 top-full z-10 mt-1 max-h-56 w-full overflow-y-auto
                         rounded border border-line bg-surface py-1 text-xs shadow-lg"
            >
              {suggestions.map((group) => (
                <li key={group.label}>
                  <p className="px-2 py-0.5 text-[11px] text-paper-faint">{group.label}</p>
                  <ul>
                    {group.tags.map((tag) => {
                      const index = flat.indexOf(tag);
                      return (
                        <li key={tag.id}>
                          <button
                            // Kept out of the input's blur: a mousedown that
                            // moves focus closes the box before the click lands.
                            onMouseDown={(pressed) => pressed.preventDefault()}
                            onClick={() => add(tag.name)}
                            className={`flex w-full items-center gap-1.5 px-2 py-1 text-left
                                        ${index === active ? 'bg-line text-paper' : 'text-paper-soft hover:bg-line/50'}`}
                          >
                            {tag.color && (
                              <span
                                aria-hidden
                                className="size-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            {tag.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}

              {inventing && (
                <li>
                  <button
                    onMouseDown={(pressed) => pressed.preventDefault()}
                    onClick={() => add(query.trim())}
                    className={`flex w-full items-center gap-1 px-2 py-1 text-left
                                ${
                                  active === flat.length
                                    ? 'bg-line text-paper'
                                    : 'text-paper-soft hover:bg-line/50'
                                }`}
                  >
                    <span className="text-paper-dim">+</span>
                    {query.trim()}
                    <span className="text-paper-faint">— a new tag</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
