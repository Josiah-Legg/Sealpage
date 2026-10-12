/**
 * Syntax highlighting for code blocks. A ProseMirror plugin that adds inline
 * decorations (CSS classes) to the text of code_block nodes. It never changes
 * the document. Colours live in blocks.css, mapped from the style's
 * --sp-syntax-* variables.
 *
 * Kept free of DOM access at import time so highlightRanges() is unit-testable
 * in Node (see tests/unit/editor/highlight.test.ts). Do not import CSS here.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/** Longer blocks are left unhighlighted to keep typing responsive. */
const MAX_CHARS = 100_000;

export interface HighlightRange {
  /** UTF-16 offset within the code, inclusive. */
  from: number;
  /** UTF-16 offset within the code, exclusive. */
  to: number;
  /** The hljs class of the innermost scope, e.g. 'hljs-keyword'. */
  className: string;
}

/**
 * The part of highlight.js's result we use: its internal token tree
 * (highlight.js version 11). Each node has an optional `scope` and `children`
 * that are either plain text strings or nested nodes. This structure is
 * private to highlight.js, so it is declared locally and only read here.
 */
interface TokenNode {
  scope?: string;
  children: (string | TokenNode)[];
}

interface HighlightResultWithTree {
  _emitter: { rootNode: TokenNode };
}

/**
 * Token ranges for `code` in the given language. An empty or unknown language
 * label gives no ranges (there is no auto-detection). Never throws.
 */
export function highlightRanges(code: string, language: string): HighlightRange[] {
  if (code === '' || code.length > MAX_CHARS) return [];
  const label = language.trim().toLowerCase();
  if (label === '') return [];
  try {
    // getLanguage resolves aliases (js, ts, py, sh, html, yml, c++ ...) and only knows registered languages.
    if (!hljs.getLanguage(label)) return [];
    const result = hljs.highlight(code, { language: label, ignoreIllegals: true }) as unknown as HighlightResultWithTree;
    const ranges: HighlightRange[] = [];
    let offset = 0;
    const walk = (node: TokenNode, scope: string | undefined): void => {
      for (const child of node.children) {
        if (typeof child === 'string') {
          if (scope && child.length > 0) {
            ranges.push({ from: offset, to: offset + child.length, className: 'hljs-' + scope.split('.')[0] });
          }
          offset += child.length;
        } else {
          // Sub-language roots carry 'language:x' scopes that have no style; they inherit the outer scope.
          const own = child.scope && !child.scope.startsWith('language:') ? child.scope : undefined;
          walk(child, own ?? scope);
        }
      }
    };
    walk(result._emitter.rootNode, undefined);
    return ranges;
  } catch {
    return [];
  }
}

const highlightKey = new PluginKey('sp-highlight');

/** Per code_block node: its ranges. ProseMirror reuses unchanged node objects, so unchanged blocks cost nothing. */
const rangeCache = new WeakMap<PMNode, HighlightRange[]>();

function rangesFor(node: PMNode): HighlightRange[] {
  let ranges = rangeCache.get(node);
  if (!ranges) {
    ranges = highlightRanges(node.textContent, String(node.attrs.language ?? ''));
    rangeCache.set(node, ranges);
  }
  return ranges;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    // The text of a code block starts one position inside the node.
    for (const range of rangesFor(node)) {
      decorations.push(Decoration.inline(pos + 1 + range.from, pos + 1 + range.to, { class: range.className }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Syntax colouring for every code block. Decorations only; the document is untouched. */
export function highlightPlugin(): Plugin {
  return new Plugin({
    key: highlightKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc),
      apply: (tr, decorations) => (tr.docChanged ? buildDecorations(tr.doc) : decorations.map(tr.mapping, tr.doc)),
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
  });
}
