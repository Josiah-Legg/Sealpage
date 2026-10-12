/**
 * The command registry. Every user action is one Command; the menu bar,
 * toolbar, slash menu, key bindings and shortcut reference are all generated
 * from COMMANDS, MENUS and TOOLBAR below. See docs/ARCHITECTURE.md §5.3.
 */
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import { findNext, findPrev, getSearchState } from 'prosemirror-search';
import type { Command as PMCommand, EditorState } from 'prosemirror-state';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, toggleHeaderRow } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import {
  clearFormatting,
  currentList,
  headingActive,
  inNode,
  indentListItem,
  insertDivider,
  insertGraph,
  insertLineBreak,
  insertTable,
  linkAtSelection,
  markActive,
  outdentListItem,
  paragraphActive,
  selectedGraph,
  setLink,
  setParagraph,
  toggleBold,
  toggleChecked,
  toggleCodeBlock,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleList,
  toggleQuote,
} from '../editor/commands';
import { schema } from '../editor/schema';
import { allStyles } from '../styles/registry';
import { PROMPT_EXTRA_PREFIX, openDialog, promptDialog } from '../ui/dialogs';
import { h } from '../ui/dom';
import type { IconName } from '../ui/icons';
import type { AppController } from './controller';

export type CommandCategory = 'File' | 'Edit' | 'Format' | 'Insert' | 'Table' | 'View' | 'Help';

export interface CommandContext {
  app: AppController;
  /** The active document's editor view, or null when no document is open. */
  view: EditorView | null;
}

export interface Command {
  /** Stable identifier, e.g. 'format.bold'. */
  id: string;
  /** Menu / tooltip text, e.g. 'Bold'. */
  title: string;
  category: CommandCategory;
  /** Default shortcut in canonical form ('Ctrl+B'); dispatched by keybindings.ts. */
  shortcut?: string;
  /** A key that performs this action inside the editor itself (shown in menus, not rebindable). */
  keyHint?: string;
  icon?: IconName;
  /** 'editor' commands act on the document and need it to have focus; 'app' commands work anywhere. */
  scope: 'app' | 'editor';
  /** The browser already implements this shortcut (clipboard); the dispatcher must not intercept it. */
  native?: boolean;
  /** 'app' commands normally do nothing while a dialog is open; this one may still run. */
  allowInDialog?: boolean;
  run(ctx: CommandContext): unknown;
  isEnabled?(ctx: CommandContext): boolean;
  /** Checked / pressed state (bold is on, this style is selected…). */
  isActive?(ctx: CommandContext): boolean;
  /** When present, the command is offered in the slash menu. */
  slash?: { keywords: string[]; description: string };
}

const n = schema.nodes;
const m = schema.marks;

/** Wrap a ProseMirror command as run / isEnabled. */
function pm(command: PMCommand): Pick<Command, 'run' | 'isEnabled'> {
  return {
    run: ({ view }) => {
      if (!view) return false;
      const done = command(view.state, view.dispatch, view);
      view.focus();
      return done;
    },
    isEnabled: ({ view }) => !!view && command(view.state),
  };
}

const active =
  (test: (state: EditorState) => boolean) =>
  ({ view }: CommandContext): boolean =>
    !!view && test(view.state);

const hasDoc = ({ view }: CommandContext): boolean => view !== null;

