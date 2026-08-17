# Design

Technical design for the concept in [../README.md](../README.md). Written before implementation;
every decision here should be revisited once there is something on screen.

**v1 is single-user, local-first, no accounts, no server.** The social layer, AI features and the
map are deferred — but the data model is shaped so that none of them require a migration.

---

## 1. Decision log

| # | Decision |
|---|---|
| D1 | Every time is a four-number fuzzy interval; the editor offers **instant** (default), interval, or fuzzy |
| D2 | Numeric time is fractional days from an epoch, proleptic Gregorian, astronomical year numbering, float64 |
| D3 | Mass is a kernel density estimate with a **screen-space** bandwidth |
| D4 | All events are personal; no canonical event registry in v1 |
| D5 | Empty timeline by default; canonical content ships as opt-in **packs**, with a `mine / mine + packs` toggle |
| D6 | Connections are free-form, but stored as an ordered pair |
| D7 | Web app: Vite + TypeScript + React + Tailwind, PWA, installable, one codebase for desktop and mobile |
| D8 | Local-first: in-memory state, IndexedDB persistence, versioned JSON as the portability contract |
| D9 | Every record gets a UUIDv7, `created_at`/`updated_at`, and a soft-delete tombstone |
| D10 | Events carry a second time: `learned_at` / `learned_from` — when and from where *you* encountered it |
| D11 | Timeline renderer is a framework-agnostic TS class owning a canvas |
| D12 | Linear time axis with continuous zoom; the scale function is pluggable |
| D13 | One event = one unit of mass; no importance weighting in v1 |
| D14 | Tags are flat with an optional parent and a `kind` discriminator |
| D15 | Eras are a separate entity from events, laid out in lanes |
| D16 | Durability is three layers: `storage.persist()`, automatic file backup, manual export — all in v1 |
| D17 | Spatial view is v2; `Place` stays in the schema from the start |
| D18 | MIT licence |
| D19 | UK English in prose and UI copy; standard programming English in identifiers (`color`, `license`) |
| D20 | Built-in tags have fixed namespaced IDs; user tags get UUIDv7; packs reference IDs, never names |
| D21 | Deleting an event soft-deletes its connections, as one undo entry |
| D22 | A connection renders only if both endpoints pass the filter; personal eras always show |
| D23 | A searchable, keyboard-navigable list view is v1 scope — the accessibility answer and the way you find things |
| D24 | Viewport and selection live in the URL hash |
| D25 | No telemetry, no analytics, no network traffic beyond loading the app |
| D26 | First run asks for a birth year and creates the "my life" era |

Conventions, settled and not worth further discussion:

- Sort key is `b → a → title → id`, fully deterministic, so render order never flickers.
  Titles compare **by code unit, not `localeCompare`** — locale collation depends on the host's
  ICU data, so the same timeline would sort differently on two machines and any byte-comparison
  of exports would be worthless.
- Schema migrations are an ordered array of pure functions, applied on load and import. Never
  delete one.
- The note editor is a plain Markdown textarea with preview. No rich editor in v1.
- `learned_at` is local wall-clock ISO with offset.
- Dates format as `20 July 1969` (D19).
- Testing is heavy on the time and density libraries, light on the store, none on canvas output.
- Quick-add grammar: the date is parsed from anywhere in the string, `#tags` are extracted, and
  whatever remains is the title. Nothing else in v1.

§10 lists what is deliberately left open.

---

## 2. Time model

### 2.1 The problem

Historical dates are: exact (`1969-07-20`), year-only (`1848`), fuzzy (`c. 250 BC`), ranged
(`1914–1918`), fuzzy-ranged (`c. 1200–1150 BC`), disputed (`1187 or 1189`), and era-scale
(`mid-3rd century BC`). A representation that only handles the first two forces a lie at entry
time, and the lie is unrecoverable.

### 2.2 Representation (D1)

**One storage shape for everything: the four-number fuzzy interval.** Three input modes sit on
top of it, so the common case stays a single box and the expressive cases are available when
wanted.

