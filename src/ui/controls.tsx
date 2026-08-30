import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * The three shapes the chrome repeats, in one place.
 *
 * Not a component library — an inventory. The bordered-input class string had
 * been copied into seven files and had drifted in five of them (two placeholder
 * opacities, two focus colours, two paddings), and two different components
 * called `Action` existed in two panels with different text colours. Nobody
 * decided any of that; it is what copying does. The visual language here is
 * deliberately quiet (§7), which makes small drift the main way it degrades.
 */

/** `n` of something, with the plural the number actually calls for. */
export function plural(count: number, noun: string, many?: string): string {
  const word = count === 1 ? noun : (many ?? `${noun}s`);
  return `${count.toLocaleString('en-GB')} ${word}`;
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Rendered above the field, and tied to it. Omit it and pass `aria-label`. */
  label?: string;
  /** A one-line reason, in place of the hint, with the field marked invalid. */
  error?: string | null;
  /** The quiet line under the field — what the parser made of it, and so on. */
  hint?: ReactNode;
  /** Sits inside the right edge: the `/` glyph on capture. Never focusable. */
  after?: ReactNode;
  className?: string;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export function Field({
  label,
  error,
  hint,
  after,
  className,
  inputClassName,
  inputRef,
  ...input
}: FieldProps) {
  const generated = useId();
  const id = input.id ?? generated;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      {label !== undefined && (
        <label htmlFor={id} className="text-xs text-paper-dim">
          {label}
        </label>
      )}
      <div className="relative flex min-w-0 flex-col">
        <input
          {...input}
          id={id}
          ref={inputRef}
          aria-invalid={error ? true : undefined}
          className={`w-full rounded border bg-surface px-3 py-1.5 text-sm text-paper
                      placeholder:text-paper-dim focus:outline-none
                      ${error ? 'border-[#e66767]' : 'border-line focus:border-accent'}
                      ${after ? 'pr-8' : ''} ${inputClassName ?? ''}`}
        />
        {after !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center
                       text-[11px] text-paper-faint"
          >
            {after}
          </span>
        )}
      </div>
      {error ? (
        <span className="text-[11px] text-[#e66767]">{error}</span>
      ) : hint !== undefined ? (
        <span className="text-[11px] text-paper-faint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** `danger` is the one that cannot be undone — the red is the whole point. */
  variant?: 'default' | 'danger' | 'quiet';
  /** Awaited for its errors, never for a result: nothing here reports one. */
  onClick?: () => void | Promise<void>;
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'rounded border border-line text-paper-soft enabled:hover:border-accent ' +
    'enabled:hover:text-paper disabled:opacity-40',
  danger: 'rounded border border-[#e66767] text-[#e66767] enabled:hover:bg-[#e66767]/10',
  quiet: 'text-paper-dim enabled:hover:text-paper disabled:opacity-40',
};

export function Button({ variant = 'default', className, onClick, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      onClick={() => void onClick?.()}
      // `min-h-11` only below `sm`: on a phone every one of these was a 16-to-24
      // pixel target, and the visual size is right — it is the hit area that was
      // not (§7.1).
      className={`inline-flex min-h-11 items-center justify-center px-2 py-1 text-xs
                  sm:min-h-0 ${VARIANTS[variant]} ${className ?? ''}`}
    />
  );
}

/**
 * The mark that says "this tag puts the event on the map" (§11.4).
 *
 * The map places almost every event by its region tag, and nothing anywhere said
 * so — the one review comment about the map was that it was not clear how to
 * make a region. A pin on the chip is the whole answer: it appears in the tag
 * editor, in the suggestions and on the filter bar, so wherever a user meets
 * tags they can see which of them are geography.
 *
 * `aria-hidden`, because the chip that carries it says the same thing in its
 * `title` — an announced "image" between a tag name and its count is noise.
 */
export function MapPin({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden
      fill="currentColor"
      className={`size-2.5 shrink-0 ${className ?? ''}`}
    >
      <path
        d="M4 0a4 4 0 0 0-4 4c0 2.9 3.4 5.8 3.5 5.9a.8.8 0 0 0 1 0C4.6 9.8 8 6.9 8 4a4 4 0 0 0-4-4Zm0 5.5A1.5 1.5 0 1 1 4 2.5a1.5 1.5 0 0 1 0 3Z"
      />
    </svg>
  );
}

/** One titled block of a panel, ruled off from the one above it. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 space-y-2 border-t border-line pt-4">
      <h3 className="text-xs font-semibold tracking-wide text-paper-soft">{title}</h3>
      {children}
    </section>
  );
}
