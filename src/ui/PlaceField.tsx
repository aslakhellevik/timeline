import { useEffect, useState } from 'react';
import type { TimelineEvent } from '../core/model/types';
import { locate } from '../core/geo';
import { useTimeline } from '../state/timeline-store';

/**
 * Where an event happened (docs/design.md §11).
 *
 * Two jobs, and the first matters more: **say how the event is currently
 * placed.** Most are placed by their region tag, so most dots on the map are
 * claims about a continent — and a user who does not know that will read the map
 * as far more precise than it is. The line under the field is the honest answer
 * to "why is that dot there".
 *
 * The second is entering coordinates, as text rather than through a picker. The
 * same reasoning as the era span field: `59.91, 10.75` is one thing to type, and
 * a map-picker for a field almost nobody fills in is a lot of interface for very
 * little. Pasting a pair out of any atlas or search result works.
 */
export function PlaceField({ event }: { event: TimelineEvent }) {
  const updateEvent = useTimeline((state) => state.updateEvent);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatPlace(event));
    setError(null);
  }, [event.id, event.place]);

  const placed = locate(event.place, event.tags);
  const byTag = event.place?.lat === undefined;

  const commit = () => {
    const text = draft.trim();
    if (text === formatPlace(event)) return;

    if (text.length === 0) {
      setError(null);
      updateEvent(event.id, { place: undefined });
      return;
    }

    const parsed = parseLatLon(text);
    if (!parsed) {
      setError('try “59.91, 10.75” — latitude first');
      return;
    }
    setError(null);
    updateEvent(event.id, {
      place: { name: text, lat: parsed.lat, lon: parsed.lon },
    });
  };

  return (
    <label className="flex flex-col gap-1 text-xs text-paper-dim">
      place
      <input
        value={draft}
        onChange={(change) => setDraft(change.target.value)}
        onBlur={commit}
        onKeyDown={(keyed) => {
          if (keyed.key === 'Enter') commit();
          if (keyed.key === 'Escape') setDraft(formatPlace(event));
        }}
        placeholder="59.91, 10.75"
        className={`rounded border bg-surface px-2 py-1 text-sm tabular-nums text-paper
                    placeholder:text-paper-dim focus:outline-none
                    ${error ? 'border-[#e66767]' : 'border-line focus:border-accent'}`}
      />
      {error ? (
        <span className="text-[11px] text-[#e66767]">{error}</span>
      ) : (
        <span className="text-[11px] text-paper-faint">
          {placed === null
            ? 'nowhere on the map — add a region tag or coordinates'
            : byTag
              ? `on the map by tag, to about ${Math.round(placed.precision)} km`
              : `on the map at ${describe(placed.lat, placed.lon)}`}
        </span>
      )}
    </label>
  );
}

function formatPlace(event: TimelineEvent): string {
  const place = event.place;
  if (!place) return '';
  if (place.lat === undefined || place.lon === undefined) return place.name;
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
 * Parses `lat, lon`, with or without degree signs and hemisphere letters.
 *
 * Exported for the tests: this is the kind of small parser that quietly accepts
 * a swapped pair and puts Oslo in the Indian Ocean.
 */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const cleaned = text.replace(/[°º]/g, ' ').trim();
  const match = /^(-?\d+(?:\.\d+)?)\s*([NSns])?\s*[,;/\s]\s*(-?\d+(?:\.\d+)?)\s*([EWew])?$/.exec(
    cleaned,
  );
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
