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
| D44 | Tag names are matched **normalised**, and a built-in may carry aliases — a `#tag` is one word and half the premade regions are not |
| D45 | Uninstalling a pack **tombstones the user's own connections** into departing events, though it still hard-removes the pack's own (D37 is about pack records) |
| D46 | Import **validates every record** and **clamps absurd future timestamps**, reversing §8.7's decision to leave both out of v1 |
| D47 | An export is recorded as an **export**, never as a backup: the app hands the browser a file and never learns whether it was saved |
| D48 | The mass scale is calibrated as a **rate**, and turned into a λ for whatever width the frame is drawn at |
| D49 | Event marks are drawn as their **trapezoid**, like eras; an instant stays a hairline whatever its granularity |
| D50 | The flat view's semantic zoom is **per column**, not one number for the frame — D35 for the canvas |
| D51 | The kernel bandwidth is **β = 3 px**: β and the height exponent `p` cannot be chosen independently |
| D52 | The pannable frame is events **and** eras, and a stated default when there is neither |
| D53 | The depth view's three label systems share **one occupancy**, and event titles are anchored outside the era lanes — fitted to the room there is, or not drawn |
| D54 | A vagueness halo is a **ring at the true radius**, not a filled disc — revising how D43 is drawn |
| D55 | Clustering is a grid **plus agglomerative passes**, merging against the radii the dots are actually **drawn** at |
| D56 | Additive arc ink falls as `1/√n`, so a bundle brightens as `√n` instead of saturating to white |
| D57 | Selecting an event **reveals** it: every view moves to show it, and a window more than four times the event's own period counts as not showing it |
| D58 | The footer is **status**; everything that creates something is header chrome — and first run is a takeover, not a layer over live chrome |
| D59 | First run **offers** the "my life" era rather than always creating one: skipping creates no era, only the premade tags — revising D26 |
| D60 | One Escape stack, **topmost wins**; a modal traps focus and silences the window-level shortcuts while it is up |
| D61 | The list is a `listbox` and the three canvases are `application` — revising the `grid`-of-`span`s and `img`-with-`tabIndex` roles, which announced the opposite of what they are |
| D62 | Faint ink is **one token at full opacity**, and only on the page plane: on the chart surface `paper-dim` is the contrast floor |
| D63 | Below `sm` the wordmark and the view switcher leave the header — capture keeps the width (§9) |
| D64 | The app checks for a newer build hourly and **says when one has installed itself**, because the worker evicts the assets the running tab is using |
| D65 | A date is edited in **one text field with no mode selector**: `formatTime` round-trips through `parseTime`, so the text carries the mode — revising §2.2's "the selector exists for editing" |
| D66 | An event can be **placed by clicking the map**, and the precision is read off the zoom — D43 applied to input rather than to drawing |
| D67 | A place may be **a name with no coordinates**, and a bundled gazetteer (Natural Earth plus hand-written historical places) turns the names history uses into points, offline |

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
- **Two registers of copy, and only two** (D19). Controls, labels and panel titles are
  lower-case — `your data`, `packs`, `event`, `regions`. Prose addressed to the reader is
  sentence case, in whole sentences. There is no third: the screen had lower-case controls,
  Sentence-case headings *and* UPPERCASE labels at once, and the same panel was `your data` in
  the footer and `Your data` in its own heading. A title that names a control takes the
  control's case.
- Counts go through one `plural` helper, because "0 events · 1 eras" is what a `n === 1 ? '' :
  's'` at every call site eventually produces.
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

**As built, a period phrase is `fuzzy`, not an instant at a coarse granularity.** `12th century`
and `1180s` name a span the event sits *somewhere in*, which is a claim about vagueness rather
than a moment measured roughly, and the editor should offer it as one — so the parser gives them
`fuzzy` with `granularity: 'century'` or `'decade'`. The `instant` row's "widened by
`granularity`" still describes a typed `1848`, where the widening is the precision of the
writing and not the shape of the claim.

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

