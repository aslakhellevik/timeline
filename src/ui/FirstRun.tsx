import { useState } from 'react';
import { summarise } from '../core/packs';
import { CATALOGUE } from '../packs';
import { useTimeline } from '../state/timeline-store';

/**
 * First run (docs/design.md §9, D26).
 *
 * "Empty timeline is the point" is right conceptually and terrible as a first
 * screen — a density view of nothing is nothing. One question does real work:
 * the timeline is never blank, and the idea the whole project rests on, that an
 * event is not just in 1847 but during your great-grandmother's childhood, is
 * demonstrated before the user has added anything.
 *
 * Then the packs are offered, and no more onboarding than that. Offering them
 * here rather than leaving them to be discovered matters: a first-time timeline
 * is empty, and an empty timeline is the hardest possible thing to judge the app
 * by. It is also the right moment to say what a pack costs — that installed
 * content is not yours and is drawn as such — while there is nothing to confuse
 * it with.
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const seedLife = useTimeline((state) => state.seedLife);
  const installPack = useTimeline((state) => state.installPack);
  const timeline = useTimeline((state) => state.timeline);

  const [step, setStep] = useState<'year' | 'packs'>('year');
  const [year, setYear] = useState('');
  const thisYear = new Date().getFullYear();

  const parsed = Number(year);
  const valid = Number.isInteger(parsed) && parsed > 1850 && parsed <= thisYear;

  const begin = (birthYear: number) => {
    seedLife(birthYear);
    setStep('packs');
  };

  if (step === 'packs') {
    const summaries = summarise(timeline, CATALOGUE);
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-semibold text-paper">Start with something on it?</h2>
          <p className="mt-2 text-sm leading-relaxed text-paper-soft">
            Optional, and reversible. Pack events are drawn dimmer than your own and can be left
            out of the mass, so the density keeps meaning <em>what I know</em>. Editing or
            connecting one adopts it as yours.
          </p>

          <ul className="mt-5 flex flex-col gap-2">
            {summaries.map(({ bundle, installed, events }) => (
              <li
                key={bundle.id}
                className="flex items-center gap-3 rounded border border-line px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-paper">{bundle.name}</p>
                  <p className="text-xs text-paper-dim">
                    {events} events · {bundle.license}
                  </p>
                </div>
                <button
                  onClick={() => installPack(bundle)}
                  disabled={installed !== undefined}
                  className="shrink-0 rounded border border-line px-2 py-1 text-xs text-paper-soft
                             enabled:hover:border-accent enabled:hover:text-paper
                             disabled:opacity-40"
                >
                  {installed ? 'installed' : 'install'}
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={onDone}
            className="mt-5 rounded border border-line px-3 py-1.5 text-sm text-paper
                       hover:border-accent"
          >
            open my timeline
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h2 className="text-lg font-semibold text-paper">A timeline of what you know</h2>
        <p className="mt-2 text-sm leading-relaxed text-paper-soft">
          It starts empty. You add events as you meet them — in books, in conversation — and its
          shape becomes a picture of your own historical knowledge, gaps and all.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-paper-soft">
          One question first, so the timeline has a frame of reference: an event is not just in
          1847, it is <em>during your great-grandmother&rsquo;s childhood</em>.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) begin(parsed);
          }}
          className="mt-5 flex items-center gap-2"
        >
          <label htmlFor="birth-year" className="text-sm text-paper-dim">
            born in
          </label>
          <input
            id="birth-year"
            value={year}
            onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={String(thisYear - 30)}
            className="w-24 rounded border border-line bg-surface px-2 py-1.5 text-sm tabular-nums
                       text-paper placeholder:text-paper-dim/60 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={!valid}
            className="rounded border border-line px-3 py-1.5 text-sm text-paper
                       enabled:hover:border-accent disabled:opacity-40"
          >
            start
          </button>
        </form>

        <button
          onClick={() => begin(thisYear - 30)}
          className="mt-3 text-xs text-paper-dim underline-offset-2 hover:underline"
        >
          skip
        </button>
      </div>
    </div>
  );
}