```ts
type TimeSpec = {
  mode: 'instant' | 'interval' | 'fuzzy';   // how it was entered; drives editor and display
  calendar: 'gregorian' | 'julian';
  granularity: 'day' | 'month' | 'year' | 'decade' | 'century';
  // the canonical representation, in days (see D2):
  a: number;  // earliest possible start
  b: number;  // likely start
  c: number;  // likely end
  d: number;  // latest possible end
  sigma: number;  // 1σ uncertainty for density purposes, derived from (a,b,c,d)
  text?: string;  // authored string, kept only when it says more than (a,b,c,d) can express
};
```

`a ≤ b ≤ c ≤ d`, always. The three modes are constraints on that shape:

| Mode | Shape | Example |
|---|---|---|
| `instant` (default) | `a=b=c=d`, widened by `granularity` | `1969-07-20`, `1848` |
| `interval` | `a=b`, `c=d` | `1914–1918` |
| `fuzzy` | unconstrained trapezoid | `c. 1200–1150 BC`, `mid-3rd century BC` |

`mode` is not redundant with the numbers — it records *what the user meant*, which the numbers
alone lose. `1848` entered as an instant with year granularity and `1848` entered as an interval
have the same `(a,b,c,d)` but should be edited and displayed differently.

The trapezoid is what gets drawn; `sigma` is what feeds the density (§3).

**There is no undated state, and none is needed.** "Something in the Song dynasty" is not a
missing date, it is a very wide fuzzy interval — which is both true and more useful, because it
still contributes mass and still sits somewhere on the axis. Maximal uncertainty is a value in
the model, not an absence of one.

**`text` is a display override, not the storage format.** Kept only when the phrasing carries
more than the numbers do — "mid-3rd century BC" and "c. 250 BC" produce identical intervals but
are different claims. Most events will not have it.

**EDTF becomes a boundary converter, not the storage format.** Parse EDTF on import, emit it on
export, for interop with packs and anything shared later. Simpler than storing it, because the
core never has to reason about a string.

The parser is the whole user experience of dates, and it is pure, testable code with no UI
dependency — **build and test it first, before anything renders.** It must handle at minimum:

- `1969-07-20`, `1969-07`, `1969`, `-0250`, `250 BC`, `250 BCE`
- `c. 1200 BC`, `ca 1200`, `~1200`, `1200?`
- `1914-1918`, `1914/1918`, `1914 to 1918`
- `3rd century BC`, `early/mid/late 3rd century BC`
- `1180s`, `12th century`
- `1187 or 1189` → `fuzzy` spanning both

The parser infers `mode` and `granularity` alongside the numbers, so typing into the quick-add
box never requires touching the mode selector — the selector exists for editing and for the
cases where the text is ambiguous.

**Known limitation, accepted:** a trapezoid cannot represent a bimodal claim. "Either 1187 or
1189" becomes a fuzzy span covering both, which slightly overstates the possibility of 1188.
This is the right trade — a mixture model per event would complicate the density for a case that
is rare and whose detail belongs in the notes anyway.

Display formatting uses `text` when present and derives from `(mode, granularity, a…d)`
otherwise.

### 2.3 Numeric axis (D2)

`t` is **fractional days from 1970-01-01T00:00 in the proleptic Gregorian calendar**, float64.

- Handles antiquity and deep time: 13.8 Gyr ≈ 5×10¹² days, well inside float64's exact-integer
  range (9×10¹⁵), leaving sub-second precision even at the extremes.
- Astronomical year numbering internally (year 0 = 1 BC, −1 = 2 BC) so arithmetic is continuous.
  Display converts back to BC/AD and never shows a year 0.
- `calendar: 'julian'` affects display only — computation is always proleptic Gregorian, so
  4 March 1493 (Julian) sorts correctly against 13 March 1493 (Gregorian). Note the offset is
  **9** days there, not 10: it only reaches 10 on 1 March 1500. Getting this wrong by a day is
  the classic error, so the conversion is table-driven and tested at every step boundary.
- The parser has no syntax for Julian dates, so `calendar` can only ever be set by the editor.

