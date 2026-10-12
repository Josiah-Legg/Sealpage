import { describe, it, expect } from 'vitest';
import {
  type Doc,
  type GraphBlock,
  type GraphType,
  codeBlock,
  defaultGraph,
  divider,
  heading,
  list,
  listItem,
  normalizeDoc,
  paragraph,
  quote,
  table,
  text,
  title,
} from '../../../src/shared/model';
import { markupVersion, parseMarkup, serializeMarkup } from '../../../src/shared/markup';

/** Serialise, parse back, and check the round trip (text is a fixed point). */
function roundTrip(doc: Doc): string {
  const out = serializeMarkup(doc);
  expect(parseMarkup(out)).toStrictEqual(normalizeDoc(doc));
  expect(serializeMarkup(parseMarkup(out))).toBe(out);
  return out;
}

/** Exact serialised text, exact parse of that text, and the round trip. */
function check(doc: Doc, expected: string): void {
  expect(serializeMarkup(doc)).toBe(expected);
  expect(parseMarkup(expected)).toStrictEqual(doc);
  expect(roundTrip(doc)).toBe(expected);
}

function graph(chart: GraphType, over: Partial<GraphBlock> = {}): GraphBlock {
  return { ...defaultGraph(chart), ...over };
}

const SALES_ROWS = [
  [[text('Name')], [text('Role')]],
  [[text('Ada')], [text('Engineer')]],
  [[text('Grace')], [text('Admiral')]],
];

// ---------------------------------------------------------------------------
// Title and headings
// ---------------------------------------------------------------------------

describe('title block', () => {
  it('serialises a simple title as "= text"', () => {
    check({ blocks: [title([text('Hello')])] }, '~sealpage 1\n\n= Hello\n');
  });

  it('parses "= text" back to a title block', () => {
    expect(parseMarkup('~sealpage 1\n\n= Hello\n')).toStrictEqual({ blocks: [title([text('Hello')])] });
  });

  it('writes an empty title as a bare "="', () => {
    check({ blocks: [title([])] }, '~sealpage 1\n\n=\n');
  });

  it('keeps inline marks inside a title', () => {
    check({ blocks: [title([text('Hi', { bold: true })])] }, '~sealpage 1\n\n= *Hi*\n');
  });
});

describe('heading blocks', () => {
  it('serialises level 1 as "== text"', () => {
    check({ blocks: [heading(1, [text('Summary')])] }, '~sealpage 1\n\n== Summary\n');
  });

  it('serialises level 2 as "=== text"', () => {
    check({ blocks: [heading(2, [text('Details')])] }, '~sealpage 1\n\n=== Details\n');
  });

  it('serialises level 3 as "==== text"', () => {
    check({ blocks: [heading(3, [text('Fine print')])] }, '~sealpage 1\n\n==== Fine print\n');
  });

  it('writes an empty level 1 heading as "=="', () => {
    check({ blocks: [heading(1, [])] }, '~sealpage 1\n\n==\n');
  });

  it('writes an empty level 2 heading as "==="', () => {
    check({ blocks: [heading(2, [])] }, '~sealpage 1\n\n===\n');
  });

  it('writes an empty level 3 heading as "===="', () => {
    check({ blocks: [heading(3, [])] }, '~sealpage 1\n\n====\n');
  });
});

// ---------------------------------------------------------------------------
// Paragraph and divider
// ---------------------------------------------------------------------------

describe('paragraph block', () => {
  it('serialises a plain paragraph with no prefix', () => {
    check({ blocks: [paragraph([text('Hello world')])] }, '~sealpage 1\n\nHello world\n');
  });

  it('writes an empty paragraph as a single backslash', () => {
    check({ blocks: [paragraph([])] }, '~sealpage 1\n\n\\\n');
  });

  it('serialises marks and links inside a paragraph', () => {
    const doc: Doc = {
      blocks: [
        paragraph([
          text('Bold', { bold: true }),
          text(' and '),
          text('link', { href: 'https://example.com/a' }),
        ]),
      ],
    };
    check(doc, '~sealpage 1\n\n*Bold* and [link](https://example.com/a)\n');
  });
});

