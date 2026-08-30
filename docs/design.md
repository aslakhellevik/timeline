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
| D27 | Markdown is a small subset rendered in-house, escape-first, with no raw HTML path — not a library plus a sanitiser |
| D28 | Arc geometry is precomputed into an index on data change; the per-frame path touches no event store and resolves no colours |
| D29 | Arcs per frame are capped, and the cap keeps the longest — culling cannot bound the far view because long arcs cross any viewport |
| D30 | Selected tags compose as a **union**, not an intersection |
| D31 | The mass scale is calibrated on the **unfiltered** corpus, so filtering removes weight rather than renormalising it |
| D32 | Personal eras take priority in lane allocation, but do not reserve lanes along the whole axis |
| D33 | The depth view is a **projection, not a camera** — the viewport stays one-dimensional |
| D34 | In the depth view mass is **width**, measured as a rate, not the density grid's per-row count |
| D35 | The depth view's semantic zoom is **per row**, not one number for the frame |
| D36 | Pack record ids are derived from the pack id and the author's key, which is what makes an upgrade an upgrade |
| D37 | Uninstalling a pack **hard-removes** its content — the one exception to D9's tombstones |
| D38 | With a pack installed the mass is drawn in **two layers**: the total desaturated, your own share solid inside it |
| D39 | The premade tags are materialised as records on first run, so a typed `#war` attaches to the built-in id |
| D40 | The service worker is written here rather than taken as a dependency: network-first shell, cache-first fingerprinted assets |
| D41 | The map uses **Equal Earth** — equal-area, because the view is about how much |
| D42 | The map draws **coastlines, not borders**: borders move on the timescale the timeline covers, coastlines do not |
| D43 | Events with no coordinates are placed by their **region tag**, drawn with a halo at the region's true radius |

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

- **Height:** `H · min(1, (λ / λ_ref)^p)`. Both constants were settled by eye in M1, and both
  moved from the design's first guess:
  - `p = 1/3`, not `1/2`. A realistic personal timeline spans roughly 500:1 between the Second
    World War and the early middle ages. A square root flattens that only to 22:1, which leaves
    everything before 1000 AD as a sliver along the bottom and most of the canvas empty. A cube
    root brings it to 8:1 — antiquity shows its structure, the modern peak still plainly
    dominates, and the ordering stays monotone so no period is ever misrepresented.
  - `λ_ref` is **calibrated once per corpus** at full extent, not fixed at a constant. One
    number cannot serve both a timeline of fifty events and one of fifty thousand: whatever
    keeps a sparse corpus visible clips a dense one flat across its peaks. Calibrating at full
    extent means the densest period fills the frame when zoomed out, and everything shrinks
    from there as you zoom in and events-per-pixel fall.

  The scale remains *fixed with respect to the viewport* — it is not re-ranged as you pan or
  zoom — so sparse regions honestly look sparse, which is the property the far view exists for.
- **Semantic zoom:** far view while `λ_max > 1`; crossfade over `1 → 0.25`; tick marks below.
  Tying the transition to the same quantity as the height means there is no popping and no
  arbitrary zoom thresholds to tune. Labels appear on a separate, simpler test (available label
  width without collision).

Offer auto-ranging as a toggle, off by default.

### 3.5 Filtering (D22, D30, D31)

Tag filters recompute ρ over the subset, and the two density grids are interpolated over 300 ms
with an ease at both ends — `W` floats, free — so switching "all" → "history of ideas" visibly
redistributes weight, as the concept asks. Built in M4 and **measured** rather than assumed: the
blue ink above the axis falls monotonically across the 300 ms and then holds, instead of stepping
once. Linear interpolation reads as a mechanical wipe; the ease is what makes the same arithmetic
read as weight settling. A pan or zoom mid-transition abandons it, since the grids then describe
different windows and there is nothing meaningful to blend.

**The mass scale is calibrated on the unfiltered corpus (D31).** This is what makes a filter mean
anything. Recalibrating against the filtered subset would redraw "philosophy" at the same height
as everything, so filtering would change the shape of the curve but never its weight — and weight
is the whole claim of the view. Against the whole corpus, filtering 2,400 events down to 97
leaves visibly about a fifth of the ink, and the semantic-zoom crossfade resolves what remains
into marks rather than letting it become an unreadable smear. The pannable extent comes from the
same unfiltered set, so the view does not jump when a filter changes under it.

