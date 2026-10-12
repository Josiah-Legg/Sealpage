import { describe, expect, it } from 'vitest';
import { type HighlightRange, highlightRanges } from '../../../src/renderer/editor/highlight';

/** The text each range covers, paired with its class, for readable assertions. */
function tokens(code: string, language: string): [string, string][] {
  return highlightRanges(code, language).map((r) => [code.slice(r.from, r.to), r.className]);
}

/** Ranges must be in bounds, non-empty, sorted and non-overlapping. */
function expectWellFormed(code: string, ranges: HighlightRange[]): void {
  let last = 0;
  for (const r of ranges) {
    expect(r.from).toBeGreaterThanOrEqual(last);
    expect(r.to).toBeGreaterThan(r.from);
    expect(r.to).toBeLessThanOrEqual(code.length);
    expect(r.className).toMatch(/^hljs-[a-z_-]+$/);
    last = r.to;
  }
}

/** A small deterministic generator, so the random-input test is repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** One realistic snippet per language. */
const SAMPLES: [language: string, code: string][] = [
  ['javascript', 'const total = items.map((x) => x * 2); // double each\nfunction run(n) { return n + 1; }\n'],
  ['typescript', 'let count: number = 1; // counter\nexport interface Box<T> { value: T }\n'],
  ['python', 'def area(r):\n    # circle\n    return 3.14 * r ** 2 if r else None\n'],
  ['bash', 'for f in *.txt; do echo "$f"; done # list\n'],
  ['c', '#include <stdio.h>\nint main(void) { return 0; } /* done */\n'],
  ['cpp', 'class Box { public: int size = 3; }; // cpp\n'],
  ['csharp', 'public class Greeter { string name = "x"; } // c#\n'],
  ['css', 'a.button:hover { color: #333; margin: 0 auto; }\n'],
  ['diff', '@@ -1,2 +1,2 @@\n-old line\n+new line\n'],
  ['go', 'package main\nfunc add(a int) int { return a + 1 } // go\n'],
  ['ini', '[section]\nkey = "value" ; note\n'],
  ['java', 'public class A { private int x = 5; } // java\n'],
  ['json', '{ "name": "Ada", "age": 36, "ok": true, "tags": null }\n'],
  ['kotlin', 'fun main() { val x = "k" } // kotlin\n'],
  ['lua', 'local t = {1, 2} -- lua\nprint("hi")\n'],
  ['markdown', '# Heading\n**bold** and `code` and [link](https://x.y)\n'],
  ['php', '<?php echo "<b>"; $n = 1; // php\n'],
  ['powershell', 'Get-Item -Path "C:\\x" | Out-Null # ps\n'],
  ['python', 'import os\nprint(f"{os.name!r}")  # py\n'],
  ['ruby', 'def hello(name)\n  puts "hi #{name}" # ruby\nend\n'],
  ['rust', 'fn main() { let s: &str = "a"; println!("{}", s); } // rust\n'],
  ['sql', "SELECT id, name FROM users WHERE age > 21 AND name LIKE 'A%'; -- sql\n"],
  ['swift', 'let greeting = "hi"; var n: Int = 3 // swift\n'],
  ['xml', '<?xml version="1.0"?>\n<root attr="v"><!-- note --><item/></root>\n'],
  ['yaml', 'name: demo\nlist:\n  - one # first\n  - "two"\n'],
];

