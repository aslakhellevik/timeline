/**
 * M0 shell. The canvas timeline lands in M1 (docs/design.md §9); until then this
 * exists only to prove the stack boots and to hold the layout the renderer will
 * mount into.
 */
export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-line px-5 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Årlinje</h1>
        <p className="text-sm text-paper-dim">a personal historical timeline</p>
      </header>

      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-paper-dim">
          M0 — core libraries. The timeline renders in M1.
        </p>
      </main>
    </div>
  );
}
