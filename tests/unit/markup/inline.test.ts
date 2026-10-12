import { describe, it, expect } from 'vitest';
import { type Inline, lineBreak, normalizeInline, text } from '../../../src/shared/model';
import { parseInline, parseMarkup, serializeInline, serializeMarkup } from '../../../src/shared/markup';

/**
 * Serialise inline content to one line, parse it back, and check that the
 * parse equals the normalised input and that the line is a fixed point.
 */
function roundTripInline(content: Inline[]): string {
  const expected = normalizeInline(content);
  const line = serializeInline(expected);
  expect(parseInline(line)).toStrictEqual(expected);
  expect(serializeInline(parseInline(line))).toBe(line);
  return line;
}

/** Exact serialisation and exact parse of a line. */
function check(content: Inline[], line: string): void {
  expect(serializeInline(content)).toBe(line);
  expect(parseInline(line)).toStrictEqual(normalizeInline(content));
  roundTripInline(content);
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

describe('inline marks', () => {
  it('serialises plain text unchanged', () => {
    check([text('hello world')], 'hello world');
  });

  it('parses plain text to a single unmarked run', () => {
    expect(parseInline('hello world')).toStrictEqual([text('hello world')]);
  });

  it('serialises bold with "*"', () => {
    check([text('x', { bold: true })], '*x*');
  });

  it('serialises italic with "_"', () => {
    check([text('x', { italic: true })], '_x_');
  });

  it('serialises code with a backtick', () => {
    check([text('x', { code: true })], '`x`');
  });

  it('serialises bold and italic together', () => {
    check([text('x', { bold: true, italic: true })], '*_x_*');
  });

  it('serialises bold and code together', () => {
    check([text('x', { bold: true, code: true })], '*`x`*');
  });

  it('serialises italic and code together', () => {
    check([text('x', { italic: true, code: true })], '_`x`_');
  });

  it('serialises bold, italic and code together', () => {
    check([text('x', { bold: true, italic: true, code: true })], '*_`x`_*');
  });

  it('parses an unclosed bold toggle to a bold run that runs to the end of the line', () => {
    expect(parseInline('*x')).toStrictEqual([text('x', { bold: true })]);
  });

  it('serialises overlapping, non-nested marks as independent toggles', () => {
    const content = [
      text('a', { bold: true }),
      text('b', { bold: true, italic: true }),
      text('c', { italic: true }),
    ];
    check(content, '*a_b*c_');
  });

  it('parses the overlapping toggle example from the specification', () => {
    expect(parseInline('*a _b* c_')).toStrictEqual([
      text('a ', { bold: true }),
      text('b', { bold: true, italic: true }),
      text(' c', { italic: true }),
    ]);
  });

  it('parses "**" to nothing', () => {
    expect(parseInline('**')).toStrictEqual([]);
  });

  it('merges the text either side of a double toggle', () => {
    expect(parseInline('a**b')).toStrictEqual([text('ab')]);
  });

  it('resets toggles at the start of each line', () => {
    expect(parseMarkup('~sealpage 1\n\n*start\n\nnext\n')).toStrictEqual({
      blocks: [
        { type: 'paragraph', content: [text('start', { bold: true })] },
        { type: 'paragraph', content: [text('next')] },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('inline links', () => {
  it('serialises a link as [text](target)', () => {
    check([text('a', { href: 'https://e.com' })], '[a](https://e.com)');
  });

  it('parses [text](target) to a linked run', () => {
    expect(parseInline('[a](https://e.com)')).toStrictEqual([text('a', { href: 'https://e.com' })]);
  });

  it('keeps marks inside a link', () => {
    check([text('a', { bold: true, href: 'x' })], '[*a*](x)');
  });

  it('carries a mark across the boundary of a link', () => {
    const content = [
      text('a', { bold: true }),
      text('b', { bold: true, href: 't' }),
      text('c', { bold: true }),
    ];
    check(content, '*a[b](t)c*');
  });

  it('serialises two adjacent links with different targets', () => {
    check([text('a', { href: 'x' }), text('b', { href: 'y' })], '[a](x)[b](y)');
  });

  it('escapes parentheses, backslashes and spaces in a link target', () => {
    const content = [text('x', { href: 'a)(b\\c d' })];
    check(content, '[x](a\\)\\(b\\\\c d)');
  });

  it('escapes a bracket inside a link target', () => {
    check([text('x', { href: 'a]b' })], '[x](a\\]b)');
  });

  it('reads a link with a parenthesis-containing target back exactly', () => {
    expect(parseInline('[x](a\\)\\(b\\\\c d)')).toStrictEqual([text('x', { href: 'a)(b\\c d' })]);
  });

  it('reads an empty link target as plain text', () => {
    expect(parseInline('[text]()')).toStrictEqual([text('text')]);
  });

  it('does not escape parentheses in plain text', () => {
    check([text('(a) and (b)')], '(a) and (b)');
  });

  it('keeps escaped brackets inside link text', () => {
    check([text('a]b', { href: 't' })], '[a\\]b](t)');
  });

  it('keeps a hard break inside link text, with the link closed after it', () => {
    check([text('a', { href: 't' }), lineBreak(), text('b')], '[a\\n](t)b');
  });

  it('does not nest links: an inner "[" inside link text is literal', () => {
    expect(parseInline('[a [b](t)')).toStrictEqual([text('a [b', { href: 't' })]);
  });
});

// ---------------------------------------------------------------------------
// Hard breaks
// ---------------------------------------------------------------------------

describe('hard line breaks', () => {
  it('serialises a break at the start', () => {
    check([lineBreak(), text('a')], '\\na');
  });

  it('serialises a break in the middle', () => {
    check([text('a'), lineBreak(), text('b')], 'a\\nb');
  });

  it('serialises a break at the end', () => {
    check([text('a'), lineBreak()], 'a\\n');
  });

  it('serialises several breaks in a row', () => {
    check([text('a'), lineBreak(), lineBreak(), text('b')], 'a\\n\\nb');
  });

  it('continues marks across a hard break', () => {
    check([text('a', { bold: true }), lineBreak(), text('b', { bold: true })], '*a\\nb*');
  });

  it('parses a backslash-n escape as a break node', () => {
    expect(parseInline('a\\nb')).toStrictEqual([text('a'), lineBreak(), text('b')]);
  });
});

// ---------------------------------------------------------------------------
// Escapes in text
// ---------------------------------------------------------------------------

describe('escaping in text', () => {
  it('escapes a backslash', () => {
    check([text('\\')], '\\\\');
  });

  it('escapes an asterisk', () => {
    check([text('*')], '\\*');
  });

  it('escapes an underscore', () => {
    check([text('_')], '\\_');
  });

  it('escapes a backtick', () => {
    check([text('`')], '\\`');
  });

  it('escapes an opening bracket', () => {
    check([text('[')], '\\[');
  });

  it('escapes a closing bracket', () => {
    check([text(']')], '\\]');
  });

  it('escapes a pipe', () => {
    check([text('|')], '\\|');
  });

  it('writes a leading space as \\u{20}', () => {
    check([text(' a')], '\\u{20}a');
  });

  it('writes a trailing space as \\u{20}', () => {
    check([text('a ')], 'a\\u{20}');
  });

  it('writes a leading tab as \\t', () => {
    check([text('\ta')], '\\ta');
  });

  it('writes a trailing tab as \\t', () => {
    check([text('a\t')], 'a\\t');
  });

  it('leaves interior spaces and tabs untouched', () => {
    check([text('a b\tc')], 'a b\tc');
  });

  it('writes U+0000 as \\u{0}', () => {
    check([text('\u0000')], '\\u{0}');
  });

  it('writes U+0007 as \\u{7}', () => {
    check([text('\u0007')], '\\u{7}');
  });

  it('writes U+001F as \\u{1F}', () => {
    check([text('\u001F')], '\\u{1F}');
  });

  it('writes U+007F as \\u{7F}', () => {
    check([text('\u007F')], '\\u{7F}');
  });

  it('writes U+0085 as \\u{85}', () => {
    check([text('\u0085')], '\\u{85}');
  });

  it('writes U+2028 as \\u{2028}', () => {
    check([text('\u2028')], '\\u{2028}');
  });

  it('writes U+2029 as \\u{2029}', () => {
    check([text('\u2029')], '\\u{2029}');
  });

  it('round trips literal text that looks like an escape', () => {
    check([text('\\n')], '\\\\n');
    check([text('\\t')], '\\\\t');
    check([text('\\u{41}')], '\\\\u{41}');
  });

  it('round trips an escape-like sequence in an ordinary word', () => {
    roundTripInline([text('path\\to\\file')]);
  });
});

// ---------------------------------------------------------------------------
// Parser leniency (FORMAT.md 1.5)
// ---------------------------------------------------------------------------

describe('parser leniency', () => {
  it('keeps the backslash of an unknown escape', () => {
    expect(parseInline('\\q')).toStrictEqual([text('\\q')]);
  });

  it('reads nothing for a trailing backslash', () => {
    expect(parseInline('a\\')).toStrictEqual([text('a')]);
  });

  it('reads nothing when the whole content is a trailing backslash', () => {
    expect(parseInline('\\')).toStrictEqual([]);
  });

  it('keeps the backslash of an empty \\u{} escape', () => {
    expect(parseInline('\\u{}')).toStrictEqual([text('\\u{}')]);
  });

  it('keeps the backslash of a \\u{} escape with non-hex digits', () => {
    expect(parseInline('\\u{ZZ}')).toStrictEqual([text('\\u{ZZ}')]);
  });

  it('keeps the backslash of an unterminated \\u{ escape', () => {
    expect(parseInline('\\u{41')).toStrictEqual([text('\\u{41')]);
  });

  it('keeps the backslash of a \\u{} escape with more than six digits', () => {
    expect(parseInline('\\u{0000041}')).toStrictEqual([text('\\u{0000041}')]);
  });

  it('reads a surrogate code point in \\u{} as U+FFFD', () => {
    expect(parseInline('\\u{D800}')).toStrictEqual([text('\uFFFD')]);
  });

  it('reads a code point above U+10FFFF in \\u{} as U+FFFD', () => {
    expect(parseInline('\\u{110000}')).toStrictEqual([text('\uFFFD')]);
  });

  it('reads a valid \\u{} escape as its code point', () => {
    expect(parseInline('\\u{41}')).toStrictEqual([text('A')]);
  });

  it('reads a six-digit \\u{} escape as a non-BMP code point', () => {
    expect(parseInline('\\u{1F600}')).toStrictEqual([text('\u{1F600}')]);
  });

  it('keeps an unmatched "[" as literal text', () => {
    expect(parseInline('[abc')).toStrictEqual([text('[abc')]);
  });

  it('keeps "[text]" without a following "(" as literal text', () => {
    expect(parseInline('[text]')).toStrictEqual([text('[text]')]);
  });

  it('keeps "[text](" without a closing ")" as literal text', () => {
    expect(parseInline('[text](')).toStrictEqual([text('[text](')]);
  });

  it('resets an unclosed bold toggle at the end of the line', () => {
    expect(parseInline('*a')).toStrictEqual([text('a', { bold: true })]);
  });

  it('reads an unescaped "*" in a line as a toggle with no trailing text', () => {
    expect(parseInline('a*')).toStrictEqual([text('a')]);
  });
});

// ---------------------------------------------------------------------------
// Normal form
// ---------------------------------------------------------------------------

describe('inline normal form', () => {
  it('merges adjacent runs with identical marks', () => {
    expect(normalizeInline([text('a'), text('b')])).toStrictEqual([text('ab')]);
  });

  it('does not merge adjacent runs whose marks differ', () => {
    expect(normalizeInline([text('a'), text('b', { bold: true })])).toStrictEqual([
      text('a'),
      text('b', { bold: true }),
    ]);
  });

  it('drops empty runs', () => {
    expect(normalizeInline([text(''), text('a'), text('')])).toStrictEqual([text('a')]);
  });

  it('turns "\\n" inside text into a break node', () => {
    expect(normalizeInline([text('a\nb')])).toStrictEqual([text('a'), lineBreak(), text('b')]);
  });

  it('turns "\\r\\n" inside text into a single break node', () => {
    expect(normalizeInline([text('a\r\nb')])).toStrictEqual([text('a'), lineBreak(), text('b')]);
  });

  it('turns a bare "\\r" inside text into a break node', () => {
    expect(normalizeInline([text('a\rb')])).toStrictEqual([text('a'), lineBreak(), text('b')]);
  });

  it('replaces a lone surrogate with U+FFFD', () => {
    expect(normalizeInline([text('a\uD800b')])).toStrictEqual([text('a\uFFFDb')]);
  });

  it('serialises line terminators in text only after they are normalised to breaks', () => {
    expect(serializeInline(normalizeInline([text('a\r\nb')]))).toBe('a\\nb');
  });

  it('never produces an empty link target from normalisation', () => {
    expect(normalizeInline([text('a', { href: '' })])).toStrictEqual([text('a')]);
  });
});
