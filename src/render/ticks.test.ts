import { describe, expect, it } from 'vitest';
import { formatYear, generateTicks } from './ticks';
import { fromGregorian, toGregorian } from '../core/time';
import type { Viewport } from '../core/model/types';

const view = (fromYear: number, toYear: number, width = 1200): Viewport => ({
  start: fromGregorian(fromYear, 1, 1),
  end: fromGregorian(toYear, 1, 1),
  width,
});

describe('formatYear', () => {
  it('never shows a year zero', () => {
    expect(formatYear(1)).toBe('1');
    expect(formatYear(0)).toBe('1 BC');
    expect(formatYear(-1)).toBe('2 BC');
    expect(formatYear(-249)).toBe('250 BC');
    expect(formatYear(1848)).toBe('1848');
  });
});

describe('generateTicks', () => {
  it('keeps ticks inside the viewport', () => {
    const vp = view(1800, 1900);
    for (const tick of generateTicks(vp)) {
      expect(tick.t).toBeGreaterThanOrEqual(vp.start);
      expect(tick.t).toBeLessThanOrEqual(vp.end);
    }
  });

  it('respects the minimum label spacing at every zoom', () => {
    const spans: [number, number][] = [
      [-4000, 2026],
      [1000, 2000],
      [1900, 2000],
      [1939, 1946],
      [1944, 1945],
    ];
    for (const [from, to] of spans) {
      const vp = view(from, to);
      const ticks = generateTicks(vp, 90);
      expect(ticks.length).toBeGreaterThan(1);

      const perDay = vp.width / (vp.end - vp.start);
      for (let i = 1; i < ticks.length; i++) {
        const gap = ((ticks[i] as { t: number }).t - (ticks[i - 1] as { t: number }).t) * perDay;
        expect(gap).toBeGreaterThanOrEqual(89);
      }
    }
  });

  it('does not flood the axis', () => {
    for (const [from, to] of [
      [-4000, 2026],
      [1800, 1900],
      [1944, 1945],
    ] as const) {
      expect(generateTicks(view(from, to)).length).toBeLessThanOrEqual(16);
    }
  });

  it('lands on round years, not arbitrary ones', () => {
    const ticks = generateTicks(view(1800, 2000));
    for (const tick of ticks) {
      const { year, month, day } = toGregorian(tick.t);
      expect(month).toBe(1);
      expect(day).toBe(1);
      expect(year % 25).toBe(0);
    }
  });

  it('steps in calendar space, so January never drifts', () => {
    // Across a long BC span, every tick must still be 1 January.
    for (const tick of generateTicks(view(-3000, -1000))) {
      const { month, day } = toGregorian(tick.t);
      expect(month).toBe(1);
      expect(day).toBe(1);
    }
  });

  it('falls back to months and then days as you zoom in', () => {
    const monthly = generateTicks(view(1848, 1849));
    expect(monthly.length).toBeGreaterThan(1);
    expect(monthly.some((t) => /Jul|Apr|Oct/.test(t.label))).toBe(true);

    const vp: Viewport = {
      start: fromGregorian(1848, 3, 1),
      end: fromGregorian(1848, 4, 1),
      width: 1200,
    };
    const daily = generateTicks(vp);
    expect(daily.length).toBeGreaterThan(1);
    expect(daily.every((t) => t.t >= vp.start && t.t <= vp.end)).toBe(true);
  });

  it('marks a sensible minority as major', () => {
    const ticks = generateTicks(view(1800, 2000));
    const majors = ticks.filter((t) => t.major);
    expect(majors.length).toBeGreaterThan(0);
    expect(majors.length).toBeLessThan(ticks.length);
  });

  it('survives degenerate viewports', () => {
    expect(generateTicks({ start: 0, end: 0, width: 100 })).toEqual([]);
    expect(generateTicks({ start: 0, end: 100, width: 0 })).toEqual([]);
    expect(generateTicks({ start: 100, end: 0, width: 100 })).toEqual([]);
  });
});