Do **not** use JS `Date` anywhere in the core. It is a display-layer convenience at most.

### 2.4 Axis projection (D12)

Linear time, continuous zoom, with the scale exposed as a swappable function
`scale(t) → px`. Reasons to keep it pluggable rather than hard-coding linear:

- A **log-time axis anchored at now** becomes worth offering if you ever add deep time.
- A **density-equalised axis** — using the CDF of your own knowledge density as the transform —
  is a genuinely interesting view (histogram equalisation of what you know), but it must never
  be the default: it destroys the property that gaps are visible at a glance, which is the whole
  point of the far view.

Default zoom-out limit: −4000 to present, configurable.

---

## 3. Mass (D3)

### 3.1 The estimator

Events are observations with measurement error. The knowledge density is

```
ρ(t) = Σᵢ (fᵢ * K_h)(t)
```

where `fᵢ` is event *i*'s own temporal distribution and `K_h` is a Gaussian kernel whose
bandwidth is chosen **in screen space**:

```
h = β · Δt_px          β ≈ 5 px,  Δt_px = time units per pixel
```

This is the key trick. A screen-space bandwidth means the plot is scale-stable: zooming in
genuinely *resolves* clumps into structure rather than stretching the same curve. "Zooming in
dissolves the mass" is exactly `h → 0`.

### 3.2 Closed form

The whole trapezoid convolves with the kernel analytically, so nothing needs numerical
integration. Writing the ramp `r_{p,q}` — 0 below p, rising linearly to 1 at q, 1 above — the
trapezoid is

```
f(t) = H · [ r_{a,b}(t) − r_{c,d}(t) ],     H = 2 / ((d−a) + (c−b))
```

and `r_{p,q}` is exactly the CDF of Uniform(p,q), so convolving it with a Gaussian produces the
antiderivative of Φ:

```
(r_{p,q} * K_h)(t) = [Ψ(u) − Ψ(v)] / (u − v),   u = (t−p)/h, v = (t−q)/h, Ψ(x) = x·Φ(x) + φ(x)
```

Every degenerate shape is a limit of this rather than a special case: as `q → p` the ratio tends
to `Φ(u)`, which recovers the interval form `[Φ((t−s)/h) − Φ((t−e)/h)] / (e−s)`, and a point is
the limit of that. Below a threshold the difference quotient is replaced by its central
difference `Φ((u+v)/2)` — the exact form subtracts two nearly-equal values and divides by a tiny
one, which loses most of the available precision exactly where day-granularity events live.

This is what `reference.ts` implements. It is O(n · width), too slow to render with, and exists
so the fast path has something to be checked against.

### 3.3 Evaluation

Per-event evaluation at every pixel is O(n · support) and misses the frame budget by an order of
magnitude at 50k events. The implemented path instead exploits the fact that a trapezoid is
**piecewise linear**, so it is fully described by four slope-changes — or two jumps, where an
edge is vertical:

1. Deposit each event's slope-changes and jumps onto a sub-pixel grid. O(1) per event.
2. A double prefix sum turns the whole array back into the summed raw density, in one pass.
3. Convolve that grid **once** with the kernel (three-pass box, O(grid) regardless of bandwidth).

O(n + W) overall, with a single convolution rather than one per σ-bucket. It is also more
faithful than the per-event closed form: the event shapes are exact and only the kernel is
approximated, where bucketing would have approximated both.

Two consequences worth stating:

- **The event's own spread enters through its rasterised shape and only there.** Since `sigma` is
  derived from `(a,b,c,d)` rather than independent of it, also folding σ into the kernel would
  double-count the spread.
- **An event narrower than one grid cell is deposited as a point mass.** At that resolution it
  *is* a point, and rasterising it as a shape would produce a spike of height 1/width the grid
  cannot represent — mass would be wrong rather than merely imprecise. The kernel supplies the
  visible width either way, so the crossover is not noticeable.

Events beginning off the left edge need care: the arrays are prefix-summed, so a slope change or
step that happened before the window still governs everything inside it. Clamping those deposits
to cell 0 rather than dropping them is what keeps a millennium-long interval from vanishing when
you zoom into the middle of it.

