import type { ReactNode } from 'react';
import { useOnEscape } from './use-escape';

/**
 * The shell the three detail panes share (docs/design.md §6.1).
 *
 * A sidebar on a desktop and a bottom sheet on a phone. Below `sm` a fixed
 * 320px column leaves a 375px screen with 55px of canvas, so the pane has to
 * stop being a column — and a sheet is the right answer rather than a full-
 * screen takeover, because the point of selecting something is to see it *in
 * context*, and a sheet keeps the timeline above it visible.
 *
 * One component rather than the same twenty classes in three files: the event,
 * connection and era panes differ in content and not at all in how they sit on
 * the screen.
 */
export function DetailPane({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // The pane is dismissible and ignored the one key that dismisses things.
  // Bottom of the stack, so an open panel or picker answers first (§5.4).
  useOnEscape(onClose);

  return (
    <aside
      aria-label={label}
      /*
        Half the screen, no more.

        `62vh` over a 390×844 phone leaves 320 px of canvas above the sheet, most
        of it behind the header and filter bar — and the argument for a sheet
        rather than a takeover is that you can still see what you selected. With
        the selection now revealed on the canvas (D57) there is something worth
        seeing there, so the cap is the one the argument implies. The safe-area
        padding is what keeps the last control clear of the home indicator;
        `viewport-fit=cover` is already set in the shell.
      */
      className="fixed inset-x-0 bottom-0 z-20 flex max-h-[50vh] flex-col gap-4
                 overflow-y-auto rounded-t-xl border-t border-line bg-ink px-4 pt-3
                 pb-[calc(1.5rem+env(safe-area-inset-bottom))]
                 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]
                 sm:static sm:z-auto sm:max-h-none sm:w-80 sm:shrink-0 sm:rounded-none
                 sm:border-l sm:border-t-0 sm:pb-3 sm:shadow-none"
    >
      {/* A grab handle on the sheet, and nothing at all once it is a sidebar. */}
      <div aria-hidden className="mx-auto -mt-1 h-1 w-10 rounded-full bg-line sm:hidden" />
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs tracking-wide text-paper-dim">{label}</h2>
        <button
          onClick={onClose}
          aria-label={`close ${label.toLowerCase()}`}
          className="-my-1 inline-flex min-h-11 items-center rounded px-2 text-paper-dim
                     hover:text-paper sm:min-h-0 sm:py-1"
        >
          ×
        </button>
      </div>
      {children}
    </aside>
  );
}
