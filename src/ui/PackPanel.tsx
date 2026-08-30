import { useMemo, useState } from 'react';
import { packRecords, summarise, uninstallImpact } from '../core/packs';
import type { PackBundle } from '../core/packs';
import { CATALOGUE } from '../packs';
import { useTimeline } from '../state/timeline-store';

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

  const [confirming, setConfirming] = useState<string | null>(null);
  const summaries = useMemo(() => summarise(timeline, CATALOGUE), [timeline]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Packs"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg
                   border border-line bg-ink shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-paper">Packs</h2>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-paper-dim">
              Canonical content, opt-in. Pack events are drawn dimmer than yours and can be left
              out of the mass entirely — because if the Second World War arrives pre-loaded, the
              density stops meaning <em>what I know</em>. Editing or connecting a pack event
              adopts it as your own, and adopted events survive uninstalling.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close packs"
            className="rounded px-1.5 text-paper-dim hover:text-paper"
          >
            ×
          </button>
        </header>

        <label className="flex items-center gap-2 border-b border-line px-5 py-2 text-xs text-paper-dim">
          <input
            type="checkbox"
            checked={includePacks}
            onChange={(change) => setIncludePacks(change.target.checked)}
            className="accent-accent"
          />
          count pack events in the mass and the views
        </label>

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
                    {events} events · {connections} connections · {eras} eras
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
                    <Action onClick={() => installPack(bundle)}>install</Action>
                  )}

                  {installed && upgradable && (
                    <Action onClick={() => installPack(bundle)}>
                      update to v{bundle.version}
                    </Action>
                  )}

                  {installed && confirming !== bundle.id && (
                    <button
                      onClick={() => setConfirming(bundle.id)}
                      className="rounded border border-line px-2 py-1 text-xs text-paper-dim
                                 hover:border-[#e66767] hover:text-[#e66767]"
                    >
                      uninstall
                    </button>
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
                        removes {impact?.events ?? 0} events
                        {(impact?.packConnections ?? 0) > 0 &&
                          ` and ${impact?.packConnections} of its connections`}
                        {adopted > 0 && `, keeps the ${adopted} you adopted`}
                        {(impact?.ownConnections ?? 0) > 0 &&
                          `, and hides ${impact?.ownConnections} connection${
                            impact?.ownConnections === 1 ? '' : 's'
                          } of your own that led into it`}
                      </span>
                      <button
                        onClick={() => {
                          removePack(bundle.id);
                          setConfirming(null);
                        }}
                        className="rounded border border-[#e66767] px-2 py-1 text-[#e66767]
                                   hover:bg-[#e66767]/10"
                      >
                        remove
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="px-1 text-paper-dim hover:text-paper"
                      >
                        cancel
                      </button>
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

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-line px-2 py-1 text-xs text-paper-soft
                 hover:border-accent hover:text-paper"
    >
      {children}
    </button>
  );
}

/** Bundles offered on first run (D26), by id. */
export const FIRST_RUN_PACKS: readonly PackBundle[] = CATALOGUE;