**As built there is no mode selector at all, and the editor is one text field (D65).** The
reason is a property of the pair rather than a simplification: `formatTime` round-trips through
`parseTime` for every shape it can produce. An interval formats as `1914–1918` and parses back
as an interval, a period phrase as `12th century` and parses back as `fuzzy` with century
granularity, and where the numbers alone would lose the claim — "mid-3rd century BC" against
"c. 250 BC" — `text` is kept and the formatter uses it. So the text *is* the mode, and a picker
offering `instant / interval / fuzzy` beside it would be three controls asking what one line has
already said. The same field is used by the event pane and the era pane (`ui/TimeField`); it
commits on blur and on Enter, never per keystroke, because a half-typed date is almost always an
invalid one and reddening the box at `196` is the parser shouting at work in progress.

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
h = β · Δt_px          β = 3 px,  Δt_px = time units per pixel
```

This is the key trick. A screen-space bandwidth means the plot is scale-stable: zooming in
genuinely *resolves* clumps into structure rather than stretching the same curve. "Zooming in
dissolves the mass" is exactly `h → 0`.

**β is 3, not the 5 this section first guessed (D51), and the reason is that β cannot be chosen
without `p`.** The drawn height is `λ^p` (§3.4), and raising a Gaussian to the power `p` widens
it by exactly `√(1/p)` — so at `p = 1/3` every feature reaches the eye **√3 ≈ 1.73 times wider
than the density says it is**. Measured against the synthetic corpus at β = 5, a lone
day-granularity event had a density FWHM of 13 px and a *drawn* FWHM of 21 px: thirty pixels of
hill, a hundred and seven years at full extent, for something that happened on a Tuesday. The
two constants are one decision, and the identity

```
drawn FWHM = √(1/p) · density FWHM
```

is what ties them. Three keeps a lone event's peak at `1/(β√2π) = 0.133`, comfortably under the
0.25 floor of the crossfade below, so an isolated event still dissolves into a mark rather than
sitting on the axis as a permanent bump; and the far view stays an order of magnitude smoother
than the bandwidth at which the sub-pixel grid begins to comb.

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
- **Semantic zoom:** far view while `λ > 1`; crossfade over `1 → 0.25`; tick marks below.
  Tying the transition to the same quantity as the height means there is no popping and no
  arbitrary zoom thresholds to tune. Labels appear on a separate, simpler test (available label
  width without collision).

Offer auto-ranging as a toggle, off by default.

**What is calibrated is a rate, not a λ (D48).** λ counts events in a *pixel column*, so it
scales with `span / width` — and the first implementation measured λ_ref once on a hard-coded
1600 px canvas and then used it at whatever width the browser actually gave it. Measured on the
800-event corpus, the 1.15 of headroom was gone by 1400 px, eleven columns were clipped flat at
1100 px and seventeen at 390 px: two different centuries drawn at exactly the same height, which
is the one thing this section promises never happens. Calibration now divides the width back
out —

```
rate_ref = λ_max(extent, w) · w / span            calibrated once per corpus
λ_ref    = rate_ref · span / width · headroom     derived per frame,  headroom = 1.3
```

— where `span` is the **corpus** extent and `width` is the canvas, so the scale is still fixed
with respect to the viewport and the same corpus draws at the same height on a phone and on a
desktop. The rate is only approximately width-invariant, since a peak narrower than the kernel
spreads rather than concentrating; the error is in the safe direction, leaving the peak a little
short rather than clipping it.

**The crossfade is per column, not per frame (D50).** `farViewOpacity` was fed `λ_max` — one
number for the whole canvas — which says the frame is dense because its busiest column is. With
the twentieth century on screen, a single event alone in 400 BC never resolved into anything at
any zoom short of panning the modern peak off the edge, which is precisely the reading the far
view is supposed to make possible. Each column now crossfades on its own λ: the mass fill and
its edge are drawn through a horizontal gradient sampling `farViewOpacity(λ)` every 16 px, and a
mark's opacity is `1 − farViewOpacity(λ at its column)`. This is D35 arriving in the flat view,
two milestones after the depth view had it.

That costs the mass fill its vertical ramp — a canvas gradient runs in one direction only — so
the height of the curve stands in for it, with tall columns taking the bright end. It also
retires `farViewOpacity(λ_max)` as the frame-wide "how near are we" signal, since it no longer
means anything: the share of visible events that resolved into marks is used instead, and it is
what decides how many rows of labels the frame may spend. Hit-testing scales its tolerance by
the same per-mark opacity, so a mark still dissolved into the mass is not a click target —
clicking apparently empty canvas used to select whatever invisible event happened to be nearest.

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
restore nothing.

**The user's own connections into a departing event are tombstoned, not dropped (D45).** They
still have to leave the view — an arc into a hole is what D37's last clause was avoiding — but
every reason D37 gives for hard removal is a reason about *pack* records: re-derivable from the
bundle, and blocked by a tombstone on reinstall. Neither is true of an argument somebody wrote
themselves about why two things belong together, which is the part of this app that is hardest to
replace. A tombstone leaves it recoverable, and reinstalling the pack does not resurrect it, which
is right: a connection nobody has seen for a year should not silently reappear. The confirmation
counts the two kinds separately for the same reason — it used to say only how many events would
go, which is the count that matters least, since pack events come back with one click.

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
not take away a tag the user's own events also carry — and with a floor timestamp, so that
installing a pack adds a missing tag without ever overwriting one the user has renamed or
recoloured (§8.7).

**The premade names have to be typeable (D44).** D39 materialised the tags, and the fork came
back anyway through the other end of the same pipe: a `#tag` is one word, and eight of the twenty
premade regions are not — "Britain and Ireland", "the Nordics", "the Near East". `ensureTags`
compared names exactly, so `#britain` and `#north-america` each invented a private tag beside the
built-in one, and because the map places an event by its region tag, the event simply never
appeared on the map. Names are now compared normalised — `-`, `_` and a space are the same
character, a leading article is dropped — and a built-in may declare `aliases` for genuine
synonyms (`#germany` for "German lands"), never for its parts, which deserve the user's own tag.
The normalisation applies to the user's own tags too, so "Reading List" answers to
`#reading-list`. A name that means a premade tag now materialises that tag at its fixed id rather
than waiting for first run, which makes D39 a convenience rather than the thing correctness rests
on.

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

**Marks are trapezoids too (D49).** An event drawn as a hairline at its mean says it happened at
a moment, and for `1914–1918` that is a lie the store does not tell — the four numbers are right
there, and 27–40 % of a real corpus is not an instant. A mark is now the same shape as an era
bar: a stem at the likely middle, and over it a crossbar solid from `b` to `c` with ramps to
transparent over `a`→`b` and `c`→`d`. It collapses back to the bare stem below `2β` of drawn
width, which is the zoom at which the trapezoid starts to beat the kernel in the density — so
both layers agree about when an interval becomes an interval.

Two details are the difference between honest and unreadable. The crossbar is a three-pixel
ribbon rather than a filled block: this corpus has thirty-eight multi-year events overlapping
any given decade of the twentieth century, and thirty-eight translucent blocks are a solid strip
at any alpha, whereas ribbons leave the stems underneath individually countable. And the bar is
drawn only for `interval` and `fuzzy` events. `1848` is stored as a whole year — an instant
"widened by granularity" (§2.2) — so its numbers are shaped exactly like an interval's, and
drawing every year-granularity event as a year-wide bar turns a decade into one continuous
strip. `mode` is what separates them, and it is in the model precisely because the numbers
cannot: an instant claims *then*, an interval claims *from-to*, and an instant's granularity is
a statement about precision that the density's kernel already carries.

Hit-testing follows the drawing: a mark's target is its span, not the distance to its midpoint,
and where two spans contain the point the narrower one wins — it is the more specific claim, and
the wider one is still reachable everywhere else along its length. The selection ring and arc
endpoints stay on the midpoint, which is the one place a span has that is a single number.

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

**But `lighter` has no ceiling either, and that is its own failure (D56).** At the two-thousand-arc
cap the modern peak pushes towards white, where two hundred crossings and two thousand look
identical and the information is gone in the other direction. Ink per stroke now falls as `1/√n`
in the number of arcs actually laid down, so the total ink over a busy region still grows — as
`√n` — and a busier region still reads as busier, without any region saturating as fast. It is
deliberately gentle and deliberately inert below a hundred and fifty arcs: a sparse timeline
never saturates anything, and dimming it would only make the structure fainter than it needs to
be. Emphasis is exempt — a selected arc, and the arcs leaving a selected event, keep their full
alpha, because their job is to be found rather than to be counted.

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

Eras beyond the row cap are dropped and counted, rather than shrinking every row. The count is
drawn, as a "+N eras" note at the band's right edge: it is the only thing that can say the band
is incomplete, and a nonzero one means the view is lying.