Measured: 50k events at 2000px costs **2.5 ms** zoomed out, 1.2 ms zoomed in — against a 16 ms
budget.

### 3.4 Display scaling

Define `λ(t) = ρ(t) · Δt_px` — **expected events per pixel column**. This single scalar drives
everything:

- **Height:** `H · min(1, √(λ / λ_ref))` with `λ_ref` fixed (e.g. 8 events/px = full height).
  The square root keeps a lone event visible without letting the Second World War flatten the
  rest of the chart. The scale is *fixed*, not auto-ranged to the viewport, so sparse regions
  honestly look sparse.
- **Semantic zoom:** far view while `λ_max > 1`; crossfade over `1 → 0.25`; tick marks below.
  Tying the transition to the same quantity as the height means there is no popping and no
  arbitrary zoom thresholds to tune. Labels appear on a separate, simpler test (available label
  width without collision).

Offer auto-ranging as a toggle, off by default.

### 3.5 Filtering (D22)

Tag filters recompute ρ over the subset. Animate by interpolating the two density grids over
~300 ms — that is `W` floats, free — so switching "all" → "history of ideas" visibly
redistributes weight, as the concept asks.

One filter predicate, evaluated once per frame, consumed by every view (canvas, list, and the
map in v2). Its rules:

- **Events** pass on their own tags, with parent tags rolling up (D14), composed with the
  `mine / mine + packs` toggle (D5).
- **Connections** render only if **both endpoints pass**. Their own tags narrow further; they
  never admit a connection whose endpoints are hidden. Otherwise you get arcs terminating in
  nothing, which reads as a rendering bug.
- **Canonical eras** filter on their own tags. **Personal eras always show** — your own life is
  the frame of reference the timeline is read against, and it should not disappear because you
  filtered to art history.

---

## 4. Data model

```ts
type Id = string;  // UUIDv7 for user records; fixed namespaced strings for built-ins (D20)

type Base = {
  id: Id;
  created_at: string;    // ISO instant, wall clock
  updated_at: string;
  deleted_at?: string;   // soft delete — never hard-delete, sync needs tombstones
};

type Event = Base & {
  title: string;
  when: TimeSpec;
  notes?: string;               // Markdown
  tags: Id[];
  place?: Place;
  sources?: Source[];
  learned_at?: string;          // D10 — when *you* encountered it
  learned_from?: string;        // free text: "Gombrich, ch. 4", "conversation with M"
  provenance: Provenance;
  pack?: Id;                    // set if this came from an installed pack
};

type Connection = Base & {
  from: Id;                     // ordered pair even though v1 is undirected (D6)
  to: Id;
  note: string;                 // Markdown — the actual content of this project
  tags: Id[];
  kind?: string;                // reserved for a later taxonomy; unset in v1
  provenance: Provenance;
};

type Tag = Base & {
  name: string;
  kind: 'region' | 'theme' | 'user';   // D14 — drives map and premade sets without name hacks
  parent?: Id;                          // Europe > Norway, for rollup filtering
  color?: string;
};

type Era = Base & {
  name: string;
  when: TimeSpec;
  kind: 'canonical' | 'personal';
  tags: Id[];
  notes?: string;
};

type Place = { name: string; lat?: number; lon?: number; precision?: number };
type Source = { kind: 'book' | 'article' | 'url' | 'conversation' | 'other';
                ref: string; locator?: string };
type Provenance = { kind: 'manual' | 'pack' | 'import' | 'ai_extract';
                    ref?: string; confidence?: number };
```

Notes on the non-obvious fields:

- **`learned_at` / `learned_from` (D10).** The README's own framing is that adding an event is
  the act of saying "I now know this happened". If that is true, the second time axis is part of
  the concept, not a feature: it makes the timeline replayable against your own life, and it
  turns "what did reading X actually teach me" into a query. It costs two nullable fields now
  and is impossible to reconstruct later. Strongly recommended.
- **`provenance`.** Needed before AI extraction and document ingestion exist, for the same
  reason — and because "how do I know this" is close to the heart of the project.
