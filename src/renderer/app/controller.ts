/**
 * AppController: the single source of truth for application state in the
 * renderer (tabs, the active editor, settings, style, sidebar folder).
 * See docs/ARCHITECTURE.md §5.2.
 *
 * No-trace: document text exists here only in memory. It leaves this process
 * solely through api.writeDocument (encrypted in the main process) or through
 * an export the user has explicitly confirmed.
 */
import type { EditorView } from 'prosemirror-view';
import { docToMarkdown } from '../../shared/export/markdown';
import type { SealpageApi } from '../../shared/ipc';
import { MARKUP_VERSION, markupVersion, parseMarkup, serializeMarkup } from '../../shared/markup';
import { type Doc, emptyDoc } from '../../shared/model';
import { type AppSettings, DEFAULT_SETTINGS, PAGE_WIDTH_FILL } from '../../shared/settings';
import { type EditorHandle, createEditor, plainText } from '../editor/editor';
import { type AppliedStyle, applyStyle } from '../styles/apply';
import { allStyles, getStyle } from '../styles/registry';
import { alertDialog, choiceDialog, openDialog, showToast } from '../ui/dialogs';
import { debounce, displayName, h, icon, nextFrame } from '../ui/dom';
import { Emitter } from './events';

export interface TabInfo {
  id: string;
  /** Absolute path, or null for a document that has never been saved. */
  path: string | null;
  /** File name without extension, or "Untitled N". */
  title: string;
  /** Has changes that are not on disk yet. */
  dirty: boolean;
}

export interface DocStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

export interface AppEvents {
  tabs: readonly TabInfo[];
  activeTab: TabInfo | null;
  editorState: void;
  stats: DocStats;
  settings: AppSettings;
  style: AppliedStyle;
  folder: string | null;
  folderContent: void;
  saveState: { tabId: string; state: 'saving' | 'saved' | 'error'; message?: string };
  toast: { text: string; kind: 'info' | 'error' };
}

export interface UiHooks {
  openSettings(section?: 'style' | 'general' | 'security'): void;
  openShortcuts(): void;
  openFind(withReplace: boolean): void;
  closeFind(): void;
  /** Edit the graph node at document position `pos` of `view`. */
  openGraphEditor(view: EditorView, pos: number): void;
}

interface Tab {
  info: TabInfo;
  pane: HTMLElement;
  editor: EditorHandle;
  /** Incremented on every content change. */
  version: number;
  /** The version that is on disk (-1: never saved). */
  savedVersion: number;
  /** Chain of in-flight saves, so saves of one tab never overlap. */
  saving: Promise<boolean>;
  autosave: ReturnType<typeof debounce<[]>>;
}

const EMPTY_STATS: DocStats = { words: 0, characters: 0, charactersNoSpaces: 0 };

function samePath(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
}

function parentFolder(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '');
}

export class AppController {
  readonly api: SealpageApi;
  readonly ui: UiHooks = {
    openSettings: () => undefined,
    openShortcuts: () => undefined,
    openFind: () => undefined,
    closeFind: () => undefined,
    openGraphEditor: () => undefined,
  };

  private readonly emitter = new Emitter<AppEvents>();
  private readonly host: HTMLElement;
  private readonly emptyState: HTMLElement;
  private tabList: Tab[] = [];
  private activeId: string | null = null;
  private currentSettings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private applied: AppliedStyle;
  /** While printing without backgrounds, graphs use this ink-friendly theme. */
  private printStyle: AppliedStyle | null = null;
  private currentFolder: string | null = null;
  private untitledCounter = 0;
  private idCounter = 0;
  private statePending = false;
  private closing = false;
  private readonly wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

  private readonly emitStats = debounce(() => this.emitter.emit('stats', this.stats()), 150);
  private readonly persistSession = debounce(() => void this.writeSession(), 400);

