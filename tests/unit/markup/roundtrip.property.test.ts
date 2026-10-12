import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeDoc, normalizeInline } from '../../../src/shared/model';
import { parseInline, parseMarkup, serializeInline, serializeMarkup } from '../../../src/shared/markup';
import { docArb, inlineArb, textArb } from './arbitraries';

const RUNS = 3000;

describe('markup round trip (property based)', () => {
  it('normalizeDoc is idempotent', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const n = normalizeDoc(doc);
        expect(normalizeDoc(n)).toStrictEqual(n);
      }),
      { numRuns: RUNS },
    );
  });

  it('parse(serialise(doc)) equals normalise(doc) for arbitrary documents', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const expected = normalizeDoc(doc);
        const text = serializeMarkup(doc);
        expect(parseMarkup(text)).toStrictEqual(expected);
        // and serialisation is a fixed point
        expect(serializeMarkup(parseMarkup(text))).toBe(text);
      }),
      { numRuns: RUNS },
    );
  });

  it('inline content round trips on a single physical line', () => {
    fc.assert(
      fc.property(inlineArb, (content) => {
        const line = serializeInline(normalizeInline(content));
        expect(line).not.toMatch(/[\n\r\u2028\u2029]/);
        expect(line).not.toMatch(/^[ \t]|[ \t]$/);
        expect(parseInline(line)).toStrictEqual(normalizeInline(content));
      }),
      { numRuns: RUNS },
    );
  });

  it('survives a UTF-8 encode/decode cycle unchanged', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const text = serializeMarkup(doc);
        const bytes = new TextEncoder().encode(text);
        expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(text);
      }),
      { numRuns: 500 },
    );
  });

  it('the parser is total: arbitrary text never throws and always yields a normalised doc', () => {
    fc.assert(
      fc.property(fc.array(textArb, { maxLength: 12 }).map((l) => l.join('\n')), (source) => {
        const doc = parseMarkup(source);
        expect(normalizeDoc(doc)).toStrictEqual(doc);
        // whatever was parsed is itself stable
        expect(parseMarkup(serializeMarkup(doc))).toStrictEqual(doc);
      }),
      { numRuns: RUNS },
    );
  });
});