**Naming an era without widening its bar.** A bar's width is a claim about how long something
lasted, so stretching it to hold six more glyphs is a false statement about the world rather
than a cosmetic liberty — which left the band reading `the…`, `the Ro…` and a row of unlabelled
slivers, and nothing at all at 390 px. Three layers instead, in order of how much room they
need. A name that fits inside its bar is drawn there, with its ink chosen by the **composited**
luminance rather than the palette entry, since the bar is drawn at half alpha and what a reader
sees is never the colour in the theme. A name that does not fit is set to the right of the bar
in the same row, tinted with the bar's colour and joined to it by a short leader — and
`layoutLanes` reserves that width in the row, or the next era lands on top of it. Below about
five glyphs nothing is drawn: `the Ro…` names nothing, and three of them in a row read as a
rendering fault. What that leaves unnamed, hovering names: the era under the cursor gets its
full name in a chip, which is the only way to read a sliver twelve pixels wide.

Personal eras have their own hue rather than the selection yellow they were first given. Yellow
already means "selected" and "this arc is being drawn"; a third meaning made the whole band look
permanently half-selected and made a genuinely selected personal era indistinguishable from an
idle one. A warm neutral says *yours* against the grey of canonical eras without claiming to be
lit up, and it fixed a 2.4:1 contrast on the label at the same time.

**The axis.** Ticks are generated in calendar space (`src/render/ticks.ts`) and the spacing floor
is a function of the canvas: `max(56, min(90, width/6))`. A flat 90 px is a desktop number, and
on a phone it is most of the axis — at 390 px it allowed four ticks, of which an 18 px edge cull
then ate all but one, leaving a five-thousand-year span labelled "2500 BC" and nothing else.
Edge ticks are now *aligned* rather than culled: the first label is pushed right and the last
pushed left by half their measured width. A couple of pixels of drift against their own rule is
a far smaller lie than not saying which century this is, and the first and last labels are
precisely the two that say what range is on screen. The year ladder gained a 2000 rung, because
1000 → 2500 is a 2.5× jump and a corpus a few thousand years long lands squarely inside it.

**Nothing to draw is still something to say.** With no events at all the canvas was blank —
indistinguishable from a broken one — and worse, the pannable range came from the events alone,
so on a first-run timeline it was empty, the viewport fell back to a one-day window at the
epoch, and `clamp` then capped the widest zoom at three days: the "my life" era D26 had just
created sat nineteen thousand days away and could not be reached. The frame is now the union of
events **and** eras (D52), with a stated `now − 100 y … now + 2 y` when there is neither, so the
axis, the ticks and the era band always have something to describe. Over that, one muted line:
how to add an event when the store is empty, or — when the window holds no events and no mass
and lies entirely outside the corpus — where the corpus actually is, since panning into the
twenty-second century otherwise looks like the data has gone.

**Interaction.** Wheel = zoom at cursor, drag = pan, pinch on touch, double-click = zoom in,
arrow keys pan / `+`/`-` zoom. Zoom is continuous in log-scale space, animated with a short
ease so the density transition reads as dissolution rather than a jump.

Lifting one finger of a pinch turns the gesture into a drag, in both canvases. Dragging was
cleared when the second finger arrived and nothing turned it back on, so the canvas simply
stopped following the finger still on the glass until it was lifted and put down again — and the
survivor's position has to seed the drag, or the first move after the lift is read as a jump from
wherever the *other* finger last was. `zoomAt` gives its anchor up at the span limits, where
`clamp` cannot honour the window it is handed and re-derives it around the centre instead: a
wheel at the edge of a fully zoomed-out canvas therefore slides rather than holding still, which
is the better of the two invariants to keep at a hard stop.

The ease was promised here and only ever applied to the wheel, which does not need it. A wheel
and a drag arrive as a continuous stream, and easing them would only make the canvas lag the
hand; a double-click, a `+` and a `-` are single discrete jumps, and jumping straight past the
mass-to-marks crossfade makes it read as a cut rather than as detail resolving. Those three now
animate, through one helper shared with the reveal below (`viewport-animation.ts`), and any
gesture arriving mid-flight cancels it — an animation that went on writing the viewport under a
finger would be the canvas arguing with the hand.

**Selecting an event reveals it (D57).** Until this existed, selection changed what the panel
said and nothing else, which made the first thing anyone does with a link look broken: opening
`#e=…` described an event in July 1990 beside a canvas showing five thousand years, with the
event a hairline at the right-hand edge and the list still at the top of the corpus. Every view
now moves to the selection — the two timelines and the map's window in time, the map's camera in
space, and the list by scrolling.

The rule has two halves, and the second is the one worth arguing. *Where*: keep the span the
user chose wherever it already shows the event, because a reveal is a pan whenever a pan is
enough and zooming to a day around an instant throws away the period they were reading; widen it
only to hold an event longer than the window. *Whether*: being inside the window is not the
test. Fitted to the whole corpus every event is inside the window, and each one is a hairline
dissolved into the mass by the semantic zoom (D50) — so a window wider than four times the
event's own period counts as not showing it, with a decade as the shortest period recognised. An
instant therefore reveals to about forty years, which is a period rather than a point. Stated as
a multiple rather than solved from the density that actually governs the crossfade: a solved
window would land somewhere different for every event, and a reveal has to be predictable enough
that the second one teaches you what the first one did.

Two exceptions, both of them cases where moving would be wrong. A selection made *by clicking
this canvas* never moves it — the mark was already under the pointer, and pulling the picture
out from under it is the view arguing with itself. And an event filtered out of the view is not
there to be revealed.

The depth view places the revealed event at 0.85 of the window rather than in the middle of it.
The corridor allocates screen space as `1/z` (§6.7), which puts the vertical middle of the
picture a tenth of the window from its newest edge — so an event centred in *time* is drawn at
the horizon, two pixels tall. Placed this way it arrives at eye level with its past receding
behind it. It is the same function with one argument different, which is all D33 lets the
projection change.

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

Virtualised rows, so 50k events costs nothing. Which is also why it has to follow a selection
that arrived from somewhere else: with the rows windowed, the selected one is not merely
off-screen but *not rendered*, so opening `#e=…` left an empty-looking list at the top of the
corpus beside a panel describing an event fifty years later. Only the arrows used to scroll.
Arrowing moves as little as possible, or the list would jump a page per keypress; an arriving
selection goes to the top of the window instead, because on a phone the detail sheet covers the
bottom two thirds of the scroller and "just inside the window" is behind the sheet describing
the very row it is hiding.