- **`from`/`to` on connections (D6).** Free-form in v1, but storing an ordered pair means a later
  `caused` / `influenced` taxonomy is directional without a migration.
- **Soft deletes and UUIDv7 (D9).** Both exist purely for the deferred sync/social layer.
  Retrofitting either is genuinely painful; adding them now costs nothing.
- **Tag IDs (D20).** Built-in tags — the regions and the history-of-ideas set — carry fixed
  namespaced IDs: `tag.region.europe`, `tag.theme.philosophy`. User-created tags get UUIDv7.
  A tag is built-in if its ID is not a UUID; no extra field needed. This exists so that a pack
  saying "Europe" attaches to *your* Europe rather than silently creating a second one and
  splitting your filters in a way you would not notice for months.

### 4.2 Deletion (D21)

Deleting an event soft-deletes its connections in the same operation, recorded as **one** undo
entry; restoring the event restores them. The alternative — leaving connections dangling and
hiding them at render time — pushes a validity check into every consumer of the store and gets
forgotten in exactly one of them.

Tags and eras do not cascade: deleting a tag removes it from events, deleting an era affects
nothing else.

### 4.1 Forward compatibility with the social layer

Without building any of it:

- Records are **field-level last-writer-wins ready**: every record has `updated_at`, and no
  field's meaning depends on another record's state.
- The one field that would need real merge semantics is `Connection.note` (two people editing a
  shared argument). Leave it LWW; upgrade to a text CRDT only if forking turns out to mean
  co-editing rather than copying.
