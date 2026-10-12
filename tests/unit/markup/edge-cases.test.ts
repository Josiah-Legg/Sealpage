import { describe, it, expect } from 'vitest';
import {
  type Block,
  type Doc,
  type Inline,
  type ListBlock,
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
import { parseMarkup, serializeMarkup } from '../../../src/shared/markup';

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

/** The serialised line of a single paragraph whose text is `s`; checks it stays a paragraph. */
function paragraphLine(s: string): string {
  const doc: Doc = { blocks: [paragraph([text(s)])] };
  const out = roundTrip(doc);
  expect(parseMarkup(out).blocks.map((b) => b.type)).toStrictEqual(['paragraph']);
  return out.split('\n')[2]!;
}

function listOf(content: string): Block {
  return list('bullet', [listItem([text(content)])]);
}

// ---------------------------------------------------------------------------
// Paragraphs that begin with block sigils
// ---------------------------------------------------------------------------

describe('paragraphs that start with a block sigil', () => {
  it('escapes a paragraph starting with "= " so it stays a paragraph', () => {
    expect(paragraphLine('= x')).toBe('\\= x');
  });

  it('escapes a paragraph starting with "== "', () => {
    expect(paragraphLine('== x')).toBe('\\== x');
  });

  it('escapes a paragraph starting with "- "', () => {
    expect(paragraphLine('- x')).toBe('\\- x');
  });

  it('escapes a paragraph starting with "+ "', () => {
    expect(paragraphLine('+ x')).toBe('\\+ x');
  });

  it('escapes a paragraph starting with "-[ ] "', () => {
    expect(paragraphLine('-[ ] x')).toBe('\\-\\[ \\] x');
  });

  it('escapes a paragraph starting with "-[x] "', () => {
    expect(paragraphLine('-[x] x')).toBe('\\-\\[x\\] x');
  });

  it('escapes a paragraph starting with "> "', () => {
    expect(paragraphLine('> x')).toBe('\\> x');
  });

  it('escapes a paragraph starting with "@code"', () => {
    expect(paragraphLine('@code')).toBe('\\@code');
  });

  it('escapes a paragraph starting with "@table"', () => {
    expect(paragraphLine('@table')).toBe('\\@table');
  });

  it('escapes a paragraph starting with "@graph bar"', () => {
    expect(paragraphLine('@graph bar')).toBe('\\@graph bar');
  });

  it('escapes a paragraph starting with the version line text', () => {
    expect(paragraphLine('~sealpage 1')).toBe('\\~sealpage 1');
  });

  it('escapes a paragraph that is a divider', () => {
    expect(paragraphLine('---')).toBe('\\---');
  });

  it('escapes a paragraph that looks like a property line', () => {
    expect(paragraphLine(': title "x"')).toBe('\\: title "x"');
  });

  it('escapes a paragraph that looks like a table row', () => {
    expect(paragraphLine('| a |')).toBe('\\| a \\|');
  });

  it('writes two leading spaces as \\u{20} and keeps the rest of the line', () => {
    expect(paragraphLine('  - indented')).toBe('\\u{20} - indented');
  });

  it('writes a single space as \\u{20}', () => {
    expect(paragraphLine(' ')).toBe('\\u{20}');
  });

  it('writes a single tab as \\t', () => {
    expect(paragraphLine('\t')).toBe('\\t');
  });

  it('writes a lone backslash as an escaped backslash', () => {
    expect(paragraphLine('\\')).toBe('\\\\');
  });

  it('writes the empty string as a single backslash', () => {
    expect(paragraphLine('')).toBe('\\');
  });
});

describe('other block lines whose content starts with a sigil', () => {
  it('writes a bullet item whose content is "- x" as "- - x"', () => {
    check({ blocks: [listOf('- x')] }, '~sealpage 1\n\n- - x\n');
  });

  it('writes a numbered item whose content is "+ x" as "+ + x"', () => {
    check({ blocks: [list('numbered', [listItem([text('+ x')])])] }, '~sealpage 1\n\n+ + x\n');
  });

  it('escapes a bullet item whose content looks like a checklist marker', () => {
    check({ blocks: [listOf('-[ ] x')] }, '~sealpage 1\n\n- -\\[ \\] x\n');
  });

  it('writes a bullet item whose content is "@code" without escaping', () => {
    check({ blocks: [listOf('@code')] }, '~sealpage 1\n\n- @code\n');
  });

  it('writes a bullet item whose content is "> x" without escaping', () => {
    check({ blocks: [listOf('> x')] }, '~sealpage 1\n\n- > x\n');
  });

  it('writes a bullet item whose content is "= x" without escaping', () => {
    check({ blocks: [listOf('= x')] }, '~sealpage 1\n\n- = x\n');
  });

  it('protects leading spaces of a list item content', () => {
    check({ blocks: [listOf('  - indented')] }, '~sealpage 1\n\n- \\u{20} - indented\n');
  });

  it('writes a level 1 heading whose content is "= x" as "== = x"', () => {
    check({ blocks: [heading(1, [text('= x')])] }, '~sealpage 1\n\n== = x\n');
  });

  it('writes a level 2 heading whose content is "- x" as "=== - x"', () => {
    check({ blocks: [heading(2, [text('- x')])] }, '~sealpage 1\n\n=== - x\n');
  });

  it('writes a title whose content is "== x" as "= == x"', () => {
    check({ blocks: [title([text('== x')])] }, '~sealpage 1\n\n= == x\n');
  });

  it('writes a quote line whose content is "> x" as "> > x"', () => {
    check({ blocks: [quote([[text('> x')]])] }, '~sealpage 1\n\n> > x\n');
  });

  it('writes a quote line whose content is "- x" as "> - x"', () => {
    check({ blocks: [quote([[text('- x')]])] }, '~sealpage 1\n\n> - x\n');
  });

  it('writes a quote line whose content is "---" as "> ---"', () => {
    check({ blocks: [quote([[text('---')]])] }, '~sealpage 1\n\n> ---\n');
  });

  it('escapes a table cell whose content starts with a pipe', () => {
    check({ blocks: [table([[[text('| x')]]], true)] }, '~sealpage 1\n\n@table header\n| \\| x |\n');
  });

  it('writes a table cell whose content is "- x" without escaping', () => {
    check({ blocks: [table([[[text('- x')]]], true)] }, '~sealpage 1\n\n@table header\n| - x |\n');
  });

  it('writes a table cell whose content is "@table" without escaping', () => {
    check({ blocks: [table([[[text('@table')]]], false)] }, '~sealpage 1\n\n@table\n| @table |\n');
  });
});

// ---------------------------------------------------------------------------
// Unusual Unicode
// ---------------------------------------------------------------------------

describe('unusual Unicode round trips', () => {
  const rawCases: [string, string][] = [
    ['ZWJ family emoji', '\u{1F468}‍\u{1F469}‍\u{1F467}'],
    ['emoji with skin tone modifier', '\u{1F44D}\u{1F3FD}'],
    ['regional indicator flag', '\u{1F1EF}\u{1F1F5}'],
    ['CJK text', '日本語のテキスト'],
    ['Arabic text', 'مرحبا بالعالم'],
    ['Hebrew text', 'שלום עולם'],
    ['right-to-left override with terminator', '‮abc‬'],
    ['bidi isolates (LRI, RLI, FSI, PDI)', '⁦x⁩ ⁧y⁩ ⁨z⁩'],
    ['zero-width space', 'a​b'],
    ['zero-width joiner', 'a‍b'],
    ['byte order mark in the middle of text', 'a﻿b'],
    ['non-BMP mathematical letter and Gothic letter', '\u{1D4B3}\u{10348}'],
    ['decomposed accent (NFD) is not normalised', 'é'],
  ];

  for (const [name, s] of rawCases) {
    it(`round trips ${name} exactly`, () => {
      expect(paragraphLine(s)).toBe(s);
      const doc: Doc = { blocks: [paragraph([text(s)])] };
      expect(parseMarkup(serializeMarkup(doc))).toStrictEqual(doc);
    });
  }

  it('keeps the decomposed accent distinct from the precomposed one', () => {
    expect(paragraphLine('é')).not.toBe(paragraphLine('é'));
  });

  it('does not escape a non-breaking space at the start or end of text', () => {
    expect(paragraphLine(' x ')).toBe(' x ');
  });

  it('does not escape an em space at the start of text', () => {
    expect(paragraphLine(' x')).toBe(' x');
  });

  it('does not escape an ideographic space at the end of text', () => {
    expect(paragraphLine('x　')).toBe('x　');
  });

  it('treats a paragraph of only non-breaking spaces as a paragraph', () => {
    expect(paragraphLine(' ')).toBe(' ');
  });

  it('round trips inline content that mixes scripts and marks', () => {
    const content: Inline[] = [
      text('مرحبا', { bold: true }),
      text(' 日本 '),
      text('é', { italic: true, href: 'https://example.com/́' }),
    ];
    const doc: Doc = { blocks: [paragraph(content)] };
    expect(parseMarkup(serializeMarkup(doc))).toStrictEqual(normalizeDoc(doc));
  });
});

// ---------------------------------------------------------------------------
// Large inputs
// ---------------------------------------------------------------------------

describe('large inputs', () => {
  it('round trips a 100 000 character paragraph of plain text', () => {
    const big = 'x'.repeat(100000);
    const doc: Doc = { blocks: [paragraph([text(big)])] };
    const out = roundTrip(doc);
    expect(out.length).toBe('~sealpage 1\n\n'.length + 100000 + 1);
    const parsed = parseMarkup(out);
    expect(parsed.blocks).toHaveLength(1);
    expect((parsed.blocks[0] as { content: Inline[] }).content).toStrictEqual([text(big)]);
  });

  it('round trips a 100 000 character paragraph full of markup characters', () => {
    const big = 'a*b_c`d[e]f|g\\h'.repeat(7000);
    expect(big.length).toBeGreaterThanOrEqual(100000);
    const doc: Doc = { blocks: [paragraph([text(big)])] };
    roundTrip(doc);
  });

  it('round trips a document with 2 000 blocks', () => {
    const blocks: Block[] = Array.from({ length: 2000 }, (_, i) => paragraph([text(`p${i}`)]));
    const doc: Doc = { blocks };
    const out = roundTrip(doc);
    expect(parseMarkup(out).blocks).toHaveLength(2000);
    expect(out.startsWith('~sealpage 1\n\np0\n\np1\n\np2\n')).toBe(true);
    expect(out.endsWith('\n\np1999\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parser leniency at block level
// ---------------------------------------------------------------------------

describe('parser leniency at block level', () => {
  it('ignores a leading byte order mark', () => {
    expect(parseMarkup('﻿~sealpage 1\n\n= x\n')).toStrictEqual({ blocks: [title([text('x')])] });
  });

  it('accepts CRLF line endings', () => {
    expect(parseMarkup('~sealpage 1\r\n\r\n= Title\r\n\r\nBody\r\n')).toStrictEqual({
      blocks: [title([text('Title')]), paragraph([text('Body')])],
    });
  });

  it('accepts several blank lines between blocks', () => {
    expect(parseMarkup('~sealpage 1\n\n\n\n= a\n\n\n\nb\n')).toStrictEqual({
      blocks: [title([text('a')]), paragraph([text('b')])],
    });
  });

  it('parses a document with no version line', () => {
    expect(parseMarkup('= a\n\nb\n')).toStrictEqual({
      blocks: [title([text('a')]), paragraph([text('b')])],
    });
  });

  it('reads an unknown @directive line as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n@foo bar\n')).toStrictEqual({ blocks: [paragraph([text('@foo bar')])] });
  });

  it('reads five equals signs as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n=====\n')).toStrictEqual({ blocks: [paragraph([text('=====')])] });
  });

  it('reads "=x" (no space) as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n=x\n')).toStrictEqual({ blocks: [paragraph([text('=x')])] });
  });

  it('reads "-x" (no space) as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n-x\n')).toStrictEqual({ blocks: [paragraph([text('-x')])] });
  });

  it('reads a stray table row with no @table line as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n| a | b |\n')).toStrictEqual({
      blocks: [paragraph([text('| a | b |')])],
    });
  });

  it('reads @table with no rows as a 1x1 empty table without header', () => {
    expect(parseMarkup('~sealpage 1\n\n@table\n')).toStrictEqual({ blocks: [table([[[]]], false)] });
  });

  it('reads @table header with no rows as a 1x1 empty table with header', () => {
    expect(parseMarkup('~sealpage 1\n\n@table header\n')).toStrictEqual({ blocks: [table([[[]]], true)] });
  });

  it('reads @code with no label and no lines as an empty code block', () => {
    expect(parseMarkup('~sealpage 1\n\n@code\n')).toStrictEqual({ blocks: [codeBlock('', '')] });
  });

  it('reads an unknown graph type as a bar graph', () => {
    expect(parseMarkup('~sealpage 1\n\n@graph sparkline\n: title "T"\n| ["Label","Series 1"]\n| ["A","1"]\n')).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), title: 'T', rows: [['A', '1']] }],
    });
  });

  it('ignores unknown graph properties', () => {
    expect(parseMarkup('~sealpage 1\n\n@graph bar\n: colour red\n| ["L","V"]\n')).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), columns: ['L', 'V'], rows: [] }],
    });
  });

  it('uses default labels, legend and bins when a graph has no property lines', () => {
    expect(parseMarkup('~sealpage 1\n\n@graph bar\n| ["Label","Series 1"]\n')).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), rows: [] }],
    });
  });

  it('defaults the columns of a graph with a missing column line', () => {
    expect(parseMarkup('~sealpage 1\n\n@graph bar\n: title "T"\n')).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), title: 'T', rows: [] }],
    });
  });

  it('skips malformed JSON data lines in a graph', () => {
    expect(
      parseMarkup('~sealpage 1\n\n@graph bar\n| ["Label","Series 1"]\n| [oops\n| ["A","5"]\n| {"x":1}\n| ["B","7"]\n'),
    ).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), rows: [['A', '5'], ['B', '7']] }],
    });
  });

  it('widens the column list to the widest row without dropping cells', () => {
    expect(parseMarkup('~sealpage 1\n\n@graph bar\n| ["Label"]\n| ["A","1","2"]\n')).toStrictEqual({
      blocks: [{ ...defaultGraph('bar'), columns: ['Label', 'Series 1', 'Series 2'], rows: [['A', '1', '2']] }],
    });
  });

  it('treats a list indent that jumps two levels as one level deeper', () => {
    expect(parseMarkup('~sealpage 1\n\n- a\n    - b\n')).toStrictEqual({
      blocks: [list('bullet', [listItem([text('a')], false, [list('bullet', [listItem([text('b')])])])])],
    });
  });

  it('reads a list marker preceded by one space as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n - x\n')).toStrictEqual({ blocks: [paragraph([text(' - x')])] });
  });

  it('reads a list marker preceded by three spaces as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n   - x\n')).toStrictEqual({ blocks: [paragraph([text('   - x')])] });
  });

  it('reads a divider line with trailing text as a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n---x\n')).toStrictEqual({ blocks: [paragraph([text('---x')])] });
  });

  it('reads an ordinary divider followed by a paragraph', () => {
    expect(parseMarkup('~sealpage 1\n\n---\n\nafter\n')).toStrictEqual({
      blocks: [divider(), paragraph([text('after')])],
    });
  });
});

