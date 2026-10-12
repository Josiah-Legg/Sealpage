/**
 * The graph editor dialog. It works on a copy of the graph's spec, shows a
 * live preview, and writes the spec back into the document only on Apply.
 * See docs/ARCHITECTURE.md §5.4 and §5.6.
 */
import type { EditorView } from 'prosemirror-view';
import type { AppController } from '../app/controller';
import { GRAPH_TYPE_LABELS, renderGraph } from '../../shared/graph/render';
import type { GraphTheme } from '../../shared/graph/types';
import { GRAPH_TYPES, LEGEND_POSITIONS, MAX_BINS, type GraphBlock, type GraphType, type LegendPosition, normalizeBlock } from '../../shared/model';
import { type DialogHandle, field, openDialog } from './dialogs';
import { clear, debounce, h, icon } from './dom';
import '../css/graphEditor.css';

type Caret = 'start' | 'end';

const TYPE_HINTS: Record<GraphType, string> = {
  bar: 'First column: category names. Second column: values.',
  'grouped-bar': 'First column: category names. Each further column is one series.',
  'stacked-bar': 'First column: category names. Each further column is one series.',
  line: 'First column: category names. Each further column is one series.',
  area: 'First column: category names. Each further column is one series.',
  pie: 'First column: slice names. Second column: values (positive numbers).',
  scatter: 'First column: x values. Each further column is a series of y values.',
  histogram: 'The first column is ignored. The values in each further column are counted into bins.',
};

const POSITION_LABELS: Record<LegendPosition, string> = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' };
const PREVIEW_SIZE = { width: 520, height: 340 };
const PREVIEW_DELAY_MS = 60;

export function mountGraphEditor(app: AppController): void {
  app.ui.openGraphEditor = (view, pos) => openGraphEditor(app, view, pos);
}

/** Split clipboard text into rows and cells. Rows split on line breaks (one trailing empty line is ignored); cells on tabs, or on commas when there are no tabs. */
function parseClipboardBlock(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const separator = text.includes('\t') ? '\t' : ',';
  return lines.map((line) => line.split(separator));
}

