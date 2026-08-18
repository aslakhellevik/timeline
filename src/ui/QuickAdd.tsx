import { useEffect, useRef, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { formatTime } from '../core/time';
import { useTimeline } from '../state/timeline-store';

/**
 * Capture (docs/design.md §9).
 *
 * This is the highest-stakes surface in the app. If adding an event while
 * reading takes more than a few seconds the timeline never gets dense enough to
 * have mass, and the whole premise fails. So: one line, no form, no modal, and a
 * keyboard shortcut from anywhere.
 */
export function QuickAdd() {
  const quickAdd = useTimeline((state) => state.quickAdd);
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'error';
    text: string;
    duplicates?: TimelineEvent[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typingElsewhere =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
      if (typingElsewhere) return;

      if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key === 'k')) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = () => {
    if (value.trim().length === 0) return;
    const outcome = quickAdd(value);

    if (!outcome.ok) {
      setFeedback({ tone: 'error', text: outcome.reason ?? 'could not add that' });
      return;
    }

    setValue('');
    if (outcome.duplicates && outcome.duplicates.length > 0) {
      setFeedback({
        tone: 'warn',
        text: 'added — but this looks like something you already have',
        duplicates: outcome.duplicates,
      });
    } else {
      const when = outcome.event ? formatTime(outcome.event.when) : '';
      setFeedback({ tone: 'ok', text: `added · ${when}` });
    }
  };

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (feedback) setFeedback(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') {
            setValue('');
            setFeedback(null);
            event.currentTarget.blur();
          }
        }}
        placeholder="battle of lepanto 1571 #europe #war"
        aria-label="Add an event"
        className="w-full rounded border border-line bg-surface px-3 py-1.5 text-sm text-paper
                   placeholder:text-paper-dim/70 focus:border-accent focus:outline-none"
      />

      {feedback && (
        <div
          role="status"
          className={`absolute left-0 top-full z-10 mt-1 w-full rounded border border-line
                      bg-surface px-3 py-2 text-xs ${
                        feedback.tone === 'error'
                          ? 'text-[#e66767]'
                          : feedback.tone === 'warn'
                            ? 'text-[#c98500]'
                            : 'text-paper-soft'
                      }`}
        >
          {feedback.text}
          {feedback.duplicates && (
            <ul className="mt-1 space-y-0.5 text-paper-dim">
              {feedback.duplicates.slice(0, 3).map((duplicate) => (
                <li key={duplicate.id}>
                  {duplicate.title} · {formatTime(duplicate.when)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
