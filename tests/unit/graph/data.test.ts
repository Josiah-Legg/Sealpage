import { describe, it, expect } from 'vitest';
import { type GraphBlock, type GraphType, defaultGraph } from '../../../src/shared/model';
import { autoBinCount, interpretGraph, parseNumber } from '../../../src/shared/graph/data';
import { isEmptyData, type GraphData } from '../../../src/shared/graph/types';

function graph(chart: GraphType, columns: string[], rows: string[][], bins = 0): GraphBlock {
  return { ...defaultGraph(chart), columns, rows, bins };
}

// ---------------------------------------------------------------------------
// parseNumber
// ---------------------------------------------------------------------------

describe('parseNumber: plain numbers', () => {
  it('parses an integer', () => {
    expect(parseNumber('42')).toBe(42);
  });

  it('parses a decimal', () => {
    expect(parseNumber('3.75')).toBe(3.75);
  });

  it('ignores leading and trailing spaces', () => {
    expect(parseNumber('  7  ')).toBe(7);
  });

  it('accepts an explicit plus sign', () => {
    expect(parseNumber('+5')).toBe(5);
  });

  it('accepts a minus sign', () => {
    expect(parseNumber('-5')).toBe(-5);
  });

  it('accepts a Unicode minus sign (U+2212)', () => {
    expect(parseNumber('−5')).toBe(-5);
  });

  it('accepts figure dash and en dash as minus signs', () => {
    expect(parseNumber('‒5')).toBe(-5);
    expect(parseNumber('–5')).toBe(-5);
  });

  it('accepts a leading decimal point', () => {
    expect(parseNumber('.5')).toBe(0.5);
  });

  it('accepts a trailing decimal point', () => {
    expect(parseNumber('5.')).toBe(5);
  });

  it('accepts an exponent', () => {
    expect(parseNumber('1e3')).toBe(1000);
  });

  it('accepts a negative exponent with an upper-case E', () => {
    expect(parseNumber('1E-2')).toBe(0.01);
  });

  it('reads -0 as negative zero', () => {
    expect(Object.is(parseNumber('-0'), -0)).toBe(true);
  });

  it('reads a very large value', () => {
    expect(parseNumber('1e308')).toBe(1e308);
    expect(parseNumber('-1e308')).toBe(-1e308);
  });

  it('returns null for a value that overflows to infinity', () => {
    expect(parseNumber('1e400')).toBeNull();
  });

  it('reads a very small value', () => {
    expect(parseNumber('5e-324')).toBe(5e-324);
  });

  it('reads a value too small to represent as zero', () => {
    expect(parseNumber('1e-400')).toBe(0);
  });
});

describe('parseNumber: thousands separators', () => {
  it('accepts a comma separator', () => {
    expect(parseNumber('1,234')).toBe(1234);
  });

  it('accepts several comma groups with decimals', () => {
    expect(parseNumber('1,234,567.89')).toBe(1234567.89);
  });

  it('accepts a space separator', () => {
    expect(parseNumber('1 234')).toBe(1234);
  });

  it('accepts a no-break space separator', () => {
    expect(parseNumber('1 234')).toBe(1234);
  });

  it('accepts a narrow no-break space separator', () => {
    expect(parseNumber('1 234')).toBe(1234);
  });

  it('accepts an apostrophe separator', () => {
    expect(parseNumber("1'234")).toBe(1234);
  });

  it('accepts an underscore separator', () => {
    expect(parseNumber('1_234')).toBe(1234);
  });

  it('accepts negative numbers with separators', () => {
    expect(parseNumber('-1,234')).toBe(-1234);
  });

  it('rejects a group of two digits after a separator', () => {
    expect(parseNumber('1,23')).toBeNull();
  });

  it('rejects a group of two digits in the middle of a number', () => {
    expect(parseNumber('12,34,567')).toBeNull();
  });

  it('rejects a group of four digits after a separator', () => {
    expect(parseNumber('1,2345')).toBeNull();
  });
});