  /**
   * `settings` and `style` are what main.ts already loaded and applied, so
   * every getter is valid from the moment UI modules are mounted.
   */
  constructor(api: SealpageApi, editorHost: HTMLElement, settings: AppSettings, style: AppliedStyle) {
    this.api = api;
    this.host = editorHost;
    this.currentSettings = settings;
    this.applied = style;
    this.emptyState = h(
      'div',
      { class: 'sp-empty-state' },
      h('div', { class: 'sp-empty-state-mark' }, icon('lock', 28)),
      h('p', { class: 'sp-empty-state-title' }, 'No document open'),
      h('p', { class: 'sp-hint' }, 'Ctrl+N for a new document, Ctrl+O to open one.'),
    );
    this.host.appendChild(this.emptyState);
  }

  /** Store the open folder and tabs (encrypted by the main process), if the user wants them restored. */
  private async writeSession(): Promise<void> {
    if (!this.currentSettings.restoreSession) return;
    await this.api.setSession({
      folder: this.currentFolder,
      openFiles: this.tabList.map((t) => t.info.path).filter((p): p is string => p !== null),
      activeFile: this.active?.info.path ?? null,
    });
  }

  // ----------------------------------------------------------------- basics

  on<K extends keyof AppEvents>(event: K, fn: (payload: AppEvents[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  get settings(): AppSettings {
    return this.currentSettings;
  }

  get style(): AppliedStyle {
    return this.printStyle ?? this.applied;
  }

  get tabs(): readonly TabInfo[] {
    return this.tabList.map((t) => t.info);
  }

  private get active(): Tab | null {
    return this.tabList.find((t) => t.info.id === this.activeId) ?? null;
  }

  get activeTab(): TabInfo | null {
    return this.active?.info ?? null;
  }

  get folder(): string | null {
    return this.currentFolder;
  }

  get view(): EditorView | null {
    return this.active?.editor.view ?? null;
  }

  toast(text: string, kind: 'info' | 'error' = 'info'): void {
    showToast(text, kind);
    this.emitter.emit('toast', { text, kind });
  }

  /** Apply the style and layout, restore the previous session. Call once, after the UI modules are mounted. */
  async init(): Promise<void> {
    this.applyCurrentStyle();
    this.applyLayoutSettings();
    this.emitter.emit('settings', this.currentSettings);
    this.api.onFolderChanged(() => this.emitter.emit('folderContent', undefined));
    this.api.onOpenPaths((paths) => {
      void (async () => {
        for (const p of paths) await this.openPath(p);
      })();
    });
    this.api.onCloseRequested(() => void this.handleCloseRequest());
    window.addEventListener('blur', () => this.flushAutosaves());

    if (this.currentSettings.restoreSession) {
      const session = await this.api.getSession();
      if (session.folder) await this.setFolder(session.folder, false);
      for (const p of session.openFiles) await this.openPath(p, { quiet: true, activate: false });
      const target = session.activeFile ? this.tabList.find((t) => t.info.path && samePath(t.info.path, session.activeFile!)) : null;
      if (target) this.activateTab(target.info.id);
      else if (this.tabList[0]) this.activateTab(this.tabList[0].info.id);
    }
    if (this.tabList.length === 0) this.newDocument();
    await this.api.rendererReady();
  }

  // ------------------------------------------------------------------- tabs

  private emitTabs(): void {
    this.emitter.emit('tabs', this.tabs);
    this.updateWindowTitle();
    this.persistSession();
  }

  private updateWindowTitle(): void {
    const t = this.active;
    const label = document.getElementById('titlebar-title');
    const text = t ? `${t.info.title}${t.info.dirty ? ' •' : ''}` : '';
    if (label) label.textContent = text;
    document.title = t ? `${t.info.title} – Sealpage` : 'Sealpage';
  }

  private scheduleEditorState(): void {
    if (this.statePending) return;
    this.statePending = true;
    requestAnimationFrame(() => {
      this.statePending = false;
      this.emitter.emit('editorState', undefined);
    });
  }

  private createTab(doc: Doc, path: string | null): Tab {
    const id = `tab-${++this.idCounter}`;
    const pane = h('div', { class: 'sp-editor-pane sp-scroll', dataset: { tabId: id } });
    const mount = h('div', { class: 'sp-editor-mount' });
    // The frame only matters when printing: its head / foot repeat on every page as margins.
    const body = h('div', { class: 'sp-print-body' }, mount);
    const frame = h(
      'div',
      { class: 'sp-print-frame' },
      h('div', { class: 'sp-print-edge sp-print-head' }, h('div')),
      body,
      h('div', { class: 'sp-print-edge sp-print-foot' }, h('div')),
    );
    pane.appendChild(frame);
    this.host.appendChild(pane);
    const info: TabInfo = { id, path, title: path ? displayName(path) : `Untitled ${++this.untitledCounter}`, dirty: false };
    const tab: Tab = {
      info,
      pane,
      editor: null as unknown as EditorHandle,
      version: 0,
      savedVersion: path ? 0 : -1,
      saving: Promise.resolve(true),
      autosave: debounce(() => {
        if (tab.info.path && tab.info.dirty && this.currentSettings.autosave) void this.save(tab.info.id);
      }, this.currentSettings.autosaveDelayMs),
    };
    tab.editor = createEditor(mount, doc, this, {
      onDocChange: () => {
        tab.version++;
        if (!tab.info.dirty) {
          tab.info.dirty = true;
          this.emitTabs();
        }
        tab.autosave();
        if (tab.info.id === this.activeId) this.emitStats();
      },
      onStateChange: () => {
        if (tab.info.id === this.activeId) this.scheduleEditorState();
      },
    });
    // clicking the empty area below the text puts the caret at the end
    pane.addEventListener('mousedown', (event) => {
      if (event.target === pane || event.target === mount || event.target === frame || event.target === body) {
        event.preventDefault();
        tab.editor.view.focus();
      }
    });
    this.tabList.push(tab);
    return tab;
  }

  private isPristine(tab: Tab): boolean {
    return tab.info.path === null && tab.version === 0;
  }

  newDocument(): void {
    const tab = this.createTab(emptyDoc(), null);
    this.emitTabs();
    this.activateTab(tab.info.id);
  }

  activateTab(tabId: string): void {
    const tab = this.tabList.find((t) => t.info.id === tabId);
    if (!tab) return;
    const previous = this.active;
    if (previous && previous !== tab) previous.autosave.flush();
    this.activeId = tabId;
    for (const t of this.tabList) t.pane.classList.toggle('is-active', t === tab);
    this.emptyState.style.display = 'none';
    this.updateWindowTitle();
    this.emitter.emit('activeTab', tab.info);
    this.emitter.emit('stats', this.stats());
    this.scheduleEditorState();
    this.persistSession();
    tab.editor.view.focus();
  }

  cycleTab(delta: 1 | -1): void {
    if (this.tabList.length < 2) return;
    const i = this.tabList.findIndex((t) => t.info.id === this.activeId);
    const next = this.tabList[(i + delta + this.tabList.length) % this.tabList.length]!;
    this.activateTab(next.info.id);
  }

  moveTab(tabId: string, toIndex: number): void {
    const from = this.tabList.findIndex((t) => t.info.id === tabId);
    if (from < 0) return;
    const [tab] = this.tabList.splice(from, 1);
    this.tabList.splice(Math.max(0, Math.min(this.tabList.length, toIndex)), 0, tab!);
    this.emitTabs();
  }

  focusEditor(): void {
    this.active?.editor.view.focus();
  }

  getActiveDoc(): Doc | null {
    return this.active?.editor.getDoc() ?? null;
  }

  stats(): DocStats {
    const view = this.view;
    if (!view) return EMPTY_STATS;
    const text = plainText(view.state.doc);
    let words = 0;
    for (const seg of this.wordSegmenter.segment(text)) if (seg.isWordLike) words++;
    let characters = 0;
    let charactersNoSpaces = 0;
    for (const ch of text) {
      if (ch === '\n') continue;
      characters++;
      if (!/\s/.test(ch)) charactersNoSpaces++;
    }
    return { words, characters, charactersNoSpaces };
  }

  // ------------------------------------------------------------ open / save

  async openWithDialog(): Promise<void> {
    const paths = await this.api.pickOpenFiles();
    for (const p of paths) await this.openPath(p);
  }

  async openPath(path: string, opts: { quiet?: boolean; activate?: boolean } = {}): Promise<boolean> {
    const existing = this.tabList.find((t) => t.info.path !== null && samePath(t.info.path, path));
    if (existing) {
      if (opts.activate !== false) this.activateTab(existing.info.id);
      return true;
    }
    const res = await this.api.readDocument(path);
    if (!res.ok) {
      // Wrong key and tampering produce the same plain message, by design.
      if (!opts.quiet) await alertDialog(displayName(path), res.message);
      return false;
    }
    const version = markupVersion(res.value);
    const doc = parseMarkup(res.value);
    const pristine = this.tabList.length === 1 && this.isPristine(this.tabList[0]!) ? this.tabList[0]! : null;
    const tab = this.createTab(doc, path);
    if (pristine) this.disposeTab(pristine);
    this.emitTabs();
    if (opts.activate !== false) this.activateTab(tab.info.id);
    if (version !== null && version > MARKUP_VERSION && !opts.quiet) {
      this.toast('This document was written by a newer version of Sealpage. Some content may not be shown correctly.', 'error');
    }
    return true;
  }

  private writeTab(tab: Tab): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const path = tab.info.path;
      if (!path) return false;
      const version = tab.version;
      if (version === tab.savedVersion) return true;
      this.emitter.emit('saveState', { tabId: tab.info.id, state: 'saving' });
      const res = await this.api.writeDocument(path, serializeMarkup(tab.editor.getDoc()));
      if (!res.ok) {
        this.emitter.emit('saveState', { tabId: tab.info.id, state: 'error', message: res.message });
        this.toast(`${tab.info.title} could not be saved. ${res.message}`, 'error');
        return false;
      }
      tab.savedVersion = version;
      const dirty = tab.version !== tab.savedVersion;
      if (tab.info.dirty !== dirty) {
        tab.info.dirty = dirty;
        this.emitTabs();
      }
      this.emitter.emit('saveState', { tabId: tab.info.id, state: 'saved' });
      return true;
    };
    tab.saving = tab.saving.catch(() => false).then(run);
    return tab.saving;
  }

  async save(tabId?: string): Promise<boolean> {
    const tab = tabId ? this.tabList.find((t) => t.info.id === tabId) : this.active;
    if (!tab) return false;
    if (!tab.info.path) return this.saveAs(tab.info.id);
    tab.autosave.cancel();
    return this.writeTab(tab);
  }

  async saveAs(tabId?: string): Promise<boolean> {
    const tab = tabId ? this.tabList.find((t) => t.info.id === tabId) : this.active;
    if (!tab) return false;
    const path = await this.api.pickSavePath(tab.info.title);
    if (!path) return false;
    const other = this.tabList.find((t) => t !== tab && t.info.path !== null && samePath(t.info.path, path));
    if (other) {
      await alertDialog('Save as', 'That file is open in another tab. Close it first, or choose a different name.');
      return false;
    }
    tab.autosave.cancel();
    tab.info.path = path;
    tab.info.title = displayName(path);
    tab.savedVersion = -1; // force a write even if nothing changed since the last save
    this.emitTabs();
    const ok = await this.writeTab(tab);
    if (ok) this.emitter.emit('folderContent', undefined);
    return ok;
  }

  /**
   * Write every open document that has a file again, whether or not it has
   * changed. Call after the master key changed so open documents are stored
   * under the new key. Returns the titles that could not be saved.
   */
  async resaveOpenDocuments(): Promise<string[]> {
    const failed: string[] = [];
    for (const tab of this.tabList) {
      if (!tab.info.path) continue;
      tab.autosave.cancel();
      tab.savedVersion = -1;
      if (!(await this.writeTab(tab))) failed.push(tab.info.title);
    }
    return failed;
  }

  private flushAutosaves(): void {
    for (const t of this.tabList) t.autosave.flush();
  }

  private disposeTab(tab: Tab): void {
    tab.autosave.cancel();
    tab.editor.destroy();
    tab.pane.remove();
    this.tabList = this.tabList.filter((t) => t !== tab);
  }

  /**
   * Make sure a tab's content is safe before it goes away: documents with a
   * file are saved; untitled documents with content ask what to do.
   * Returns false when the user cancelled.
   */
  private async settleTab(tab: Tab): Promise<boolean> {
    if (!tab.info.dirty) return true;
    if (tab.info.path) {
      if (await this.save(tab.info.id)) return true;
      const answer = await choiceDialog({
        title: 'Could not save',
        message: `"${tab.info.title}" could not be saved. Closing it now loses the changes made since the last successful save.`,
        choices: [
          { id: 'cancel', label: 'Keep open', isDefault: true, kind: 'primary' },
          { id: 'discard', label: 'Close anyway', kind: 'danger' },
        ],
      });
      return answer === 'discard';
    }
    if (plainText(tab.editor.view.state.doc).trim() === '' && tab.editor.view.state.doc.childCount <= 1) return true;
    this.activateTab(tab.info.id);
    const answer = await choiceDialog({
      title: 'Unsaved document',
      message: `"${tab.info.title}" has never been saved.`,
      detail: 'Sealpage keeps nothing on disk for unsaved documents, so discarding it cannot be undone.',
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: 'Discard', kind: 'danger' },
        { id: 'save', label: 'Save…', kind: 'primary', isDefault: true },
      ],
    });
    if (answer === 'save') return this.saveAs(tab.info.id);
    return answer === 'discard';
  }

  async closeTab(tabId?: string): Promise<boolean> {
    const tab = tabId ? this.tabList.find((t) => t.info.id === tabId) : this.active;
    if (!tab) return false;
    if (!(await this.settleTab(tab))) return false;
    await tab.saving.catch(() => false);
    const index = this.tabList.indexOf(tab);
    const wasActive = tab.info.id === this.activeId;
    this.disposeTab(tab);
    if (wasActive) {
      const next = this.tabList[Math.min(index, this.tabList.length - 1)];
      if (next) {
        this.activeId = null;
        this.emitTabs();
        this.activateTab(next.info.id);
        return true;
      }
      this.activeId = null;
      this.emptyState.style.display = '';
      this.ui.closeFind();
      this.emitter.emit('activeTab', null);
      this.emitter.emit('stats', EMPTY_STATS);
      this.scheduleEditorState();
    }
    this.emitTabs();
    return true;
  }

  /** A file was renamed or moved on disk by the sidebar: keep its tab pointing at it. */
  pathRenamed(oldPath: string, newPath: string): void {
    for (const tab of this.tabList) {
      const p = tab.info.path;
      if (!p) continue;
      if (samePath(p, oldPath)) {
        tab.info.path = newPath;
        tab.info.title = displayName(newPath);
      } else if (p.toLowerCase().startsWith(oldPath.toLowerCase() + '\\')) {
        tab.info.path = newPath + p.slice(oldPath.length);
      }
    }
    this.emitTabs();
  }

  /** A file or folder is about to be deleted by the sidebar: close its tabs without saving back. */
  async pathRemoved(path: string): Promise<void> {
    const lower = path.toLowerCase();
    for (const tab of [...this.tabList]) {
      const p = tab.info.path?.toLowerCase();
      if (!p || (p !== lower && !p.startsWith(lower + '\\'))) continue;
      await tab.saving.catch(() => false);
      const wasActive = tab.info.id === this.activeId;
      this.disposeTab(tab);
      if (wasActive) {
        this.activeId = null;
        const next = this.tabList[0];
        if (next) this.activateTab(next.info.id);
        else {
          this.emptyState.style.display = '';
          this.emitter.emit('activeTab', null);
          this.emitter.emit('stats', EMPTY_STATS);
        }
      }
    }
    this.emitTabs();
  }

  private async handleCloseRequest(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    try {
      for (const tab of [...this.tabList]) {
        if (!(await this.settleTab(tab))) return; // user cancelled: stay open
      }
      await Promise.all(this.tabList.map((t) => t.saving.catch(() => false)));
      // must be on disk before the window goes away
      this.persistSession.cancel();
      await this.writeSession();
      await this.api.confirmClose();
    } finally {
      this.closing = false;
    }
  }

  // ----------------------------------------------------------------- folder

  async chooseFolder(): Promise<void> {
    const dir = await this.api.pickFolder();
    if (dir) await this.setFolder(dir);
  }

  async setFolder(path: string | null, reveal = true): Promise<void> {
    this.currentFolder = path;
    await this.api.watchFolder(path);
    this.emitter.emit('folder', path);
    this.persistSession();
    if (reveal && path && !this.currentSettings.sidebarVisible) await this.updateSettings({ sidebarVisible: true });
  }

  /** The folder new documents should go to: the sidebar folder, else the active file's folder. */
  defaultFolder(): string | null {
    return this.currentFolder ?? (this.active?.info.path ? parentFolder(this.active.info.path) : null);
  }

  // ------------------------------------------------------- settings & style

  private applyCurrentStyle(): void {
    const def = getStyle(this.currentSettings.styleId);
    this.applied = applyStyle(def, this.currentSettings.styleOptions[def.id]);
    const titlebar = document.getElementById('titlebar');
    const { titleBarColor, titleBarSymbolColor } = this.applied.tokens.chrome;
    // after layout, so the caption buttons match the themed title bar height
    requestAnimationFrame(() => {
      void this.api.setChrome({ color: titleBarColor, symbolColor: titleBarSymbolColor, height: titlebar?.offsetHeight || 36 });
    });
    this.emitter.emit('style', this.applied);
  }

  private applyLayoutSettings(): void {
    const s = this.currentSettings;
    const root = document.documentElement;
    root.classList.toggle('sp-hide-sidebar', !s.sidebarVisible);
    root.classList.toggle('sp-hide-toolbar', !s.toolbarVisible);
    root.classList.toggle('sp-hide-statusbar', !s.statusBarVisible);
    root.style.setProperty('--sp-layout-sidebar-width', `${s.sidebarWidth}px`);
    root.style.setProperty('--sp-layout-zoom', String(s.zoom));
    root.style.setProperty('--sp-layout-page-fill', `${PAGE_WIDTH_FILL[s.pageWidth]}%`);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const before = this.currentSettings;
    this.currentSettings = await this.api.updateSettings(patch);
    const s = this.currentSettings;
    if (before.styleId !== s.styleId || JSON.stringify(before.styleOptions) !== JSON.stringify(s.styleOptions)) this.applyCurrentStyle();
    this.applyLayoutSettings();
    if (!s.restoreSession && before.restoreSession) void this.api.setSession({ folder: null, openFiles: [], activeFile: null });
    if (s.restoreSession && !before.restoreSession) this.persistSession();
    this.emitter.emit('settings', s);
  }

  async setStyle(styleId: string): Promise<void> {
    await this.updateSettings({ styleId });
  }

  async cycleStyle(): Promise<void> {
    const styles = allStyles();
    const i = styles.findIndex((s) => s.id === this.applied.def.id);
    await this.setStyle(styles[(i + 1) % styles.length]!.id);
  }

  async setStyleOption(styleId: string, optionId: string, value: boolean | string): Promise<void> {
    const styleOptions = { ...this.currentSettings.styleOptions, [styleId]: { ...this.currentSettings.styleOptions[styleId], [optionId]: value } };
    await this.updateSettings({ styleOptions });
  }

  // ---------------------------------------------------------------- exports

  /**
   * Every export leaves Sealpage's protection, so each one is confirmed.
   * Resolves to null when cancelled, otherwise the chosen options.
   */
  private confirmUnencrypted(what: string, offerBackground: boolean, backgroundDefault: boolean): Promise<{ background: boolean } | null> {
    return new Promise((resolve) => {
      let result: { background: boolean } | null = null;
      const background = h('input', { type: 'checkbox', class: 'sp-checkbox', checked: backgroundDefault });
      const body = h(
        'div',
        { class: 'sp-dialog-message' },
        h(
          'div',
          { class: 'sp-warning-box' },
          icon('shield-alert'),
          h('span', null, `${what} is not encrypted. Anyone who can reach it can read this document.`),
        ),
        h('p', { class: 'sp-hint' }, 'Sealpage cannot protect or track copies made this way. The original .slpg file stays encrypted.'),
        offerBackground
          ? h('label', { class: 'sp-check-row' }, background, h('span', null, 'Use the style’s colours and backgrounds (off: dark text on white paper)'))
          : null,
      );
      openDialog({
        title: 'Unencrypted export',
        icon: 'shield-alert',
        body,
        width: 480,
        onClose: () => resolve(result),
        buttons: [
          { label: 'Cancel', isDefault: true },
          {
            label: 'Continue',
            kind: 'danger',
            onClick: () => {
              result = { background: background.checked };
            },
          },
        ],
      });
    });
  }

  async exportMarkdown(): Promise<void> {
    const tab = this.active;
    if (!tab) return;
    if (!(await this.confirmUnencrypted('A Markdown export', false, false))) return;
    const res = await this.api.exportMarkdown(tab.info.title, docToMarkdown(tab.editor.getDoc()));
    if (res.ok) this.toast('Exported as Markdown (not encrypted).');
    else if (res.code !== 'cancelled') this.toast(res.message, 'error');
  }

  /** Switch the page into print layout, run `job`, and always switch back. */
  private async withPrintLayout<T>(background: boolean, job: () => Promise<T>): Promise<T> {
    const root = document.documentElement;
    root.classList.add('sp-printing');
    if (!background) {
      root.classList.add('sp-print-plain');
      const g = this.applied.graphTheme;
      this.printStyle = {
        ...this.applied,
        graphTheme: { ...g, background: 'transparent', text: '#111111', textMuted: '#444444', axis: '#666666', grid: '#cccccc', sliceStroke: '#ffffff' },
      };
      this.emitter.emit('style', this.printStyle);
    }
    await nextFrame();
    await nextFrame();
    try {
      return await job();
    } finally {
      root.classList.remove('sp-printing', 'sp-print-plain');
      if (this.printStyle) {
        this.printStyle = null;
        this.emitter.emit('style', this.applied);
      }
    }
  }

  async exportPdf(): Promise<void> {
    const tab = this.active;
    if (!tab) return;
    const choice = await this.confirmUnencrypted('A PDF export', true, true);
    if (!choice) return;
    const res = await this.withPrintLayout(choice.background, () => this.api.exportPdf(tab.info.title, choice));
    if (res.ok) this.toast('Exported as PDF (not encrypted).');
    else if (res.code !== 'cancelled') this.toast(res.message, 'error');
  }

  async print(): Promise<void> {
    if (!this.active) return;
    const choice = await this.confirmUnencrypted('A printout (and the print job Windows keeps while printing)', true, false);
    if (!choice) return;
    const res = await this.withPrintLayout(choice.background, () => this.api.print(choice));
    if (!res.ok && res.code !== 'cancelled') this.toast(res.message, 'error');
  }
}
