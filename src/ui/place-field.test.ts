import { describe, expect, it } from 'vitest';
import { parseLatLon } from './PlaceField';

describe('parseLatLon', () => {
  it('reads a plain pair, latitude first', () => {
    expect(parseLatLon('59.91, 10.75')).toEqual({ lat: 59.91, lon: 10.75 });
  });

  it('accepts the separators people actually paste', () => {
    for (const text of ['59.91 10.75', '59.91;10.75', '59.91/10.75', '59.91,10.75']) {
      expect(parseLatLon(text)).toEqual({ lat: 59.91, lon: 10.75 });
    }
  });

  it('accepts degree signs and hemisphere letters', () => {
    expect(parseLatLon('59.91°N, 10.75°E')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('33.87 S, 151.21 E')).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseLatLon('40.71N, 74.01W')).toEqual({ lat: 40.71, lon: -74.01 });
  });

  it('reads negative numbers', () => {
    expect(parseLatLon('-33.87, -70.65')).toEqual({ lat: -33.87, lon: -70.65 });
  });

  /**
   * Rejected rather than clamped. A latitude of 200 is a typo or a swapped pair,
   * and quietly moving it to the pole hides the mistake on the map — which is
   * the one place it would look plausible.
   */
  it('refuses impossible coordinates instead of clamping them', () => {
    expect(parseLatLon('200, 400')).toBeNull();
    expect(parseLatLon('91, 0')).toBeNull();
    expect(parseLatLon('0, 181')).toBeNull();
  });

  it('accepts the exact limits', () => {
    expect(parseLatLon('90, 180')).toEqual({ lat: 90, lon: 180 });
    expect(parseLatLon('-90, -180')).toEqual({ lat: -90, lon: -180 });
  });

  it('refuses anything that is not a pair', () => {
    for (const text of ['', 'Oslo', '59.91', 'about 60 north', '59.91, 10.75, 3']) {
      expect(parseLatLon(text)).toBeNull();
    }
  });
});