describe('parseNumber: currency and percent', () => {
  it('strips a leading dollar sign', () => {
    expect(parseNumber('$5')).toBe(5);
  });

  it('strips a pound sign and separators', () => {
    expect(parseNumber('£1,000.50')).toBe(1000.5);
  });

  it('reads a sign placed before the euro sign', () => {
    expect(parseNumber('-€3')).toBe(-3);
  });

  it('reads a sign placed after the currency symbol', () => {
    expect(parseNumber('$-3')).toBe(-3);
  });

  it('reads a trailing percent sign as the number itself, not a fraction', () => {
    expect(parseNumber('12%')).toBe(12);
  });

  it('reads a percent sign separated by a space', () => {
    expect(parseNumber('12 %')).toBe(12);
  });

  it('reads accounting brackets as a negative number', () => {
    expect(parseNumber('(123)')).toBe(-123);
  });

  it('rejects an unclosed accounting bracket', () => {
    expect(parseNumber('(12')).toBeNull();
  });

  it('returns null for a lone currency symbol', () => {
    expect(parseNumber('$')).toBeNull();
  });

  it('returns null for a lone percent sign', () => {
    expect(parseNumber('%')).toBeNull();
  });
});

describe('parseNumber: blank and non-numeric text', () => {
  it('returns null for an empty string', () => {
    expect(parseNumber('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseNumber('   ')).toBeNull();
  });

  it.each(['abc', '1.2.3', '1e', '5px', 'NaN', 'Infinity', '0x10', '-', '+', '.'])(
    'returns null for %j',
    (raw) => {
      expect(parseNumber(raw)).toBeNull();
    },
  );

  // SUSPECTED BUG: the sign handling runs twice (once for "-", then again after the currency
  // strip), so "--5" loses both minus signs and yields 5 (and "+-5" yields -5).
  // Input "--5" -> actual 5; expected null (a double sign is not a number).
  it('returns null for a double minus sign ("--5")', () => {
    expect(parseNumber('--5')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoBinCount
// ---------------------------------------------------------------------------

describe('autoBinCount', () => {
  it('uses one bin for zero values', () => {
    expect(autoBinCount(0)).toBe(1);
  });

  it('uses one bin for one value', () => {
    expect(autoBinCount(1)).toBe(1);
  });

  it('uses two bins for two values', () => {
    expect(autoBinCount(2)).toBe(2);
  });

  it('uses four bins for eight values', () => {
    expect(autoBinCount(8)).toBe(4);
  });

  it('uses five bins for nine values', () => {
    expect(autoBinCount(9)).toBe(5);
  });

  it('uses eleven bins for one thousand values', () => {
    expect(autoBinCount(1000)).toBe(11);
  });

  it('uses thirty-one bins for one billion values (Sturges rule, below the cap)', () => {
    // ceil(log2(1e9)) + 1 = 31. The cap of 50 is only reached above 2^49 values.
    expect(autoBinCount(1e9)).toBe(31);
  });

  it('caps the bin count at 50 for an enormous count', () => {
    expect(autoBinCount(2 ** 50)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Category charts
// ---------------------------------------------------------------------------

describe('category charts', () => {
  it('reads categories from column 0 and one series per further column', () => {
    expect(interpretGraph(graph('bar', ['Quarter', 'Revenue'], [['Q1', '120'], ['Q2', '98']]))).toStrictEqual({
      kind: 'category',
      categories: ['Q1', 'Q2'],
      series: [{ name: 'Revenue', values: [120, 98] }],
      warnings: [],
    });
  });

  it('reads several series for a grouped bar chart', () => {
    expect(
      interpretGraph(graph('grouped-bar', ['Quarter', '2023', '2024'], [['Q1', '120', '135.5'], ['Q2', '98', '142']])),
    ).toStrictEqual({
      kind: 'category',
      categories: ['Q1', 'Q2'],
      series: [
        { name: '2023', values: [120, 98] },
        { name: '2024', values: [135.5, 142] },
      ],
      warnings: [],
    });
  });

  it('reads a line chart with the category shape', () => {
    expect(interpretGraph(graph('line', ['M', 'V'], [['Jan', '1']]))).toStrictEqual({
      kind: 'category',
      categories: ['Jan'],
      series: [{ name: 'V', values: [1] }],
      warnings: [],
    });
  });

  it('reads an area chart with the category shape', () => {
    expect(interpretGraph(graph('area', ['M', 'V'], [['Jan', '2']]))).toStrictEqual({
      kind: 'category',
      categories: ['Jan'],
      series: [{ name: 'V', values: [2] }],
      warnings: [],
    });
  });

  it('replaces a blank category label with its 1-based row number', () => {
    const d = interpretGraph(graph('bar', ['L', 'V'], [['', '1'], ['B', '2'], ['   ', '3']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['1', 'B', '3'],
      series: [{ name: 'V', values: [1, 2, 3] }],
      warnings: [],
    });
  });

  it('treats a blank cell as a gap (null) without a warning', () => {
    expect(interpretGraph(graph('bar', ['L', 'V'], [['A', ''], ['B', '4']]))).toStrictEqual({
      kind: 'category',
      categories: ['A', 'B'],
      series: [{ name: 'V', values: [null, 4] }],
      warnings: [],
    });
  });

  it('treats a non-numeric cell as a gap with the singular warning', () => {
    expect(interpretGraph(graph('bar', ['L', 'V'], [['A', 'x'], ['B', '4']]))).toStrictEqual({
      kind: 'category',
      categories: ['A', 'B'],
      series: [{ name: 'V', values: [null, 4] }],
      warnings: ['1 cell is not a number and was skipped.'],
    });
  });

  it('uses the plural warning for several non-numeric cells', () => {
    const d = interpretGraph(graph('bar', ['L', 'V'], [['A', 'x'], ['B', 'y'], ['C', '1']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['A', 'B', 'C'],
      series: [{ name: 'V', values: [null, null, 1] }],
      warnings: ['2 cells are not numbers and were skipped.'],
    });
  });

  it('ignores fully blank rows', () => {
    expect(
      interpretGraph(graph('bar', ['L', 'V'], [['A', '1'], ['', ''], ['   ', '  '], ['B', '2']])),
    ).toStrictEqual({
      kind: 'category',
      categories: ['A', 'B'],
      series: [{ name: 'V', values: [1, 2] }],
      warnings: [],
    });
  });

  it('names a series with a blank column name "Series N" using its column index', () => {
    const d = interpretGraph(graph('grouped-bar', ['L', '', '  '], [['A', '1', '2']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['A'],
      series: [
        { name: 'Series 1', values: [1] },
        { name: 'Series 2', values: [2] },
      ],
      warnings: [],
    });
  });

  it('trims a series name', () => {
    const d = interpretGraph(graph('bar', ['L', ' Sales '], [['A', '1']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['A'],
      series: [{ name: 'Sales', values: [1] }],
      warnings: [],
    });
  });

  it('warns about negative values in a stacked bar chart', () => {
    expect(interpretGraph(graph('stacked-bar', ['Q', 'A'], [['Q1', '-5']]))).toStrictEqual({
      kind: 'category',
      categories: ['Q1'],
      series: [{ name: 'A', values: [-5] }],
      warnings: ['Stacked bars with negative values are stacked downwards from zero.'],
    });
  });

  it('does not warn about negative values in a grouped bar chart', () => {
    const d = interpretGraph(graph('grouped-bar', ['Q', 'A'], [['Q1', '-5']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['Q1'],
      series: [{ name: 'A', values: [-5] }],
      warnings: [],
    });
  });

  it('reads thousands separators and percentages in cells', () => {
    const d = interpretGraph(graph('bar', ['L', 'V', 'P'], [['A', '1,234', '12%']]));
    expect(d).toStrictEqual({
      kind: 'category',
      categories: ['A'],
      series: [
        { name: 'V', values: [1234] },
        { name: 'P', values: [12] },
      ],
      warnings: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Pie charts
// ---------------------------------------------------------------------------

describe('pie charts', () => {
  it('reads slices from column 0 and values from column 1 and totals them', () => {
    expect(interpretGraph(graph('pie', ['Slice', 'Share'], [['A', '30'], ['B', '70']]))).toStrictEqual({
      kind: 'pie',
      slices: [
        { label: 'A', value: 30 },
        { label: 'B', value: 70 },
      ],
      total: 100,
      warnings: [],
    });
  });

  it('sums decimal values into the total', () => {
    const d = interpretGraph(graph('pie', ['S', 'V'], [['A', '1.5'], ['B', '2.5']]));
    expect(d).toStrictEqual({
      kind: 'pie',
      slices: [
        { label: 'A', value: 1.5 },
        { label: 'B', value: 2.5 },
      ],
      total: 4,
      warnings: [],
    });
  });

  it('skips zero and negative values with a warning', () => {
    expect(interpretGraph(graph('pie', ['S', 'V'], [['A', '0'], ['B', '-4'], ['C', '5']]))).toStrictEqual({
      kind: 'pie',
      slices: [{ label: 'C', value: 5 }],
      total: 5,
      warnings: ['Zero and negative values cannot be shown in a pie chart and were skipped.'],
    });
  });

  it('uses only the first series and warns when there are more', () => {
    expect(interpretGraph(graph('pie', ['S', 'A', 'B'], [['x', '1', '9']]))).toStrictEqual({
      kind: 'pie',
      slices: [{ label: 'x', value: 1 }],
      total: 1,
      warnings: ['A pie chart uses only the first data series.'],
    });
  });

  it('replaces a blank slice label with its 1-based row number', () => {
    const d = interpretGraph(graph('pie', ['S', 'V'], [['', '5'], ['   ', '7']]));
    expect(d).toStrictEqual({
      kind: 'pie',
      slices: [
        { label: '1', value: 5 },
        { label: '2', value: 7 },
      ],
      total: 12,
      warnings: [],
    });
  });

  it('warns about a non-numeric value and leaves it out', () => {
    expect(interpretGraph(graph('pie', ['S', 'V'], [['A', 'x']]))).toStrictEqual({
      kind: 'pie',
      slices: [],
      total: 0,
      warnings: ['1 cell is not a number and was skipped.'],
    });
  });

  it('skips a blank value silently', () => {
    expect(interpretGraph(graph('pie', ['S', 'V'], [['A', ''], ['B', '2']]))).toStrictEqual({
      kind: 'pie',
      slices: [{ label: 'B', value: 2 }],
      total: 2,
      warnings: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Scatter charts
// ---------------------------------------------------------------------------

describe('scatter charts', () => {
  it('reads numeric x from column 0 and points for each y series', () => {
    expect(interpretGraph(graph('scatter', ['X', 'Y'], [['1', '2'], ['3', '4']]))).toStrictEqual({
      kind: 'scatter',
      series: [{ name: 'Y', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      warnings: [],
    });
  });

  it('produces one series per y column', () => {
    expect(interpretGraph(graph('scatter', ['X', 'A', 'B'], [['1', '10', '20']]))).toStrictEqual({
      kind: 'scatter',
      series: [
        { name: 'A', points: [{ x: 1, y: 10 }] },
        { name: 'B', points: [{ x: 1, y: 20 }] },
      ],
      warnings: [],
    });
  });

  it('skips a row with a blank y silently', () => {
    expect(interpretGraph(graph('scatter', ['X', 'Y'], [['1', ''], ['2', '5']]))).toStrictEqual({
      kind: 'scatter',
      series: [{ name: 'Y', points: [{ x: 2, y: 5 }] }],
      warnings: [],
    });
  });

  it('skips points with non-numeric coordinates and uses the plural warning', () => {
    expect(interpretGraph(graph('scatter', ['X', 'Y'], [['x', '1'], ['2', 'y'], ['3', '4']]))).toStrictEqual({
      kind: 'scatter',
      series: [{ name: 'Y', points: [{ x: 3, y: 4 }] }],
      warnings: ['2 points have a non-numeric coordinate and were skipped.'],
    });
  });

  it('uses the singular warning for one non-numeric point', () => {
    expect(interpretGraph(graph('scatter', ['X', 'Y'], [['1', '2'], ['bad', '3']]))).toStrictEqual({
      kind: 'scatter',
      series: [{ name: 'Y', points: [{ x: 1, y: 2 }] }],
      warnings: ['1 point has a non-numeric coordinate and was skipped.'],
    });
  });
});

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

describe('histograms', () => {
  it('uses the automatic bin count for the number of values', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ['', String(i + 1)]);
    const d = interpretGraph(graph('histogram', ['L', 'V'], rows, 0));
    expect(d).toMatchObject({ kind: 'histogram', count: 9 });
    expect((d as { bins: unknown[] }).bins).toHaveLength(autoBinCount(9));
  });

  it('uses eleven automatic bins for one thousand values', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ['', String(i)]);
    const d = interpretGraph(graph('histogram', ['L', 'V'], rows, 0));
    expect((d as { bins: unknown[] }).bins).toHaveLength(11);
  });

  it('respects a requested bin count and counts each value into the right bin', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ['', String(i)]);
    expect(interpretGraph(graph('histogram', ['L', 'V'], rows, 4))).toStrictEqual({
      kind: 'histogram',
      bins: [
        { x0: 0, x1: 2, counts: [2] },
        { x0: 2, x1: 4, counts: [2] },
        { x0: 4, x1: 6, counts: [2] },
        { x0: 6, x1: 8, counts: [3] },
      ],
      seriesNames: ['V'],
      count: 9,
      warnings: [],
    });
  });

  it('caps a requested bin count at 200', () => {
    const d = interpretGraph(graph('histogram', ['L', 'V'], [['', '1'], ['', '2'], ['', '3']], 500));
    expect((d as { bins: unknown[] }).bins).toHaveLength(200);
  });

  it('makes bins contiguous with equal width that cover [min, max]', () => {
    const d = interpretGraph(graph('histogram', ['L', 'V'], [['', '2'], ['', '10']], 4));
    expect((d as { bins: { x0: number; x1: number }[] }).bins.map((b) => [b.x0, b.x1])).toStrictEqual([
      [2, 4],
      [4, 6],
      [6, 8],
      [8, 10],
    ]);
  });

  it('places the maximum value in the last bin', () => {
    const d = interpretGraph(graph('histogram', ['L', 'V'], [['', '0'], ['', '10']], 2));
    expect(d).toStrictEqual({
      kind: 'histogram',
      bins: [
        { x0: 0, x1: 5, counts: [1] },
        { x0: 5, x1: 10, counts: [1] },
      ],
      seriesNames: ['V'],
      count: 2,
      warnings: [],
    });
  });

  it('counts every value exactly once', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ['', String(i)]);
    const d = interpretGraph(graph('histogram', ['L', 'V'], rows, 0));
    if (d.kind !== 'histogram') throw new Error('expected a histogram');
    const total = d.bins.reduce((sum, b) => sum + b.counts[0]!, 0);
    expect(total).toBe(100);
    expect(d.count).toBe(100);
  });

  it('gives one unit-wide bin centred on a single distinct value', () => {
    expect(interpretGraph(graph('histogram', ['L', 'V'], [['', '5'], ['', '5'], ['', '5']]))).toStrictEqual({
      kind: 'histogram',
      bins: [{ x0: 4.5, x1: 5.5, counts: [3] }],
      seriesNames: ['V'],
      count: 3,
      warnings: [],
    });
  });

  it('shares bin edges between two series and keeps their counts separate', () => {
    const d = interpretGraph(
      graph(
        'histogram',
        ['L', 'A', 'B'],
        [
          ['', '1', '10'],
          ['', '2', '20'],
          ['', '3', ''],
        ],
        2,
      ),
    );
    expect(d).toStrictEqual({
      kind: 'histogram',
      bins: [
        { x0: 1, x1: 10.5, counts: [3, 1] },
        { x0: 10.5, x1: 20, counts: [0, 1] },
      ],
      seriesNames: ['A', 'B'],
      count: 5,
      warnings: [],
    });
  });

  it('gives no bins and a zero count when there are no numeric values', () => {
    expect(interpretGraph(graph('histogram', ['L', 'V'], [['a', 'x']]))).toStrictEqual({
      kind: 'histogram',
      bins: [],
      seriesNames: ['V'],
      count: 0,
      warnings: ['1 cell is not a number and was skipped.'],
    });
  });

  it('gives no bins and no warning when the values are all blank', () => {
    expect(interpretGraph(graph('histogram', ['L', 'V'], [['a', '']]))).toStrictEqual({
      kind: 'histogram',
      bins: [],
      seriesNames: ['V'],
      count: 0,
      warnings: [],
    });
  });

  it('names a blank histogram series "Series N"', () => {
    const d = interpretGraph(graph('histogram', ['L', ''], [['', '1']]));
    expect(d).toStrictEqual({
      kind: 'histogram',
      bins: [{ x0: 0.5, x1: 1.5, counts: [1] }],
      seriesNames: ['Series 1'],
      count: 1,
      warnings: [],
    });
  });

  // SUSPECTED BUG: when max - min overflows to Infinity (values +1e308 and -1e308),
  // the bin width becomes Infinity, the bin index becomes NaN and bins[NaN] is undefined,
  // so interpretGraph throws "Cannot read properties of undefined (reading 'counts')".
  // Input: values 1e308 and -1e308. Actual: TypeError. Expected: no throw, count 2
  // (data.ts says it is "pure and total: never throws").
  it('bins values whose range overflows to Infinity without throwing', () => {
    const d = interpretGraph(graph('histogram', ['L', 'V'], [['', '1e308'], ['', '-1e308']]));
    expect(d).toMatchObject({ kind: 'histogram', count: 2 });
  });

  it('ignores the label column when binning', () => {
    const d = interpretGraph(graph('histogram', ['L', 'V'], [['999999', '1']]));
    expect(d).toStrictEqual({
      kind: 'histogram',
      bins: [{ x0: 0.5, x1: 1.5, counts: [1] }],
      seriesNames: ['V'],
      count: 1,
      warnings: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Dispatch and emptiness
// ---------------------------------------------------------------------------

describe('interpretGraph dispatch', () => {
  it.each([
    ['bar', 'category'],
    ['grouped-bar', 'category'],
    ['stacked-bar', 'category'],
    ['line', 'category'],
    ['area', 'category'],
    ['pie', 'pie'],
    ['scatter', 'scatter'],
    ['histogram', 'histogram'],
  ] as const)('interprets %s as a %s chart', (chart, kind) => {
    expect(interpretGraph(defaultGraph(chart)).kind).toBe(kind);
  });
});

describe('isEmptyData', () => {
  it('treats a category chart with no categories as empty', () => {
    const d: GraphData = { kind: 'category', categories: [], series: [], warnings: [] };
    expect(isEmptyData(d)).toBe(true);
  });

  it('treats a category chart whose values are all null as empty', () => {
    const d: GraphData = {
      kind: 'category',
      categories: ['A'],
      series: [{ name: 'V', values: [null] }],
      warnings: [],
    };
    expect(isEmptyData(d)).toBe(true);
  });

  it('treats a category chart with one value as not empty', () => {
    const d: GraphData = {
      kind: 'category',
      categories: ['A'],
      series: [{ name: 'V', values: [null, 1] }],
      warnings: [],
    };
    expect(isEmptyData(d)).toBe(false);
  });

  it('treats a pie chart with no slices as empty', () => {
    expect(isEmptyData({ kind: 'pie', slices: [], total: 0, warnings: [] })).toBe(true);
  });

  it('treats a pie chart with a slice as not empty', () => {
    expect(isEmptyData({ kind: 'pie', slices: [{ label: 'A', value: 1 }], total: 1, warnings: [] })).toBe(false);
  });

  it('treats a scatter chart with no points as empty', () => {
    expect(isEmptyData({ kind: 'scatter', series: [{ name: 'Y', points: [] }], warnings: [] })).toBe(true);
  });

  it('treats a scatter chart with a point as not empty', () => {
    expect(
      isEmptyData({ kind: 'scatter', series: [{ name: 'Y', points: [{ x: 1, y: 1 }] }], warnings: [] }),
    ).toBe(false);
  });

  it('treats a histogram with no counted values as empty', () => {
    expect(isEmptyData({ kind: 'histogram', bins: [], seriesNames: ['V'], count: 0, warnings: [] })).toBe(true);
  });

  it('treats a histogram with a counted value as not empty', () => {
    expect(
      isEmptyData({ kind: 'histogram', bins: [{ x0: 0, x1: 1, counts: [1] }], seriesNames: ['V'], count: 1, warnings: [] }),
    ).toBe(false);
  });

  it('reports an all-blank table as empty for every chart type', () => {
    for (const chart of ['bar', 'pie', 'scatter', 'histogram'] as const) {
      const g = graph(chart, ['L', 'V'], [['', ''], ['  ', '']]);
      expect(isEmptyData(interpretGraph(g))).toBe(true);
    }
  });
});
