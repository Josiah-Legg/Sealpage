/** fast-check generators for arbitrary (un-normalised) Sealpage documents. */
import fc from 'fast-check';
import { type Block, type Doc, type Inline, type ListBlock, GRAPH_TYPES, LEGEND_POSITIONS } from '../../../src/shared/model';

/** Fragments biased towards characters that are meaningful in the markup. */
const nasty = fc.constantFrom(
  '\\', '*', '_', '`', '[', ']', '(', ')', '|', '~', '=', '-', '+', '@', '>', ':', ' ', '\t', '\n', '\r',
  '\\n', '\\t', '\\u{41}', '\\ ', '---', '- ', '-[ ] ', '-[x] ', '+ ', '> ', '= ', '== ', '@code ', '@table', '@graph bar',
  '~sealpage 1', '| ', '](', '[]()', '  ', '\u2028', '\u2029', '\u0000', '\u007f', '\u0085', '\u00A0',
  '\uFEFF', '\u200B', '\u202E', 'é', '😀', '\ud83d', '\ude00', '漢字', 'مرحبا', '"', "'", '{', '}', '#',
);

export const textArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: 'binary', maxLength: 12 }) },
  {
    weight: 3,
    arbitrary: fc.array(fc.oneof(nasty, fc.string({ maxLength: 3 })), { maxLength: 8 }).map((a) => a.join('')),
  },
  { weight: 1, arbitrary: fc.constant('') },
);

const hrefArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(null),
  fc.constantFrom('https://example.com/a_b(c)', 'mailto:x@y.z', 'a b', ')', '\\', ''),
  textArb,
);

export const inlineArb: fc.Arbitrary<Inline[]> = fc.array(
  fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        type: fc.constant('text' as const),
        text: textArb,
        bold: fc.boolean(),
        italic: fc.boolean(),
        code: fc.boolean(),
        href: hrefArb,
      }),
    },
    { weight: 1, arbitrary: fc.constant({ type: 'break' as const }) },
  ),
  { maxLength: 6 },
);

const listArb: fc.Arbitrary<ListBlock> = fc.letrec<{ list: ListBlock }>((tie) => ({
  list: fc.record({
    type: fc.constant('list' as const),
    kind: fc.constantFrom('bullet' as const, 'numbered' as const, 'check' as const),
    items: fc.array(
      fc.record({
        content: inlineArb,
        checked: fc.boolean(),
        children: fc.oneof(
          { depthSize: 'small', maxDepth: 3 },
          fc.constant<ListBlock[]>([]),
          fc.array(tie('list'), { maxLength: 3 }),
        ),
      }),
      { maxLength: 4 },
    ),
  }),
})).list;

export const blockArb: fc.Arbitrary<Block> = fc.oneof(
  fc.record({ type: fc.constant('title' as const), content: inlineArb }),
  fc.record({
    type: fc.constant('heading' as const),
    level: fc.constantFrom(1 as const, 2 as const, 3 as const),
    content: inlineArb,
  }),
  { weight: 3, arbitrary: fc.record({ type: fc.constant('paragraph' as const), content: inlineArb }) },
  fc.record({ type: fc.constant('code' as const), language: textArb, text: textArb }),
  listArb,
  fc.record({ type: fc.constant('quote' as const), paragraphs: fc.array(inlineArb, { maxLength: 4 }) }),
  fc.record({
    type: fc.constant('table' as const),
    headerRow: fc.boolean(),
    rows: fc.array(fc.array(inlineArb, { maxLength: 4 }), { maxLength: 4 }),
  }),
  fc.constant({ type: 'divider' as const }),
  fc.record({
    type: fc.constant('graph' as const),
    chart: fc.constantFrom(...GRAPH_TYPES),
    title: textArb,
    xLabel: textArb,
    yLabel: textArb,
    legend: fc.record({ show: fc.boolean(), position: fc.constantFrom(...LEGEND_POSITIONS) }),
    bins: fc.oneof(fc.integer({ min: -5, max: 300 }), fc.constant(0)),
    columns: fc.array(textArb, { maxLength: 5 }),
    rows: fc.array(fc.array(textArb, { maxLength: 6 }), { maxLength: 5 }),
  }),
);

export const docArb: fc.Arbitrary<Doc> = fc.record({ blocks: fc.array(blockArb, { maxLength: 8 }) });