`Enter` on a row is the way back to the picture: it switches to the canvas last used and reveals
the row there (§6.1). The same link sits under the date in the event panel, which is where
someone reading about an event is when they wonder where it sits.

**The pane is an editor, which it was not.** The event panel showed the title, the date and the
tags as text and offered no way to change any of them, although `updateEvent` had covered all
three since M2 — so a title mistyped into the capture box, the surface deliberately optimised for
speed over accuracy, could be read back and not corrected, and the only route to a fix was delete
and retype. The title is a borderless input styled as the heading; the date is the shared
`TimeField` (D65); the tag chips carry a `×` and a `+ tag` box beside them. All three commit on
blur or Enter and revert on Escape, never per keystroke.

The tag box suggests over the whole vocabulary, **grouped, with the regions first and labelled
`regions — these place the event on the map`**, and every region chip — here and on the filter
bar — carries a small pin. That is the whole answer to the one thing nobody worked out about the
map: almost every dot on it is placed by a region tag (§11.4), and until the pin existed there
was nothing anywhere in the interface saying which of thirty words were geography. Tags are
emitted as **names**, never ids, so that `ensureTags` remains the single answer to what a word
means (D20, D44) — one `commit` covers resolving the names, inventing any that are new, and the
edit itself, so an undo takes back the tag and the tagging together.

The "from a pack" line moved **above** the title. It is a warning about the edit that adoption
will trigger (§5.1), and under the title it was read after the thing it is about had been done.

**A `listbox`, not a `grid` (D61).** The accessibility claim above was, for a while, only a
claim: the rows were `role="row"` over bare `<span>`s inside `role="grid"`, and a grid whose
rows contain no cells announces nothing at all — the one view that exists to be the accessible
presentation of the canvas was the least accessible thing in the app. There was no
`aria-activedescendant` either, so a screen reader following the arrow keys was told nothing
about where they had got to. It is a single-column list of options, which is what a listbox is
and what the connect picker had been declaring correctly all along; the container carries
`aria-activedescendant`, each row an `id`, and the two wrappers the windowing needs are
`presentation`, since a listbox owns its options directly. `aria-selected` stays the selection
and `aria-current` stays the cursor, for the reason §6.4 gives.

The canvases were mislabelled in the opposite direction: `role="img"` on a focusable element
whose arrow keys pan it and whose `+`/`−` zoom it, which is a picture as far as a screen reader
is concerned — so it swallows exactly those keys. They are `role="application"` with an
`aria-roledescription` and a label that says what the keyboard does and where the same data is
available as text. The map keeps the role and admits in its label that it is pointer-only for
now.

The list takes the filtered corpus from the app rather than filtering again. It was running
`applyFilter` over the whole timeline inside the same memo as the search, so every keystroke in
the search box re-filtered everything before searching it — twice the work of any other view,
for an answer the app had already computed for the footer.

### 6.3 Search

Over the in-memory store: substring across `title`, `notes`, `learned_from` and tag names, plus
fuzzy matching on `title`. A linear scan per keystroke — no index, no worker.

**Measured**, since the original claim of "imperceptible at 50k" was a guess and turned out to
be half right: about 1 ms at a few thousand events, and 16–21 ms at 50,000. Comfortable at any
size a real personal timeline will reach for years, and roughly one frame at the stress ceiling.
The cost is the scan itself, not the sorting or the fuzzy path — capping results barely moves it —
so the next step, if it is ever needed, is an inverted index rather than a smarter scan. Folded
text is cached against the event array, which is what keeps the scan to one pass over already-
lowercased strings — and, since the caller filters the store and so hands over a *fresh array of
the same records* on every keystroke, against each event record as well. The array cache alone
cached nothing in the app: 85 of the 96 ms a keystroke cost at 50k events went on re-folding text
that had already been folded.

The fuzzy path is a subsequence match, so it forgives a dropped or an extra letter — `lepnto`
finds Lepanto — but not a transposition: `seige` does not find `siege`.

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

**One rule in the store still needs the list to have a cursor of its own.** Because *every*
selection completes the pick, arrowing down the list while one was armed wrote a connection per
keypress and left a trail of them behind the cursor — the rule working exactly as specified,
against a component that had assumed moving and choosing were the same act. While a pick is
armed the arrows therefore move a local cursor and `Enter` commits it, which is what the
picker's own footer has always promised (`↑↓ to move · ⏎ to connect`). Committing still goes
through `select`, so the rule stays in one place; what changed is that the list no longer calls
it on the way past. The cursored row is ringed in the pending-connection yellow and marked
`aria-current` rather than `aria-selected`, because while a pick is armed the *selection* is
still the connection's first endpoint.

Finishing the pick lands in the note editor with the cursor in it. The note is the point.

**Dismissing is not cancelling.** The picker's backdrop called `cancelConnect` while the footer
beside it called `closePicker`, so the same modal had two exits that disagreed about whether the
pick survived — and the accidental one, a click beside the dialog, was the one that threw the
pick away. The backdrop now dismisses and leaves the pick armed, which is what the banner then
explains; Escape cancels, because that is the exit you mean.

**Escape, and what a modal is (D60).** Every dismissible thing wanted the same key and each one
answered for itself: the data panel closed on it, the packs panel ignored it, the detail pane
ignored it, and an armed pick cancelled from a window listener underneath all of them — so the
app had no answer to "what does Escape do here" beyond which component had happened to bind it.
There is now one stack: layers register in mount order, only the topmost acts, and the ones
beneath stay bound so closing the top hands the key back. A keystroke a field has already spent
on itself — quick-add clearing its own box — is left alone, which is what `defaultPrevented` is
for. With a panel open over an armed pick, Escape therefore closes the panel and a second Escape
cancels the pick, in that order.

The same stack settles what "modal" means here, which was previously nothing: three panels
carried `aria-modal="true"` while Tab walked straight out of them into the chrome behind,
closing one dropped focus onto the document, and the window shortcuts went on firing underneath
— `c` stacked a second dialog on top of the first, and `/` focused the capture box *behind* the
overlay so the next keystrokes went somewhere invisible. A modal is now exactly the thing that
takes the keyboard: it traps Tab, restores focus to wherever it came from, and registers itself
so the global handlers can stand down. The one key a modal does not block is `?`, since the
overlay it opens is the only one it can close. The data panel also carried its dialog role on
the *backdrop*, which told a screen reader that the whole screen was the modal — including the
chrome the overlay exists to take out of play.

