import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RECORD_KINDS,
  SNAPSHOT_RETENTION,
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
import type {
  BackupStatus,
  MergeStats,
  PersistenceResult,
  StorageEstimateResult,
} from '../store';
import { useTimeline } from '../state/timeline-store';
import { Button, Section, plural } from './controls';
import { useOnEscape } from './use-escape';
import { useFocusTrap } from './use-focus-trap';

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
  const resetAll = useTimeline((state) => state.resetAll);
  /** The result of the automatic layer-1 request, if it has happened yet. */
  const claimed = useTimeline((state) => state.persistence);

  const [persistence, setPersistence] = useState<PersistenceResult | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimateResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useFocusTrap(panelRef);
  useOnEscape(onClose);

  const resetEverything = useCallback(async () => {
    await resetAll();
    setConfirmingReset(false);
    onClose();
  }, [resetAll, onClose]);

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

  const onImport = async (file: File) => {
    try {
      const incoming = parseDocument(await file.text());
      const merged = mergeDocument(timeline, incoming);
      // Awaited: the note below claims the import landed, and until the write
      // has actually returned that is not yet true.
      await replaceTimeline(merged.timeline);
      const total = (of: (stats: MergeStats) => number) =>
        RECORD_KINDS.reduce((sum, kind) => sum + of(merged.stats[kind]), 0);
      const rejected = total((stats) => stats.rejected);
      setNote(
        `imported — ${total((stats) => stats.added)} added, ` +
          `${total((stats) => stats.updated)} updated, ` +
          `${total((stats) => stats.skipped)} left alone` +
          // Said plainly rather than folded into "left alone": a record left
          // alone is the merge rule protecting newer work, a rejected one is
          // data that could not be read at all, and the user may want the file
          // looked at.
          (rejected > 0 ? `, ${plural(rejected, 'record')} could not be read` : ''),
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'could not read that file');
    }
  };

  return (
    // The dialog is the panel, not the backdrop it floats on: with the roles on
    // the outer element a screen reader was told the whole screen was the modal,
    // including the chrome the overlay exists to take out of play.
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/80 p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="your data"
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded border border-line bg-surface p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-paper">your data</h2>
            <p className="mt-1 text-xs leading-relaxed text-paper-dim">
              Everything lives in this browser. Nothing is sent anywhere. That also means clearing
              your browsing data would delete it — so keep a copy somewhere real.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="inline-flex min-h-11 items-center px-1.5 text-paper-dim hover:text-paper
                       sm:min-h-0"
          >
            ×
          </button>
        </div>

        <Section title="keep it from being evicted">
          <p className="text-xs text-paper-dim">{persistence?.message ?? 'checking…'}</p>
          {persistence &&
            !persistence.persisted &&
            persistence.supported &&
            /*
              The app already asked, on the first thing you saved (§8.3, layer
              1). Offering a button that repeats a refused request is worse than
              saying what happened: the browser decides this on how much the app
              is used, so the honest advice is the one that changes its mind.
            */
            (claimed?.requested && !claimed.persisted ? (
              <p className="text-xs text-paper-dim">
                It was asked when you saved your first event, and would not commit. Using the app
                more, or installing it, usually changes that.
              </p>
            ) : (
              <Button
                onClick={async () => {
                  setPersistence(await requestPersistence());
                }}
              >
                ask the browser to keep it
              </Button>
            ))}
        </Section>

        <Section title="back up to a folder">
          <p className="text-xs text-paper-dim">{backup?.message ?? 'checking…'}</p>
          {backup?.supported && backup.folder && (
            <p className="text-xs text-paper-dim">
              A copy is written when you open the app and every ten minutes after a change. The
              last {SNAPSHOT_RETENTION} are kept — {SNAPSHOT_RETENTION} days, rather than{' '}
              {SNAPSHOT_RETENTION} files: a second copy on the same day replaces the first.
            </p>
          )}
          {backup?.supported && (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  const chosen = await chooseBackupFolder();
                  setNote(chosen.ok ? `backing up to ${chosen.name}` : chosen.message);
                  await refresh();
                }}
              >
                {backup.folder ? 'change folder' : 'choose a folder'}
              </Button>
              {backup.folder && (
                <>
                  {backup.permission !== 'granted' && (
                    <Button
                      onClick={async () => {
                        await requestBackupPermission();
                        await refresh();
                      }}
                    >
                      allow access
                    </Button>
                  )}
                  <Button
                    onClick={async () => {
                      await flush();
                      const result = await writeSnapshot(timeline);
                      setNote(result.ok ? `saved ${result.filename}` : result.message);
                      await refresh();
                    }}
                  >
                    back up now
                  </Button>
                </>
              )}
            </div>
          )}
        </Section>

        <Section title="export and import">
          <p className="text-xs text-paper-dim">
            A single JSON file with everything in it. Importing merges by record rather than
            replacing, so restoring an old backup never discards newer work. An export counts as
            exported, not backed up — where the file goes is between you and the browser, and this
            app never learns whether you saved it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                await flush();
                const result = await downloadExport(timeline);
                setNote(result.ok ? `exported ${result.filename}` : result.message);
                await refresh();
              }}
            >
              export
            </Button>
            <Button onClick={() => fileRef.current?.click()}>import</Button>
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

        {/*
          Deliberately last, and deliberately two steps.

          A local-first app has no server-side undo, so this is the one action in
          the whole app that is genuinely unrecoverable — and the panel it sits in
          exists precisely to say that clearing your data is the honest failure
          mode. Offering the export beside it is not politeness; it is the only
          safety net there is.
        */}
        <Section title="start over">
          {confirmingReset ? (
            <>
              <p className="text-xs text-[#e66767]">
                This deletes every event, connection, era and pack in this browser. It cannot be
                undone, and nothing else has a copy.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    await flush();
                    const result = await downloadExport(timeline);
                    setNote(result.ok ? `exported ${result.filename}` : result.message);
                  }}
                >
                  export first
                </Button>
                <Button variant="danger" onClick={() => void resetEverything()}>
                  delete everything
                </Button>
                <Button variant="quiet" onClick={() => setConfirmingReset(false)}>
                  cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-paper-dim">
                Empty this timeline and go back to the first-run screen. Useful for showing someone
                the app from the beginning.
              </p>
              <Button onClick={() => setConfirmingReset(true)}>start over…</Button>
            </>
          )}
        </Section>

        {estimate?.supported && <p className="mt-4 text-xs text-paper-dim">{estimate.message}</p>}
        {note && <p className="mt-3 text-xs text-paper-soft">{note}</p>}
      </div>
    </div>
  );
}
