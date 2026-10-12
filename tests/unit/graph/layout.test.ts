import { describe, it, expect } from 'vitest';
import type { GraphTheme } from '../../../src/shared/graph/types';
import {
  type Ticks,
  bandScale,
  esc,
  formatNumber,
  linearScale,
  niceTicks,
  r,
  seriesColor,
  textWidth,
  truncate,
} from '../../../src/shared/graph/layout';

function themeWith(palette: string[]): GraphTheme {
  return {
    palette,
    background: 'transparent',
    text: '#000000',
    textMuted: '#666666',
    axis: '#000000',
    grid: '#cccccc',
    fontFamily: 'sans-serif',
    titleFontFamily: 'serif',
    fontSize: 12,
    titleFontSize: 16,
    titleWeight: 600,
    lineWidth: 2,
    axisWidth: 1,
    gridWidth: 1,
    gridDash: '',
    barRadius: 2,
    pointRadius: 3,
    areaOpacity: 0.3,
    sliceStroke: '#ffffff',
    sliceStrokeWidth: 1,
  };
}

/** The tick-generation contract every niceTicks result must satisfy. */
function expectNiceInvariants(lo: number, hi: number, t: Ticks): void {
  const { ticks, step } = t;
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  expect(ticks.length).toBeLessThanOrEqual(12);
  expect(t.min).toBe(ticks[0]);
  expect(t.max).toBe(ticks[ticks.length - 1]);
  expect(t.min).toBeLessThanOrEqual(Math.min(lo, hi));
  expect(t.max).toBeGreaterThanOrEqual(Math.max(lo, hi));
  expect(step).toBeGreaterThan(0);
  for (let i = 1; i < ticks.length; i++) {
    expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    expect(Math.abs(ticks[i]! - ticks[i - 1]! - step)).toBeLessThanOrEqual(1e-9 * Math.abs(step));
  }
  // step is 1, 2, 2.5 or 5 times a power of ten (10 is included for rounding at exact powers)
  const exponent = Math.floor(Math.log10(step));
  const mantissa = step / 10 ** exponent;
  expect([1, 2, 2.5, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true);
}

// ---------------------------------------------------------------------------
// esc
// ---------------------------------------------------------------------------

describe('esc', () => {
  it('escapes ampersand, angle brackets, double quote and apostrophe', () => {
    expect(esc(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
  });

  it('escapes an ampersand so an existing entity is not decoded', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('removes XML-invalid control characters', () => {
    expect(esc('a\u0000b\u0001c\u0008d\u000Be\u000Cf\u000Eg\u001Fh')).toBe('abcdefgh');
  });

  it('keeps tab, line feed and carriage return', () => {
    expect(esc('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('removes the non-characters U+FFFE and U+FFFF', () => {
    expect(esc('a￾b￿c')).toBe('abc');
  });

  it('leaves ordinary Unicode untouched', () => {
    expect(esc('héllo 世界 🎉')).toBe('héllo 世界 🎉');
  });
});

// ---------------------------------------------------------------------------
// r
// ---------------------------------------------------------------------------

describe('r', () => {
  it('rounds to two decimal places', () => {
    expect(r(3.14159)).toBe('3.14');
    expect(r(1.236)).toBe('1.24');
  });

  it('writes whole numbers without a decimal part', () => {
    expect(r(2)).toBe('2');
    expect(r(2.5)).toBe('2.5');
  });

  it('rounds negative numbers away from zero at the half', () => {
    expect(r(-1.239)).toBe('-1.24');
  });

  it('writes negative zero as "0"', () => {
    expect(r(-0)).toBe('0');
    expect(r(-0.001)).toBe('0');
  });

  it('writes non-finite numbers as "0"', () => {
    expect(r(Number.NaN)).toBe('0');
    expect(r(Number.POSITIVE_INFINITY)).toBe('0');
    expect(r(Number.NEGATIVE_INFINITY)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it('formats zero as "0"', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('keeps small decimals', () => {
    expect(formatNumber(0.5)).toBe('0.5');
  });

  it('keeps four-digit numbers unabbreviated', () => {
    expect(formatNumber(1234)).toBe('1234');
  });

  it('abbreviated five-digit numbers to thousands', () => {
    expect(formatNumber(12345)).toBe('12.345k');
  });

  it('abbreviates millions', () => {
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(1000000)).toBe('1M');
  });

  it('abbreviates billions', () => {
    expect(formatNumber(2.5e9)).toBe('2.5B');
    expect(formatNumber(1e9)).toBe('1B');
  });

  it('formats negative numbers with a leading minus', () => {
    expect(formatNumber(-12345)).toBe('-12.345k');
    expect(formatNumber(-1500000)).toBe('-1.5M');
    expect(formatNumber(-3.5)).toBe('-3.5');
  });

  it('uses exponent form for very small magnitudes', () => {
    expect(formatNumber(1e-7)).toBe('1e-7');
    expect(formatNumber(-1e-7)).toBe('-1e-7');
  });

  it('keeps 0.000001 in decimal form at the boundary', () => {
    expect(formatNumber(0.000001)).toBe('0.000001');
  });

  it('uses exponent form for very large magnitudes', () => {
    expect(formatNumber(1e16)).toBe('1e+16');
    expect(formatNumber(1e15)).toBe('1e+15');
  });

  it('removes floating-point noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('returns an empty string for non-finite numbers', () => {
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// linearScale
// ---------------------------------------------------------------------------

describe('linearScale', () => {
  it('maps the domain endpoints onto the range endpoints', () => {
    const s = linearScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
  });

  it('maps the midpoint to the midpoint', () => {
    expect(linearScale(0, 10, 0, 100)(5)).toBe(50);
  });

  it('supports a reversed range (as used for y axes)', () => {
    const s = linearScale(0, 10, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(0);
  });

  it('maps a zero-width domain to the middle of the range', () => {
    const s = linearScale(5, 5, 0, 100);
    expect(s(5)).toBe(50);
    expect(s(1000)).toBe(50);
  });

  it('extrapolates beyond the domain', () => {
    expect(linearScale(0, 10, 0, 100)(20)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// bandScale
// ---------------------------------------------------------------------------

describe('bandScale', () => {
  it('tiles the range with n equal bands when padding is 0', () => {
    const b = bandScale(4, 0, 100, 0);
    expect(b.step).toBe(25);
    expect(b.bandwidth).toBe(25);
    expect(b.start(0)).toBe(0);
    expect(b.start(3)).toBe(75);
    expect(b.center(0)).toBe(12.5);
  });

  it('keeps the centre halfway across each band and the step between band starts', () => {
    const b = bandScale(4, 0, 100, 0.5);
    expect(b.step).toBe(25);
    expect(b.bandwidth).toBe(12.5);
    for (let i = 0; i < 4; i++) {
      expect(b.center(i)).toBeCloseTo(b.start(i) + b.bandwidth / 2, 10);
    }
    expect(b.start(1) - b.start(0)).toBeCloseTo(b.step, 10);
  });

  it('places a band start at half the spare space when padding is 0.5', () => {
    const b = bandScale(4, 0, 100, 0.5);
    expect(b.start(0)).toBe(6.25);
    expect(b.center(0)).toBe(12.5);
  });

  it('clamps padding above 0.95 so that a band keeps some width', () => {
    const b = bandScale(2, 0, 100, 1);
    expect(b.bandwidth).toBeCloseTo(2.5, 10);
  });

  it('treats negative padding as 0', () => {
    expect(bandScale(2, 0, 100, -1).bandwidth).toBe(50);
  });

  it('does not divide by zero for n = 0', () => {
    const b = bandScale(0, 0, 100);
    expect(Number.isFinite(b.step)).toBe(true);
    expect(b.step).toBe(100);
    expect(Number.isFinite(b.start(0))).toBe(true);
    expect(Number.isFinite(b.center(0))).toBe(true);
  });

  it('gives one band the whole range when padding is 0 and n = 1', () => {
    const b = bandScale(1, 0, 100, 0);
    expect(b.bandwidth).toBe(100);
    expect(b.start(0)).toBe(0);
    expect(b.center(0)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// niceTicks
// ---------------------------------------------------------------------------

describe('niceTicks invariants', () => {
  it.each([
    [0, 10],
    [0, 100],
    [3, 97],
    [-5, 5],
    [0, 0],
    [5, 5],
    [-3, -3],
    [0.1, 0.7],
    [-0.5, 0.25],
    [1, 2],
    [1000, 1001],
    [-1e6, 3e5],
    [0.001, 0.002],
    [7, 7.5],
    [-100, -1],
    [1e-9, 3e-9],
    [0, 1e12],
    [2.5, 2.75],
    [123, 4567],
    [-1e-6, 1e-6],
  ])('holds for the range [%s, %s]', (lo, hi) => {
    expectNiceInvariants(lo, hi, niceTicks(lo, hi));
  });

  it.each([
    [0, 10],
    [3, 97],
    [-50, -10],
    [5, 5],
    [0.5, 4],
  ])('keeps zero inside the domain with includeZero for [%s, %s]', (lo, hi) => {
    const t = niceTicks(lo, hi, 5, true);
    expectNiceInvariants(Math.min(lo, 0), Math.max(hi, 0), t);
    expect(t.min).toBeLessThanOrEqual(0);
    expect(t.max).toBeGreaterThanOrEqual(0);
    expect(t.ticks).toContain(0);
  });
});

describe('niceTicks exact results', () => {
  it('gives 0 to 10 in steps of 2', () => {
    expect(niceTicks(0, 10)).toStrictEqual({ ticks: [0, 2, 4, 6, 8, 10], min: 0, max: 10, step: 2 });
  });

  it('gives 0 to 100 in steps of 20', () => {
    expect(niceTicks(0, 100)).toStrictEqual({ ticks: [0, 20, 40, 60, 80, 100], min: 0, max: 100, step: 20 });
  });

  it('expands 3 to 97 outwards to 0 to 100', () => {
    expect(niceTicks(3, 97)).toStrictEqual({ ticks: [0, 20, 40, 60, 80, 100], min: 0, max: 100, step: 20 });
  });

  it('gives -5 to 5 as ticks from -6 to 6 in steps of 2', () => {
    expect(niceTicks(-5, 5)).toStrictEqual({
      ticks: [-6, -4, -2, 0, 2, 4, 6],
      min: -6,
      max: 6,
      step: 2,
    });
  });

  it('gives a zero range the ticks 0 to 1 in steps of 0.2', () => {
    expect(niceTicks(0, 0)).toStrictEqual({ ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], min: 0, max: 1, step: 0.2 });
  });

  it('gives a single value 5 the ticks 2 to 8 in steps of 1', () => {
    expect(niceTicks(5, 5)).toStrictEqual({ ticks: [2, 3, 4, 5, 6, 7, 8], min: 2, max: 8, step: 1 });
  });

  it('gives a single negative value -3 the ticks -5 to -1', () => {
    expect(niceTicks(-3, -3)).toStrictEqual({ ticks: [-5, -4, -3, -2, -1], min: -5, max: -1, step: 1 });
  });

  it('gives the same result when the arguments are swapped', () => {
    expect(niceTicks(10, 0)).toStrictEqual(niceTicks(0, 10));
  });

  it('treats NaN as 0', () => {
    expect(niceTicks(Number.NaN, 10)).toStrictEqual(niceTicks(0, 10));
    expect(niceTicks(Number.NaN, Number.NaN)).toStrictEqual(niceTicks(0, 0));
  });

  it('treats an infinite bound as 0', () => {
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toStrictEqual(niceTicks(0, 0));
    expect(niceTicks(Number.NEGATIVE_INFINITY, 5)).toStrictEqual(niceTicks(0, 5));
  });

  it('produces tick values with no floating-point noise for 0.1 steps', () => {
    expect(niceTicks(0, 0.5).ticks).toStrictEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('produces exact ticks for a huge range', () => {
    expect(niceTicks(0, 1e12)).toStrictEqual({
      ticks: [0, 2e11, 4e11, 6e11, 8e11, 1e12],
      min: 0,
      max: 1e12,
      step: 2e11,
    });
  });

  it('includes zero when the range is entirely positive and includeZero is set', () => {
    expect(niceTicks(3, 97, 5, true)).toStrictEqual({ ticks: [0, 20, 40, 60, 80, 100], min: 0, max: 100, step: 20 });
  });

  it('extends a negative-only range up to zero when includeZero is set', () => {
    expect(niceTicks(-50, -10, 5, true)).toStrictEqual({
      ticks: [-50, -40, -30, -20, -10, 0],
      min: -50,
      max: 0,
      step: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// textWidth
// ---------------------------------------------------------------------------

describe('textWidth', () => {
  it('grows with the number of characters', () => {
    expect(textWidth('abcd', 12)).toBeGreaterThan(textWidth('abc', 12));
  });

  it('measures a lower-case letter as 0.56 em', () => {
    expect(textWidth('a', 10)).toBeCloseTo(5.6, 10);
  });

  it('scales linearly with the font size', () => {
    expect(textWidth('Hello', 20)).toBeCloseTo(2 * textWidth('Hello', 10), 10);
  });

  it('measures narrow letters narrower than normal letters and wide letters wider', () => {
    expect(textWidth('i', 10)).toBeLessThan(textWidth('a', 10));
    expect(textWidth('a', 10)).toBeLessThan(textWidth('M', 10));
  });

  it('measures a CJK character as one em', () => {
    expect(textWidth('日', 10)).toBeCloseTo(10, 10);
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns the input unchanged when it fits', () => {
    expect(truncate('abc', 1000, 10)).toBe('abc');
  });

  it('returns an empty string unchanged', () => {
    expect(truncate('', 10, 10)).toBe('');
  });

  it('shortens to the longest prefix plus an ellipsis that fits', () => {
    expect(truncate('abcdefghijklmnop', 50, 10)).toBe('abcdefg…');
  });

  it('always returns a string that fits when one character and an ellipsis fit', () => {
    for (const max of [20, 40, 80]) {
      const out = truncate('abcdefghijklmnop', max, 10);
      expect(out.endsWith('…')).toBe(true);
      expect(textWidth(out, 10)).toBeLessThanOrEqual(max);
    }
  });

  it('truncates by code point so surrogate pairs are never split', () => {
    expect(truncate('🎉🎉🎉🎉', 26, 10)).toBe('🎉🎉…');
  });
});

// ---------------------------------------------------------------------------
// seriesColor
// ---------------------------------------------------------------------------

describe('seriesColor', () => {
  it('returns palette entries in order and cycles them', () => {
    const t = themeWith(['#a', '#b', '#c']);
    expect([0, 1, 2, 3, 4].map((i) => seriesColor(t, i))).toStrictEqual(['#a', '#b', '#c', '#a', '#b']);
  });

  it('wraps a negative index into the palette', () => {
    expect(seriesColor(themeWith(['#a', '#b', '#c']), -1)).toBe('#c');
  });

  it('falls back to grey when the palette is empty', () => {
    expect(seriesColor(themeWith([]), 3)).toBe('#888888');
  });
});
