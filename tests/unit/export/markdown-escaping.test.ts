import { describe, expect, it } from 'vitest';
import { docToMarkdown } from '../../../src/shared/export/markdown';
import { paragraph, text } from '../../../src/shared/model';

const md = (value: string): string => docToMarkdown({ blocks: [paragraph([text(value)])] });

describe('Markdown export: text that could be mistaken for syntax', () => {
  it('escapes tildes so they cannot open a code fence or strikethrough', () => {
    expect(md('~~~')).toBe('\\~\\~\\~\n');
    expect(md('a ~~b~~ c')).toBe('a \\~\\~b\\~\\~ c\n');
  });

  it('escapes ampersands so entity-like text stays literal', () => {
    expect(md('&amp; and &lt;tag&gt; and R&D')).toBe('\\&amp; and \\&lt;tag\\&gt; and R\\&D\n');
  });

  it('keeps a line that starts with four or more spaces from becoming a code block', () => {
    // the model writes edge spaces as-is; the exporter must not emit 4 raw leading spaces
    const out = md('    indented text');
    expect(out.startsWith('    ')).toBe(false);
    expect(out).toContain('indented text');
    const tabbed = md('\tafter a tab');
    expect(tabbed.startsWith('\t')).toBe(false);
    expect(tabbed).toContain('after a tab');
  });

  it('leaves up to three leading spaces alone', () => {
    expect(md('   three')).toBe('   three\n');
  });
});
