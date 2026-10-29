import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useFocusTrap } from './use-focus-trap';
import { useOnEscape } from './use-escape';

/**
 * What the app can do without the mouse, said once (docs/design.md §6.4).
 *
 * The shortcuts were real and entirely undiscoverable: `/` and `c` and `⌘Z`
 * existed in a window listener and nowhere in the interface, so the only way to
 * learn them was to read the source. A single overlay costs one glyph of chrome
 * and is the conventional place to look.
 *
 * The keys it lists are the ones the app binds — it is not a manual, and a list
 * that drifts from the handler is worse than none, so it stays short enough to
 * check against the handler by eye.
 */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = (key: string) => (MAC ? `⌘${key}` : `ctrl ${key.toLowerCase()}`);

const SHORTCUTS: { keys: string[]; does: string; where?: string }[] = [
  { keys: ['/', mod('K')], does: 'jump to capture' },
  { keys: ['c'], does: 'connect the selected event' },
  { keys: ['esc'], does: 'cancel the pick, or close what is open' },
  { keys: [mod('Z')], does: 'undo' },
  { keys: ['←', '→'], does: 'pan the picture', where: 'timeline' },
  { keys: ['+', '−'], does: 'zoom the picture', where: 'timeline' },
  { keys: ['↑', '↓'], does: 'move', where: 'list' },
  { keys: ['⏎'], does: 'open on the canvas, or finish a connection', where: 'list' },
  { keys: ['?'], does: 'this' },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel);
  useOnEscape(onClose);

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border
                   border-line bg-ink shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-paper">keyboard</h2>
            <p className="mt-1 text-xs leading-relaxed text-paper-dim">
              The list view is the keyboard-navigable equivalent of the canvas — everything the
              picture can do is reachable there.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="close shortcuts"
            className="-my-1 rounded px-1.5 py-1 text-paper-dim hover:text-paper"
          >
            ×
          </button>
        </header>

        <dl className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-xs">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.does + shortcut.keys.join()} className="flex items-baseline gap-3 py-1">
              <dt className="flex w-28 shrink-0 flex-wrap gap-1">
                {shortcut.keys.map((key) => (
                  <Key key={key}>{key}</Key>
                ))}
              </dt>
              <dd className="min-w-0 flex-1 text-paper-soft">
                {shortcut.does}
                {shortcut.where && <span className="text-paper-faint"> · {shortcut.where}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <footer className="border-t border-line px-5 py-2 text-[11px] text-paper-faint">
          Panning and zooming need the picture itself focused — click it, or Tab to it. A bare
          letter never fires while you are typing: capture is what the app is built around.
        </footer>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px]
                 text-paper"
    >
      {children}
    </kbd>
  );
}