function isSafeLink(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

async function editLink({ view }: CommandContext): Promise<void> {
  if (!view) return;
  const current = linkAtSelection(view.state);
  const answer = await promptDialog({
    title: current ? 'Edit link' : 'Add link',
    label: 'Link address',
    value: current ?? 'https://',
    placeholder: 'https://example.com',
    confirmLabel: current ? 'Update' : 'Add link',
    validate: (value) => (isSafeLink(value) ? null : 'Enter an address starting with https://, http:// or mailto:'),
    extra: current ? [{ id: 'remove', label: 'Remove link', kind: 'danger' }] : [],
  });
  if (answer === null) {
    view.focus();
    return;
  }
  setLink(answer === PROMPT_EXTRA_PREFIX + 'remove' ? null : answer)(view.state, view.dispatch);
  view.focus();
}

function showAbout(app: AppController): void {
  void app.api.appInfo().then((info) => {
    openDialog({
      title: 'About Sealpage',
      icon: 'lock',
      width: 420,
      body: h(
        'div',
        { class: 'sp-dialog-message sp-about' },
        h('p', { class: 'sp-about-name' }, `Sealpage ${info.version}`),
        h('p', null, 'An encrypted structured text editor. Every document is sealed with AES-256-GCM; nothing readable is written to disk.'),
        h('p', { class: 'sp-hint' }, `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`),
        h('p', { class: 'sp-hint' }, `App data: ${info.dataDir}`),
      ),
      buttons: [{ label: 'Close', kind: 'primary', isDefault: true }],
    });
  });
}

const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
function stepZoom(app: AppController, delta: 1 | -1): void {
  const z = app.settings.zoom;
  const next = delta > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
  if (next !== undefined) void app.updateSettings({ zoom: next });
}

const tableCmd = (id: string, title: string, command: PMCommand, icon?: IconName): Command => ({
  id,
  title,
  category: 'Table',
  scope: 'editor',
  icon,
  run: pm(command).run,
  isEnabled: ({ view }) => !!view && isInTable(view.state) && command(view.state),
});

const styleCommands: Command[] = allStyles().map((style) => ({
  id: `view.style.${style.id}`,
  title: style.name,
  category: 'View',
  scope: 'app',
  allowInDialog: true,
  run: ({ app }) => app.setStyle(style.id),
  isActive: ({ app }) => app.style.def.id === style.id,
}));

export const COMMANDS: readonly Command[] = [
  // ------------------------------------------------------------------ File
  { id: 'file.new', title: 'New document', category: 'File', shortcut: 'Ctrl+N', icon: 'file-plus', scope: 'app', run: ({ app }) => app.newDocument() },
  { id: 'file.open', title: 'Open…', category: 'File', shortcut: 'Ctrl+O', icon: 'file-text', scope: 'app', run: ({ app }) => app.openWithDialog() },
  { id: 'file.openFolder', title: 'Open folder…', category: 'File', shortcut: 'Ctrl+Shift+O', icon: 'folder-open', scope: 'app', run: ({ app }) => app.chooseFolder() },
  { id: 'file.save', title: 'Save', category: 'File', shortcut: 'Ctrl+S', icon: 'save', scope: 'app', run: ({ app }) => app.save(), isEnabled: hasDoc },
  { id: 'file.saveAs', title: 'Save as…', category: 'File', shortcut: 'Ctrl+Shift+S', scope: 'app', run: ({ app }) => app.saveAs(), isEnabled: hasDoc },
  { id: 'file.exportMarkdown', title: 'Export as Markdown…', category: 'File', shortcut: 'Ctrl+Shift+M', icon: 'file-down', scope: 'app', run: ({ app }) => app.exportMarkdown(), isEnabled: hasDoc },
  { id: 'file.exportPdf', title: 'Export as PDF…', category: 'File', shortcut: 'Ctrl+Shift+E', icon: 'download', scope: 'app', run: ({ app }) => app.exportPdf(), isEnabled: hasDoc },
  { id: 'file.print', title: 'Print…', category: 'File', shortcut: 'Ctrl+P', icon: 'printer', scope: 'app', run: ({ app }) => app.print(), isEnabled: hasDoc },
  { id: 'file.closeTab', title: 'Close tab', category: 'File', shortcut: 'Ctrl+W', icon: 'close', scope: 'app', run: ({ app }) => app.closeTab(), isEnabled: hasDoc },
  { id: 'file.settings', title: 'Settings…', category: 'File', shortcut: 'Ctrl+,', icon: 'settings', scope: 'app', run: ({ app }) => app.ui.openSettings() },
  { id: 'file.exit', title: 'Exit', category: 'File', keyHint: 'Alt+F4', scope: 'app', run: () => window.close() },

  // ------------------------------------------------------------------ Edit
  {
    id: 'edit.undo',
    title: 'Undo',
    category: 'Edit',
    shortcut: 'Ctrl+Z',
    icon: 'undo',
    scope: 'editor',
    run: pm(undo).run,
    isEnabled: ({ view }) => !!view && undoDepth(view.state) > 0,
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    category: 'Edit',
    shortcut: 'Ctrl+Y',
    icon: 'redo',
    scope: 'editor',
    run: pm(redo).run,
    isEnabled: ({ view }) => !!view && redoDepth(view.state) > 0,
  },
  { id: 'edit.cut', title: 'Cut', category: 'Edit', shortcut: 'Ctrl+X', scope: 'editor', native: true, run: ({ app }) => (app.focusEditor(), app.api.editAction('cut')), isEnabled: ({ view }) => !!view && !view.state.selection.empty },
  { id: 'edit.copy', title: 'Copy', category: 'Edit', shortcut: 'Ctrl+C', icon: 'copy', scope: 'editor', native: true, run: ({ app }) => (app.focusEditor(), app.api.editAction('copy')), isEnabled: ({ view }) => !!view && !view.state.selection.empty },
  { id: 'edit.paste', title: 'Paste', category: 'Edit', shortcut: 'Ctrl+V', scope: 'editor', native: true, run: ({ app }) => (app.focusEditor(), app.api.editAction('paste')), isEnabled: hasDoc },
  { id: 'edit.pastePlain', title: 'Paste as plain text', category: 'Edit', shortcut: 'Ctrl+Shift+V', scope: 'editor', native: true, run: ({ app }) => (app.focusEditor(), app.api.editAction('pastePlain')), isEnabled: hasDoc },
  { id: 'edit.selectAll', title: 'Select all', category: 'Edit', shortcut: 'Ctrl+A', scope: 'editor', native: true, run: ({ app }) => (app.focusEditor(), app.api.editAction('selectAll')), isEnabled: hasDoc },
  { id: 'edit.find', title: 'Find…', category: 'Edit', shortcut: 'Ctrl+F', icon: 'search', scope: 'app', run: ({ app }) => app.ui.openFind(false), isEnabled: hasDoc },
  { id: 'edit.replace', title: 'Find and replace…', category: 'Edit', shortcut: 'Ctrl+H', icon: 'replace', scope: 'app', run: ({ app }) => app.ui.openFind(true), isEnabled: hasDoc },
  {
    id: 'edit.findNext',
    title: 'Find next',
    category: 'Edit',
    shortcut: 'F3',
    scope: 'app',
    run: ({ view }) => view && findNext(view.state, view.dispatch),
    isEnabled: ({ view }) => !!view && !!getSearchState(view.state)?.query.valid,
  },
  {
    id: 'edit.findPrevious',
    title: 'Find previous',
    category: 'Edit',
    shortcut: 'Shift+F3',
    scope: 'app',
    run: ({ view }) => view && findPrev(view.state, view.dispatch),
    isEnabled: ({ view }) => !!view && !!getSearchState(view.state)?.query.valid,
  },

  // ---------------------------------------------------------------- Format
  { id: 'format.bold', title: 'Bold', category: 'Format', shortcut: 'Ctrl+B', icon: 'bold', scope: 'editor', ...pm(toggleBold), isActive: active((s) => markActive(s, m.strong!)) },
  { id: 'format.italic', title: 'Italic', category: 'Format', shortcut: 'Ctrl+I', icon: 'italic', scope: 'editor', ...pm(toggleItalic), isActive: active((s) => markActive(s, m.em!)) },
  { id: 'format.code', title: 'Inline code', category: 'Format', shortcut: 'Ctrl+E', icon: 'code', scope: 'editor', ...pm(toggleInlineCode), isActive: active((s) => markActive(s, m.code!)) },
  {
    id: 'format.link',
    title: 'Link…',
    category: 'Format',
    shortcut: 'Ctrl+K',
    icon: 'link',
    scope: 'editor',
    run: editLink,
    isEnabled: ({ view }) => !!view && view.state.selection.$from.parent.inlineContent && !view.state.selection.$from.parent.type.spec.code,
    isActive: active((s) => linkAtSelection(s) !== null),
  },
  { id: 'format.clear', title: 'Clear formatting', category: 'Format', shortcut: 'Ctrl+\\', icon: 'clear-format', scope: 'editor', ...pm(clearFormatting) },
  {
    id: 'format.paragraph',
    title: 'Body text',
    category: 'Format',
    shortcut: 'Ctrl+Alt+0',
    icon: 'pilcrow',
    scope: 'editor',
    run: pm(setParagraph).run,
    isEnabled: hasDoc,
    isActive: active(paragraphActive),
    slash: { keywords: ['paragraph', 'text', 'body', 'plain'], description: 'Ordinary paragraph text' },
  },
  {
    id: 'format.title',
    title: 'Title',
    category: 'Format',
    shortcut: 'Ctrl+Alt+1',
    icon: 'heading',
    scope: 'editor',
    ...pm(toggleHeading(1)),
    isActive: active((s) => headingActive(s, 1)),
    slash: { keywords: ['title', 'h1', 'heading'], description: 'The document title' },
  },
  {
    id: 'format.heading1',
    title: 'Subheading 1',
    category: 'Format',
    shortcut: 'Ctrl+Alt+2',
    icon: 'heading-1',
    scope: 'editor',
    ...pm(toggleHeading(2)),
    isActive: active((s) => headingActive(s, 2)),
    slash: { keywords: ['heading', 'subheading', 'h2', 'section'], description: 'Large section heading' },
  },
  {
    id: 'format.heading2',
    title: 'Subheading 2',
    category: 'Format',
    shortcut: 'Ctrl+Alt+3',
    icon: 'heading-2',
    scope: 'editor',
    ...pm(toggleHeading(3)),
    isActive: active((s) => headingActive(s, 3)),
    slash: { keywords: ['heading', 'subheading', 'h3'], description: 'Medium section heading' },
  },
  {
    id: 'format.heading3',
    title: 'Subheading 3',
    category: 'Format',
    shortcut: 'Ctrl+Alt+4',
    icon: 'heading-3',
    scope: 'editor',
    ...pm(toggleHeading(4)),
    isActive: active((s) => headingActive(s, 4)),
    slash: { keywords: ['heading', 'subheading', 'h4'], description: 'Small section heading' },
  },
  {
    id: 'format.bulletList',
    title: 'Bullet list',
    category: 'Format',
    shortcut: 'Ctrl+Shift+8',
    icon: 'list',
    scope: 'editor',
    ...pm(toggleList('bullet_list')),
    isActive: active((s) => currentList(s)?.node.type === n.bullet_list),
    slash: { keywords: ['bullet', 'list', 'unordered', 'ul'], description: 'A simple bulleted list' },
  },
  {
    id: 'format.numberedList',
    title: 'Numbered list',
    category: 'Format',
    shortcut: 'Ctrl+Shift+7',
    icon: 'list-ordered',
    scope: 'editor',
    ...pm(toggleList('ordered_list')),
    isActive: active((s) => currentList(s)?.node.type === n.ordered_list),
    slash: { keywords: ['numbered', 'list', 'ordered', 'ol', '1'], description: 'A list with numbering' },
  },
  {
    id: 'format.checklist',
    title: 'Checklist',
    category: 'Format',
    shortcut: 'Ctrl+Shift+9',
    icon: 'list-checks',
    scope: 'editor',
    ...pm(toggleList('check_list')),
    isActive: active((s) => currentList(s)?.node.type === n.check_list),
    slash: { keywords: ['checklist', 'todo', 'task', 'checkbox'], description: 'A list with clickable checkboxes' },
  },
  { id: 'format.toggleCheck', title: 'Tick / untick item', category: 'Format', keyHint: 'Ctrl+Enter', icon: 'check', scope: 'editor', ...pm(toggleChecked) },
  { id: 'format.indent', title: 'Indent list item', category: 'Format', keyHint: 'Tab', scope: 'editor', ...pm(indentListItem) },
  { id: 'format.outdent', title: 'Outdent list item', category: 'Format', keyHint: 'Shift+Tab', scope: 'editor', ...pm(outdentListItem) },
  {
    id: 'format.quote',
    title: 'Block quote',
    category: 'Format',
    shortcut: 'Ctrl+Shift+.',
    icon: 'quote',
    scope: 'editor',
    ...pm(toggleQuote),
    isActive: active((s) => inNode(s, n.blockquote!)),
    slash: { keywords: ['quote', 'blockquote', 'citation'], description: 'A quoted passage' },
  },
  {
    id: 'format.codeBlock',
    title: 'Code block',
    category: 'Format',
    shortcut: 'Ctrl+Alt+C',
    icon: 'code-block',
    scope: 'editor',
    ...pm(toggleCodeBlock),
    isActive: active((s) => s.selection.$from.parent.type === n.code_block),
    slash: { keywords: ['code', 'block', 'pre', 'snippet', 'fenced'], description: 'Code with syntax highlighting' },
  },

  // ---------------------------------------------------------------- Insert
  {
    id: 'insert.divider',
    title: 'Horizontal divider',
    category: 'Insert',
    shortcut: 'Ctrl+Shift+-',
    icon: 'minus',
    scope: 'editor',
    ...pm(insertDivider),
    slash: { keywords: ['divider', 'rule', 'line', 'hr', 'separator'], description: 'A horizontal line between sections' },
  },
  {
    id: 'insert.table',
    title: 'Table',
    category: 'Insert',
    shortcut: 'Ctrl+Alt+T',
    icon: 'table',
    scope: 'editor',
    ...pm(insertTable(3, 3)),
    slash: { keywords: ['table', 'grid', 'rows', 'columns'], description: 'A table with a header row' },
  },
  {
    id: 'insert.graph',
    title: 'Graph',
    category: 'Insert',
    shortcut: 'Ctrl+Alt+G',
    icon: 'chart-column',
    scope: 'editor',
    run: ({ view, app }) => {
      if (!view) return;
      if (insertGraph()(view.state, view.dispatch)) {
        const sel = selectedGraph(view.state);
        if (sel) app.ui.openGraphEditor(view, sel.pos);
      }
    },
    isEnabled: ({ view }) => !!view && insertGraph()(view.state),
    slash: { keywords: ['graph', 'chart', 'bar', 'line', 'pie', 'plot', 'histogram', 'scatter'], description: 'A chart drawn from a data table' },
  },
  {
    id: 'insert.graphEdit',
    title: 'Edit graph…',
    category: 'Insert',
    keyHint: 'Enter',
    icon: 'pencil',
    scope: 'editor',
    run: ({ view, app }) => {
      const sel = view && selectedGraph(view.state);
      if (view && sel) app.ui.openGraphEditor(view, sel.pos);
    },
    isEnabled: ({ view }) => !!view && selectedGraph(view.state) !== null,
  },
  { id: 'insert.lineBreak', title: 'Line break', category: 'Insert', keyHint: 'Shift+Enter', scope: 'editor', ...pm(insertLineBreak) },

  // ----------------------------------------------------------------- Table
  tableCmd('table.addRowBefore', 'Insert row above', addRowBefore),
  tableCmd('table.addRowAfter', 'Insert row below', addRowAfter, 'rows'),
  tableCmd('table.addColumnBefore', 'Insert column left', addColumnBefore),
  tableCmd('table.addColumnAfter', 'Insert column right', addColumnAfter, 'columns'),
  tableCmd('table.deleteRow', 'Delete row', deleteRow),
  tableCmd('table.deleteColumn', 'Delete column', deleteColumn),
  {
    ...tableCmd('table.toggleHeaderRow', 'Header row', toggleHeaderRow),
    isActive: ({ view }) => {
      if (!view || !isInTable(view.state)) return false;
      const { $from } = view.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === n.table) return node.firstChild?.firstChild?.type === n.table_header;
      }
      return false;
    },
  },
  tableCmd('table.delete', 'Delete table', deleteTable, 'trash'),

  // ------------------------------------------------------------------ View
  {
    id: 'view.toggleSidebar',
    title: 'Sidebar',
    category: 'View',
    shortcut: 'Ctrl+Alt+S',
    icon: 'sidebar',
    scope: 'app',
    run: ({ app }) => app.updateSettings({ sidebarVisible: !app.settings.sidebarVisible }),
    isActive: ({ app }) => app.settings.sidebarVisible,
  },
  {
    id: 'view.toggleToolbar',
    title: 'Toolbar',
    category: 'View',
    shortcut: 'Ctrl+Alt+B',
    scope: 'app',
    run: ({ app }) => app.updateSettings({ toolbarVisible: !app.settings.toolbarVisible }),
    isActive: ({ app }) => app.settings.toolbarVisible,
  },
  {
    id: 'view.toggleStatusBar',
    title: 'Status bar',
    category: 'View',
    scope: 'app',
    run: ({ app }) => app.updateSettings({ statusBarVisible: !app.settings.statusBarVisible }),
    isActive: ({ app }) => app.settings.statusBarVisible,
  },
  { id: 'view.zoomIn', title: 'Zoom in', category: 'View', shortcut: 'Ctrl+=', icon: 'zoom-in', scope: 'app', allowInDialog: true, run: ({ app }) => stepZoom(app, 1) },
  { id: 'view.zoomOut', title: 'Zoom out', category: 'View', shortcut: 'Ctrl+-', icon: 'zoom-out', scope: 'app', allowInDialog: true, run: ({ app }) => stepZoom(app, -1) },
  { id: 'view.zoomReset', title: 'Actual size', category: 'View', shortcut: 'Ctrl+0', scope: 'app', allowInDialog: true, run: ({ app }) => app.updateSettings({ zoom: 1 }) },
  { id: 'view.nextTab', title: 'Next tab', category: 'View', shortcut: 'Ctrl+Tab', scope: 'app', run: ({ app }) => app.cycleTab(1), isEnabled: ({ app }) => app.tabs.length > 1 },
  { id: 'view.previousTab', title: 'Previous tab', category: 'View', shortcut: 'Ctrl+Shift+Tab', scope: 'app', run: ({ app }) => app.cycleTab(-1), isEnabled: ({ app }) => app.tabs.length > 1 },
  { id: 'view.cycleStyle', title: 'Next style', category: 'View', shortcut: 'F8', icon: 'palette', scope: 'app', allowInDialog: true, run: ({ app }) => app.cycleStyle() },
  ...styleCommands,

  // ------------------------------------------------------------------ Help
  { id: 'help.shortcuts', title: 'Keyboard shortcuts', category: 'Help', shortcut: 'Ctrl+/', icon: 'keyboard', scope: 'app', run: ({ app }) => app.ui.openShortcuts() },
  { id: 'help.about', title: 'About Sealpage', category: 'Help', icon: 'info', scope: 'app', run: ({ app }) => showAbout(app) },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): Command | undefined {
  return BY_ID.get(id);
}

