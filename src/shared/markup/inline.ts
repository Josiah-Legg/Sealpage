/**
 * Sealmark inline syntax: escaping, serialisation and parsing of inline
 * content (text runs with bold / italic / code / link marks, and hard breaks).
 *
 * See docs/FORMAT.md section "Inline content" for the grammar.
 */
import { type Inline, type TextRun, normalizeInline } from '../model';

/** Characters that are always backslash-escaped inside text. */
const ALWAYS_ESCAPED = new Set(['\\', '*', '_', '`', '[', ']', '|']);

/** Characters that are additionally escaped when they would start a paragraph line. */
export const LINE_START_SIGILS = new Set(['~', '=', '-', '+', '@', '>', ':']);

function isControl(cp: number): boolean {
  // C0 controls (except TAB), DEL, C1 controls, LINE SEPARATOR, PARAGRAPH SEPARATOR.
  return (cp < 0x20 && cp !== 0x09) || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
}

function isAsciiPunctOrSpace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    c === 0x20 ||
    (c >= 0x21 && c <= 0x2f) ||
    (c >= 0x3a && c <= 0x40) ||
    (c >= 0x5b && c <= 0x60) ||
    (c >= 0x7b && c <= 0x7e)
  );
}

/**
 * Backslash-escape the characters that have meaning in inline syntax and
 * write control characters as \u{HEX}. With `parens` the round brackets are
 * escaped too (used for link targets).
 */
export function escapeText(s: string, parens = false): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = ch.charCodeAt(0);
    if (ALWAYS_ESCAPED.has(ch) || (parens && (ch === '(' || ch === ')'))) out += '\\' + ch;
    else if (isControl(code)) out += '\\u{' + code.toString(16).toUpperCase() + '}';
    else out += ch;
  }
  return out;
}

/**
 * Read one escape sequence starting at s[i] === '\\'.
 * Returns the produced value (a literal string, or null for a hard break)
 * and the index just past the sequence.
 */
function readEscape(s: string, i: number): { value: string | null; next: number } {
  const ch = s[i + 1];
  if (ch === undefined) return { value: '', next: i + 1 }; // trailing backslash yields nothing
  if (ch === 'n') return { value: null, next: i + 2 };
  if (ch === 't') return { value: '\t', next: i + 2 };
  if (ch === 'u' && s[i + 2] === '{') {
    const close = s.indexOf('}', i + 3);
    const hex = close < 0 ? '' : s.slice(i + 3, close);
    if (/^[0-9A-Fa-f]{1,6}$/.test(hex)) {
      const cp = parseInt(hex, 16);
      const valid = cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      return { value: valid ? String.fromCodePoint(cp) : '\uFFFD', next: close + 1 };
    }
    return { value: '\\', next: i + 1 };
  }
  if (isAsciiPunctOrSpace(ch)) return { value: ch, next: i + 2 };
  return { value: '\\', next: i + 1 }; // unknown escape: the backslash is literal
}

/** Undo escapeText for a string that carries no mark syntax (link targets). */
export function unescapeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s[i] === '\\') {
      const e = readEscape(s, i);
      out += e.value === null ? '\n' : e.value;
      i = e.next;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

/** Index of the first unescaped `ch` at or after `from`, or -1. */
export function findUnescaped(s: string, ch: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === ch) return i;
  }
  return -1;
}

/** Split on unescaped `sep` characters. */
export function splitUnescaped(s: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === sep) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** True when the final character of `s` is consumed by a backslash escape. */
export function endsWithEscape(s: string): boolean {
  let n = 0;
  for (let i = s.length - 2; i >= 0 && s[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

/**
 * Make sure a serialised line never physically starts or ends with a
 * whitespace character: an edge space is written as \u{20}, an edge tab as \t.
 * (escapeText never emits "\ ", so a space at either edge is always a raw one.)
 */
function protectEdges(line: string): string {
  let s = line;
  if (s.startsWith(' ')) s = '\\u{20}' + s.slice(1);
  else if (s.startsWith('\t')) s = '\\t' + s.slice(1);
  if (s.endsWith(' ')) s = s.slice(0, -1) + '\\u{20}';
  else if (s.endsWith('\t')) s = s.slice(0, -1) + '\\t';
  return s;
}

/**
 * Serialise inline content to a single physical line.
 *
 * Marks are written as state toggles (`*` bold, `_` italic, backtick code)
 * and links as `[text](target)`. Toggles are independent switches, so they
 * never need to nest properly.
 */
export function serializeInline(content: readonly Inline[]): string {
  let out = '';
  let bold = false;
  let italic = false;
  let code = false;
  let href: string | null = null;
  for (const node of content) {
    if (node.type === 'break') {
      out += '\\n';
      continue;
    }
    if (node.href !== href) {
      if (href !== null) out += '](' + escapeText(href, true) + ')';
      if (node.href !== null) out += '[';
      href = node.href;
    }
    if (node.bold !== bold) {
      out += '*';
      bold = node.bold;
    }
    if (node.italic !== italic) {
      out += '_';
      italic = node.italic;
    }
    if (node.code !== code) {
      out += '`';
      code = node.code;
    }
    out += escapeText(node.text);
  }
  if (code) out += '`';
  if (italic) out += '_';
  if (bold) out += '*';
  if (href !== null) out += '](' + escapeText(href, true) + ')';
  return protectEdges(out);
}

/** Parse one physical line of inline syntax. Total: never throws. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let bold = false;
  let italic = false;
  let code = false;
  let href: string | null = null;
  let inLink = false;
  let linkClose = -1;
  let linkResume = -1;
  let cur: TextRun | null = null;

  const emit = (value: string): void => {
    if (value === '') return;
    if (cur && cur.bold === bold && cur.italic === italic && cur.code === code && cur.href === href) {
      cur.text += value;
    } else {
      cur = { type: 'text', text: value, bold, italic, code, href };
      out.push(cur);
    }
  };

  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (ch === '\\') {
      const e = readEscape(s, i);
      if (e.value === null) {
        out.push({ type: 'break' });
        cur = null;
      } else {
        emit(e.value);
      }
      i = e.next;
    } else if (ch === '*') {
      bold = !bold;
      i++;
    } else if (ch === '_') {
      italic = !italic;
      i++;
    } else if (ch === '`') {
      code = !code;
      i++;
    } else if (ch === '[' && !inLink) {
      const close = findUnescaped(s, ']', i + 1);
      const end = close >= 0 && s[close + 1] === '(' ? findUnescaped(s, ')', close + 2) : -1;
      if (end >= 0) {
        // A link with an empty target keeps its text but carries no link mark.
        const target = unescapeText(s.slice(close + 2, end)).replace(/[\r\n]/g, '');
        href = target === '' ? null : target;
        inLink = true;
        linkClose = close;
        linkResume = end + 1;
      } else {
        emit('[');
      }
      i++;
    } else if (ch === ']' && inLink && i === linkClose) {
      href = null;
      inLink = false;
      i = linkResume;
    } else {
      emit(ch);
      i++;
    }
  }
  return normalizeInline(out);
}
