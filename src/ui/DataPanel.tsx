import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  backupStatus,
  chooseBackupFolder,
  downloadExport,
  mergeDocument,
  parseDocument,
  persistenceState,
  requestBackupPermission,
  requestPersistence,
  storageEstimate,
  writeSnapshot,
} from '../store';
import type { BackupStatus, PersistenceResult, StorageEstimateResult } from '../store';
import { useTimeline } from '../state/timeline-store';

/**
 * The three durability layers, made visible (docs/design.md §8.3).
 *
 * This panel exists because the honest failure mode of local-first is "cleared
 * browsing data, years of work gone", and the mitigations are worthless if the
 * user never finds them. Each section is one layer, in the order that matters.
 */
export function DataPanel({ onClose }: { onClose: () => void }) {
  const timeline = useTimeline((state) => state.timeline);
  const replaceTimeline = useTimeline((state) => state.replaceTimeline);
  const flush = useTimeline((state) => state.flush);

  const [persistence, setPersistence] = useState<PersistenceResult | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimateResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    // `persistenceState`, not `requestPersistence` — opening settings should
    // report the state, never prompt.
    setPersistence(await persistenceState());
    setBackup(await backupStatus());
    setEstimate(await storageEstimate());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onImport = async (file: File) => {
    try {
      const incoming = parseDocument(await file.text());
      const merged = mergeDocument(timeline, incoming);
      replaceTimeline(merged.timeline);
      const { events, connections, tags, eras } = merged.stats;
      const added = events.added + connections.added + tags.added + eras.added;
      const updated = events.updated + connections.updated + tags.updated + eras.updated;
      const skipped = events.skipped + connections.skipped + tags.skipped + eras.skipped;
      setNote(`imported — ${added} added, ${updated} updated, ${skipped} left alone`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'could not read that file');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your data"
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-6"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded border border-line bg-surface p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-paper">Your data</h2>
            <p className="mt-1 text-xs leading-relaxed text-paper-dim">
              Everything lives in this browser. Nothing is sent anywhere. That also means clearing
              your browsing data would delete it — so keep a copy somewhere real.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="px-1.5 text-paper-dim hover:text-paper">
            ×
          </button>
        </div>

        <Section title="Keep it from being evicted">
          <p className="text-xs text-paper-dim">{persistence?.message ?? 'checking…'}</p>
          {persistence && !persistence.persisted && persistence.supported && (
            <Action
              onClick={async () => {
                setPersistence(await requestPersistence());
              }}
            >
              ask the browser to keep it
            </Action>
          )}
        </Section>

        <Section title="Back up to a folder">
          <p className="text-xs text-paper-dim">{backup?.message ?? 'checking…'}</p>
          {backup?.supported && (
            <div className="flex flex-wrap gap-2">
              <Action
                onClick={async () => {
                  const chosen = await chooseBackupFolder();
                  setNote(chosen.ok ? `backing up to ${chosen.name}` : chosen.message);
                  await refresh();
                }}
              >
                {backup.folder ? 'change folder' : 'choose a folder'}
              </Action>
              {backup.folder && (
                <>
                  {backup.permission !== 'granted' && (
                    <Action
                      onClick={async () => {
                        await requestBackupPermission();
                        await refresh();
                      }}
                    >
                      allow access
                    </Action>
                  )}
                  <Action
                    onClick={async () => {
                      await flush();
                      const result = await writeSnapshot(timeline);
                      setNote(result.ok ? `saved ${result.filename}` : result.message);
                      await refresh();
                    }}
                  >
                    back up now
                  </Action>
                </>
              )}
            </div>
          )}
        </Section>

        <Section title="Export and import">
          <p className="text-xs text-paper-dim">
            A single JSON file with everything in it. Importing merges by record rather than
            replacing, so restoring an old backup never discards newer work.
          </p>
          <div className="flex flex-wrap gap-2">
            <Action
              onClick={async () => {
                await flush();
                const result = await downloadExport(timeline);
                setNote(result.ok ? `exported ${result.filename}` : result.message);
                await refresh();
              }}
            >
              export
            </Action>
            <Action onClick={() => fileRef.current?.click()}>import</Action>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImport(file);
                event.target.value = '';
              }}
            />
          </div>
        </Section>

        {estimate?.supported && <p className="mt-4 text-xs text-paper-dim">{estimate.message}</p>}
        {note && <p className="mt-3 text-xs text-paper-soft">{note}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 space-y-2 border-t border-line pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-paper-soft">{title}</h3>
      {children}
    </section>
  );
}

function Action({ onClick, children }: { onClick: () => void | Promise<void>; children: ReactNode }) {
  return (
    <button
      onClick={() => void onClick()}
      className="rounded border border-line px-2 py-1 text-xs text-paper hover:border-accent"
    >
      {children}
    </button>
  );
}