**Selected tags compose as a union (D30).** An event passes if it carries *any* of them.
Intersection is the other reasonable choice and is the wrong one here: the premade set mixes
regions with themes, so the obvious pair to pick — Europe and philosophy — would mean "European
philosophy" under intersection and show almost nothing, since an event tagged *philosophy* is
rarely also tagged with its region. Union makes selecting more tags show more, which is what the
counts beside them promise.

Those counts are **rolled up** through `parent` (D14), because that is what selecting the tag
does: filtering by Europe shows an event tagged only Norway, so offering "Europe · 3" when it
would reveal thirty is a lie told every time. An event counts once per tag however many of that
tag's descendants it carries.

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

### 5.1 As built (M5)

Two packs ship in the app: the Second World War and the Cold War, forty-odd events each with
their own connections and eras. **Skeletons, not chronicles** — a pack that tried to be complete
would bury the user's own events under it, which is the failure this section exists to avoid.
They are statically imported so installing one makes no network request (D25) and works offline.

**Record ids are `<pack id>/<author key>` (D36).** That is what makes an upgrade an upgrade:
version two produces the same ids as version one, so the merge rule updates records in place
instead of installing a second copy of everything. Records arrive from the bundle without ids or
timestamps and the installer stamps them, so a pack author cannot forge a timestamp newer than
the user's work.

**Adoption happens on edit, and that simplifies the upgrade rule.** §5 above asks a pack upgrade
to skip any record whose `pack` has been cleared *or* whose `updated_at` is later than the
install it came from. Because editing or connecting a pack record clears `pack`, the second
condition can never hold without the first — so the merge needs no install timestamps to be safe,
and `mergeDocument`'s single clause covers it.

**Uninstall hard-removes (D37).** The one place D9's "never delete, sync needs tombstones" does
not apply, and not by oversight: pack content is not the user's data and is re-derivable from the
bundle, while a tombstone would carry a newer `updated_at` than the bundle and make reinstalling
restore nothing. The user's own connections *into* a departing event go too — the alternative is
an arc into a hole.

**The mass is drawn in two layers (D38).** The `mine / mine + packs` toggle turned out not to be
enough on its own: with a pack installed and the toggle on, a wall of canonical events simply
reads as knowledge. So the total is drawn desaturated and the user's own share solid inside it,
in both views — the flat one as two filled curves, the depth one as a blue river inside a grey
one. That says what the toggle only implies. Marks and labels are dimmed and shortened for pack
records on the same reasoning, and shorter as well as dimmer because colour alone is not a
distinction everyone can see.

**The premade tags are materialised as records (D39).** They existed only as constants, and
`ensureTags` matches by name — so on a timeline that had never created them, typing `#war`
invented a private tag beside the one every pack event carried, and the vocabulary forked in two.
Exactly what fixed namespaced ids were meant to prevent. First run now creates them, and a pack
brings the ones it references, emitted without `pack` since they are shared and an uninstall must
not take away a tag the user's own events also carry.

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

**Connection arcs** (`src/render/arcs.ts`, built in M3). Quadratic Béziers above the axis, over
the mass and under the marks: the mass is the ground — what you know — and the connections are
the figure on it.

Apex height is `minApex + (maxApex − minApex)·√(min(1, d/width))` where `d` is the horizontal
distance in pixels. Sub-linear and saturating at one viewport width, so long arcs flatten rather
than leaving the screen. The useful signal is the *ordering* of spans, not their ratio: linear
height would put a millennium-spanning arc off the top while a decade-spanning one lay flat on
the axis. The control point sits at twice the apex, since a quadratic Bézier reaches halfway to
its control at `t = 0.5`.

Strokes composite with `lighter`. That is what makes a bundle read as structure rather than as
one thick line — where several arcs cross, the crossing brightens in proportion to how many.
Normal alpha compositing saturates after three or four overlaps and the information is gone.

