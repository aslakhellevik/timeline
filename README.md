# Årlinje

A personal historical timeline: the events *you* have encountered — in books, conversations,
news, lectures — placed on a shared axis of time, and connected to each other.

*Årlinje* — year-line. The package and any ASCII-only contexts use `arlinje`.

Most timelines are canonical and impersonal: someone else decided what belongs on them. This
one is a record of an individual's accumulated historical knowledge. It grows as you read and
talk to people, and its shape says something about what you know and how you connect it.

## Status

**M0–M4 built**: the pure core, the canvas renderer, real local-first storage with capture,
connections — the arcs, the creation flow and the note that carries the argument — and tag
filtering that visibly redistributes the mass, with eras in lanes below the axis.
The concept below is settled; the technical decisions that follow from it live in
[docs/design.md](docs/design.md).

**v1 scope:** single user, local-first, no accounts, no server. Events, connections, tags, eras,
the density timeline. Everything else is deliberately deferred — see [Deferred](#deferred).

## Core concepts

### Events

The atomic unit. An event has a position in time (a date, a year, a range, or something
fuzzier like "mid-3rd century BC"), a title, and optionally notes, sources, a location, and
tags.

Events are entered by the user as they encounter them. The act of adding an event is the act
of saying "I now know this happened."

Which means an event carries two times: **when it happened**, and **when you learned it** — the
latter alongside *where you learned it from*. Both are free to record now and impossible to
reconstruct later, and they make the timeline replayable against your own life: not just what
you know, but when each piece of it arrived and what brought it.

### Connections

Two events can be connected. A connection is **an object in its own right**, not just an edge:
it has its own document — notes, an explanation, an argument for why these two things belong
together. Some connections are causal, some thematic, some ironic, some purely personal.

This is the part we think is actually novel. The interesting content of a personal timeline is
not the events but the reasoning between them.

Connections are free-form in v1 — no taxonomy, just a note. They are stored as an ordered pair
so a later `caused` / `influenced` vocabulary can be directional without a migration.

### Tags

Arbitrary user-defined tags, plus a set of premade ones:

- **Continents / regions** — used for geographic display
- **History of ideas** — philosophy, art, science

Tags drive filtering and display: view the timeline as art history only, or as Asia only.

### Eras / blocks

Named spans of time drawn on the timeline. Either predefined (the Victorian era, the Warring
States period, the Cold War) or user-defined. User-defined eras are where this gets personal:

- your own life
- other people's lives
- "the years I was reading Russian novels"
- a family's history

Eras give the timeline a personal frame of reference — an event is not just in 1847, it is
*during your great-grandmother's childhood*.

## The graphical view

The default view is a zoomed-out graphical timeline, not a list.

**Mass.** Zoomed out, events are not drawn individually. Regions dense with events show up as
*mass* — a visual weight proportional to how much you know about that period. The timeline
becomes a density plot of your own historical knowledge, and its gaps are visible at a glance.

**Zoom levels.** Zooming in dissolves the mass:

1. **Far** — mass only, plus era blocks and connection arcs
2. **Mid** — individual events resolve as tick marks
3. **Near** — labels and text appear

**Connections** are drawn as colourful lines/arcs across the timeline, colour-coded (by tag,
by type of connection — to be decided). Zoomed out, the connection structure should be the
most visually striking thing on screen.

**Tag-based display.** Filtering by tag changes what contributes mass, so switching from "all"
to "history of ideas" visibly redistributes the weight of the timeline.

Mass is a kernel density estimate whose bandwidth is measured in *pixels*, not years — so
zooming in genuinely resolves clumps into structure instead of stretching the same curve, and
uncertain events stay smeared while precise ones sharpen. The maths is in
[docs/design.md](docs/design.md#3-mass-d3).

## Starting from empty

A new timeline is empty — that is the point. Canonical content is available as opt-in **packs**
(the Second World War, the Cold War, …) which can be installed and uninstalled cleanly.

Pack events are drawn desaturated and can be excluded from mass, because if canonical events are
pre-loaded the density plot stops meaning "what I know". Editing or connecting a pack event
adopts it as your own.

## Deferred

Not in v1. The data model is built so that none of these need a migration.

### Social layer

A **social network of timelines**. Timelines are personal, but they are interesting to compare:
see a friend's timeline; see the union or intersection of yours and theirs; see which events
they have that you don't; inherit or fork someone's connection with its explanation.

Forking a connection is the most interesting of these, and it is cheap: copy with attribution.
The design keeps records merge-ready (stable IDs, timestamps, soft deletes) without building any
sync now. Open: public/followable or invite-only, and whether the unit of sharing is the whole
timeline or a subset by tag.

**Event identity** is settled for now by avoidance: all events are personal, there is no
canonical registry. If two people both add "the fall of Constantinople", those are two events.
Deduplication, if it ever matters, is a matching problem on top — not a schema problem.

### Spatial view

Events also want to be shown in space, not only time: a world map with dots, driven by the
geographic tag or an explicit location. Ideally coupled to the timeline — scrub through time and
watch the map fill in. Location is already in the schema. The hard part is not the map; it is
that borders and place names move.

### AI

- **AI-suggested tags** — proposed on event creation, accepted or rejected by the user. *(TODO)*
- **Automatic generation** — consume content (book, PDF, Word doc), produce timeline points from
  it. *(TODO)*

Both are why every record carries provenance from day one: manual, pack, import, or extracted.

They also both break the privacy baseline — they mean sending your notes and reading history to
someone else's API. That may be worth doing, but it is a decision to make deliberately against a
stated default, not one to arrive at by accident inside a feature. See
[docs/design.md §8.8](docs/design.md#88-privacy-d25).

## Decisions

Answered, with rationale in [docs/design.md](docs/design.md):

| Question | Decision |
|---|---|
| Time representation | One shape — a four-number fuzzy interval — with three input modes: instant (default), interval, fuzzy. Numeric axis is fractional days, proleptic Gregorian, float64 |
| Mass rendering | Kernel density estimate, screen-space bandwidth, closed-form per event |
| Event identity | All events personal; no canonical registry |
| Seed data | Empty by default; canonical content as opt-in packs |
| Connection types | Free-form only, stored as an ordered pair |
| Platform | Web app: Vite + TypeScript + React + Tailwind, PWA, installable, desktop and mobile |
| Local-first vs. server | Local-first; in-memory state, IndexedDB, versioned JSON export |
| Data durability | Three layers: persisted storage, automatic file backup, manual export — all in v1 |
| Views | Canvas and a searchable, keyboard-navigable list, over one shared filter |
| Privacy | No telemetry, no analytics, no network traffic beyond loading the app |
| Spatial view | v2; location stays in the schema from the start |
| Licence / language | MIT; UK English |

Nothing blocks implementation. What is deliberately left until there is something on screen:
[docs/design.md §10](docs/design.md#10-deliberately-left-open).

## Repo layout

```
docs/design.md      technical design and decision log
src/core/           pure, framework-free, fully tested
  model/            entities, ids, the built-in tag set
  time/             calendar, fuzzy intervals, parsing, formatting
  density/          the kernel density estimator
  testing/          seeded synthetic timeline generator
  filter.ts         the one filter predicate every view consumes
  search.ts         search, and the capture-time duplicate guard
  quick-add.ts      the capture grammar
  markdown.ts       a small Markdown subset, escape-first (D27)
src/render/         canvas renderer — no framework imports (D11)
  arcs.ts           connection arc geometry, colour and hit-testing
  lanes.ts          era lane allocation and bar geometry
src/state/          in-memory timeline, mutations, undo, persist queue
src/store/          IndexedDB, merge, backup, durability
src/ui/             React
scripts/shot.mjs    screenshot the running app over CDP, for verification
```

`src/core` never imports from `src/ui` or `src/render`, and `src/render` never imports React.
That boundary is the one architectural rule worth enforcing — see
[D11](docs/design.md#1-decision-log).

Build order: [docs/design.md §9](docs/design.md#9-build-order). **M0–M4 complete**. M5 is packs —
installable canonical content — plus the PWA and mobile polish.

```
npm run dev        # your timeline; starts empty
npm test           # 635 tests
npm run typecheck
```