function openGraphEditor(app: AppController, view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'graph') return;
  const working = structuredClone(node.attrs.spec as GraphBlock);
  let theme: GraphTheme = app.style.graphTheme;

  // --- preview -----------------------------------------------------------------

  const previewFigure = h('div', { class: 'sp-graph-preview-figure' });
  const problems = h('div', { class: 'sp-graph-problems', 'aria-live': 'polite' });

  const showProblems = (list: string[]): void => {
    clear(problems);
    if (list.length === 0) {
      problems.append(h('div', { class: 'sp-hint' }, 'No problems found.'));
      return;
    }
    for (const text of list) {
      problems.append(h('div', { class: 'sp-graph-problem' }, icon('warning', '1em'), h('span', null, text)));
    }
  };

  const renderPreview = (): void => {
    const result = renderGraph(normalizeBlock(working) as GraphBlock, theme, PREVIEW_SIZE);
    previewFigure.innerHTML = result.svg;
    showProblems(result.warnings);
  };
  const schedulePreview = debounce(renderPreview, PREVIEW_DELAY_MS);

  // --- settings form -----------------------------------------------------------

  const typeHint = h('span', null);
  const typeSelect: HTMLSelectElement = h(
    'select',
    {
      class: 'sp-select',
      onchange: () => {
        working.chart = typeSelect.value as GraphType;
        syncChartControls();
        schedulePreview();
      },
    },
    GRAPH_TYPES.map((type) => h('option', { value: type }, GRAPH_TYPE_LABELS[type])),
  );
  typeSelect.value = working.chart;
  const typeField = field('Type', typeSelect, typeHint);

  const textControl = (value: string, set: (text: string) => void): HTMLInputElement =>
    h('input', {
      class: 'sp-input',
      type: 'text',
      value,
      oninput: (event: Event) => {
        set((event.target as HTMLInputElement).value);
        schedulePreview();
      },
    });

  const titleField = field(
    'Title',
    textControl(working.title, (text) => {
      working.title = text;
    }),
  );
  const xField = field(
    'X axis label',
    textControl(working.xLabel, (text) => {
      working.xLabel = text;
    }),
  );
  const yField = field(
    'Y axis label',
    textControl(working.yLabel, (text) => {
      working.yLabel = text;
    }),
  );

  const legendCheck: HTMLInputElement = h('input', {
    class: 'sp-checkbox',
    type: 'checkbox',
    checked: working.legend.show,
    onchange: () => {
      working.legend.show = legendCheck.checked;
      syncLegend();
      schedulePreview();
    },
  });
  const legendPosition: HTMLSelectElement = h(
    'select',
    {
      class: 'sp-select',
      'aria-label': 'Legend position',
      onchange: () => {
        working.legend.position = legendPosition.value as LegendPosition;
        schedulePreview();
      },
    },
    LEGEND_POSITIONS.map((position) => h('option', { value: position }, POSITION_LABELS[position])),
  );
  legendPosition.value = working.legend.position;
  const legendField = h(
    'div',
    { class: 'sp-field' },
    h('span', { class: 'sp-label' }, 'Legend'),
    h('div', { class: 'sp-graph-legend-row' }, h('label', { class: 'sp-check-row' }, legendCheck, 'Show legend'), legendPosition),
  );

  const binsInput: HTMLInputElement = h('input', {
    class: 'sp-input',
    type: 'number',
    min: 0,
    max: MAX_BINS,
    step: 1,
    value: String(working.bins),
    oninput: (event: Event) => {
      const n = (event.target as HTMLInputElement).valueAsNumber;
      working.bins = Number.isFinite(n) ? Math.trunc(n) : 0;
      schedulePreview();
    },
  });
  const binsField = field('Bins', binsInput, '0 = automatic');

  const syncChartControls = (): void => {
    const pie = working.chart === 'pie';
    xField.hidden = pie;
    yField.hidden = pie;
    binsField.hidden = working.chart !== 'histogram';
    typeHint.textContent = TYPE_HINTS[working.chart];
  };
  const syncLegend = (): void => {
    legendPosition.disabled = !legendCheck.checked;
  };

  // --- data grid ---------------------------------------------------------------

  const gridHost = h('div', { class: 'sp-graph-grid-scroll sp-scroll' });
  const addRowButton: HTMLButtonElement = h(
    'button',
    { class: 'sp-btn sp-graph-add-row', type: 'button', onclick: () => addRow(0) },
    icon('plus'),
    'Add row',
  );
  const addColumnButton: HTMLButtonElement = h(
    'button',
    { class: 'sp-btn sp-graph-add-column', type: 'button', onclick: () => addColumn() },
    icon('plus'),
    'Add column',
  );

  /** One grid cell. Row -1 is the header (column names). */
  function cellInput(value: string, r: number, c: number, isHeader: boolean): HTMLInputElement {
    return h('input', {
      class: ['sp-input', 'sp-graph-cell', isHeader && 'sp-graph-colname'],
      type: 'text',
      value,
      autocomplete: 'off',
      dataset: { r: String(r), c: String(c) },
      'aria-label': isHeader ? `Column ${c + 1} name` : `Row ${r + 1}, column ${c + 1}`,
      oninput: (event: Event) => {
        const text = (event.target as HTMLInputElement).value;
        if (isHeader) working.columns[c] = text;
        else working.rows[r][c] = text;
        schedulePreview();
      },
      onkeydown: (event: KeyboardEvent) => onCellKeyDown(event, r, c),
      onpaste: (event: ClipboardEvent) => onPaste(event, r, c),
    });
  }

  function buildTable(): HTMLTableElement {
    const columns = working.columns;
    const canRemoveColumn = columns.length > 2;
    const headRow = h(
      'tr',
      null,
      h('th', { class: 'sp-graph-head sp-graph-gutter', scope: 'col' }),
      columns.map((name, c) =>
        h(
          'th',
          { class: 'sp-graph-head', scope: 'col' },
          h(
            'div',
            { class: 'sp-graph-head-inner' },
            cellInput(name, -1, c, true),
            c > 0 && canRemoveColumn
              ? h('button', {
                  class: 'sp-icon-btn sp-graph-remove',
                  type: 'button',
                  title: 'Remove column',
                  'aria-label': `Remove column ${c + 1}`,
                  onclick: () => removeColumn(c),
                }, icon('close', '0.95em'))
              : null,
          ),
        ),
      ),
      h('th', { class: 'sp-graph-head sp-graph-actions', scope: 'col' }),
    );
    const bodyRows = working.rows.map((row, r) =>
      h(
        'tr',
        null,
        h('td', { class: 'sp-graph-gutter' }, String(r + 1)),
        row.map((value, c) => h('td', { class: 'sp-graph-data' }, cellInput(value, r, c, false))),
        h(
          'td',
          { class: 'sp-graph-actions' },
          h('button', {
            class: 'sp-icon-btn sp-graph-remove',
            type: 'button',
            title: 'Remove row',
            'aria-label': `Remove row ${r + 1}`,
            onclick: () => removeRow(r),
          }, icon('close', '0.95em')),
        ),
      ),
    );
    return h('table', { class: 'sp-graph-grid' }, h('thead', null, headRow), h('tbody', null, bodyRows));
  }

  function renderGrid(): void {
    clear(gridHost);
    gridHost.append(buildTable());
  }

  /** Focus a cell by row and column (row -1 is the header). Returns false when there is no such cell. */
  function focusCell(r: number, c: number, caret: Caret | null): boolean {
    const input = gridHost.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
    if (!input) return false;
    input.focus();
    if (caret) {
      const at = caret === 'start' ? 0 : input.value.length;
      input.setSelectionRange(at, at);
    }
    return true;
  }

  function addRow(focusColumn: number): void {
    working.rows.push(working.columns.map(() => ''));
    renderGrid();
    focusCell(working.rows.length - 1, focusColumn, null);
    schedulePreview();
  }

  function removeRow(r: number): void {
    working.rows.splice(r, 1);
    renderGrid();
    if (working.rows.length > 0) focusCell(Math.min(r, working.rows.length - 1), 0, null);
    else addRowButton.focus();
    schedulePreview();
  }

  function addColumn(): void {
    const c = working.columns.length;
    working.columns.push(`Series ${c}`);
    for (const row of working.rows) row.push('');
    renderGrid();
    focusCell(-1, c, null);
    schedulePreview();
  }

  function removeColumn(c: number): void {
    if (c < 1 || working.columns.length <= 2) return;
    working.columns.splice(c, 1);
    for (const row of working.rows) row.splice(c, 1);
    renderGrid();
    focusCell(-1, Math.min(c, working.columns.length - 1), null);
    schedulePreview();
  }

  function onCellKeyDown(event: KeyboardEvent, r: number, c: number): void {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const input = event.target as HTMLInputElement;
    const rowCount = working.rows.length;
    const columnCount = working.columns.length;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    switch (event.key) {
      case 'Enter':
        // Stop the dialog's default-button handling; the grid owns Enter.
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          if (r >= 0) focusCell(r - 1, c, 'end');
        } else if (r + 1 < rowCount) {
          focusCell(r + 1, c, 'end');
        } else {
          addRow(c);
        }
        return;
      case 'ArrowUp':
        if (r < 0) return;
        event.preventDefault();
        focusCell(r - 1, c, 'end');
        return;
      case 'ArrowDown':
        if (r + 1 >= rowCount) return;
        event.preventDefault();
        focusCell(r + 1, c, 'end');
        return;
      case 'ArrowLeft':
        if (!atStart || c === 0) return;
        event.preventDefault();
        focusCell(r, c - 1, 'end');
        return;
      case 'ArrowRight':
        if (!atEnd || c + 1 >= columnCount) return;
        event.preventDefault();
        focusCell(r, c + 1, 'start');
        return;
      default:
        return;
    }
  }

  /** A multi-cell paste is written from the focused cell, growing the grid as needed. A single value pastes natively. */
  function onPaste(event: ClipboardEvent, r: number, c: number): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!/[\t\n\r]/.test(text)) return;
    event.preventDefault();
    const block = parseClipboardBlock(text);
    for (let i = 0; i < block.length; i++) {
      const row = r + i;
      if (row >= 0) {
        while (working.rows.length <= row) working.rows.push(working.columns.map(() => ''));
      }
      const cells = block[i];
      for (let j = 0; j < cells.length; j++) {
        const col = c + j;
        while (working.columns.length <= col) {
          working.columns.push(`Series ${working.columns.length}`);
          for (const dataRow of working.rows) dataRow.push('');
        }
        if (row < 0) working.columns[col] = cells[j];
        else working.rows[row][col] = cells[j];
      }
    }
    renderGrid();
    focusCell(r, c, null);
    schedulePreview();
  }

  const gridField = h(
    'div',
    { class: 'sp-field' },
    h('span', { class: 'sp-label' }, 'Data'),
    gridHost,
    h('div', { class: 'sp-graph-grid-tools' }, addRowButton, addColumnButton),
  );

  // --- layout ------------------------------------------------------------------

  const left = h('div', { class: 'sp-graph-editor-left' }, h('div', { class: 'sp-graph-settings' }, typeField, titleField, xField, yField, legendField, binsField), gridField);
  const right = h(
    'div',
    { class: 'sp-graph-editor-right' },
    h('span', { class: 'sp-label' }, 'Preview'),
    h('div', { class: 'sp-graph-preview' }, previewFigure),
    problems,
  );
  const body = h('div', { class: 'sp-graph-editor-layout' }, h('div', { class: 'sp-graph-editor-columns' }, left, right));

  // --- dialog ------------------------------------------------------------------

  const commit = (): void => {
    if (view.isDestroyed) return;
    if (view.state.doc.nodeAt(pos)?.type.name !== 'graph') return;
    const spec = normalizeBlock(working) as GraphBlock;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { spec }));
  };

  syncChartControls();
  syncLegend();
  renderGrid();
  renderPreview();

  const offStyle = app.on('style', (style) => {
    theme = style.graphTheme;
    schedulePreview();
  });

  const dialog: DialogHandle = openDialog({
    title: 'Edit graph',
    icon: 'chart-column',
    width: 980,
    className: 'sp-graph-editor',
    body,
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Apply',
        kind: 'primary',
        onClick: () => {
          commit();
          dialog.close();
          if (!view.isDestroyed) view.focus();
          return false;
        },
      },
    ],
    onClose: () => {
      offStyle();
      schedulePreview.cancel();
    },
  });
}