describe('divider block', () => {
  it('serialises as a line of three dashes', () => {
    check({ blocks: [divider()] }, '~sealpage 1\n\n---\n');
  });
});

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

describe('code block', () => {
  it('serialises language label and each line with a "| " prefix', () => {
    const doc: Doc = {
      blocks: [codeBlock('python', 'def greet(name):\n    return f"Hello, {name}"')],
    };
    check(doc, '~sealpage 1\n\n@code "python"\n| def greet(name):\n|     return f"Hello, {name}"\n');
  });

  it('writes an empty code block as one bare "|" line', () => {
    check({ blocks: [codeBlock('', '')] }, '~sealpage 1\n\n@code ""\n|\n');
  });

  it('writes an empty line inside code as a bare "|"', () => {
    check({ blocks: [codeBlock('', 'a\n\nb')] }, '~sealpage 1\n\n@code ""\n| a\n|\n| b\n');
  });

  it('keeps lines that look like other blocks inside the code body', () => {
    const doc: Doc = {
      blocks: [codeBlock('', '@code "x"\n| pipe\n---\n= title\n~sealpage 1')],
    };
    check(
      doc,
      '~sealpage 1\n\n@code ""\n| @code "x"\n| | pipe\n| ---\n| = title\n| ~sealpage 1\n',
    );
  });

  it('keeps a blank line inside code without ending the block', () => {
    const doc: Doc = { blocks: [codeBlock('', 'first\n\nlast')] };
    expect(parseMarkup('~sealpage 1\n\n@code ""\n| first\n|\n| last\n')).toStrictEqual(doc);
    roundTrip(doc);
  });

  it('keeps leading and trailing blank lines of code', () => {
    check({ blocks: [codeBlock('', '\nabc\n')] }, '~sealpage 1\n\n@code ""\n|\n| abc\n|\n');
  });

  it('keeps trailing spaces on a code line verbatim', () => {
    check({ blocks: [codeBlock('', 'abc   ')] }, '~sealpage 1\n\n@code ""\n| abc   \n');
  });

  it('keeps tabs inside a code line verbatim', () => {
    check({ blocks: [codeBlock('', '\tindented\tend')] }, '~sealpage 1\n\n@code ""\n| \tindented\tend\n');
  });

  it('keeps a lone backslash on a code line verbatim', () => {
    check({ blocks: [codeBlock('', '\\')] }, '~sealpage 1\n\n@code ""\n| \\\n');
  });

  it('keeps leading indentation of code lines', () => {
    check({ blocks: [codeBlock('', '    x')] }, '~sealpage 1\n\n@code ""\n|     x\n');
  });

  it('serialises a language label that contains double quotes', () => {
    check({ blocks: [codeBlock('say "hi"', 'x')] }, '~sealpage 1\n\n@code "say \\"hi\\""\n| x\n');
  });

  it('serialises a language label that contains backslashes', () => {
    check({ blocks: [codeBlock('C:\\dir', 'x')] }, '~sealpage 1\n\n@code "C:\\\\dir"\n| x\n');
  });

  it('serialises a language label with unicode characters', () => {
    check({ blocks: [codeBlock('日本語', 'x')] }, '~sealpage 1\n\n@code "日本語"\n| x\n');
  });

  it('serialises a language label that contains spaces', () => {
    check({ blocks: [codeBlock('plain text', 'x')] }, '~sealpage 1\n\n@code "plain text"\n| x\n');
  });

  it('trims surrounding spaces from the language label during normalisation', () => {
    const out = serializeMarkup({ blocks: [codeBlock('  py  ', 'x')] });
    expect(out).toBe('~sealpage 1\n\n@code "py"\n| x\n');
    expect(parseMarkup(out)).toStrictEqual({ blocks: [codeBlock('py', 'x')] });
  });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe('list blocks', () => {
  it('serialises a bullet list with "- " markers', () => {
    const doc: Doc = {
      blocks: [list('bullet', [listItem([text('one')]), listItem([text('two')])])],
    };
    check(doc, '~sealpage 1\n\n- one\n- two\n');
  });

  it('serialises a numbered list with "+ " markers', () => {
    const doc: Doc = {
      blocks: [list('numbered', [listItem([text('first')]), listItem([text('second')])])],
    };
    check(doc, '~sealpage 1\n\n+ first\n+ second\n');
  });

  it('serialises a checklist with "-[ ]" and "-[x]" markers', () => {
    const doc: Doc = {
      blocks: [list('check', [listItem([text('open')], false), listItem([text('closed')], true)])],
    };
    check(doc, '~sealpage 1\n\n-[ ] open\n-[x] closed\n');
  });

  it('writes an empty bullet item as a bare "-"', () => {
    check({ blocks: [list('bullet', [listItem([])])] }, '~sealpage 1\n\n-\n');
  });

  it('writes an empty numbered item as a bare "+"', () => {
    check({ blocks: [list('numbered', [listItem([])])] }, '~sealpage 1\n\n+\n');
  });

  it('writes an empty unchecked checklist item as "-[ ]"', () => {
    check({ blocks: [list('check', [listItem([], false)])] }, '~sealpage 1\n\n-[ ]\n');
  });

  it('writes an empty checked checklist item as "-[x]"', () => {
    check({ blocks: [list('check', [listItem([], true)])] }, '~sealpage 1\n\n-[x]\n');
  });
});

describe('nested lists', () => {
  it('nests a numbered list two spaces deeper under a bullet', () => {
    const doc: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('First point')], false, [
            list('bullet', [listItem([text('A nested point')])]),
          ]),
          listItem([text('Second point')]),
        ]),
      ],
    };
    check(doc, '~sealpage 1\n\n- First point\n  - A nested point\n- Second point\n');
  });

  it('serialises a numbered child list and a checklist grandchild', () => {
    const doc: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('a')], false, [
            list('numbered', [
              listItem([text('b')], false, [
                list('check', [listItem([text('c')], true), listItem([text('d')], false)]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    check(doc, '~sealpage 1\n\n- a\n  + b\n    -[x] c\n    -[ ] d\n');
  });

  it('keeps nested lists of different kinds as sibling lists', () => {
    const doc: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('a')], false, [
            list('bullet', [listItem([text('b')])]),
            list('numbered', [listItem([text('c')])]),
          ]),
        ]),
      ],
    };
    check(doc, '~sealpage 1\n\n- a\n  - b\n  + c\n');
  });

  it('merges adjacent nested lists of the same kind when normalising', () => {
    const unmerged: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('a')], false, [
            list('bullet', [listItem([text('b')])]),
            list('bullet', [listItem([text('c')])]),
          ]),
        ]),
      ],
    };
    const merged: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('a')], false, [
            list('bullet', [listItem([text('b')]), listItem([text('c')])]),
          ]),
        ]),
      ],
    };
    expect(serializeMarkup(unmerged)).toBe('~sealpage 1\n\n- a\n  - b\n  - c\n');
    expect(parseMarkup('~sealpage 1\n\n- a\n  - b\n  - c\n')).toStrictEqual(merged);
    roundTrip(unmerged);
  });

  it('round trips four levels of nesting with mixed kinds', () => {
    const doc: Doc = {
      blocks: [
        list('bullet', [
          listItem([text('L0')], false, [
            list('numbered', [
              listItem([text('L1')], false, [
                list('check', [
                  listItem([text('L2')], false, [list('bullet', [listItem([text('L3')])])]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    check(doc, '~sealpage 1\n\n- L0\n  + L1\n    -[ ] L2\n      - L3\n');
  });

  it('forces checked to false on bullet items', () => {
    const unnormalised: Doc = { blocks: [list('bullet', [listItem([text('x')], true)])] };
    expect(serializeMarkup(unnormalised)).toBe('~sealpage 1\n\n- x\n');
    expect(parseMarkup('~sealpage 1\n\n- x\n')).toStrictEqual({
      blocks: [list('bullet', [listItem([text('x')], false)])],
    });
  });

  it('forces checked to false on numbered items', () => {
    const unnormalised: Doc = { blocks: [list('numbered', [listItem([text('x')], true)])] };
    expect(serializeMarkup(unnormalised)).toBe('~sealpage 1\n\n+ x\n');
    expect(parseMarkup('~sealpage 1\n\n+ x\n')).toStrictEqual({
      blocks: [list('numbered', [listItem([text('x')], false)])],
    });
  });

  it('keeps two adjacent top-level bullet lists as two lists', () => {
    const doc: Doc = {
      blocks: [list('bullet', [listItem([text('a')])]), list('bullet', [listItem([text('b')])])],
    };
    check(doc, '~sealpage 1\n\n- a\n\n- b\n');
  });
});

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

describe('quote block', () => {
  it('serialises each paragraph of a quote as its own "> " line', () => {
    const doc: Doc = {
      blocks: [quote([[text('First paragraph of the quote.')], [text('Second paragraph.')]])],
    };
    check(doc, '~sealpage 1\n\n> First paragraph of the quote.\n> Second paragraph.\n');
  });

  it('keeps three paragraphs in one quote', () => {
    const doc: Doc = { blocks: [quote([[text('One')], [text('Two')], [text('Three')]])] };
    check(doc, '~sealpage 1\n\n> One\n> Two\n> Three\n');
  });

  it('writes an empty quote paragraph as a bare ">"', () => {
    check({ blocks: [quote([[]])] }, '~sealpage 1\n\n>\n');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('table block', () => {
  it('serialises a table with a header row', () => {
    const doc: Doc = { blocks: [table(SALES_ROWS, true)] };
    check(doc, '~sealpage 1\n\n@table header\n| Name | Role |\n| Ada | Engineer |\n| Grace | Admiral |\n');
  });

  it('serialises a table without a header row as plain "@table"', () => {
    const doc: Doc = { blocks: [table(SALES_ROWS, false)] };
    check(doc, '~sealpage 1\n\n@table\n| Name | Role |\n| Ada | Engineer |\n| Grace | Admiral |\n');
  });

  it('writes a 1x1 empty table without header as two spaces between bars', () => {
    check({ blocks: [table([[[]]], false)] }, '~sealpage 1\n\n@table\n|  |\n');
  });

  it('writes a 1x1 empty table with header', () => {
    check({ blocks: [table([[[]]], true)] }, '~sealpage 1\n\n@table header\n|  |\n');
  });

  it('pads short rows with empty cells when normalising', () => {
    const ragged: Doc = {
      blocks: [table([[[text('a')]], [[text('b')], [text('c')]]], true)],
    };
    const padded: Doc = {
      blocks: [table([[[text('a')], []], [[text('b')], [text('c')]]], true)],
    };
    expect(serializeMarkup(ragged)).toBe('~sealpage 1\n\n@table header\n| a |  |\n| b | c |\n');
    expect(parseMarkup(serializeMarkup(ragged))).toStrictEqual(padded);
    roundTrip(ragged);
  });

  it('escapes a pipe inside a cell', () => {
    check({ blocks: [table([[[text('a|b')]]], true)] }, '~sealpage 1\n\n@table header\n| a\\|b |\n');
  });

  it('protects leading and trailing spaces inside a cell', () => {
    check({ blocks: [table([[[text(' a ')]]], true)] }, '~sealpage 1\n\n@table header\n| \\u{20}a\\u{20} |\n');
  });

  it('writes empty cells as two spaces between bars', () => {
    const doc: Doc = {
      blocks: [table([[[], [text('x')]], [[text('y')], []]], true)],
    };
    check(doc, '~sealpage 1\n\n@table header\n|  | x |\n| y |  |\n');
  });

  it('keeps inline marks inside cells', () => {
    const doc: Doc = { blocks: [table([[[text('b', { bold: true })]]], true)] };
    check(doc, '~sealpage 1\n\n@table header\n| *b* |\n');
  });
});

// ---------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------

const GRAPH_DEFAULT_TEXT =
  '~sealpage 1\n\n' +
  '@graph bar\n' +
  ': title ""\n' +
  ': x-label ""\n' +
  ': y-label ""\n' +
  ': legend show bottom\n' +
  ': bins 0\n' +
  '| ["Label","Series 1"]\n' +
  '| ["A","3"]\n' +
  '| ["B","5"]\n' +
  '| ["C","2"]\n';

describe('graph block', () => {
  it('serialises the default bar graph with all five property lines', () => {
    check({ blocks: [defaultGraph('bar')] }, GRAPH_DEFAULT_TEXT);
  });

  it('writes a graph with no rows as only the column line', () => {
    check(
      { blocks: [graph('pie', { rows: [] })] },
      '~sealpage 1\n\n@graph pie\n: title ""\n: x-label ""\n: y-label ""\n: legend show bottom\n: bins 0\n| ["Label","Series 1"]\n',
    );
  });

  it.each([
    ['bar', '@graph bar'],
    ['grouped-bar', '@graph grouped-bar'],
    ['stacked-bar', '@graph stacked-bar'],
    ['line', '@graph line'],
    ['area', '@graph area'],
    ['pie', '@graph pie'],
    ['scatter', '@graph scatter'],
    ['histogram', '@graph histogram'],
  ] as const)('writes the %s chart type on the directive line', (chart, line) => {
    const out = serializeMarkup({ blocks: [defaultGraph(chart)] });
    expect(out.split('\n')[2]).toBe(line);
    check({ blocks: [defaultGraph(chart)] }, GRAPH_DEFAULT_TEXT.replace('@graph bar', line));
  });

  it('writes a hidden legend with its position', () => {
    check(
      { blocks: [graph('bar', { legend: { show: false, position: 'top' } })] },
      GRAPH_DEFAULT_TEXT.replace(': legend show bottom', ': legend hide top'),
    );
  });

  it('writes a legend shown at the top', () => {
    check(
      { blocks: [graph('bar', { legend: { show: true, position: 'top' } })] },
      GRAPH_DEFAULT_TEXT.replace(': legend show bottom', ': legend show top'),
    );
  });

  it('writes a legend shown at the left', () => {
    check(
      { blocks: [graph('bar', { legend: { show: true, position: 'left' } })] },
      GRAPH_DEFAULT_TEXT.replace(': legend show bottom', ': legend show left'),
    );
  });

  it('writes a legend shown at the right', () => {
    check(
      { blocks: [graph('bar', { legend: { show: true, position: 'right' } })] },
      GRAPH_DEFAULT_TEXT.replace(': legend show bottom', ': legend show right'),
    );
  });

  it('writes an explicit bin count', () => {
    check({ blocks: [graph('histogram', { bins: 12 })] }, GRAPH_DEFAULT_TEXT.replace('@graph bar', '@graph histogram').replace(': bins 0', ': bins 12'));
  });

  it('writes the maximum bin count of 200', () => {
    check({ blocks: [graph('histogram', { bins: 200 })] }, GRAPH_DEFAULT_TEXT.replace('@graph bar', '@graph histogram').replace(': bins 0', ': bins 200'));
  });

  it('writes title, x label and y label as JSON strings', () => {
    const doc: Doc = {
      blocks: [graph('grouped-bar', { title: 'Revenue by quarter', xLabel: 'Quarter', yLabel: 'USD (thousands)' })],
    };
    check(
      doc,
      '~sealpage 1\n\n@graph grouped-bar\n: title "Revenue by quarter"\n: x-label "Quarter"\n: y-label "USD (thousands)"\n: legend show bottom\n: bins 0\n| ["Label","Series 1"]\n| ["A","3"]\n| ["B","5"]\n| ["C","2"]\n',
    );
  });

  it('escapes double quotes and backslashes in labels', () => {
    const doc: Doc = { blocks: [graph('bar', { title: 'Say "hi"', xLabel: 'C:\\path' })] };
    const out = serializeMarkup(doc);
    expect(out.split('\n')[3]).toBe(': title "Say \\"hi\\""');
    expect(out.split('\n')[4]).toBe(': x-label "C:\\\\path"');
    check(doc, out);
  });

  it('turns line breaks in labels into spaces', () => {
    const doc: Doc = { blocks: [graph('bar', { yLabel: 'a\nb' })] };
    expect(serializeMarkup(doc).split('\n')[5]).toBe(': y-label "a b"');
    expect(parseMarkup(serializeMarkup(doc))).toStrictEqual({ blocks: [graph('bar', { yLabel: 'a b' })] });
  });

  it('writes unicode labels unescaped', () => {
    check({ blocks: [graph('bar', { title: '€ 日本 🎉' })] }, GRAPH_DEFAULT_TEXT.replace(': title ""', ': title "€ 日本 🎉"'));
  });

  it('writes cells containing pipe, quote, comma and bracket characters as JSON', () => {
    const doc: Doc = {
      blocks: [graph('bar', { columns: ['K', 'V'], rows: [['a|b', '"q"'], ['x,y', 'z]']] })],
    };
    check(
      doc,
      '~sealpage 1\n\n@graph bar\n: title ""\n: x-label ""\n: y-label ""\n: legend show bottom\n: bins 0\n| ["K","V"]\n| ["a|b","\\"q\\""]\n| ["x,y","z]"]\n',
    );
  });

  it('writes a graph with three series columns', () => {
    const doc: Doc = {
      blocks: [graph('line', { columns: ['Month', 'A', 'B'], rows: [['Jan', '1', '2']] })],
    };
    check(
      doc,
      '~sealpage 1\n\n@graph line\n: title ""\n: x-label ""\n: y-label ""\n: legend show bottom\n: bins 0\n| ["Month","A","B"]\n| ["Jan","1","2"]\n',
    );
  });

  it('clamps out-of-range bin counts during normalisation', () => {
    expect(serializeMarkup({ blocks: [graph('histogram', { bins: 500 })] })).toContain(': bins 200\n');
    expect(serializeMarkup({ blocks: [graph('histogram', { bins: -3 })] })).toContain(': bins 0\n');
  });
});

// ---------------------------------------------------------------------------
// Documents and separators
// ---------------------------------------------------------------------------

describe('document structure', () => {
  it('writes a document with zero blocks as the version line only', () => {
    check({ blocks: [] }, '~sealpage 1\n');
    expect(parseMarkup('~sealpage 1\n')).toStrictEqual({ blocks: [] });
  });

  it('writes exactly one blank line between consecutive blocks', () => {
    const doc: Doc = { blocks: [title([text('T')]), paragraph([text('P')]), divider()] };
    check(doc, '~sealpage 1\n\n= T\n\nP\n\n---\n');
  });

  it('writes each block type in sequence with one blank line between', () => {
    const doc: Doc = {
      blocks: [
        heading(2, [text('H')]),
        codeBlock('', 'c'),
        quote([[text('q')]]),
        table([[[text('t')]]], false),
      ],
    };
    check(doc, '~sealpage 1\n\n=== H\n\n@code ""\n| c\n\n> q\n\n@table\n| t |\n');
  });
});

// ---------------------------------------------------------------------------
// markupVersion
// ---------------------------------------------------------------------------

describe('markupVersion', () => {
  it('reads the version from a valid first line', () => {
    expect(markupVersion('~sealpage 1\n\n= x\n')).toBe(1);
  });

  it('reads a version other than 1 without judging it', () => {
    expect(markupVersion('~sealpage 2\n')).toBe(2);
  });

  it('accepts a CRLF first line', () => {
    expect(markupVersion('~sealpage 1\r\n\r\n= x\r\n')).toBe(1);
  });

  it('ignores a leading byte order mark', () => {
    expect(markupVersion('\uFEFF~sealpage 1\n')).toBe(1);
  });

  it('returns null for an empty string', () => {
    expect(markupVersion('')).toBeNull();
  });

  it('returns null when the version line is missing', () => {
    expect(markupVersion('= x\n~sealpage 1\n')).toBeNull();
  });

  it('returns null when the version is not a number', () => {
    expect(markupVersion('~sealpage x\n')).toBeNull();
  });

  it('returns null when the version number is missing', () => {
    expect(markupVersion('~sealpage\n')).toBeNull();
  });

  it('returns null when there are two spaces before the number', () => {
    expect(markupVersion('~sealpage  1\n')).toBeNull();
  });

  it('returns null when the version has a fractional part', () => {
    expect(markupVersion('~sealpage 1.0\n')).toBeNull();
  });
});