**Colour** falls back in the order the concept cares about: the connection's own tags, then a
tag both endpoints share (two events tagged *philosophy* make a philosophy connection whether or
not anyone said so), then either endpoint, then a neutral default.

**Selecting an event dims every arc it does not touch**, which turns the canvas into an answer
to "what does this connect to" without introducing a mode — but only when the event actually has
arcs, or selecting an unconnected event blanks the whole structure to emphasise nothing.

**Two costs are hoisted out of the frame (D28).** `buildArcIndex` reduces each connection to two
times and a colour when the data changes; `layoutArcs` then does arithmetic only. Resolving
colours and looking up endpoint events per frame cost about ten times as much — the measured
figures are in `arcs.perf.test.ts`, and at the stated budget the layout is **0.3 ms** a frame
at full extent and **0.5 ms** zoomed in, against 3–9 ms before.

**Culling is exact but insufficient (D29).** An arc with both endpoints off the same side cannot
be visible, because the convex hull of a quadratic Bézier contains the curve — but an arc with
one endpoint on each side crosses the viewport however far you zoom in, and with ten thousand
connections thousands of them do. A per-frame cap is what actually bounds the work. The index is
ordered longest-first so the cap keeps the arcs carrying the large-scale structure, and keeps the
same ones each frame, which is what stops it flickering.

Coordinates are clamped to eight screen widths. An arc between events ten thousand years apart,
viewed at a span of one day, puts an endpoint billions of pixels away; the curve through that
point is indistinguishable on screen from the curve through a point eight screens away, and only
one of the two survives being flattened by the rasteriser.

**Hit-testing** samples the curve at a fixed resolution rather than solving the cubic, and runs
against the previous frame's layout — recomputing one to answer "what is under the cursor" both
wastes work and invites the classic bug where the hit target has drifted a frame from what is on
screen. Marks win ties against arcs: an arc is a wide, forgiving target and a mark is a hairline,
so the other way round makes events near a busy bundle unselectable.

**Eras** occupy lanes below the axis (`src/render/lanes.ts`, built in M4). Lane allocation is
greedy interval-graph colouring — walk them in start order, drop each into the lowest row it
clears — which is optimal for interval graphs: it uses exactly as many rows as the deepest
overlap. The axis sits above the band, so its height moves as the number of rows changes with the
viewport.

Bars are drawn between `b` and `c` with the flanks `a`→`b` and `c`→`d` as gradient ramps to
transparent. That is the only honest rendering of "the years I was reading Russian novels": an era
whose `a`≠`b` has no first day, and a crisp edge would claim it does. The ramps are part of the
hit target, because they are part of the era.

A gap is required between two bars in the same row. Not cosmetic: "the Cold War" running straight
into "the Nineties" would render as one continuous bar, which is a false statement about the
world.

**Personal eras are allocated first, but do not reserve lanes (D32).** The original rule gave
them the lanes nearest the axis outright, and that was wrong in a way only visible against a real
corpus: a life, a schooling and two reading periods all overlap inside the last two decades, so
four rows were held clear across four thousand years for bars twenty pixels wide — which pushed
every canonical era down four rows and dropped the ones that then did not fit. Placing personal
eras first still gives them the lowest row wherever they exist, and a canonical era may share row
0 with "my life" when the two are millennia apart, which nobody can misread.

That fix needed the allocator to track the *intervals* taken in each row rather than just the
rightmost edge. The cheap version is only correct when eras arrive in start order, and they no
longer do.

Eras beyond the row cap are dropped and counted, rather than shrinking every row.

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
fuzzy matching on `title`. A linear scan per keystroke — no index, no worker.

**Measured**, since the original claim of "imperceptible at 50k" was a guess and turned out to
be half right: about 1 ms at a few thousand events, and 16–21 ms at 50,000. Comfortable at any
size a real personal timeline will reach for years, and roughly one frame at the stress ceiling.
The cost is the scan itself, not the sorting or the fuzzy path — capping results barely moves it —
so the next step, if it is ever needed, is an inverted index rather than a smarter scan. Folded
text is cached against the event array, which is what keeps the scan to one pass over already-
lowercased strings.

Search doubles as the event picker in the connection flow (M3) and as the target for a command
palette later.

