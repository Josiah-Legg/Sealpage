/**
 * Markdown export: exact expected output for every block type and inline rule.
 */
import { describe, it, expect } from 'vitest';
import {
  type Block,
  type Doc,
  codeBlock,
  defaultGraph,
  divider,
  heading,
  lineBreak,
  list,
  listItem,
  paragraph,
  quote,
  table,
  text,
  title,
} from '../../../src/shared/model';
import { docToMarkdown } from '../../../src/shared/export/markdown';

const doc = (...blocks: Block[]): Doc => ({ blocks });
const md = (...blocks: Block[]): string => docToMarkdown(doc(...blocks));
const p = (...texts: string[]): Block => paragraph(texts.map((t) => text(t)));
const URL = 'https://example.com/';

describe('docToMarkdown: document and block separation', () => {
  it('returns an empty string for an empty document', () => {
    expect(docToMarkdown({ blocks: [] })).toBe('');
  });

  it('returns an empty string for a document that is only empty paragraphs', () => {
    expect(md(paragraph(), paragraph(), paragraph())).toBe('');
  });

  it('skips empty paragraphs between other blocks without leaving gaps', () => {
    expect(md(p('a'), paragraph(), p('b'))).toBe('a\n\nb\n');
  });

  it('skips a paragraph that holds only whitespace', () => {
    expect(md(p('a'), paragraph([text('   ')]), p('b'))).toBe('a\n\nb\n');
  });

  it('separates blocks with exactly one blank line and ends with exactly one newline', () => {
    const out = md(title([text('T')]), p('a'), divider(), codeBlock('', 'x'));
    expect(out).toBe('# T\n\na\n\n---\n\n```\nx\n```\n');
    expect(out).not.toContain('\n\n\n');
    expect(out.endsWith('\n\n')).toBe(false);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('ends a single-paragraph document with one newline', () => {
    expect(md(p('only'))).toBe('only\n');
  });
});

describe('docToMarkdown: titles, headings, paragraphs, dividers', () => {
  it('writes the title as a level-one heading', () => {
    expect(md(title([text('My Doc')]))).toBe('# My Doc\n');
  });

  it('writes an empty title as a bare hash', () => {
    expect(md(title())).toBe('#\n');
  });

  it('maps heading levels 1, 2 and 3 to ##, ### and ####', () => {
    expect(md(heading(1, [text('one')]), heading(2, [text('two')]), heading(3, [text('three')]))).toBe(
      '## one\n\n### two\n\n#### three\n',
    );
  });

  it('keeps inline formatting inside headings', () => {
    expect(md(heading(2, [text('a '), text('b', { bold: true })]))).toBe('### a **b**\n');
  });

  it('turns hard breaks inside a heading into a single space', () => {
    expect(md(heading(2, [text('a'), lineBreak(), text('b')]))).toBe('### a b\n');
  });

  it('writes a paragraph as its inline content', () => {
    expect(md(p('Hello world'))).toBe('Hello world\n');
  });

  it('writes a divider as three hyphens', () => {
    expect(md(divider())).toBe('---\n');
  });
});

describe('docToMarkdown: code blocks', () => {
  it('writes a fenced block with its language label', () => {
    expect(md(codeBlock('ts', 'const a = 1;'))).toBe('```ts\nconst a = 1;\n```\n');
  });

  it('writes a fenced block with no label when the language is empty', () => {
    expect(md(codeBlock('', 'x'))).toBe('```\nx\n```\n');
  });

  it('writes an empty code block as two fence lines', () => {
    expect(md(codeBlock('', ''))).toBe('```\n```\n');
  });

  it('lengthens the fence when the code contains a run of three backticks', () => {
    expect(md(codeBlock('', 'a ``` b'))).toBe('````\na ``` b\n````\n');
  });

  it('keeps a two-backtick run inside a three-backtick fence', () => {
    expect(md(codeBlock('', 'a `` b'))).toBe('```\na `` b\n```\n');
  });

  it('lengthens the fence to one more than the longest run', () => {
    expect(md(codeBlock('', '````x'))).toBe('`````\n````x\n`````\n');
  });

  it('emits code verbatim, with markup characters untouched', () => {
    expect(md(codeBlock('', '*a* _b_ [c](d) <e> | \\ # `x`'))).toBe(
      '```\n*a* _b_ [c](d) <e> | \\ # `x`\n```\n',
    );
  });

  it('keeps indentation and blank lines inside code', () => {
    expect(md(codeBlock('py', 'def f():\n    return 1\n\nf()'))).toBe(
      '```py\ndef f():\n    return 1\n\nf()\n```\n',
    );
  });

  it('keeps only the first word of the language and strips backticks from it', () => {
    expect(md(codeBlock('`py thon 3', 'x'))).toBe('```py\nx\n```\n');
  });
});

describe('docToMarkdown: lists', () => {
  it('writes bullet items with a hyphen', () => {
    expect(md(list('bullet', [listItem([text('a')]), listItem([text('b')])]))).toBe('- a\n- b\n');
  });

  it('writes numbered items 1., 2., 3.', () => {
    expect(md(list('numbered', [listItem([text('a')]), listItem([text('b')]), listItem([text('c')])]))).toBe(
      '1. a\n2. b\n3. c\n',
    );
  });

  it('writes checklist items as unchecked and checked boxes', () => {
    expect(md(list('check', [listItem([text('open')], false), listItem([text('done')], true)]))).toBe(
      '- [ ] open\n- [x] done\n',
    );
  });

  it('restarts numbering in each list', () => {
    expect(
      md(
        list('numbered', [listItem([text('a')]), listItem([text('b')])]),
        p('mid'),
        list('numbered', [listItem([text('c')])]),
      ),
    ).toBe('1. a\n2. b\n\nmid\n\n1. c\n');
  });

  it('nests lists three levels deep, mixing bullet, numbered and checklist', () => {
    const deep = list('check', [listItem([text('Draft')], false), listItem([text('Review')], true)]);
    const numbered = list('numbered', [
      listItem([text('First')], false, [deep]),
      listItem([text('Second')]),
    ]);
    const top = list('bullet', [listItem([text('Plan')], false, [numbered])]);
    expect(md(top)).toBe('- Plan\n  1. First\n     - [ ] Draft\n     - [x] Review\n  2. Second\n');
  });

  it('indents a child under a two-digit number by four spaces', () => {
    const items = Array.from({ length: 10 }, (_, i) => listItem([text('x')], false, i === 9 ? [list('bullet', [listItem([text('child')])])] : []));
    expect(md(list('numbered', items))).toBe(
      '1. x\n2. x\n3. x\n4. x\n5. x\n6. x\n7. x\n8. x\n9. x\n10. x\n    - child\n',
    );
  });

  it('indents a child under a checklist item by two spaces', () => {
    const out = md(list('check', [listItem([text('parent')], false, [list('bullet', [listItem([text('kid')])])])]));
    expect(out).toBe('- [ ] parent\n  - kid\n');
  });

  it('keeps a bullet child under a bullet parent indented by two spaces', () => {
    const out = md(list('bullet', [listItem([text('a')], false, [list('bullet', [listItem([text('b')])])])]));
    expect(out).toBe('- a\n  - b\n');
  });

  it('continues a hard break inside an item on a line indented to the content column', () => {
    expect(md(list('bullet', [listItem([text('a'), lineBreak(), text('b')])]))).toBe('- a\\\n  b\n');
  });

  it('continues a hard break inside a numbered item by three spaces', () => {
    expect(md(list('numbered', [listItem([text('a'), lineBreak(), text('b')])]))).toBe('1. a\\\n   b\n');
  });

  it('escapes a list-looking item text so it stays text', () => {
    expect(md(list('bullet', [listItem([text('- x')])]))).toBe('- \\- x\n');
  });
});

describe('docToMarkdown: quotes', () => {
  it('prefixes each paragraph with > and separates paragraphs with a bare >', () => {
    expect(md(quote([[text('one')], [text('two')]]))).toBe('> one\n>\n> two\n');
  });

  it('prefixes every line of a paragraph that has a hard break', () => {
    expect(md(quote([[text('a'), lineBreak(), text('b')]]))).toBe('> a\\\n> b\n');
  });

  it('escapes a numbered-looking line inside a quote', () => {
    expect(md(quote([[text('1. x')]]))).toBe('> 1\\. x\n');
  });
});

describe('docToMarkdown: tables', () => {
  it('writes a table with a header row and a separator', () => {
    expect(md(table([[[text('a')], [text('b')]], [[text('1')], [text('2')]]], true))).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    );
  });

  it('writes a header of empty cells when there is no header row', () => {
    expect(md(table([[[text('a')], [text('b')]]], false))).toBe('|  |  |\n| --- | --- |\n| a | b |\n');
  });

  it('escapes pipes in cells and keeps empty cells', () => {
    expect(md(table([[[text('x|y')], []], [[text('1')], [text('2')]]], true))).toBe(
      '| x\\|y |  |\n| --- | --- |\n| 1 | 2 |\n',
    );
  });

  it('escapes a pipe that sits inside a code span in a cell', () => {
    expect(md(table([[[text('a|b', { code: true })]]], true))).toBe('| `a\\|b` |\n| --- |\n');
  });

  it('turns a hard break inside a cell into <br>', () => {
    expect(md(table([[[text('a'), lineBreak(), text('b')]]], true))).toBe('| a<br>b |\n| --- |\n');
  });

  it('writes a header-only table as header plus separator', () => {
    expect(md(table([[[text('only')]]], true))).toBe('| only |\n| --- |\n');
  });

  it('writes an empty cell as nothing between pipes', () => {
    expect(md(table([[[]]], true))).toBe('|  |\n| --- |\n');
  });
});

describe('docToMarkdown: graphs', () => {
  it('writes a default bar graph as a caption and a data table', () => {
    expect(md(defaultGraph('bar'))).toBe(
      '**Bar chart**\n\n| Label | Series 1 |\n| --- | --- |\n| A | 3 |\n| B | 5 |\n| C | 2 |\n',
    );
  });

  it('writes a titled grouped bar graph with axis labels and several series', () => {
    const graph = {
      ...defaultGraph('grouped-bar'),
      title: 'Sales',
      xLabel: 'Quarter',
      yLabel: 'Units',
      columns: ['Quarter', 'North', 'South'],
      rows: [['Q1', '3', '4']],
    };
    expect(md(graph)).toBe(
      '**Sales** (Grouped bar chart)\n\n*X: Quarter · Y: Units*\n\n| Quarter | North | South |\n| --- | --- | --- |\n| Q1 | 3 | 4 |\n',
    );
  });

  it('writes only the labels that are set', () => {
    const graph = { ...defaultGraph('line'), yLabel: 'Count' };
    expect(md(graph)).toBe(
      '**Line chart**\n\n*Y: Count*\n\n| Label | Series 1 |\n| --- | --- |\n| A | 3 |\n| B | 5 |\n| C | 2 |\n',
    );
  });

  it('escapes the title and the cell text', () => {
    const graph = { ...defaultGraph('bar'), title: 'a*b', columns: ['Label', 'x|y'], rows: [['A', '1']] };
    expect(md(graph)).toBe('**a\\*b** (Bar chart)\n\n| Label | x\\|y |\n| --- | --- |\n| A | 1 |\n');
  });
});

describe('docToMarkdown: inline marks', () => {
  it('writes bold', () => {
    expect(md(paragraph([text('b', { bold: true })]))).toBe('**b**\n');
  });

  it('writes italic', () => {
    expect(md(paragraph([text('i', { italic: true })]))).toBe('*i*\n');
  });

  it('writes bold and italic together as three asterisks', () => {
    expect(md(paragraph([text('bi', { bold: true, italic: true })]))).toBe('***bi***\n');
  });

  it('writes inline code as a code span', () => {
    expect(md(paragraph([text('c', { code: true })]))).toBe('`c`\n');
  });

  it('does not escape text inside a code span', () => {
    expect(md(paragraph([text('a*b_c[d]', { code: true })]))).toBe('`a*b_c[d]`\n');
  });

  it('uses a longer fence when the code span contains backticks', () => {
    expect(md(paragraph([text('a`b', { code: true })]))).toBe('``a`b``\n');
  });

  it('pads a code span whose text starts with a backtick', () => {
    expect(md(paragraph([text('`x`', { code: true })]))).toBe('`` `x` ``\n');
  });

  it('writes a link', () => {
    expect(md(paragraph([text('site', { href: URL })]))).toBe('[site](https://example.com/)\n');
  });

  it('writes bold inside a link', () => {
    expect(md(paragraph([text('x', { bold: true, href: URL })]))).toBe('[**x**](https://example.com/)\n');
  });

  it('wraps a bold code span in bold delimiters', () => {
    expect(md(paragraph([text('x', { bold: true, code: true })]))).toBe('**`x`**\n');
  });

  it('shares one pair of bold delimiters across adjacent bold runs', () => {
    expect(md(paragraph([text('a', { bold: true }), text('b', { bold: true, italic: true })]))).toBe('**a*b***\n');
  });

  it('closes bold and opens italic when the next run has different marks', () => {
    expect(md(paragraph([text('a', { bold: true }), text('b', { italic: true })]))).toBe('**a***b*\n');
  });

  it('keeps plain text next to formatted text unchanged', () => {
    expect(md(paragraph([text('see '), text('here', { italic: true }), text(' now')]))).toBe('see *here* now\n');
  });
});

describe('docToMarkdown: whitespace hoisting and run-only whitespace', () => {
  it('moves trailing whitespace of a bold run outside the delimiters', () => {
    expect(md(paragraph([text('hello ', { bold: true }), text('world')]))).toBe('**hello** world\n');
  });

  it('moves leading whitespace of an italic run outside the delimiters', () => {
    expect(md(paragraph([text('a'), text(' b', { italic: true })]))).toBe('a *b*\n');
  });

  it('moves whitespace at both ends of a formatted run outside', () => {
    expect(md(paragraph([text(' x ', { bold: true })]))).toBe(' **x**\n');
  });

  it('keeps whitespace inside a link when it is inside the link text', () => {
    expect(md(paragraph([text('a ', { href: URL, bold: true })]))).toBe('[**a** ](https://example.com/)\n');
  });

  it('gives a whitespace-only run no delimiters of its own', () => {
    expect(md(paragraph([text('a', { bold: true }), text(' ', { bold: true, italic: true }), text('b', { bold: true })]))).toBe(
      '**a b**\n',
    );
  });

  it('writes a whitespace-only run between plain runs as a plain space', () => {
    expect(md(paragraph([text('a'), text(' ', { bold: true }), text('b')]))).toBe('a b\n');
  });

  it('writes no delimiters for a whitespace-only formatted paragraph, which is then skipped', () => {
    expect(md(paragraph([text(' ', { italic: true })]))).toBe('');
  });
});

describe('docToMarkdown: links', () => {
  it('escapes parentheses in the URL with backslashes', () => {
    expect(md(paragraph([text('t', { href: 'https://x.com/a_(b)' })]))).toBe('[t](https://x.com/a_\\(b\\))\n');
  });

  it('escapes backslashes in the URL', () => {
    expect(md(paragraph([text('t', { href: 'https://x.com/a\\b' })]))).toBe('[t](https://x.com/a\\\\b)\n');
  });

  it('wraps a URL that contains spaces in angle brackets', () => {
    expect(md(paragraph([text('t', { href: 'https://x.com/my file' })]))).toBe('[t](<https://x.com/my file>)\n');
  });

  it('escapes angle brackets inside an angle-bracketed URL', () => {
    expect(md(paragraph([text('t', { href: 'https://x.com/<a> b' })]))).toBe('[t](<https://x.com/\\<a\\> b>)\n');
  });

  it('forms one link from consecutive runs with the same href', () => {
    expect(md(paragraph([text('a', { href: URL }), text('b', { href: URL, bold: true })]))).toBe(
      '[a**b**](https://example.com/)\n',
    );
  });

  it('writes two adjacent links with different hrefs as two links', () => {
    expect(md(paragraph([text('a', { href: 'https://one.test/' }), text('b', { href: 'https://two.test/' })]))).toBe(
      '[a](https://one.test/)[b](https://two.test/)\n',
    );
  });

  it('writes link text containing markup characters escaped', () => {
    expect(md(paragraph([text('a_b*', { href: URL })]))).toBe('[a\\_b\\*](https://example.com/)\n');
  });
});

describe('docToMarkdown: hard breaks', () => {
  it('writes a hard break in a paragraph as a backslash and a newline', () => {
    expect(md(paragraph([text('a'), lineBreak(), text('b')]))).toBe('a\\\nb\n');
  });

  it('keeps emphasis across a hard break in one pair of delimiters', () => {
    expect(md(paragraph([text('a', { bold: true }), lineBreak(), text('b', { bold: true })]))).toBe('**a\\\nb**\n');
  });

  it('moves a hard break that ends a bold span outside the delimiters', () => {
    expect(md(paragraph([text('a', { bold: true }), lineBreak(), text('b')]))).toBe('**a**\\\nb\n');
  });

  it('drops hard breaks at the start and end of a paragraph', () => {
    expect(md(paragraph([lineBreak(), text('a'), lineBreak()]))).toBe('a\n');
  });
});

describe('docToMarkdown: escaping', () => {
  it('escapes every always-escaped character', () => {
    expect(md(paragraph([text('\\`*_[]<>#|')]))).toBe('\\\\\\`\\*\\_\\[\\]\\<\\>\\#\\|\n');
  });

  it('escapes a leading hyphen so text is not a list', () => {
    expect(md(p('- item'))).toBe('\\- item\n');
  });

  it('escapes a leading plus so text is not a list', () => {
    expect(md(p('+ item'))).toBe('\\+ item\n');
  });

  it('escapes a leading equals sign so text is not a setext underline', () => {
    expect(md(p('=== title'))).toBe('\\=== title\n');
  });

  it('escapes a leading number followed by a period', () => {
    expect(md(p('1. first'))).toBe('1\\. first\n');
  });

  it('escapes a leading number followed by a closing parenthesis', () => {
    expect(md(p('2) second'))).toBe('2\\) second\n');
  });

  it('escapes a leading multi-digit number', () => {
    expect(md(p('2024. year'))).toBe('2024\\. year\n');
  });

  it('does not escape a number or hyphen in the middle of a line', () => {
    expect(md(p('a - b 1. c'))).toBe('a - b 1. c\n');
  });

  it('does not escape a line-start hyphen that is inside bold', () => {
    expect(md(paragraph([text('-x', { bold: true })]))).toBe('**-x**\n');
  });

  it('escapes a line-start marker that follows a hard break', () => {
    expect(md(paragraph([text('a'), lineBreak(), text('- b')]))).toBe('a\\\n\\- b\n');
  });

  it('escapes an exclamation mark that would start an image', () => {
    expect(md(p('wow![x]'))).toBe('wow\\!\\[x\\]\n');
  });

  it('escapes an exclamation mark before a link so it is not an image', () => {
    expect(md(paragraph([text('wow!'), text('link', { href: URL })]))).toBe('wow\\![link](https://example.com/)\n');
  });

  it('leaves an exclamation mark alone when no bracket follows', () => {
    expect(md(p('hi!'))).toBe('hi!\n');
  });

  it('does not treat text in a code span as needing escapes', () => {
    expect(md(paragraph([text('-x #|', { code: true })]))).toBe('`-x #|`\n');
  });
});

describe('docToMarkdown: unusual Unicode', () => {
  it('passes emoji, CJK, right-to-left text and combining marks through unchanged', () => {
    const sample = '🙂 日本語 שלום مرحبا é ß';
    expect(md(p(sample))).toBe(`${sample}\n`);
  });

  it('passes Unicode inside headings, code and table cells through unchanged', () => {
    expect(md(heading(1, [text('日本語')]), codeBlock('', 'שלום 🙂'), table([[[text('é')]]], true))).toBe(
      '## 日本語\n\n```\nשלום 🙂\n```\n\n| é |\n| --- |\n',
    );
  });
});