- **Forking a connection** (README's most interesting social feature) is copy-with-attribution:
  new `id`, `provenance.kind = 'import'`, `provenance.ref = <origin id>`. Nothing else needed.
- Event identity (D4): all events are personal. Deduplication across users, if it ever happens,
  is a *matching* problem solved on top — title similarity plus interval overlap — not a schema
  problem. Keeping a canonical registry out of v1 avoids the hardest question in the project.

---

## 5. Packs (D5)

An empty timeline is the point, so canonical content ships as installable packs: versioned JSON
bundles (`id`, `name`, `version`, `license`, events, eras, suggested tags). Install/uninstall is
clean because every pack-sourced record carries `pack: <id>`.

The semantic problem worth being deliberate about: **if WWII events are pre-loaded, the density
plot stops meaning "what I know".** Resolution:

- Packs are opt-in.
- Pack events render desaturated, and the view has a `mine` / `mine + packs` toggle that changes
  what contributes mass.
- "Adopting" a pack event (editing it, connecting it, or an explicit action) converts it to
  yours: `pack` cleared, `provenance.kind = 'manual'`.

Record `license` per pack — Wikipedia-derived data is CC BY-SA and that propagates.

**Packs reference tags by ID, never by name (D20).** A pack may use a built-in ID
(`tag.region.europe`) and attach to the tag you already have, or declare its own pack-scoped tag
which is removed on uninstall. It may not introduce a bare name and hope for a match — that is
how you end up with two Europes and a filter that quietly shows half of what it should.

Pack install and data import share one code path.

**Pack upgrades must not overwrite your work.** Merge-by-`id` on a newer pack version would
otherwise clobber an event you adopted and rewrote, since the pack's `updated_at` is newer. Rule:
a pack upgrade skips any record whose `pack` has been cleared, or whose `updated_at` is later
than the install it came from.

---

## 6. Views (D11, D23, D24)

Two views over one filtered state: the canvas and the list. Both read the same filter predicate
(§3.5) and the same in-memory store, and either can be the primary one depending on what you are
doing.

### 6.1 The canvas

**Canvas 2D, one canvas, devicePixelRatio-aware, with a DOM overlay for labels and hit targets
at near zoom.** Not SVG (thousands of nodes), not WebGL yet (unnecessary — the far view is a
filled path, not marks).

The timeline is fundamentally **1-D**, which makes everything cheap: events sorted by `b`,
binary search for the visible window, density evaluated on a per-pixel grid. Hit-testing is a
binary search, not a quadtree.

The renderer is a plain TypeScript class that owns a canvas and takes `(events, connections,
eras, viewport, filters)`. No framework imports. This is the one architectural rule worth
enforcing: the renderer is the part of this project with real value, and it should survive any
UI framework decision.

**Connection arcs.** Quadratic Béziers above the axis, control height ∝ `√(pixel distance)`,
capped so long arcs flatten rather than leaving the screen. Additive alpha so overlapping arcs
build visible structure. Cull arcs with both endpoints off-screen on the same side. Colour by
the connection's dominant tag; palette chosen at implementation time.

**Eras** occupy lanes below the axis; lane allocation is interval-graph greedy colouring, with
personal eras pinned to the lanes nearest the axis.

**Interaction.** Wheel = zoom at cursor, drag = pan, pinch on touch, double-click = zoom in,
arrow keys pan / `+`/`-` zoom. Zoom is continuous in log-scale space, animated with a short
ease so the density transition reads as dissolution rather than a jump.

**Performance budget.** 50k events, 10k connections, 60 fps on a laptop. Build a seeded
synthetic-data generator on day one — the density view cannot be developed against an empty
timeline, and the perf budget is meaningless without it.

### 6.2 The list view (D23)

A searchable, sortable, keyboard-navigable table of events, sharing filter state with the canvas.
It is v1 scope for two independent reasons, either of which would be sufficient:

- **Accessibility.** A canvas is opaque to screen readers and to keyboard navigation. The list is
  the accessible presentation of the same data, not a lesser alternative to it. Everything doable
  on the canvas — select, edit, connect, delete — is doable here.
- **It is how you find things.** Creating a connection means picking a second event, and picking
  it by scrubbing a density plot is absurd. The list, and the search behind it, is the real
  answer to "where is that event I added in March".

Virtualised rows, so 50k events costs nothing.

### 6.3 Search

Over the in-memory store: substring across `title`, `notes`, `learned_from` and tag names, plus
fuzzy matching on `title`. At 50k records this is a linear scan per keystroke and still
imperceptible — no index, no worker, until measurement says otherwise.

Search doubles as the event picker in the connection flow (M3) and as the target for a command
palette later.

**Duplicate guard.** On quick-add, warn if a similar title already exists within a nearby
interval. Adding the Battle of Lepanto twice six months apart is the obvious failure mode of a
capture-optimised tool, and it corrupts the density quietly.

### 6.4 URL state (D24)

Viewport (centre and span) and selection live in the URL hash. Cheap now, awkward to retrofit
once React state and the renderer's viewport have grown into each other. It buys bookmarkable
periods immediately — "the 1840s, art history only" is a link — and shareable links for free when
the social layer arrives.

---

## 7. Platform (D7)

**Web app, TypeScript, PWA (installable, offline), one codebase for desktop and mobile,
deployed static to Cloudflare Pages.**

- Canvas zoom is excellent on the web; no app stores; the deferred social layer is a natural fit;
  it matches the Cloudflare setup already in use for `aslakhellevik.no`.
- **Escape hatch:** wrap the same app in Tauri later if a real file-backed vault matters. Same
  code, no rewrite. Worth knowing the door is open; not worth walking through now.

Stack: **Vite + TypeScript + React + Tailwind**, with a small state store (Zustand). React for
the ecosystem — a Markdown editor now, a map in v2. The renderer boundary (D11) means React
never touches the canvas, so this choice stays reversible.

**Mobile is a capture-and-browse client.** Full connection authoring is desktop. Pinch-zoom on
the same canvas, simplified chrome. The honest risk: the far-zoom density view on a 390 px-wide
screen may simply not be legible — test this early, and be willing to give mobile a different
default view.

---

## 8. Storage, durability and privacy (D8, D16, D25)

### 8.1 The working store

- **Canonical state in memory.** 10k events is ~2 MB; keeping everything resident makes the
  render loop trivial and removes a whole class of async complexity.
- **IndexedDB for persistence** (via `idb`), written on change with a short debounce. Writes are
  per-record, in a transaction, so a crash mid-write cannot leave a half-written store.
- **Versioned JSON (`schema_version`) as the portability contract.** Migrations are an ordered
  array of pure `(data) => data` functions applied on load and on import, run from whatever
  version the file declares. Old migrations are never deleted — an export from two years ago has
  to open, or the portability promise was a decoration.
- SQLite-in-wasm is deferred until there is a query in-memory filtering cannot serve. There
  probably never will be.
- **Two tabs on the same store will silently eat each other's edits** — both hold in-memory
  state, both write, last one wins. Broadcast every committed write on a `BroadcastChannel` and
  have other tabs apply it to their in-memory state. Twenty lines, and the alternative is a bug
  that looks like corruption.

### 8.2 What actually threatens the data

IndexedDB is durable in the ordinary sense — it survives reloads, crashes and reboots. It is not
durable against the browser deciding to reclaim space, and that is the real risk:

| Threat | Reality |
|---|---|
| User clears browsing data | Gone. Nothing can prevent this; only a file copy survives it. |
| Eviction under storage pressure | Chromium evicts non-persistent origins. `navigator.storage.persist()` exempts you, and is granted silently for installed or high-engagement sites. |
| **Safari's 7-day cap** | WebKit deletes script-writable storage after ~7 days without interaction with the site. **Installed (home-screen) web apps are exempt.** This is the single most important durability fact for this project on mobile. |
| Private browsing | Ephemeral everywhere. Detect and warn. |

Verify the current behaviour of each when implementing — these policies move.

### 8.3 The plan: three layers, all in v1

**Layer 1 — claim persistence.** Call `navigator.storage.persist()` on first write; show the
result in settings. On iOS, prompt to add to the home screen on second or third visit, and say
plainly why: *installing keeps your timeline from being deleted.* Not a growth nag — the actual
mechanism by which the data survives.

**Layer 2 — automatic file backup (the one that matters).** The user picks a backup folder once
via the File System Access API. The `FileSystemDirectoryHandle` is structured-cloneable, so it
is stored in IndexedDB and survives reloads; permission is re-granted with one click per
session. On open and every ~10 minutes when dirty, write `timeline-YYYY-MM-DD.json`, keeping the
last ~20. Chromium desktop only — Safari and Firefox fall back to layer 3.

**Layer 3 — manual export, with a visible conscience.** An always-available export button, plus a
"last backed up N days ago" indicator that turns amber past a week. On browsers without layer 2,
prompt for a download on close after a session with substantial edits.

**Import merges by `id`; it never replaces.** Restoring a backup onto a store that has since
diverged has to be safe, or backups are a trap. Per record: newer `updated_at` wins, tombstones
respected. This is also exactly the code path pack install uses — one function, three callers
(import, restore, pack install).

### 8.4 Is it easy?

Yes — this is the cheapest part of the project. Roughly:

| Piece | Size | Effort |
|---|---|---|
| IndexedDB store + debounced writes | ~150 lines with `idb` | half a day |
| FSA folder handle, permission flow, rotating snapshots | ~150 lines | half a day, mostly permission UX |
| Export / import / merge | ~100 lines, shared with packs | half a day |

Call it **two days including the settings UI and the backup indicator.** Do it in M2, before
there is data worth losing. The hard part is not the code, it is remembering that the code has to
exist before you have three hundred events in there.

### 8.5 If durability has to be guaranteed

The three layers cover realistic failure. If you want *no* dependence on browser storage policy,
the answer is the Tauri shell (§7): the same web app, but the vault is a real file on disk, and
IndexedDB becomes a cache. Half a day to wrap, no code changes to the app. Worth doing the day
the timeline stops being an experiment.

### 8.6 Undo

An in-memory operation stack, plus soft deletes making destructive actions recoverable after the
stack is gone. Cascading deletes (D21) are a single entry.

### 8.7 Privacy (D25)

**No telemetry, no analytics, no error reporting, no network traffic beyond loading the app
itself.** The app is static files; after first load it never talks to a server.

This is worth stating as a commitment rather than leaving as an emergent property, because of
what the data is. A record of what you have read, what you know, what you learned when and from
whom, and what you privately think connects to what, is closer to a diary than to a document. It
would be an unusually revealing thing to leak, and its owner would have no way to tell.

The reason to write it down *now*, while there is no code: **the deferred AI features break it.**
Suggested tags and document ingestion mean sending your notes and reading history to someone
else's API. That may well be worth doing — but it should be a deliberate, explicitly consented
decision made against a stated baseline, not a default that arrives quietly inside a feature.
When that day comes: opt-in per action, visible in the UI at the moment it happens, never
retroactive over the existing corpus, and recorded in `provenance` on anything it touches.

---

## 9. Build order

Ordered to put the risky, distinctive work first and the CRUD last.

| Milestone | Content |
|---|---|
| ~~**M0**~~ | ✅ Repo skeleton, TS + Vite. Time library: parser, fuzzy interval, formatting, calendar conversion. Density estimator. Synthetic data generator. Viewport and interaction maths. 314 tests. |
| **M1** | Canvas renderer against synthetic data: linear axis, pan/zoom, density field, semantic zoom crossfade. No persistence, no UI chrome. **This is the proof-of-concept — if the far view isn't striking, the project needs rethinking before anything else is built.** |
| **M2** | Real store: IndexedDB, quick-add capture, event detail, the list view and search, export/import/backup, URL state, first run. |
| **M3** | Connections: creation flow, arcs, Markdown note editor. Near-zoom labels. |
| **M4** | Tags and filters with animated mass redistribution. Eras with lane layout. |
| **M5** | Packs (WWII, Cold War, …). PWA, mobile polish. |
| **Later** | Map view · AI-suggested tags · document ingestion · social layer and sync. |

**M1 is the decision point.** Everything before it is cheap; everything after it assumes the
core view works.

### First run (D26)

"Empty timeline is the point" is right conceptually and terrible as a first screen — a density
view of nothing is nothing. Ask one question, a birth year, and create the "my life" era from it.

That single question does real work: the timeline is never blank, the personal frame of reference
exists from the first minute, and the idea the whole project rests on — *an event is not just in
1847, it is during your great-grandmother's childhood* — is demonstrated before the user has
added anything. Offer the packs immediately after, and no more onboarding than that.

### Capture friction is the top product risk

Above any rendering concern: the app lives or dies on how fast you can add an event *while
reading*. Target a single input line with the date parser inline — `battle of lepanto 1571
#europe #war` — a global keyboard shortcut, and a mobile share-sheet target later. If adding an
event takes more than a few seconds, the timeline never gets dense enough to have mass, and the
entire premise fails. Treat this as a first-class design goal in M2, not polish.

---

## 10. Deliberately left open

Nothing blocks implementation. These are decisions that want evidence rather than argument, and
the right time to make them is after M1 is on screen:

1. **Connection colour encoding.** By dominant tag, by era, or a per-connection colour. Depends
   entirely on what the far view actually looks like with real arc density.
2. **Kernel constants.** `β` (bandwidth in pixels), `λ_ref` (events/px for full height), and the
   crossfade window. Set by eye against synthetic data in M1; the forms in §3 are settled, the
   numbers are not.
3. **Mobile default view.** Whether the density view is legible at 390 px or mobile needs a
   different default. Test on a real phone in M5 before deciding.
4. **Density-equalised axis** (§2.4) — a good idea that may or may not be a good view. It is a
   swappable scale function, so it costs nothing to try later.
5. **Connection taxonomy.** Free-form in v1 by decision; whether a light vocabulary emerges is
   something to learn from a few hundred real connections, not to specify now.
6. **Pack authoring.** Hand-written JSON, or "export a filtered subset as a pack"? The second is
   nicer and nearly free given that export already exists — but it is an M5 question, and the
   first pack can be written by hand either way.

Outside the design: the app is called **Årlinje**, provisionally — the name may change, so keep
it out of module names and types. `arlinje` is the ASCII form, used for the package and anywhere
a diacritic would be hostile. It still needs somewhere to live (`arlinje.aslakhellevik.no`, or
its own domain); neither blocks anything.