**The shortcuts are written down.** `/`, `c`, `⌘Z` and the rest existed in a window listener and
nowhere in the interface, so the only way to learn them was to read the source. A `?` overlay
lists them, in the picker's idiom; `?` is registered in the same handler as `c` so the typing
guard covers it, a dim `/` sits inside the right edge of the capture box, and the pane's
`connect…` button carries `connect (c)` as its title.

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

**Text fields commit when the typing stops, and the editor is keyed on its subject.** Every one
of them — the note, a connection's argument, an era's name, `learned from` — wrote through to the
store on every keystroke: a database write, a re-render of the whole app, and an `updated_at`
recording the moment of the last letter rather than the moment of the thought. The draft is now
held in the component and committed on about half a second of idle and on blur, which is what the
place field had always done and what nothing else had copied. It complements rather than replaces
the undo coalescing (§8.6): the window is one second per `(kind, id, field)`, so a slow typist
still gets one undo entry per sentence rather than one per pause.

The mode was worse, because it was *sticky across selections*. `MarkdownEditor` reads "empty note
wants a cursor, written one wants to be read" once, at mount, and all three panes were one
long-lived component — so reading one event's note and then selecting an event without one left
an empty preview beside a `write` tab that was disabled: a field that could not be typed into and
had nothing in it. Each pane is now keyed on the record it is showing, so the drafts and the mode
belong to that record; and the selected tab is never the disabled one, whatever else happens.
That keying is also what keeps §6.4's promise that finishing a connection lands in a focused note
editor — `autoFocus` only fires on a fresh mount, so without it the promise held for the first
connection of a session and no other.


### 6.6 URL state (D24)

Viewport (centre and span) and selection live in the URL hash. Cheap now, awkward to retrofit
once React state and the renderer's viewport have grown into each other. It buys bookmarkable
periods immediately — "the 1840s, art history only" is a link — and shareable links for free when
the social layer arrives.

**The pan has to write it too.** For a while it did not: the hash was mirrored from a React effect
watching selection, tags and view, and panning changes none of them — so the one half of the state
the section names first never reached the address bar, and the link said "art history only"
without the 1840s. The write is now scheduled by the viewport callback as well, on the same ~300 ms
debounce, and it reads everything it needs at write time from a ref and from the store rather than
from a closure. That keeps the property §6.1 depends on: **React never re-renders on a pan.**

Restoring runs in the opposite direction and exactly once, on mount. It has to set the selection
*directly* rather than through the store's `select`, because while a connection is pending `select`
completes it (§6.4) — a bookmark is not a click, and routing it through the connect rule let a
re-render write a connection nobody asked for.

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
opposite each other instead of competing for space. They take the personal hue §6.1 settled on,
not the selection yellow: the argument against a third meaning for yellow is the same one, and on
this flank it was worse, since the personal lane is the one nearest the eye.

Bars too short along the corridor to hold a name — which, with a window usually spanning
millennia, is nearly every personal era — are named on **hover** instead, exactly as the flat
view's slivers are. And the era hit target is the bar: a bar fills four fifths of its lane's step
and the test used to *round* to the nearest lane boundary, so it sat a third of a bar off the bar
and the deliberate gap between two lanes was claimed by whichever was nearer.

**Marks carry their span too (D49).** The axis has turned through ninety degrees, so an event's
stem runs *across* the corridor and its span runs *along* it, as a ribbon down each bank of the
river. `spanBar` needed no changes for that — it works in whatever pixel coordinate it is handed,
and the corridor's is the same one the era lanes are already laid out in. So both layers agree
about when an interval is an interval in this view as in the other.

**One occupancy for three label systems (D53).** Year labels, era names and event titles all
write into the same two strips of canvas beside the corridor, and none of them knew the others
were there: `1000` was set inside an event title, and *Elsa Hovden resigns* was laid across *the
long nineteenth century*. Every candidate now tests against one list of claimed rectangles per
side, filled in priority order — the year rail first, because it is the frame of reference the
whole projection is read against, then era names, then event titles, which are the most numerous
and the only ones a hover can recover.

Two changes come with it. Titles are anchored **outside** the era lanes rather than just outside
the river: the river reaches 0.5 of the corridor's half-width and the lanes start at 0.6, so near
the ground a title was drawn through the era band *by construction*. The price is real — the
margin outside the lanes is narrowest exactly where the corridor is widest — so a title there is
fitted to the room that exists and, below about eight glyphs, is not drawn at all. And the years
are set on **one rail**. The ring already crosses the whole corridor, so the year at each end of
it was the same fact written twice, into the two strips the other two systems have to share.

**The sky ends at the horizon.** Its gradient used to run forty pixels past it, which put the
brightest stop *below* the horizon and then stopped dead — a hard-edged rectangle across the full
width of the canvas, sitting in the ground plane and describing nothing. The wash now ends at the
horizon and a separate band carries it down into the ground, fading to fully transparent, which
is the glow the original was reaching for.

**Arcs go over the mass and under the marks**, as §6.1 says and as the flat view does. Drawn last
with `lighter`, they were adding their brightness to the label chips and the era names rather
than to each other.

**The connection being drawn is drawn.** `Selection` has carried `connectFrom` from the start and
this view ignored it, so arming a connection and switching here showed nothing at all — while the
next click completed it regardless. A gesture with no feedback and a real effect is the worst of
both, and the same dashed vault the flat view draws now says what is about to happen.

**Nothing to draw is still something to say, here too.** The corridor took its pan bounds from
the events alone and fell back to a one-day window at the epoch, which `clamp` then read as a
three-day zoom limit: on a first-run timeline the view ran from 1 January to 2 January of year
one, and the "my life" era D26 had just created could not be reached at any zoom. It frames
events **and** eras now, with the same stated default as the flat view (D52).

**Dragging grabs the ground.** The time under the cursor when the drag began stays under the
cursor. A constant pixels-to-time factor is meaningless when a pixel near the horizon is worth
eighty at your feet, which is why `depth-interaction.ts` exists rather than a flag on
`interaction.ts`. Zoom still goes through `zoomAt` by converting the cursor's height to the
equivalent position on a linear axis.

### 6.8 The chrome around them (D58, D62)

