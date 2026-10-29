import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * What a modal has to do besides look like one (docs/design.md §5.4).
 *
 * Three panels carried `aria-modal="true"` and none of them behaved like a
 * modal: Tab walked straight out of the dialog and down the chrome behind it,
 * closing one dropped focus back to the document, and the global shortcuts went
 * on firing underneath — `c` opened a second dialog on top of the first, `/`
 * focused the capture box behind the overlay.
 *
 * So the trap is also the registry: a modal is exactly the thing that takes the
 * keyboard, and `modalIsOpen` is what the window-level shortcuts check before
 * they act. Read at keystroke time rather than subscribed to, because nothing
 * re-renders when it changes.
 */
const stack: HTMLElement[] = [];

export function modalIsOpen(): boolean {
  return stack.length > 0;
}

/**
 * Everything focusable, in document order.
 *
 * Queried per keystroke rather than cached: a panel's controls appear and
 * disappear as it is used (the confirm step of "start over" swaps three buttons
 * in), and a stale list is a Tab that lands nowhere.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    stack.push(container);

    // Where the keyboard came from, so closing the panel gives it back. The
    // element can be gone by then — a row that scrolled out of a windowed list
    // — hence the guard rather than a bare `focus()`.
    const cameFrom = document.activeElement;

    // Only if nothing inside has claimed it already: the picker's search box
    // has `autoFocus`, and React sets that before this effect runs.
    if (!container.contains(document.activeElement)) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (stack[stack.length - 1] !== container) return;

      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;

      if (active === null || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capturing, so the wrap happens before anything inside the panel sees Tab.
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const at = stack.lastIndexOf(container);
      if (at >= 0) stack.splice(at, 1);

      /*
       * Give the keyboard back, unless something has already claimed it.
       *
       * Closing a modal drops focus to `body`, which is the case worth fixing.
       * But finishing a connection unmounts the picker *and* mounts the note
       * editor with `autoFocus` in the same commit — and React applies that
       * while the DOM changes, before this cleanup runs. Restoring
       * unconditionally would take the cursor straight back out of the note,
       * which is the one place §5.4 says the flow should land.
       */
      const active = document.activeElement;
      const unclaimed = active === null || active === document.body;
      if (unclaimed && cameFrom instanceof HTMLElement && cameFrom.isConnected) cameFrom.focus();
    };
  }, [ref]);
}
