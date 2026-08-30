import { useMemo, useRef, useState } from 'react';
import { packRecords, summarise, uninstallImpact } from '../core/packs';
import type { PackBundle } from '../core/packs';
import { CATALOGUE } from '../packs';
import { useTimeline } from '../state/timeline-store';
import { Button, plural } from './controls';
import { useOnEscape } from './use-escape';
import { useFocusTrap } from './use-focus-trap';

/**
 * Installing and removing packs (docs/design.md §5).
 *
 * The panel leads with the semantic point rather than hiding it in a tooltip:
 * installed content is drawn desaturated and can be excluded from the mass,
 * because if the Second World War is pre-loaded the density plot stops meaning
 * "what I know". Users who do not know that will read the timeline wrongly.
 *
 * Uninstall is confirmed inline, and says how many records will go, because
 * anything adopted stays and anything not adopted does not — a count is the only
 * honest way to say which is which.
 */
export function PackPanel({ onClose }: { onClose: () => void }) {
  const timeline = useTimeline((state) => state.timeline);
  const installPack = useTimeline((state) => state.installPack);
  const removePack = useTimeline((state) => state.removePack);
  const includePacks = useTimeline((state) => state.filter.includePacks);
  const setIncludePacks = useTimeline((state) => state.setIncludePacks);

  const panelRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useFocusTrap(panelRef);
  useOnEscape(onClose);

  const summaries = useMemo(() => summarise(timeline, CATALOGUE), [timeline]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="packs"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg
                   border border-line bg-ink shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-paper">packs</h2>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-paper-dim">
              Canonical content, opt-in. Pack events are drawn dimmer than yours and can be left
              out of the mass entirely — because if the Second World War arrives pre-loaded, the
              density stops meaning <em>what I know</em>. Editing or connecting a pack event
              adopts it as your own, and adopted events survive uninstalling.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="close packs"
            className="inline-flex min-h-11 items-center rounded px-1.5 text-paper-dim
                       hover:text-paper sm:min-h-0"
          >
            ×
          </button>
        </header>

        {/*
          A toggle rather than a checkbox, and the same control as the one in the
          filter bar: the box measured thirteen pixels square on a phone, which
          is not a target — and a pressed button says its own state without a
          label to parse (§7.1).
        */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-xs text-paper-dim">
          <button
            onClick={() => setIncludePacks(!includePacks)}
            aria-pressed={includePacks}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3
                        text-[11px] sm:min-h-0 sm:px-2.5 sm:py-0.5 ${
                          includePacks
                            ? 'border-accent text-paper'
                            : 'border-line text-paper-dim hover:border-paper-dim'
                        }`}
          >
            in the mass
          </button>
          <span>pack events count towards the density, and towards the views</span>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
          {summaries.map(({ bundle, installed, upgradable, events, eras, connections }) => {
            const owned = installed ? packRecords(timeline, bundle.id) : null;
            const adopted = installed ? events - (owned?.events.length ?? 0) : 0;
            const impact = installed ? uninstallImpact(timeline, bundle.id) : null;

            return (
              <li key={bundle.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm text-paper">{bundle.name}</h3>
                  <span className="shrink-0 text-[11px] tabular-nums text-paper-dim">
                    {plural(events, 'event')} · {plural(connections, 'connection')} ·{' '}
                    {plural(eras, 'era')}
                  </span>
                </div>

                {bundle.description && (
                  <p className="text-xs leading-relaxed text-paper-soft">{bundle.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-paper-dim">
                  <span>
                    v{bundle.version} · {bundle.license}
                  </span>
                  {installed && (
                    <span>
                      installed {installed.installed_at.slice(0, 10)}
                      {adopted > 0 && ` · ${adopted} adopted`}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!installed && (
                    <Button onClick={() => installPack(bundle)}>install</Button>
                  )}

                  {installed && upgradable && (
                    <Button onClick={() => installPack(bundle)}>
                      update to v{bundle.version}
                    </Button>
                  )}

                  {installed && confirming !== bundle.id && (
                    <Button
                      onClick={() => setConfirming(bundle.id)}
                      className="enabled:hover:border-[#e66767] enabled:hover:text-[#e66767]"
                    >
                      uninstall
                    </Button>
                  )}

                  {installed && confirming === bundle.id && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {/*
                        The count of the user's own connections is the one that
                        matters: pack content comes back with a click, and a note
                        somebody wrote about why two things belong together does
                        not. It is said separately, and said as "hidden", because
                        those are tombstoned rather than deleted.
                      */}
                      <span className="text-paper-soft">
                        removes {plural(impact?.events ?? 0, 'event')}
                        {(impact?.packConnections ?? 0) > 0 &&
                          ` and ${impact?.packConnections} of its connections`}
                        {adopted > 0 && `, keeps the ${adopted} you adopted`}
                        {(impact?.ownConnections ?? 0) > 0 &&
                          `, and hides ${plural(
                            impact?.ownConnections ?? 0,
                            'connection',
                          )} of your own that led into it`}
                      </span>
                      <Button
                        variant="danger"
                        onClick={() => {
                          removePack(bundle.id);
                          setConfirming(null);
                        }}
                      >
                        remove
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirming(null)}>
                        cancel
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="border-t border-line px-5 py-2 text-[11px] text-paper-dim">
          Packs ship inside the app — installing one makes no network request (D25).
        </footer>
      </div>
    </div>
  );
}

/** Bundles offered on first run (D26), by id. */
export const FIRST_RUN_PACKS: readonly PackBundle[] = CATALOGUE;
