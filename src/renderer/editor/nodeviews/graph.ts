/**
 * Node view for the `graph` node: an atom that draws its spec as SVG, shows
 * the warnings of the data table, and offers edit / export tools on hover.
 * See docs/ARCHITECTURE.md §5.6.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { AppController } from '../../app/controller';
import { renderGraph } from '../../../shared/graph/render';
import type { GraphTheme } from '../../../shared/graph/types';
import type { GraphBlock } from '../../../shared/model';
import { h, icon } from '../../ui/dom';
import { exportGraphAsPng, exportGraphAsSvg } from '../../ui/graphExport';
import '../../css/graphBlock.css';

const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 280;
const MAX_WIDTH = 1100;

export function createGraphView(app: AppController): (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView {
  return (node, view, getPos) => {
    let spec = node.attrs.spec as GraphBlock;
    let theme: GraphTheme = app.style.graphTheme;
    /** Raw figure width at the last render; compared against the live width to decide on a re-render. */
    let renderedWidth = -1;
    let frame: number | null = null;
    let destroyed = false;

    const figure = h('div', { class: 'sp-graph-figure' });
    const warningText = h('span', { class: 'sp-graph-warnings-text' });
    const warnings = h('div', { class: 'sp-graph-warnings sp-no-print', hidden: true }, icon('warning', '1em'), warningText);

    const openEditor = (): void => {
      const pos = getPos();
      if (pos !== undefined) app.ui.openGraphEditor(view, pos);
    };

    const tools = h(
      'div',
      { class: 'sp-graph-tools sp-no-print' },
      h('button', { class: 'sp-icon-btn', type: 'button', title: 'Edit graph', 'aria-label': 'Edit graph', onclick: openEditor }, icon('pencil')),
      h(
        'button',
        {
          class: 'sp-icon-btn',
          type: 'button',
          title: 'Export as SVG',
          'aria-label': 'Export as SVG',
          onclick: () => void exportGraphAsSvg(app, spec),
        },
        icon('file-down'),
      ),
      h(
        'button',
        {
          class: 'sp-icon-btn',
          type: 'button',
          title: 'Export as PNG',
          'aria-label': 'Export as PNG',
          onclick: () => void exportGraphAsPng(app, spec),
        },
        icon('download'),
      ),
    );

    const dom = h('div', { class: 'sp-graph-block', contenteditable: 'false' }, figure, warnings, tools);

    figure.addEventListener('dblclick', (event) => {
      event.preventDefault();
      openEditor();
    });

    const render = (): void => {
      const raw = figure.clientWidth;
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw > 0 ? raw : DEFAULT_WIDTH));
      const height = Math.round(Math.min(520, Math.max(240, width * 0.56)));
      renderedWidth = raw;
      const result = renderGraph(spec, theme, { width, height });
      figure.innerHTML = result.svg;
      const svg = figure.querySelector('svg');
      if (svg) {
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
      }
      warningText.textContent = result.warnings.join(' ');
      warnings.hidden = result.warnings.length === 0;
    };

    const schedule = (): void => {
      if (destroyed || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!destroyed) render();
      });
    };

    const observer = new ResizeObserver(() => {
      if (Math.abs(figure.clientWidth - renderedWidth) > 1) schedule();
    });
    observer.observe(figure);

    const offStyle = app.on('style', (style) => {
      theme = style.graphTheme;
      schedule();
    });

    schedule();

    return {
      dom,
      update(next: PMNode): boolean {
        if (next.type !== node.type) return false;
        spec = next.attrs.spec as GraphBlock;
        schedule();
        return true;
      },
      selectNode(): void {
        dom.classList.add('ProseMirror-selectednode');
      },
      deselectNode(): void {
        dom.classList.remove('ProseMirror-selectednode');
      },
      stopEvent(event: Event): boolean {
        return event.target instanceof Node && tools.contains(event.target);
      },
      ignoreMutation: () => true,
      destroy(): void {
        destroyed = true;
        offStyle();
        observer.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      },
    };
  };
}