function context(app: AppController): CommandContext {
  return { app, view: app.view };
}

/** Enabled / checked state of a command right now. Unknown ids are disabled. */
export function commandState(id: string, app: AppController): { enabled: boolean; active: boolean } {
  const command = BY_ID.get(id);
  if (!command) return { enabled: false, active: false };
  const ctx = context(app);
  if (command.scope === 'editor' && !ctx.view) return { enabled: false, active: false };
  let enabled = true;
  let isActive = false;
  try {
    enabled = command.isEnabled ? command.isEnabled(ctx) : true;
    isActive = command.isActive ? command.isActive(ctx) : false;
  } catch {
    enabled = false;
  }
  return { enabled, active: isActive };
}

/** Run a command if it is currently enabled. */
export function runCommand(id: string, app: AppController): void {
  const command = BY_ID.get(id);
  if (!command || !commandState(id, app).enabled) return;
  try {
    const result = command.run(context(app));
    if (result instanceof Promise) result.catch(() => app.toast(`“${command.title}” did not complete.`, 'error'));
  } catch {
    app.toast(`“${command.title}” did not complete.`, 'error');
  }
}

/** A menu entry: a command id, a separator, or a submenu. */
export type MenuEntry = string | '-' | { title: string; items: MenuEntry[] };

export interface MenuSpec {
  title: string;
  items: MenuEntry[];
}

