import { useState } from 'react';
import { useTimeline } from '../state/timeline-store';
import { Field } from './controls';

/**
 * First run (docs/design.md §9, D26).
 *
 * "Empty timeline is the point" is right conceptually and terrible as a first
 * screen — a density view of nothing is nothing. One question does real work:
 * the timeline is never blank, and the idea the whole project rests on, that an
 * event is not just in 1847 but during your great-grandmother's childhood, is
 * demonstrated before the user has added anything. No more onboarding than that.
 *
 * The screen is reachable again later, from "add my life" in the filter bar,
 * which is what makes skipping cheap: it asks once and never nags.
 */

/** The earliest birth year worth accepting, and the one the message names. */
const EARLIEST_BIRTH_YEAR = 1850;

/**
 * Why a year was refused, or null if it was not.
 *
 * A separate function because the form used to say nothing at all: `parsed >
 * 1850` disabled the button for 1850 itself, for an empty box and for 3000
 * alike, with no reason given and no visible difference between "not yet" and
 * "no". A refusal has to say what it wants.
 */
export function birthYearError(text: string, thisYear: number): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return 'a four-digit year, like 1994';
  if (parsed > thisYear) return `${thisYear} at the latest — this is a birth year`;
  if (parsed < EARLIEST_BIRTH_YEAR) return `${EARLIEST_BIRTH_YEAR} at the earliest`;
  return null;
}

export interface FirstRunProps {
  /**
   * Why the question is on screen.
   *
   * `life` is the same question asked again from "add my life", of someone who
   * skipped it — possibly months and several hundred events ago. They are not
   * being onboarded.
   */
  mode?: 'first-run' | 'life';
  onDone: () => void;
}

export function FirstRun({ mode = 'first-run', onDone }: FirstRunProps) {
  const seedLife = useTimeline((state) => state.seedLife);
  const seedTags = useTimeline((state) => state.seedTags);

  const [year, setYear] = useState('');
  const thisYear = new Date().getFullYear();

  const returning = mode === 'life';

  const error = birthYearError(year, thisYear);
  const valid = year.trim().length > 0 && error === null;

  const begin = (birthYear: number) => {
    seedLife(birthYear);
    onDone();
  };

  /*
   * Skip creates nothing.
   *
   * It used to seed the life era from `thisYear − 30`, so declining to answer
   * left a personal era on the axis claiming to be your life, dated from a year
   * you never gave — the one piece of data in the app the user cannot check
   * against anything. The premade vocabulary is still materialised, because
   * that is what makes a typed `#war` attach to the built-in tag (D39) and has
   * nothing to do with the question.
   */
  const skip = () => {
    seedTags();
    onDone();
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-md">
        {returning ? (
          <>
            <h2 className="text-lg font-semibold text-paper">When does your part start?</h2>
            <p className="mt-2 text-sm leading-relaxed text-paper-soft">
              One era, named <em>my life</em>, running from the year you were born to now. It is
              the frame of reference the rest of the timeline is read against — an event is not
              just in 1847, it is <em>during your great-grandmother&rsquo;s childhood</em>.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-paper">A timeline of what you know</h2>
            <p className="mt-2 text-sm leading-relaxed text-paper-soft">
              It starts empty. You add events as you meet them — in books, in conversation — and
              its shape becomes a picture of your own historical knowledge, gaps and all.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-paper-soft">
              One question first, so the timeline has a frame of reference: an event is not just
              in 1847, it is <em>during your great-grandmother&rsquo;s childhood</em>.
            </p>
          </>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) begin(Number(year));
          }}
          className="mt-5 flex items-start gap-2"
        >
          <label htmlFor="birth-year" className="mt-2 text-sm text-paper-dim">
            born in
          </label>
          <Field
            id="birth-year"
            value={year}
            onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={String(thisYear - 30)}
            error={error}
            className="w-44"
            inputClassName="tabular-nums"
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
          onClick={returning ? onDone : skip}
          className="mt-3 text-xs text-paper-dim underline-offset-2 hover:underline"
        >
          {returning ? 'not now' : 'skip'}
        </button>
      </div>
    </div>
  );
}