describe('highlightRanges', () => {
  it('returns no ranges for an empty or unknown language (no auto-detection)', () => {
    expect(highlightRanges('const x = 1;', '')).toEqual([]);
    expect(highlightRanges('const x = 1;', '   ')).toEqual([]);
    expect(highlightRanges('const x = 1;', 'klingon')).toEqual([]);
    expect(highlightRanges('const x = 1;', 'plain text')).toEqual([]);
  });

  it('returns no ranges for empty code', () => {
    expect(highlightRanges('', 'javascript')).toEqual([]);
    expect(highlightRanges('', '')).toEqual([]);
  });

  it('finds the keyword, string and comment at their exact offsets in JavaScript', () => {
    const code = 'const s = "hi"; // note\n';
    expect(highlightRanges(code, 'javascript')).toEqual([
      { from: 0, to: 5, className: 'hljs-keyword' },
      { from: 10, to: 14, className: 'hljs-string' },
      { from: 16, to: 23, className: 'hljs-comment' },
    ]);
    expect(code.slice(0, 5)).toBe('const');
    expect(code.slice(10, 14)).toBe('"hi"');
    expect(code.slice(16, 23)).toBe('// note');
  });

  it('gives the innermost scope when scopes are nested', () => {
    // "foo" is a function title inside the function declaration; "a" is a parameter.
    expect(tokens('function foo(a) { return a + 1; }', 'javascript')).toEqual([
      ['function', 'hljs-keyword'],
      ['foo', 'hljs-title'],
      ['a', 'hljs-params'],
      ['return', 'hljs-keyword'],
      ['1', 'hljs-number'],
    ]);
  });

  it('resolves the aliases js, ts, py, sh, html and yml to their language', () => {
    const cases: [string, string, string][] = [
      ['js', 'javascript', 'const s = "hi"; // note\n'],
      ['ts', 'typescript', 'let count: number = 1; // counter\n'],
      ['py', 'python', 'def area(r):\n    return 3.14 * r ** 2  # circle\n'],
      ['sh', 'bash', 'echo "$HOME" # list\n'],
      ['html', 'xml', '<root attr="v"><!-- note --></root>\n'],
      ['yml', 'yaml', 'name: demo # first\n'],
    ];
    for (const [alias, canonical, code] of cases) {
      const viaAlias = highlightRanges(code, alias);
      expect(viaAlias.length, `alias ${alias}`).toBeGreaterThan(0);
      expect(viaAlias, `alias ${alias}`).toEqual(highlightRanges(code, canonical));
    }
  });

  it('resolves the other aliases, ignores case and surrounding spaces', () => {
    const code = 'if (a) { return "x"; } // c\n';
    const canonical = highlightRanges(code, 'javascript');
    expect(canonical.length).toBeGreaterThan(0);
    expect(highlightRanges(code, 'JavaScript')).toEqual(canonical);
    expect(highlightRanges(code, '  javascript  ')).toEqual(canonical);
    expect(highlightRanges('int x = 1; // c', 'c++')).toEqual(highlightRanges('int x = 1; // c', 'cpp'));
    expect(highlightRanges('var x = "a"; // c', 'cs')).toEqual(highlightRanges('var x = "a"; // c', 'csharp'));
    expect(highlightRanges('puts "a" # c', 'rb')).toEqual(highlightRanges('puts "a" # c', 'ruby'));
    expect(highlightRanges('let s = "a"; // c', 'rs')).toEqual(highlightRanges('let s = "a"; // c', 'rust'));
    expect(highlightRanges('# T\n**b**', 'md')).toEqual(highlightRanges('# T\n**b**', 'markdown'));
    expect(highlightRanges('Get-Item -Path "x"', 'ps1')).toEqual(highlightRanges('Get-Item -Path "x"', 'powershell'));
  });

  it('keeps ranges sorted, non-empty, non-overlapping and in bounds for many languages', () => {
    const languages = new Set(SAMPLES.map(([language]) => language));
    expect(languages.size).toBeGreaterThanOrEqual(8);
    for (const [language, code] of SAMPLES) {
      const ranges = highlightRanges(code, language);
      expect(ranges.length, `language ${language}`).toBeGreaterThan(0);
      expectWellFormed(code, ranges);
    }
  });

  it('keeps offsets exact when the code contains <, &, quotes and markup-like text', () => {
    const code = 'const html = "<script>&amp; `x` **bold**</script>"; // <b> & "q"\n';
    expect(tokens(code, 'javascript')).toEqual([
      ['const', 'hljs-keyword'],
      ['"<script>&amp; `x` **bold**</script>"', 'hljs-string'],
      ['// <b> & "q"', 'hljs-comment'],
    ]);
    const markup = '<script>alert("x")</script> & "q"';
    expect(tokens(markup, 'html')).toEqual([
      ['<', 'hljs-tag'],
      ['script', 'hljs-name'],
      ['>', 'hljs-tag'],
      ['alert', 'hljs-title'],
      ['"x"', 'hljs-string'],
      ['</', 'hljs-tag'],
      ['script', 'hljs-name'],
      ['>', 'hljs-tag'],
    ]);
  });

  it('keeps offsets exact for Markdown-like text inside a code block', () => {
    const code = '# Title\n**bold** `code`';
    expect(tokens(code, 'markdown')).toEqual([
      ['# Title', 'hljs-section'],
      ['**bold**', 'hljs-strong'],
      ['`code`', 'hljs-code'],
    ]);
  });

  it('emoji and other non-BMP characters before a token do not shift offsets', () => {
    // 😀 and 𝒳 are two UTF-16 code units each.
    const code = '// 😀😀 𝒳\nconst a = "😀";';
    expect(highlightRanges(code, 'javascript')).toEqual([
      { from: 0, to: 10, className: 'hljs-comment' },
      { from: 11, to: 16, className: 'hljs-keyword' },
      { from: 21, to: 25, className: 'hljs-string' },
    ]);
    expect(code.slice(11, 16)).toBe('const');
    expect(code.slice(21, 25)).toBe('"😀"');
  });

  it('returns no ranges for code longer than 100 000 characters, and highlights exactly 100 000', () => {
    const unit = 'const a = 1;\n';
    const tooLong = unit.repeat(9000);
    expect(tooLong.length).toBeGreaterThan(100_000);
    expect(highlightRanges(tooLong, 'javascript')).toEqual([]);

    const atLimit = unit.repeat(Math.floor(100_000 / unit.length)).padEnd(100_000, 'x');
    expect(atLimit.length).toBe(100_000);
    const ranges = highlightRanges(atLimit, 'javascript');
    expect(ranges[0]).toEqual({ from: 0, to: 5, className: 'hljs-keyword' });
    expectWellFormed(atLimit, ranges);
  });

  it('gives exact offsets for SQL keywords, operators and strings', () => {
    const code = "SELECT id FROM t WHERE x = 'a';";
    expect(tokens(code, 'sql')).toEqual([
      ['SELECT', 'hljs-keyword'],
      ['FROM', 'hljs-keyword'],
      ['WHERE', 'hljs-keyword'],
      ['=', 'hljs-operator'],
      ["'a'", 'hljs-string'],
    ]);
  });

  it('gives exact offsets for YAML keys, values and comments', () => {
    const code = 'key: value # c';
    expect(tokens(code, 'yml')).toEqual([
      ['key:', 'hljs-attr'],
      ['value', 'hljs-string'],
      ['# c', 'hljs-comment'],
    ]);
  });

  it('keeps offsets valid after an unterminated string (illegal input is tolerated)', () => {
    const code = 'const s = "unterminated\nconst t = 2;\n';
    const ranges = highlightRanges(code, 'javascript');
    expect(ranges[0]).toEqual({ from: 0, to: 5, className: 'hljs-keyword' });
    expect(ranges[1]).toEqual({ from: 10, to: code.length, className: 'hljs-string' });
    expectWellFormed(code, ranges);
  });

  it('returns no ranges for whitespace-only code', () => {
    expect(highlightRanges('   \n\t  ', 'javascript')).toEqual([]);
  });

  it('never throws on random punctuation input and keeps ranges well formed', () => {
    const random = seeded(20260611);
    const alphabet = '{}[]()<>"\'`/\\*#-+=;:,.&|!?$%^~@ \n\t_0123456789abcXYZ';
    const languages = ['javascript', 'python', 'bash', 'xml', 'markdown', 'sql', 'yaml', 'c', 'rust', 'powershell'];
    for (let i = 0; i < 300; i++) {
      const length = Math.floor(random() * 300);
      let code = '';
      for (let j = 0; j < length; j++) code += alphabet[Math.floor(random() * alphabet.length)];
      const language = languages[i % languages.length]!;
      let ranges: HighlightRange[] = [];
      expect(() => {
        ranges = highlightRanges(code, language);
      }).not.toThrow();
      expectWellFormed(code, ranges);
    }
  });
});