The chrome is deliberately quiet, and quiet chrome degrades in a particular way: everything ends
up the same size, in the same grey, in whichever row it was added to. The footer had become a
status readout (`800 events · 133 connections · 10 eras`, the backup age), a creating action
(`+ era`), an undo, and two panel openers — five things of three different kinds, set in the
same eleven-pixel word, in one row.

**Sorted by kind rather than by history.** The footer is status: what is on screen, how long
since a copy of the timeline was written, what went wrong — plus the two things that are *about*
that state, undoing the last change and the panel that explains the backup age. `+ era` moved
to the header beside the view nav, because an era is derived from the viewport — you zoom to
the period you mean and press the button — which makes it the same kind of act as choosing a
view. `?` sits at the far right of the header. `packs` stays in the footer, since what is
installed changes what the picture *means* (D38), which is the same sort of claim as the counts
beside it; it is underlined so it reads as a way in rather than as another reading. Undo names
what it will undo — `undo add event` — which the store has always known and the button never
said.

**One faint ink, at full opacity (D62).** Secondary text was written as a fade of the muted
token: `text-paper-dim/70` on the tag-group labels, `/60` on placeholders. Measured against the
surfaces behind them those are 2.6:1 to 3.2:1, well under the 4.5:1 small text needs, and the
worst of them were the ten-pixel labels. Nothing dimmer than `paper-dim` itself clears 4.5:1 on
the *chart surface*, though, so a single "faint" token cannot serve both planes: `paper-faint`
is `#7d7b75`, 4.6:1 on the page plane and used only there, and on `surface` — which is every
input in the app — `paper-dim` at full opacity is the floor at 4.9:1. Alpha on ink is gone
either way, because a colour you cannot name is a colour nobody measures.

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

**Three things measured at 390 px say the chrome was still a desktop's** (D63, and the touch
targets are D58's other half).

- **The header cannot hold capture plus four nav words.** The placeholder truncated at
  `#europe #`, cutting off the tag half of the grammar — and the placeholder is the only place
  that grammar is written down. Below `sm` the view switcher moves to a segmented control across
  the top of the footer and the wordmark goes; capture keeps the width, which is the priority
  §9 sets. `+ era` and `?` stay in the header, at 44 px.
- **Nothing was tappable.** The nav buttons were 24 px tall, `filters` — the only route to
  filtering on a phone — was 27×17, the packs checkbox was 13×13 and the footer's buttons were
  16 px. Every single-row control is now at least 44 px tall below `sm`, with the visual size
  unchanged; the two checkboxes became labelled toggle buttons, which say their own state and
  match the tag chips they sit beside. The chips themselves stop at 32 px on purpose: they wrap
  into a grid four pixels apart, and a 44 px target there would overlap the row above it and
  swallow the tap meant for another tag.
- **The sheet is capped at 50vh** and padded for the home indicator with
  `env(safe-area-inset-bottom)` (`viewport-fit=cover` was already set). At 62vh a 844 px phone
  had 320 px of "context" left, most of it header and filter bar. The argument for a sheet over
  a takeover is that you can still see what you selected, and with the selection now revealed on
  the canvas (D57) there is something there worth seeing.

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

**A third silent failure, on the page's side of it (D64).** The registration was made once and
never looked at again, while the worker it registers calls `skipWaiting` and deletes the old
cache the moment it activates. So a deployment can claim an open tab and evict the assets that
tab is still running: it keeps working until it asks for something it has not already loaded,
and then fails for no visible reason. Nothing on the page can prevent that — the swap is the
worker's own decision — so the page notices it instead. It asks for an update hourly and watches
three edges, each of which the other two miss: a worker already `waiting` when the tab opened, a
`statechange` to `installed` while it is open, and a `controllerchange` from a swap another tab
triggered. The last is filtered on whether the page was controlled to begin with, since the very
first install claims an uncontrolled page and that is the app arriving, not a new version of it.
The footer then carries one quiet status item, `a new version is ready · reload` — a state the
app is in, not an offer.

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
- **"On load" meant on import only, for a while.** Files were migrated and the database was not,
  so records written by an older build were handed to the app unchanged — the one case the chain
  exists for. The schema version of the records on disk now lives in a small `meta` object store
  beside them, and a load that finds it behind runs the same chain a file goes through, writes the
  result back and records the new version, so the cost is paid once. Databases that predate the
  meta store have their version inferred from the IndexedDB version, which has tracked the schema
  version so far. The guard points both ways: a database written by a *newer* build refuses to
  open rather than be quietly downgraded, on the same argument as `SchemaVersionError` at import.
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

**Layers 1 and 2 are automatic, and for a while neither was.** Every piece of both existed except
the thing that runs them: `requestPersistence` said "call it on first write" in its own docstring
and nothing did, and the only caller of `writeSnapshot` was the "back up now" button — so a folder
chosen in January still held January's snapshot in August unless the user remembered. A backup
that depends on being remembered is layer 3 with extra steps. As built:

- **Layer 1 fires on the first real write**, once per timeline, and the answer is kept so the
  panel can tell "never asked" from "asked and refused" — the browser reports both as simply not
  persisted, and only one of them is worth offering a button for. On the first write rather than
  on load because Chromium weighs engagement: asked as the page opens the answer is often no.
- **Layer 2 writes on open, then every ten minutes when the timeline is dirty, and once on
  `pagehide`.** The store stamps every mutation and the schedule compares that stamp against the
  one it last wrote, so an idle tab costs nothing — not even a permission query. Another tab's
  write counts as a mutation too: the folder is per machine, not per tab.
- **It never prompts.** Folder permission is only granted on a user gesture, so a cycle that finds
  permission ungranted does nothing at all and leaves the panel to say so. A dialog raised by a
  ten-minute timer is how an app gets denied permanently.
- **It flushes first**, since the debounce window is the likeliest data-loss path (§8.7) and a
  snapshot taken without flushing can be missing the edits it was scheduled to protect.

**"The last ~20" is twenty days, not twenty saves.** The filename is the local date, so every
write after the first on a given day overwrites that day's file — which is what makes a
ten-minute cycle cheap. Two other things follow. A file that is *empty* is not counted towards the
retention and is always pruned: a failed write used to leave a zero-byte file behind, because
`getFileHandle(…, { create: true })` creates the file before `createWritable` can fail, and it
then sorted as the newest snapshot and would have restored nothing. And a write that fails now
removes the file it created, if it created it.

