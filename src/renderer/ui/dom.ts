/**
 * Tiny DOM helpers shared by every UI module. No framework: modules build
 * elements with h() and update them imperatively.
 */
import { type IconNode } from 'lucide';
import { ICONS, type IconName } from './icons';

export type Child = Node | string | number | false | null | undefined | Child[];

type EventHandlers = {
  [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => void;
};

export interface Props extends EventHandlers {
  /** CSS class string (or array, falsy entries skipped). */
  class?: string | (string | false | null | undefined)[];
  /** data-* attributes. */
  dataset?: Record<string, string | undefined>;
  /** Inline styles, including CSS custom properties. */
  style?: Record<string, string | undefined>;
  /** Any other attribute or DOM property (id, title, type, value, checked, disabled, href, tabIndex, role, aria-*…). */
  [key: string]: unknown;
}

/** DOM properties that must be set as properties rather than attributes. */
const AS_PROPERTY = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'readOnly', 'tabIndex', 'textContent', 'htmlFor', 'spellcheck']);

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

/**
 * Create an element.
 *
 *   h('button', { class: 'sp-btn', title: 'Save', onclick: save }, icon('save'), 'Save')
 *
 * Text children are always inserted as text nodes, never parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') {
        el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value as Record<string, string | undefined>)) if (v !== undefined) el.dataset[k] = v;
      } else if (key === 'style') {
        for (const [k, v] of Object.entries(value as Record<string, string | undefined>)) {
          if (v === undefined) continue;
          if (k.startsWith('--')) el.style.setProperty(k, v);
          else (el.style as unknown as Record<string, string>)[k] = v;
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (AS_PROPERTY.has(key)) {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

/** Remove all children. */
export function clear(el: Element): void {
  el.replaceChildren();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildIcon(node: IconNode, size: number | string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sp-icon');
  for (const [tag, attrs] of node) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) child.setAttribute(k, String(v));
    svg.appendChild(child);
  }
  return svg;
}

/** A line icon that inherits the current text colour. Default size is 1.15em so it scales with the UI font. */
export function icon(name: IconName, size: number | string = '1.15em'): SVGSVGElement {
  return buildIcon(ICONS[name], size);
}

/** Wait for the next animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Debounce a function by `ms` milliseconds. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const wrapped = (...args: A): void => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pending!;
      pending = null;
      fn(...a);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  wrapped.flush = (): void => {
    if (!timer || !pending) return;
    clearTimeout(timer);
    timer = null;
    const a = pending;
    pending = null;
    fn(...a);
  };
  return wrapped;
}

/** File name without folder and without the .slpg extension. */
export function displayName(path: string): string {
  const base = path.replace(/^.*[\\/]/, '');
  return base.replace(/\.slpg$/i, '');
}