// ---------------------------------------------------------------------------
// The parser is total
// ---------------------------------------------------------------------------

describe('the parser never throws', () => {
  it('accepts the empty string', () => {
    expect(parseMarkup('')).toStrictEqual({ blocks: [] });
  });

  it('accepts only newlines', () => {
    expect(parseMarkup('\n\n\n')).toStrictEqual({ blocks: [] });
  });

  it('accepts only spaces', () => {
    expect(parseMarkup('   ')).toStrictEqual({ blocks: [] });
  });

  it('accepts random punctuation', () => {
    const soup = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
    const doc = parseMarkup(soup);
    expect(doc.blocks.map((b) => b.type)).toStrictEqual(['paragraph']);
    expect(parseMarkup(serializeMarkup(doc))).toStrictEqual(doc);
  });

  it('reads 10 000 "[" characters as literal text', () => {
    expect(parseMarkup('['.repeat(10000))).toStrictEqual({
      blocks: [paragraph([text('['.repeat(10000))])],
    });
  });

  it('reads 10 000 backslashes as 5 000 literal backslashes', () => {
    expect(parseMarkup('\\'.repeat(10000))).toStrictEqual({
      blocks: [paragraph([text('\\'.repeat(5000))])],
    });
  });

  it('parses 200 levels of deeply indented list lines and writes them back identically', () => {
    const lines = Array.from({ length: 200 }, (_, d) => '  '.repeat(d) + '- L' + d);
    const source = '~sealpage 1\n\n' + lines.join('\n') + '\n';
    const doc = parseMarkup(source);
    expect(doc.blocks).toHaveLength(1);
    let depth = 0;
    let level = doc.blocks[0] as ListBlock;
    for (;;) {
      depth++;
      const child = level.items[0]!.children;
      if (child.length === 0) break;
      level = child[0]!;
    }
    expect(depth).toBe(200);
    expect(serializeMarkup(doc)).toBe(source);
  });
});
