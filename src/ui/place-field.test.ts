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

/*
   * A decimal comma is how half of Europe writes a number, including the
   * country this app is named in, and the field simply refused it. The dot
   * reading is tried first, so `59.91, 10.75` still means what it always meant;
   * the comma reading only gets a turn on a string nothing else could read.
   */
  it('reads a decimal comma', () => {
    expect(parseLatLon('59,91 10,75')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('59,91; 10,75')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('59,91, 10,75')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('-33,87 -70,65')).toEqual({ lat: -33.87, lon: -70.65 });
  });

  it('does not let the comma reading change what a dot pair means', () => {
    expect(parseLatLon('59.91, 10.75')).toEqual({ lat: 59.91, lon: 10.75 });
    // A whole-number pair separated by a comma is read as one, as it always
    // was: `59,91` is 59°N 91°E, which is a coordinate someone might mean and
    // half a coordinate nobody would type.
    expect(parseLatLon('59,91')).toEqual({ lat: 59, lon: 91 });
    // Four numbers under either reading, and so neither.
    expect(parseLatLon('59,91,10,75')).toBeNull();
  });

  it('reads a hemisphere letter written in front of its number', () => {
    expect(parseLatLon('N59.91 E10.75')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('N 59.91, E 10.75')).toEqual({ lat: 59.91, lon: 10.75 });
    expect(parseLatLon('S33.87 E151.21')).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseLatLon('N40.71 W74.01')).toEqual({ lat: 40.71, lon: -74.01 });
  });

  it('still refuses a place name, which is now stored as a name instead', () => {
    for (const text of ['Constantinople', 'Oslo', "grandma's house", 'Sparta']) {
      expect(parseLatLon(text)).toBeNull();
    }
  });

  it('refuses anything that is not a pair', () => {
    for (const text of ['', 'Oslo', '59.91', 'about 60 north', '59.91, 10.75, 3']) {
      expect(parseLatLon(text)).toBeNull();
    }
  });
});