**Duplicate guard.** On quick-add, warn if a similar title already exists within a nearby
interval. Adding the Battle of Lepanto twice six months apart is the obvious failure mode of a
capture-optimised tool, and it corrupts the density quietly.

### 6.4 Making a connection (M3)

Two routes, one state. `connectFrom` holds the first endpoint, and while it is set, *every* path
that would select an event completes the connection instead — a canvas click, a list row, the
picker. That is one rule in the store rather than a connect-aware branch in three components.

The **search picker** is the default route, for the reason §6.2 gives: picking a second event by
scrubbing a density plot is absurd. It can be dismissed without disarming the pick ("pick on the
timeline instead"), which is the only way to reach the canvas route; a banner then says so,
because the pick is still armed and the modal that explained it is gone. `Escape` cancels, and
`c` connects the selected event when focus is not in a text field — a bare letter shortcut that
fired inside quick-add would break capture, which the app is built around.

Events already connected to the source stay in the picker's results, marked. Their absence would
read as a search failure, and choosing one is reasonable: it opens what you already wrote about
the pair. For the same reason, connecting an already-connected pair selects the existing
connection rather than reporting an error.

Finishing the pick lands in the note editor with the cursor in it. The note is the point.

### 6.5 Notes and Markdown (D27)

Event notes and connection arguments are Markdown. The renderer is a subset written in
`core/markdown.ts` rather than a library plus a sanitiser, for one reason that outweighs the
convenience: **raw HTML is never passed through.** Input is escaped before any parsing happens
and the output is assembled from a fixed set of tags the module emits itself, so there is no code
path from input text to live markup and nothing for a sanitiser to get wrong later.

That matters more than it looks. The social layer plans to let someone "inherit or fork someone's
connection with its explanation", which makes a note untrusted text the moment it ships; pack
content is untrusted already. Escaping first makes that safe by construction rather than by
remembering to sanitise at each boundary. Link `href`s are checked against an allowlist of
schemes, not a `javascript:` denylist — the ways to smuggle a script URL past a denylist are
numerous and well catalogued, and the ways to write a legitimate link are three.

Supported: headings, paragraphs, emphasis, code, links, fenced and indented code, blockquotes,
lists, rules. Absent: tables, footnotes, images, reference links, inline HTML — because notes do
not need them, not because they are hard. Where the parser differs from CommonMark it renders
something plainer, never something unsafe.

The editor is write/read tabs rather than a live side-by-side preview, because the pane is three
hundred pixels wide and half of that is not an editor. It opens on whichever mode the content
implies: an empty note wants a cursor, a written one wants to be read.

### 6.6 URL state (D24)

Viewport (centre and span) and selection live in the URL hash. Cheap now, awkward to retrofit
once React state and the renderer's viewport have grown into each other. It buys bookmarkable
periods immediately — "the 1840s, art history only" is a link — and shareable links for free when
the social layer arrives.
### 6.7 The depth view (D33–D35)

A second view of the same data, in which time runs *into* the screen: you stand at the newest
moment in the window and look back down a corridor to a horizon. Not a replacement for the flat
view — that one is better for reading — but it says something the flat view cannot.

**It is a legibility argument, not an atmospheric one.** A perspective projection allocates
screen space as `1/z`, which is roughly how a personal corpus thins out with age: most of what
anyone knows is recent, and near means large means room for it. That makes it a principled
version of the density-equalised axis §2.4 leaves open.

**A projection, not a camera (D33).** The viewport is still `(start, end)` — the window is mapped
onto the corridor, with the newest edge at `z = 1` and the oldest at `zFar = 9`, linearly in
time. Pan, zoom, the pan bounds and the URL round-trip therefore work unchanged, and switching
views keeps the period you were looking at. This is the single largest cost the design avoids,
and it is why the view took hours rather than the week a real 3-D camera would have.

D12 made this cheap by anticipating it: the scale function was pluggable from the start.
`arcs.ts` and `lanes.ts` already took a `toPx` callback and needed no changes at all.

**The density needed one line.** `computeDensity` has exactly one place where time meets pixels,
and everything after it — deposit, the double prefix sum, the blur, the column sums — already
worked in screen space. `DensityOptions.toPixel` composes there. Two properties survive any
monotone mapping and both are load-bearing: each event still carries exactly unit mass, because
the trapezoid's height is derived from its width *in cells*; and the kernel bandwidth stays β
**pixels**, which is the property §3.1 rests on. The approximation introduced is that a
trapezoid's ramps are straight in cell space and a warp curves them — corners and mass stay
exact, so only the interior of a very wide fuzzy event is affected.

**Mass is width, and width is a rate (D34).** The corridor holds a river whose half-width is the
density. A river's width is a property of the river and not of where you stand, so it is measured
in events per unit *time* and then shrunk by the projection like everything else. That conversion
is the one piece of arithmetic this view cannot skip: the grid counts events per pixel *row*, and
rows differ by a factor of `z²` in how much time they cover, so drawing the raw grid would render
a compressed stretch of antiquity as wide as a genuinely dense century — the opposite of the
truth. `DepthProjection.rowsPerTime` is the analytic derivative that undoes it, and it is tested
against a numerical one.

**The semantic zoom is spatial (D35).** The flat view crossfades on one λ for the whole frame,
which is right when every column covers the same span. A corridor's rows do not, so a single
number is always dominated by the far end and marks would never appear at any zoom — they did
not, until each event was tested against the density at *its own* row. Now individual events
resolve as they come towards you and dissolve back into mass as they recede, which is what the
projection was for.

**Arcs vault over the corridor and into the sky.** Their height comes from how much of the window
a connection spans, not from how far apart its ends look — those are the same thing in the flat
view and wildly different here, where a century is four hundred pixels at your feet and four at
the horizon. Every arc is rooted on the same centre line, since the corridor has only one, so
they are also swept sideways in proportion to reach: long connections swing wide and become the
visible structure, local ones stay a thread down the middle. Endpoints are clamped into the
window before projecting, because past the far plane the depth approaches zero and an unclamped
endpoint turns its arc into a straight line across the sky.

**Eras use both sides** — personal to the left, canonical to the right. The corridor has two
flanks where the flat view has one stack of rows, so this is the one place the depth view can
show something the flat view cannot: your own frame of reference and the canonical one sit
opposite each other instead of competing for space.

**Dragging grabs the ground.** The time under the cursor when the drag began stays under the
cursor. A constant pixels-to-time factor is meaningless when a pixel near the horizon is worth
eighty at your feet, which is why `depth-interaction.ts` exists rather than a flag on
`interaction.ts`. Zoom still goes through `zoomAt` by converting the cursor's height to the
equivalent position on a linear axis.


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

### 7.1 As built (M5)

**Two changes carry the mobile layout**, both below Tailwind's `sm`. The detail pane becomes a
bottom sheet rather than a column, because a fixed 320 px sidebar leaves a 390 px screen with
fifty pixels of canvas — and a sheet rather than a full-screen takeover, since the point of
selecting something is to see it *in context*. The filter bar collapses behind a single
`filters` control, because thirty tags is five rows and most of the screen. Above `sm` both
behave exactly as before.

The density view does turn out to be legible at 390 px, which was the stated risk. It has less to
say at that size, but the shape of the corpus survives.

### 7.2 The service worker (D40)

Written in `scripts/pwa-plugin.ts` rather than taken as a dependency, for the reason the Markdown
renderer was (D27): it is forty lines, and one aspect has to be exactly right. Workbox would do
this well, but it is a large dependency whose caching strategy nobody here had read.

- **The HTML shell is network-first**, falling back to the cache. Its URL is the only stable one,
  so it is the only file that can go stale — and a local-first app running last week's code
  against this week's database is worth a round-trip to avoid.
- **Fingerprinted assets are cache-first**, exactly because Vite fingerprints them.
- **The precache list comes from the bundle itself** at build time, so it cannot drift from what
  was actually built. That is the thing a hand-written service worker usually gets wrong.

Two bugs found by testing it rather than assuming, both worth recording because both were silent:

**`cache.addAll` is atomic**, so one entry failing threw the whole precache away, the install
never completed, and there was no offline support at all — while the app looked fine online.
Replaced with an entry-by-entry fetch-and-put that tolerates individual failures, which is the
right trade for offline-first anyway: four files out of five is worth having.

**`Vary: Origin` defeated every cache lookup.** The worker precaches without an `Origin` header;
the page then requests the same files with `crossorigin`, which sends one. Under default Cache
API matching those are different entries, so the app precached itself perfectly and then failed
to load offline — the shell was served and nothing else was. Lookups now pass `ignoreVary`, which
is correct rather than a workaround: `Vary: Origin` is a statement about CORS, and a fingerprinted
URL is one immutable body whoever asks.

Verified by cutting the network through the DevTools protocol and reloading — `scripts/shot.mjs
--offline` — rather than by stopping the server, which races Chrome's own start-up and fails for
reasons unrelated to the worker.

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

### 8.7 Known limitations of the merge rule

Found while building it, and worth writing down before the sync layer inherits them:

- **`updated_at` is client wall-clock time.** One device with a wrong clock can stamp a record in
  2035, and last-write-wins will then never overwrite it again. A logical clock is the real fix;
  a guard on absurd future timestamps at import would be a cheap partial one. Neither is in v1
  because both change merge semantics.
- **Comparison must parse the instants, not the strings.** `+02:00` and `Z` forms of the same
  moment sort differently as text, so a naive string compare silently loses edits across
  timezones.
- **Field-level concurrent edits vanish without trace.** Two tabs editing different fields of one
  event: the older edit is simply gone. Acceptable for single-user v1; this is the seam the
  deferred sync layer will tear at first.
- **§5's pack rule is not literally implementable.** It says to skip a record whose `updated_at`
  is later than *the install it came from*, but nothing records the installed version's
  timestamp. The implementation compares against the incoming record instead. The two differ only
  for a record edited without being adopted — which §5 says cannot happen — and closing the gap
  properly needs a `pack_updated_at` on `Base`.
- **An incoming document is a claim only about the records it contains, never the ones it omits.**
  That is what makes restore safe, and it means merging can never uninstall a pack; uninstall has
  to be its own operation.
- **`replaceAll` broadcasts the union of removed and written ids**, since the change signal
  carries ids only and a receiving tab must learn about removals too. The receiver's rule is
  "re-read these ids, drop the ones that are gone".
- **On iOS there is no layer 2 at all.** The plan reads as three layers; on the one platform with
  a 7-day storage cap it is one and a half, and the home-screen prompt is the actual durability
  mechanism rather than an onboarding nicety.
- **The likeliest real data-loss path is the debounce window, not eviction.** A tab closed
  mid-window loses the last edits, so the queue is flushed on `pagehide` and
  `visibilitychange` — not `beforeunload`, which is unreliable on mobile.

### 8.7a Starting over

The data panel also offers a reset: empty everything and return to the first-run screen. Added
when showing the app to someone a second time made it obvious there was no way to show them the
beginning.

Two steps, an export offered beside the confirmation, and last in the panel — this is the only
genuinely unrecoverable action in the app, and it sits in the one panel whose whole purpose is to
say that losing local data is the honest failure mode. It restores `isFirstRun` rather than only
emptying the store, because an empty density view is exactly the first screen D26 exists to
avoid. The backup folder and its stamp are deliberately kept: they are settings about *where*
copies go, and forgetting them would disarm the safety net immediately after the one action that
makes it matter.

### 8.8 Privacy (D25)

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
| ~~**M1**~~ | ✅ Canvas renderer against synthetic data: linear axis, pan/zoom, density field, semantic zoom crossfade, calendar-correct ticks at every scale, selective labels, hover crosshair. The far view works — it reads as a picture of what someone knows, with the gaps legible at a glance. |
| ~~**M2**~~ | ✅ IndexedDB store with cross-tab sync, quick-add capture with a duplicate guard, event detail, the searchable list view, export/import/merge, the three durability layers, URL state, first run. |
| ~~**M3**~~ | ✅ Connections: the creation flow from both the picker and the canvas, arcs with tag colour and additive blending, hit-testing and selection on the canvas, the Markdown subset and the note editor, connections in the event pane. 598 tests. |
| ~~**M4**~~ | ✅ Tag filtering with rolled-up counts and the packs toggle, animated mass redistribution, era lanes below the axis, era creation and editing. 635 tests. |
| ~~**M5**~~ | ✅ Two bundled packs with install, upgrade, adoption and uninstall; the two-layer mass; the premade tags as records; a hand-rolled service worker with verified offline loading; the mobile layout. 687 tests. |
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
2. ~~**Kernel constants.**~~ Settled in M1: `β = 5 px`, crossfade over λ 1 → 0.25, and the two
   changes recorded in §3.4 — a cube-root height and a per-corpus `λ_ref`. Worth revisiting once
   there is a real corpus rather than a synthetic one, since both were tuned against the
   generator's distribution.
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

---

## 11. The spatial view (D17, D41–D43)

Built after v1, ahead of schedule, because §5's packs gave the corpus enough geography to make it
worth looking at. The README always described it: "a world map with dots, driven by the geographic
tag or an explicit location. Ideally coupled to the timeline — scrub through time and watch the
map fill in."

### 11.1 Coupled to time, which is the point

A static map of everything says where you have read about, not what happened when — and the
timeline already answers the first question better. So the map draws only what overlaps the
current window, and carries a scrubber along the bottom: a density strip of the whole corpus with
the window as a lit band. Drag it and the dots fill in and drain away.

The window is the same `(start, end)` the other views use, so switching views keeps your place.
An event counts as present if its span *overlaps* the window rather than if its midpoint falls
inside: the Second World War belongs on the map for every year of it, not only for 1942.

The canvas has two regions and each has exactly one meaning — the map pans and zooms in space,
the scrubber moves and resizes the window in time. Two interaction models sharing one surface is
a surface nobody can predict.

### 11.2 Equal Earth (D41)

Equal-area, and not for looks. The map answers "where do I know about", which is a question about
*how much*, and Mercator inflates Greenland to the size of Africa — a view whose whole point is
comparing quantities cannot sit on a projection that distorts them by an order of magnitude at
the latitudes a European user cares most about. Equal Earth (Šavrič, Patterson & Jenny, 2018) has
a closed-form forward, an inverse by Newton iteration, and looks like a world map rather than a
diagram. The equal-area property is asserted by a test rather than assumed.

### 11.3 Coastlines, not borders (D42)

The data could as easily have been countries, and borders would look richer. They would also be a
lie on this particular map: a timeline running from the Bronze Age to last week cannot draw the
frontiers of 2026 across it and call the result a picture of anything. The README says as much —
"the hard part is not the map; it is that borders and place names move". Coastlines move too, but
over millennia rather than decades, so one outline is an honest backdrop for the whole span.

Natural Earth's 110m land outline, public domain, committed to the repo rather than pulled from a
package — 55 kB of TopoJSON, decoded by twenty lines written here. A runtime dependency for that
much arithmetic is not a trade worth making, and the data now cannot change underneath the app.

### 11.4 Vagueness is drawn (D43)

Almost no event has coordinates, and asking users to geocode everything they read about would
make capture slow — which is the stated top product risk. So an event with no `place` is located
by its **most specific region tag**, read straight off the radius so adding a region needs no
ordering table.

Those are representative points *with a radius*, not centroids, and each dot carries a halo at
its true size. An event tagged only *Asia* is a soft disc two thousand kilometres across, because
that is genuinely all that is known about where it happened. Drawing it as a neat dot would be
the same lie the time model refuses to tell about dates. A centroid would be worse than useless
here: the centroid of Europe's landmass is in Belarus.

Clustering happens in **screen space**, on the same reasoning as the density's screen-space
bandwidth (§3.1) — what matters is whether two dots would overlap where they are drawn. Zooming
in therefore separates a cluster into its parts, exactly as zooming the timeline resolves mass
into events. Dot area is proportional to count, and a cluster is anchored by its *best*-placed
member, so one precise event among fifty vague ones is not drawn as continent-sized.

Coordinates can be typed as `59.91, 10.75` — the same choice as the era span field, since a
map-picker for a field almost nobody fills in is a lot of interface for very little. Impossible
pairs are rejected rather than clamped: a latitude of 200 is a typo or a swapped pair, and
quietly moving it to the pole hides the mistake in the one place it would look plausible.

