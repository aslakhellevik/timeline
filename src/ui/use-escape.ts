import { useEffect, useRef } from 'react';

/**
 * Escape, resolved to exactly one layer (docs/design.md §6.4).
 *
 * Every dismissible thing on screen wants the same key, and before this each
 * one answered for itself: the data panel closed, the detail pane ignored it,
 * and an armed connection cancelled from a window
 * listener that fired underneath all of them. So the app had no answer to "what
 * does Escape do here" — it depended on which component had happened to bind it.
 *
 * The rule is topmost wins. Layers register in mount order, the last one
 * registered is the one on top, and only it acts; the others stay bound so that
 * closing the top one hands the key back to whatever was beneath it. A keystroke
 * a field has already spent on itself — quick-add clears its own box — is left
 * alone, which is what `defaultPrevented` is for.
 */
const stack: symbol[] = [];

export function useOnEscape(handler: () => void, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    const layer = Symbol('escape layer');
    stack.push(layer);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (stack[stack.length - 1] !== layer) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const at = stack.lastIndexOf(layer);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [enabled]);
}
