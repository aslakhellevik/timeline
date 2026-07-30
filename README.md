# Timeline

A personal historical timeline: the events *you* have encountered — in books, conversations,
news, lectures — placed on a shared axis of time, and connected to each other.

Most timelines are canonical and impersonal: someone else decided what belongs on them. This
one is a record of an individual's accumulated historical knowledge. It grows as you read and
talk to people, and its shape says something about what you know and how you connect it.

## Status

Early idea stage. This repo currently holds the concept only — no implementation decisions
made yet.

## Core concepts

### Events

The atomic unit. An event has a position in time (a date, a year, a range, or something
fuzzier like "mid-3rd century BC"), a title, and optionally notes, sources, a location, and
tags.

Events are entered by the user as they encounter them. The act of adding an event is the act
of saying "I now know this happened."

### Connections

Two events can be connected. A connection is **an object in its own right**, not just an edge:
it has its own document — notes, an explanation, an argument for why these two things belong
together. Some connections are causal, some thematic, some ironic, some purely personal.

This is the part we think is actually novel. The interesting content of a personal timeline is
not the events but the reasoning between them.

### Tags

Arbitrary user-defined tags, plus a set of premade ones:

- **Continents / regions** — used for geographic display
- **History of ideas** — philosophy, art, science
- **AI-suggested tags** — proposed on event creation, accepted or rejected by the user

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

### Spatial view

Events also want to be shown in space, not only time: a world map with dots, driven by the
geographic tag or an explicit location. Ideally coupled to the timeline — scrub through time
and watch the map fill in.

## Social layer

A **social network of timelines**. Timelines are personal, but they are interesting to compare:

- see a friend's timeline
- see the union or intersection of yours and theirs
- see which events they have that you don't
- inherit or fork someone's connection with its explanation

Open questions: is the social layer public/followable, or invite-only between friends? Is the
unit of sharing the whole timeline, or a subset by tag?

## Open questions

- **Time representation.** Fuzzy, ranged and disputed dates are the norm in history, not the
  exception. This has to be designed properly up front — it constrains everything else.
- **Mass rendering.** What exactly is "mass" mathematically? A kernel density estimate over
  events, with bandwidth tied to zoom level, is the obvious starting point.
- **Event identity.** If two users both add "the fall of Constantinople", is that one canonical
  event or two personal ones? Affects the whole social layer and any deduplication.
- **Canonical seed data.** Do we ship a base set of events, or is an empty timeline the point?
- **Connection types.** Free-form only, or a light taxonomy (caused / influenced / echoes /
  contemporaneous / personal)?
- **Platform.** Web, desktop, mobile. The zoom interaction is the hard part and drives this
  choice.
- **Local-first vs. server.** A personal knowledge store argues for local-first; the social
  layer argues for a server.

## Repo layout

Nothing here yet beyond this document. Structure will follow the first implementation
decisions.
