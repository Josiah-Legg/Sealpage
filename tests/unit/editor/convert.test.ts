/**
 * The editor's document (ProseMirror) and the saved document (model) must be
 * the same thing: model -> editor -> model is lossless, and so is the full
 * chain  model -> editor -> model -> markup -> model.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseMarkup, serializeMarkup } from '../../../src/shared/markup';
import {
  type Doc,
  codeBlock,
  defaultGraph,
  divider,
  heading,
  lineBreak,
  list,
  listItem,
  normalizeDoc,
  paragraph,
  quote,
  table,
  text,
  title,
} from '../../../src/shared/model';
import { docToPm, pmToDoc } from '../../../src/renderer/editor/convert';
import { schema } from '../../../src/renderer/editor/schema';
import { docArb } from '../markup/arbitraries';

/** What the editor shows for a model document: an empty document becomes one empty paragraph. */
function expected(doc: Doc): Doc {
  const n = normalizeDoc(doc);
  return n.blocks.length === 0 ? { blocks: [paragraph()] } : n;
}

describe('model <-> ProseMirror conversion', () => {
  it('builds schema-valid documents for every block type', () => {
    const doc: Doc = {
      blocks: [
        title([text('Title')]),
        heading(1, [text('One')]),
        heading(2, [text('Two')]),
        heading(3, [text('Three')]),
        paragraph([text('plain '), text('bold', { bold: true }), text(' both', { bold: true, italic: true }), lineBreak(), text('code', { code: true }), text('link', { href: 'https://example.com' })]),
        codeBlock('ts', 'const x = 1;\n\n  indented'),
        list('bullet', [listItem([text('a')], false, [list('numbered', [listItem([text('1')]), listItem([text('2')], false, [list('check', [listItem([text('done')], true), listItem([], false)])])])])]),
        list('check', [listItem([text('todo')], false), listItem([text('done')], true)]),
        quote([[text('first')], [], [text('third', { italic: true })]]),
        table([[[text('h1')], [text('h2')]], [[text('a')], []]], true),
        table([[[text('x')]]], false),
        divider(),
        defaultGraph('pie'),
      ],
    };
    const pm = docToPm(doc);
    expect(() => pm.check()).not.toThrow();
    expect(pm.type).toBe(schema.nodes.doc);
    expect(pmToDoc(pm)).toStrictEqual(normalizeDoc(doc));
  });

  it('maps title and heading levels to heading levels 1-4 and back', () => {
    const pm = docToPm({ blocks: [title(), heading(1), heading(2), heading(3)] });
    const levels: number[] = [];
    pm.forEach((n) => levels.push(n.attrs.level as number));
    expect(levels).toEqual([1, 2, 3, 4]);
    expect(pmToDoc(pm).blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type))).toEqual(['title', 'h1', 'h2', 'h3']);
  });

  it('shows an empty document as a single empty paragraph', () => {
    const pm = docToPm({ blocks: [] });
    expect(pm.childCount).toBe(1);
    expect(pm.firstChild!.type).toBe(schema.nodes.paragraph);
    expect(pmToDoc(pm)).toStrictEqual({ blocks: [paragraph()] });
  });

  it('keeps the header row flag, checked state only in checklists, and graph specs intact', () => {
    const g = { ...defaultGraph('scatter'), title: 'T', xLabel: 'x', yLabel: 'y', legend: { show: false, position: 'left' as const }, columns: ['x', 'a', 'b'], rows: [['1', '2', '3']] };
    const doc: Doc = {
      blocks: [table([[[text('a')]], [[text('b')]]], false), table([[[text('a')]], [[text('b')]]], true), list('bullet', [listItem([text('x')], true)]), g],
    };
    const back = pmToDoc(docToPm(doc));
    expect(back.blocks[0]).toMatchObject({ type: 'table', headerRow: false });
    expect(back.blocks[1]).toMatchObject({ type: 'table', headerRow: true });
    expect(back.blocks[2]).toMatchObject({ type: 'list', items: [{ checked: false }] });
    expect(back.blocks[3]).toStrictEqual(g);
  });

  it('round trips arbitrary documents through the editor model', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const pm = docToPm(doc);
        pm.check();
        expect(pmToDoc(pm)).toStrictEqual(expected(doc));
      }),
      { numRuns: 1500 },
    );
  });

  it('round trips arbitrary documents through editor, markup and back', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const fromEditor = pmToDoc(docToPm(doc));
        const saved = serializeMarkup(fromEditor);
        const reopened = pmToDoc(docToPm(parseMarkup(saved)));
        expect(reopened).toStrictEqual(fromEditor);
        expect(serializeMarkup(reopened)).toBe(saved);
      }),
      { numRuns: 1500 },
    );
  });

  it('survives a JSON round trip of the editor document (copy / paste, undo history)', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const pm = docToPm(doc);
        const again = schema.nodeFromJSON(JSON.parse(JSON.stringify(pm.toJSON())));
        expect(pmToDoc(again)).toStrictEqual(expected(doc));
      }),
      { numRuns: 300 },
    );
  });
});