export const MENUS: readonly MenuSpec[] = [
  {
    title: 'File',
    items: ['file.new', 'file.open', 'file.openFolder', '-', 'file.save', 'file.saveAs', '-', 'file.exportMarkdown', 'file.exportPdf', 'file.print', '-', 'file.settings', '-', 'file.closeTab', 'file.exit'],
  },
  {
    title: 'Edit',
    items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.pastePlain', 'edit.selectAll', '-', 'edit.find', 'edit.replace', 'edit.findNext', 'edit.findPrevious'],
  },
  {
    title: 'Format',
    items: [
      'format.bold',
      'format.italic',
      'format.code',
      'format.link',
      'format.clear',
      '-',
      'format.paragraph',
      'format.title',
      'format.heading1',
      'format.heading2',
      'format.heading3',
      '-',
      'format.bulletList',
      'format.numberedList',
      'format.checklist',
      'format.toggleCheck',
      'format.indent',
      'format.outdent',
      '-',
      'format.quote',
      'format.codeBlock',
    ],
  },
  {
    title: 'Insert',
    items: [
      'insert.table',
      'insert.graph',
      'insert.divider',
      'insert.lineBreak',
      '-',
      'insert.graphEdit',
      {
        title: 'Table',
        items: ['table.addRowBefore', 'table.addRowAfter', 'table.deleteRow', '-', 'table.addColumnBefore', 'table.addColumnAfter', 'table.deleteColumn', '-', 'table.toggleHeaderRow', 'table.delete'],
      },
    ],
  },
  {
    title: 'View',
    items: [
      { title: 'Style', items: [...styleCommands.map((c) => c.id), '-', 'view.cycleStyle'] },
      '-',
      'view.toggleSidebar',
      'view.toggleToolbar',
      'view.toggleStatusBar',
      '-',
      'view.zoomIn',
      'view.zoomOut',
      'view.zoomReset',
      '-',
      'view.nextTab',
      'view.previousTab',
    ],
  },
  { title: 'Help', items: ['help.shortcuts', 'help.about'] },
];

