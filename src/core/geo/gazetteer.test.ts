import { describe, expect, it } from 'vitest';
import { gazetteerSize, searchPlaces } from './gazetteer';

describe('gazetteer data', () => {
  it('holds the three sources', () => {
    // 243 cities + 177 countries + the hand-written historical set, minus the
    // names that collide (Singapore is both a city and a country).
    expect(gazetteerSize()).toBeGreaterThan(400);
    expect(gazetteerSize()).toBeLessThan(600);
  });

  it('parses every line into a usable point', () => {
    for (const query of ['a', 'e', 'i', 'o', 'u', 'n', 'r', 's']) {
      for (const place of searchPlaces(query.repeat(1) + 'r', 100)) {
        expect(Number.isFinite(place.lat)).toBe(true);
        expect(Number.isFinite(place.lon)).toBe(true);
        expect(Math.abs(place.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(place.lon)).toBeLessThanOrEqual(180);
        expect(place.precision).toBeGreaterThan(0);
        expect(place.name.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('searchPlaces', () => {
  it('finds a modern city', () => {
    const [first] = searchPlaces('oslo');
    expect(first?.name).toBe('Oslo');
    expect(first?.lat).toBeCloseTo(59.92, 1);
    expect(first?.lon).toBeCloseTo(10.75, 1);
  });

  it('finds a country, with a radius from its area', () => {
    const [france] = searchPlaces('france');
    expect(france?.name).toBe('France');
    // Roughly √(551 000 km² / π) — big enough to say "somewhere in France".
    expect(france?.precision).toBeGreaterThan(300);
    expect(france?.precision).toBeLessThan(600);

    const [russia] = searchPlaces('russia');
    expect(russia?.precision).toBeGreaterThan(2000);
  });

  it('gives a city a city-sized radius', () => {
    expect(searchPlaces('paris')[0]?.precision).toBe(25);
  });

  /*
   * The half no modern gazetteer has, and the reason this file is hand-extended:
   * an event at Constantinople did not happen in the Istanbul of 2026, and one
   * at Carthage did not happen in a suburb of Tunis.
   */
  it('knows historical places, at their own size', () => {
    const [constantinople] = searchPlaces('constantinople');
    expect(constantinople?.name).toBe('Constantinople');
    expect(constantinople?.precision).toBeLessThan(30);

    expect(searchPlaces('carthage')[0]?.name).toBe('Carthage');
    expect(searchPlaces('tenochtitlan')[0]?.name).toBe('Tenochtitlan');
    expect(searchPlaces('babylon')[0]?.name).toBe('Babylon');
    expect(searchPlaces('angkor')[0]?.name).toBe('Angkor');
    expect(searchPlaces('great zimbabwe')[0]?.name).toBe('Great Zimbabwe');
  });

  it('is indifferent to case, accents and punctuation', () => {
    expect(searchPlaces('CORDOBA')[0]?.name).toBe('Cordoba');
    expect(searchPlaces('chang an')[0]?.name).toBe("Chang'an");
    expect(searchPlaces('changan')[0]?.name).toBe("Chang'an");
    expect(searchPlaces('mohenjo daro')[0]?.name).toBe('Mohenjo-daro');
  });

  it('ranks an exact name above a longer one containing it', () => {
    const names = searchPlaces('sudan').map((place) => place.name);
    expect(names[0]).toBe('Sudan');
    expect(names).toContain('S. Sudan');
  });

  it('matches a prefix before a substring', () => {
    const names = searchPlaces('rom', 20).map((place) => place.name);
    expect(names.indexOf('Rome')).toBeLessThan(names.indexOf('Romania') + 1);
    expect(names[0]).toBe('Rome');
  });

  it('refuses a query too short to mean anything', () => {
    expect(searchPlaces('a')).toEqual([]);
    expect(searchPlaces('')).toEqual([]);
    expect(searchPlaces('  ')).toEqual([]);
  });

  it('honours the limit', () => {
    expect(searchPlaces('an', 3)).toHaveLength(3);
    expect(searchPlaces('an').length).toBeLessThanOrEqual(6);
  });

  it('returns nothing for a name it does not have', () => {
    expect(searchPlaces('zzzqqqx')).toEqual([]);
  });

  /* The result is stored straight into `Place`, so it must be a plain point. */
  it('returns only the four stored fields', () => {
    expect(Object.keys(searchPlaces('oslo')[0] ?? {}).sort()).toEqual([
      'lat',
      'lon',
      'name',
      'precision',
    ]);
  });
});
