import { describe, expect, it } from 'vitest';
import { FALLBACK_INK, composite, inkOn, luminance, mix, parseColour, withAlpha } from './colour';

describe('parseColour', () => {
  it('reads both hex forms', () => {
    expect(parseColour('#3987e5')).toEqual([0x39, 0x87, 0xe5]);
    expect(parseColour('#F00')).toEqual([255, 0, 0]);
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
  });

  it('refuses everything it cannot actually read', () => {
    for (const bad of ['rebeccapurple', 'rgb(1,2,3)', '#12345', '#gggggg', '', 'f00']) {
      expect(parseColour(bad)).toBeNull();
    }
  });
});

describe('withAlpha', () => {
  it('expands three-digit hex rather than producing NaN', () => {
    // `#f00` reaches the renderers through `Tag.color`, from imported files.
    // The old two-character slice made `rgba(NaN, NaN, NaN, …)`, which canvas
    // ignores in silence: the tag simply stopped drawing, with nothing to say why.
    expect(withAlpha('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('falls back for a colour it cannot read', () => {
    expect(withAlpha('rebeccapurple', 1)).toBe(withAlpha(FALLBACK_INK, 1));
    expect(withAlpha('rebeccapurple', 1, '#3987e5')).toBe('rgba(57, 135, 229, 1)');
    expect(withAlpha('#3987e5', 0.25)).toBe('rgba(57, 135, 229, 0.25)');
  });

  it('never emits NaN, whatever it is given', () => {
    for (const value of ['', 'nonsense', '#', '#12', '#1234567']) {
      expect(withAlpha(value, 0.4)).not.toContain('NaN');
    }
  });
});

describe('mix', () => {
  it('interpolates and clamps', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    expect(mix('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)');
    expect(mix('#000000', '#ffffff', 2)).toBe('rgb(255, 255, 255)');
  });
});

describe('label ink', () => {
  it('picks by the composited colour, not the palette entry', () => {
    // An era bar is drawn at half alpha, so what a reader sees is never the
    // colour in the palette — and choosing ink against the palette entry is how
    // a "light" bar ends up with white text nobody can read.
    const bright = '#ffd43b';
    expect(luminance(composite(bright, '#1a1a19', 1))).toBeGreaterThan(
      luminance(composite(bright, '#1a1a19', 0.5)),
    );
    expect(inkOn(composite(bright, '#1a1a19', 1), '#1a1a19', '#c3c2b7')).toBe('#1a1a19');
    expect(inkOn(composite('#6a6a64', '#1a1a19', 0.5), '#1a1a19', '#c3c2b7')).toBe('#c3c2b7');
  });

  it('orders luminance the way the eye does', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([0, 255, 0])).toBeGreaterThan(luminance([0, 0, 255]));
  });
});