/** A toolbar entry: a command id (button), a separator, or a drop-down of commands. */
export type ToolbarEntry = string | '-' | { title: string; choices: string[] };

export const TOOLBAR: readonly ToolbarEntry[] = [
  'edit.undo',
  'edit.redo',
  '-',
  { title: 'Text style', choices: ['format.paragraph', 'format.title', 'format.heading1', 'format.heading2', 'format.heading3'] },
  '-',
  'format.bold',
  'format.italic',
  'format.code',
  'format.link',
  '-',
  'format.bulletList',
  'format.numberedList',
  'format.checklist',
  '-',
  'format.quote',
  'format.codeBlock',
  'insert.divider',
  'insert.table',
  'insert.graph',
];

/** Commands offered in the slash menu, in display order. */
export const SLASH_COMMANDS: readonly Command[] = COMMANDS.filter((c) => c.slash);

/** Entries of the right-click menu inside the document. */
export const CONTEXT_MENU: readonly MenuEntry[] = [
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.pastePlain',
  '-',
  'format.bold',
  'format.italic',
  'format.code',
  'format.link',
  '-',
  'insert.graphEdit',
  {
    title: 'Table',
    items: ['table.addRowBefore', 'table.addRowAfter', 'table.deleteRow', '-', 'table.addColumnBefore', 'table.addColumnAfter', 'table.deleteColumn', '-', 'table.toggleHeaderRow', 'table.delete'],
  },
];
