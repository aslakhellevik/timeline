import { useEffect, useMemo, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { findPlace, locate, searchPlaces } from '../core/geo';
import { useTimeline } from '../state/timeline-store';
import { Field } from './controls';

/**
 * Where an event happened (docs/design.md §11.4).
 *
 * Two jobs, and the first matters more: **say how the event is currently
 * placed.** Most are placed by their region tag, so most dots on the map are
 * claims about a continent — and a user who does not know that will read the map
 * as far more precise than it is. The line under the field is the honest answer
 * to "why is that dot there".
 *
 * The second is entering a place, and it used to accept exactly one form. A
 * typed **name** — `Constantinople`, `grandma's house` — reddened the box and
 * was refused, although `Place.name` is the first field of the type and the only
 * one that is not optional. Three routes now, in the order a user reaches for
 * them:
 *
 *  - a **name the bundled gazetteer knows** brings its coordinates and its own
 *    radius with it, offered as you type and attached on Enter;
 *  - a **name it does not** is stored as a name, with the field saying plainly
 *    that this is not yet a point on the map and offering the two ways to make
 *    it one;
 *  - **coordinates**, as before, for anyone pasting a pair out of an atlas —
 *    now including `59,91 10,75` and `N59.91 E10.75`, because a decimal comma is
 *    how half of Europe writes a number and refusing it is a parochialism.
 *
 * The hint is a pair of controls rather than a sentence of advice, for the
 * reason the whole review found this pane wanting: telling someone to "add a
 * region tag" and leaving them to work out where is not help.
 */
export function PlaceField({
  event,
  onAddRegion,
}: {
  event: TimelineEvent;
  onAddRegion?: () => void;
}) {
  const updateEvent = useTimeline((state) => state.updateEvent);
  const beginPlacing = useTimeline((state) => state.beginPlacing);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(formatPlace(event));
    setError(null);
    setOpen(false);
  }, [event.id, event.place]);

  const placed = locate(event.place, event.tags);
  const byTag = event.place?.lat === undefined;
  /** A name with no point behind it — stored, honest, and not on the map. */
  const named = event.place !== undefined && event.place.lat === undefined;

  const trimmed = draft.trim();
  const suggestions = useMemo(
    () => (parseLatLon(trimmed) ? [] : searchPlaces(trimmed, 5)),
    [trimmed],
  );

  const store = (place: TimelineEvent['place']): void => {
    setError(null);
    setOpen(false);
    updateEvent(event.id, place === undefined ? { place: undefined } : { place });
  };

  const commit = () => {
    setOpen(false);
    const text = draft.trim();
    if (text === formatPlace(event)) return;
    if (text.length === 0) {
      store(undefined);
      return;
    }

    const pair = parseLatLon(text);
    if (pair) {
      store({ name: text, lat: pair.lat, lon: pair.lon });
      return;
    }

    // A name the gazetteer knows arrives complete — coordinates and the radius
    // that says how big the place is, which is what D43's halo draws.
    const known = findPlace(text);
    store(known ?? { name: text });
  };

  return (
    <div className="relative flex flex-col">
      <Field
        label="place"
        value={draft}
        error={error}
        onChange={(change) => {
          setDraft(change.target.value);
          setOpen(true);
          if (error) setError(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={commit}
        onKeyDown={(keyed) => {
          if (keyed.key === 'Enter') commit();
          if (keyed.key === 'Escape') {
            // Claimed, so reverting the field does not also close the pane.
            keyed.preventDefault();
            setDraft(formatPlace(event));
            setOpen(false);
          }
        }}
        placeholder="Constantinople · 59.91, 10.75"
        inputClassName="tabular-nums"
        hint={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span>
              {placed === null
                ? named
                  ? 'saved as a name — not on the map yet'
                  : 'nowhere on the map yet'
                : byTag
                  ? `on the map by tag, to about ${Math.round(placed.precision)} km`
                  : `on the map at ${describe(placed.lat, placed.lon)}, to about ${Math.round(
                      placed.precision,
                    )} km`}
            </span>
            {placed === null && onAddRegion && (
              <button onClick={onAddRegion} className="underline decoration-line underline-offset-2 hover:text-paper">
                add a region
              </button>
            )}
            <button
              onClick={() => beginPlacing(event.id)}
              className="underline decoration-line underline-offset-2 hover:text-paper"
            >
              set on the map
            </button>
          </span>
        }
      />

      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 top-full z-10 -mt-4 max-h-48 w-full overflow-y-auto rounded
                     border border-line bg-surface py-1 text-xs shadow-lg"
        >
          {suggestions.map((place) => (
            <li key={`${place.name}|${place.lat}|${place.lon}`}>
              <button
                // Kept out of the input's blur, which would otherwise commit the
                // half-typed name before the click on the suggestion landed.
                onMouseDown={(pressed) => pressed.preventDefault()}
                onClick={() => {
                  setDraft(place.name);
                  store(place);
                }}
                className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left
                           text-paper-soft hover:bg-line/50"
              >
                <span className="truncate">{place.name}</span>
                <span className="shrink-0 tabular-nums text-paper-dim">
                  ±{Math.round(place.precision)} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatPlace(event: TimelineEvent): string {
  const place = event.place;
  if (!place) return '';
  if (place.lat === undefined || place.lon === undefined) return place.name;
  // A place that has a name *and* a point shows the name: it is the half a
  // human can read, and the numbers are one click on the map away anyway.
  if (place.name.length > 0 && !parseLatLon(place.name)) return place.name;
  return `${round(place.lat)}, ${round(place.lon)}`;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function describe(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(round(lat))}°${ns} ${Math.abs(round(lon))}°${ew}`;
}

/**
 * Moves a hemisphere letter to the right of its number.
 *
 * `N59.91 E10.75` is how a great many sources write a pair, and it was rejected
 * — so one normalisation here lets the single pattern below keep handling every
 * form, rather than the pattern growing a second optional letter at each end.
 */
function hoistHemisphere(text: string): string {
  return text.replace(/(^|[\s,;/])([NSEWnsew])\s*(\d+(?:[.,]\d+)?)/g, '$1$3$2');
}

const PAIR = /^(-?\d+(?:\.\d+)?)\s*([NSns])?\s*[,;/\s]\s*(-?\d+(?:\.\d+)?)\s*([EWew])?$/;

function readPair(text: string): { lat: number; lon: number } | null {
  const match = PAIR.exec(text);
  if (!match) return null;

  let lat = Number(match[1]);
  let lon = Number(match[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  if (match[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (match[2]?.toUpperCase() === 'N') lat = Math.abs(lat);
  if (match[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (match[4]?.toUpperCase() === 'E') lon = Math.abs(lon);

  // Rejected rather than clamped: a latitude of 100 is a typo or a swapped pair,
  // and silently moving it to the pole hides the mistake on the map.
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Parses `lat, lon`, with or without degree signs and hemisphere letters.
 *
 * Exported for the tests: this is the kind of small parser that quietly accepts
 * a swapped pair and puts Oslo in the Indian Ocean.
 *
 * The decimal comma is tried **second**, and only on a string the dot reading
 * refused. That ordering is what keeps `59.91, 10.75` meaning what it always
 * meant while `59,91 10,75` starts working: the two notations are genuinely
 * ambiguous in isolation, and the only non-arbitrary tie-break is that the
 * reading which parses as a whole pair wins.
 */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const cleaned = hoistHemisphere(text.replace(/[°º]/g, ' ')).trim();
  const asDots = cleaned.replace(/(\d),(\d)/g, '$1.$2');
  return readPair(cleaned) ?? (asDots === cleaned ? null : readPair(asDots));
}