**An export is recorded as an export (D47).** All the page can do is click an anchor; whether a
file was written is decided afterwards, in a dialog this code cannot see. Counting that as a
backup meant a cancelled save-as cleared the amber warning as thoroughly as a real snapshot did.
The two are stamped under separate keys, the indicator counts from whichever is more recent and
words itself after which one that was, and exports carry an `-HHMM` suffix so two on the same day
do not collide — which also keeps them outside the snapshot pattern, so pruning can never delete
one.

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

**Consecutive edits of one field coalesce.** Every keystroke in a note is a mutation, so an entry
per mutation meant a fifty-deep stack was emptied by a single typed sentence: the more work you
had done, the less of it undo could reach. Edits of the same field of the same record, within a
second of each other, are merged into the entry already on top, keeping the *older* record as the
one to restore. Changing field breaks
the merge on purpose: going back to before you touched the title is a different step from going
back to before you touched the note. Each entry carries the label of the mutation that made it, so
the footer can say what the next undo would take back.

Undoing the creation of a record tombstones it rather than dropping it, since the store is
upsert-only (D9). One exception: a tag another live record still carries is left alone. Undoing
the quick-add that invented `#war` must not take the tag away from the four events that have since
been given it.

### 8.7 Known limitations of the merge rule

Found while building it, and worth writing down before the sync layer inherits them:

- **`updated_at` is client wall-clock time.** One device with a wrong clock can stamp a record in
  2035, and last-write-wins will then never overwrite it again. A logical clock is the real fix;
  a guard on absurd future timestamps at import is the cheap partial one, and **it is now in
  (D46)**. Anything more than a day ahead of the importing machine is **clamped** to the moment of
  the import rather than skipped: the record is the user's data and is very likely fine, it is
  only the claim to have been written tomorrow that is not — and that claim is what would freeze
  the id against every later edit. Clamping keeps the content and costs the record only its place
  at the front of the queue. A day is wide enough for every honest cause and narrow enough to
  catch the dishonest one. `created_at` is left alone; nothing decides anything by it.
- **A document was trusted to contain records (D46).** `asDocument` checked `schema_version` and
  nothing else, so hostile or hand-edited JSON put events with no `when`, string coordinates and
  `tags: 'x'` straight into the store — and the store is trusted absolutely by everything
  downstream, so an event with no `when` threw inside `compareEvents` the moment it was sorted,
  which is not a state any amount of clicking gets out of. The merge now shape-checks every
  incoming record against its kind, rejects the ones that fail, and reports the count so the panel
  can say "N records could not be read" rather than claiming a clean import. Connections are held
  to one rule more: an endpoint that neither the document nor the timeline has means the arc goes
  into a hole, so it is dropped. Only *incoming* records are checked — deleting what is already
  there would be the merge losing data on its own initiative. The checks are deliberately shallow
  and cover only the fields the app dereferences without asking, because a document from a future
  version will carry fields this build has never heard of. The validation lives in `mergeDocument`
  rather than `asDocument`: that is where a record actually enters the timeline, every route in
  goes through it, and it is the only one of the two with anywhere to report what it threw away.
- **The string fallback in `compareTimestamps` is kept, with its cost stated.** A value that will
  not parse has no instant to compare, and a byte comparison at least keeps the order total and
  deterministic, so merging the same file twice reaches the same timeline. The cost is that
  `'zzz'` sorts above `'2026-…'` — the same hole the future guard closes for readable values,
  left open because a garbled string cannot be clamped to anything. Nothing this app writes
  reaches it.
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
  "re-read these ids, drop the ones that are gone" — and the receiver now actually implements it.
  It ignored the payload for a while and simply reloaded everything, which threw away whatever the
  receiving tab had typed since its last flush; the record it *had* just been told about was the
  only one it was entitled to overwrite. The splice keeps the local record where that is the newer
  of the two, and clears the undo stack outright, because every step on it was computed against a
  timeline that no longer exists. A `replaceAll` announces once per kind, so the five messages are
  gathered into one reload.
- **An undo is a new write, not an old one.** Restoring a record put its old `updated_at` back, so
  a backup taken between the action and the undo compared as newer and silently re-applied the
  change the user had just taken back. The content is old; the write is new, and it is stamped
  accordingly.
- **The premade tags a pack carries are upsert-if-absent.** They are references, not content: a
  pack that mentions Europe needs Europe to exist and has nothing to say about what it is called.
  Emitted with `now`, they were newer than the user's own rename and the merge rule dutifully
  undid it on every install. They now carry a floor timestamp, so they are added when missing and
  never preferred over anything already there.
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

It has to empty the **write queue** as well as the database, and in that order. A record still
waiting on the debounce was written back a moment after the store was cleared and came back on the
next load, which is a startling thing for the one irreversible action in the app to do. Nothing in
memory is cleared until the write has actually landed, either: a failed reset that had already
blanked the screen would look exactly like a successful one that lost everything.

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

**Skip creates nothing, which revises D26 to an offer (D59).** `skip` used to seed the life era
from `this year − 30`, so declining to answer left a personal era on the axis claiming to be
your life, dated from a year you never gave — the one record in the app the user has no way to
check against anything, sitting in the one place the whole reading depends on. Skipping now
materialises the premade vocabulary and nothing else: the tags have nothing to do with the
question and everything to do with a typed `#war` attaching to the built-in tag (D39). The offer
does not disappear with the screen — while no personal era exists, the filter bar carries a
small `add my life`, which asks the same question again and says so in its own words, without
the onboarding prose or the pack step. And the form now gives a reason when it refuses a year:
`1850` was rejected by `parsed > 1850` with nothing on screen but a disabled button.

**Onboarding is a takeover (D58).** It used to render inside the shell, so the header and footer
stayed live behind the one question the app asks: you could add an event, switch views or open
the packs panel while being asked your birth year, and "never backed up" glowed amber before
there was anything to back up. It returns before the shell now, as the loading and error states
already did.

### Capture friction is the top product risk

Above any rendering concern: the app lives or dies on how fast you can add an event *while
reading*. Target a single input line with the date parser inline — `battle of lepanto 1571
#europe #war` — a global keyboard shortcut, and a mobile share-sheet target later. If adding an
event takes more than a few seconds, the timeline never gets dense enough to have mass, and the
entire premise fails. Treat this as a first-class design goal in M2, not polish.

**The parse is shown before it is saved, which is what the lenient grammar was sold on.** §2.2
justifies a parser that guesses — the rightmost of two years, a period phrase as a fuzzy span — by
promising that "the quick-add UI shows the parsed date back, so the rare wrong guess is visible
before it is saved". It was shown only *after*, in a panel reporting a fact about a record that
already existed. The date and the tags now appear faintly in the box's right gutter as you type,
on a ~100 ms debounce, from the same pure `parseQuickAdd` the store calls — so a misread year is
caught by the person who typed it, with the cursor still in the box.

**Success is a line; trouble is a panel.** The two outcomes are not the same kind of news and had
the same shape: one absolutely-positioned dropdown that cleared only on the next keystroke, so
`added · 1571` sat over ten filter chips indefinitely. A confirmation is now a status line in the
same gutter — `added · <title> · <date> · #tags`, with `undo` beside it — which says everything
the line claimed, including which tags it resolved to, and clears itself after four seconds or on
blur. A duplicate warning or a refusal stays a dropdown and waits to be dismissed on purpose,
since the thing it is warning about is the failure mode §6.3 calls the obvious one for a
capture-optimised tool. Its duplicate rows are buttons that select the existing event, which is
the whole point of showing them and was not previously reachable.


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
its true size. An event tagged only *Asia* is vague to two thousand kilometres, because that is
genuinely all that is known about where it happened. Drawing it as a neat dot would be the same
lie the time model refuses to tell about dates. A centroid would be worse than useless here: the
centroid of Europe's landmass is in Belarus.

**The halo is a ring, not a disc (D54).** The claim it makes is "known to within about here",
which is a statement about an edge — and at world zoom the filled version was a hundred and
twenty-five pixels of flat translucency saying nothing the outline does not, over the part of the
map the eye was meant to land on. Worse, the halos were drawn inside the per-cluster loop, so
every small cluster's wash went over the large dots already painted. All of them are drawn in one
pass before any dot now, as a hairline at the true radius with a very soft gradient inside it so
it does not read as a drawn boundary.

Clustering happens in **screen space**, on the same reasoning as the density's screen-space
bandwidth (§3.1) — what matters is whether two dots would overlap where they are drawn. Zooming
in therefore separates a cluster into its parts, exactly as zooming the timeline resolves mass
into events. Dot area is proportional to count, and a cluster is anchored by its *best*-placed
member, so one precise event among fifty vague ones is not drawn as continent-sized.

**A grid does not deliver that, and the grid was all there was (D55).** Bucketing by
`round(x / cell)` puts two points a fifth of a pixel apart into different buckets whenever the
cell boundary falls between them, and the promise in `clusterEvents`' own first line — no two
clusters closer than `radius` — was simply false. Against a real corpus it showed: at world zoom
the European region anchors sit nine to twenty-nine pixels apart and are drawn as fifty-pixel
discs, so the map opened on a stack of five overlapping counts over France with nothing legible
in it. The grid is now the cheap first cut, and two or three agglomerative passes finish the job:
any two clusters whose **drawn** discs would overlap become one. Drawn, not stated — whether two
dots overlap depends on how the renderer sizes them, so the radius function is passed in rather
than assumed, and the clustering and the drawing can no longer disagree. A sweep ordered in `x`
keeps it near-linear, and the ordering is a deterministic function of position, so the grouping
does not flicker between frames.

The size cap moved with it. Area proportional to count is right, and `min(26, 3.4·√n)` saturated
at fifty-nine events — so on this corpus a Europe of four hundred and ninety-seven was drawn
exactly as large as a Britain of sixty-one, and the encoding was gone across most of the range
that matters. Forty saturates at a hundred and thirty-eight, which is a disc a map can hold;
above it the count label carries what the area no longer can, which is why the label is drawn on
every dot big enough to hold one.

Coordinates can be typed as `59.91, 10.75` — the same choice as the era span field, since a
map-picker for a field almost nobody fills in is a lot of interface for very little. Impossible
pairs are rejected rather than clamped: a latitude of 200 is a typo or a swapped pair, and
quietly moving it to the pole hides the mistake in the one place it would look plausible.

**A place may be a name, and there is a gazetteer for the names history uses (D67).** The field
accepted coordinates and nothing else, so typing `Constantinople` reddened the box — although
`name` is the first field of `Place` and the only one that is not optional. Three routes now, in
the order a person reaches for them. A name the gazetteer knows brings its coordinates *and its
own radius*, offered as suggestions while typing and attached on Enter. A name it does not know
is stored as a name, with the field saying plainly that this is not yet a point on the map and
offering the two ways to make it one. Coordinates still work, and now include `59,91 10,75` and
`N59.91 E10.75` — a decimal comma is how half of Europe writes a number, including the country
this app is named in, and refusing it was a parochialism.

The gazetteer is bundled, for the reason the coastlines are (D25): geocoding a place name is
exactly the request that would leak what someone is reading, to a third party, from a timeline
they were told never leaves the device. Twelve kilobytes of `name|lat|lon|precisionKm`, from three
sources — Natural Earth's 243 populated places at 25 km each, its 177 countries at their label
point with the radius derived from the country's own area (`√(area/π)`, so Russia is 2321 km and
Monaco is the 10 km floor), and about sixty-five **historical** places written by hand. The last
group is the half that matters and the half no modern gazetteer has: Constantinople is not
Istanbul, Carthage is not a suburb of Tunis, and the radius is the size of the place as it was.

**And an event can be placed by clicking the map (D66).** "A map-picker for a field almost nobody
fills in is a lot of interface for very little" was right about a *picker* and wrong about the
map, which already exists, already knows how to turn a pixel into a point, and is the only
surface on which the answer to "where did this happen" is obvious. The mode is armed from the
place field, held in the store beside `connectFrom` — one piece of state the whole app can read
rather than a flag inside whichever component is mounted — and announced by a banner in the same
yellow, cancelled by the same Escape. The app switches to the map and comes back afterwards to
where it was, because the offer is made from a pane reachable from every view.

The precision comes from the **zoom**, not from a constant: six pixels is about as accurately as
anyone points, and six pixels is two hundred kilometres at world zoom and five in close. So a
click while looking at the whole of Europe records a Europe-sized uncertainty, and the halo drawn
for it tells the truth without anyone having to think about it. That is D43 applied to input
instead of to drawing — the same refusal to record a confidence nobody has. A name already typed
survives the click: someone who wrote "Constantinople" and then pointed at the Bosphorus has said
two true things about the place, and keeping only the numbers loses the better half.


