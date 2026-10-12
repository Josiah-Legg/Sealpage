/**
 * Settings dialog (Style, General, Security) and the two passphrase wizards it
 * opens: change key, and re-encrypt files. Every change applies at once; the
 * dialog has no Save button.
 *
 * Passphrases are read from password inputs only and handed straight to one
 * IPC call. The inputs are emptied when a wizard closes, or as soon as the call
 * that needed them has finished.
 */
import '../css/settings.css';
import type { ReencryptFileResult, ReencryptProgress, ReencryptReport, ReencryptStatus, Result, SealpageApi } from '../../shared/ipc';
import type { PageWidth } from '../../shared/settings';
import type { AppController } from '../app/controller';
import { effectiveOptionValues, resolveTokens } from '../styles/apply';
import { allStyles } from '../styles/registry';
import type { StyleDefinition, StyleOption } from '../styles/schema';
import { type DialogButton, type DialogHandle, field, openDialog } from './dialogs';
import { type Child, clear, h, icon } from './dom';
import type { IconName } from './icons';
import { type PassphraseSet, noRecoveryWarning, passphraseInput, passphraseSet, showRow, unexpectedFailure } from './setupScreen';

type Section = 'style' | 'general' | 'security';

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'style', label: 'Style', icon: 'palette' },
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'security', label: 'Security', icon: 'shield-alert' },
];

const AUTOSAVE_HINT = 'Saves the encrypted file automatically while you type. Documents that have never been saved to a file are kept in memory only.';
const RESTORE_HINT = 'The list of open files is stored encrypted with your key.';
const SECURITY_SUMMARY =
  'Your key is stored on this computer, protected by your Windows account. Anyone who can use this Windows account can open your documents; the encryption protects the files themselves if they are copied, synced, backed up or stolen. There is no recovery if the passphrase is lost and the stored key is gone.';
const KEEP_ITEMS = [
  'Your encrypted .slpg files, where you save them',
  'The key, protected by Windows',
  'Preferences such as the chosen style and window size',
  'The list of open tabs, encrypted (if enabled)',
];
const NO_TRACE =
  'Document text is never written to disk unencrypted: no temporary files, no crash recovery files, no cache. Exports, printing and the clipboard are outside this protection.';
const KEY_HINT = 'Set a new passphrase, then choose the files to convert to it.';
const REENCRYPT_HINT = 'Convert files that are still encrypted with an earlier passphrase to your current key.';
const KEY_CHANGE_FILES =
  'Files stay encrypted with the old key until they are re-encrypted. Files you do not convert now can only be opened later by re-encrypting them with the old passphrase (Settings → Security → Re-encrypt files).';
const REENCRYPT_EXPLAIN =
  'Converts files that are still encrypted with a previous key to your current key. Each file is replaced only after its new version has been written and verified, so a file is never left half converted.';
const RETRY_NOTE = 'Files that were not converted are unchanged and still use the old key. You can retry from Settings → Security → Re-encrypt files with the old passphrase.';
const VERIFY_FAILED = 'The passphrase could not be checked. Try again.';
const CHANGE_FAILED = 'The key could not be changed. Try again.';
const REENCRYPT_FAILED = 'Re-encryption did not finish. Try again.';

const DELAY_OPTIONS = [
  { value: '500', label: '0.5 s' },
  { value: '1500', label: '1.5 s' },
  { value: '3000', label: '3 s' },
  { value: '10000', label: '10 s' },
];
const ZOOM_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%` }));
const PAGE_WIDTH_HINT = 'How much of a wide window the text fills. Narrow keeps the width set by the style.';
const PAGE_WIDTH_OPTIONS: { value: PageWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full width' },
];

const STATUS_LABEL: Record<ReencryptStatus, string> = {
  converted: 'Converted',
  'already-current': 'Already current',
  'cannot-decrypt': 'Cannot decrypt',
  'bad-format': 'Not a Sealpage file',
  'io-error': 'Read or write error',
};

export function mountSettingsDialog(app: AppController): void {
  const view = new SettingsView(app);
  app.ui.openSettings = (section) => view.open(section);
  app.on('style', () => view.onStyleChanged());
  app.on('settings', () => view.onSettingsChanged());
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

class SettingsView {
  private readonly app: AppController;
  private handle: DialogHandle | null = null;
  private section: Section = 'style';
  private panel: HTMLElement = h('div');
  private readonly navButtons = new Map<Section, HTMLButtonElement>();
  /** Keeps the General controls in step with settings changed elsewhere. */
  private syncGeneral: (() => void) | null = null;

  constructor(app: AppController) {
    this.app = app;
  }

  private get isOpen(): boolean {
    return this.handle !== null && this.handle.isOpen;
  }

  open(section?: Section): void {
    if (this.isOpen) {
      if (section) this.show(section);
      return;
    }
    this.section = section ?? 'style';
    this.navButtons.clear();
    const nav = h(
      'nav',
      { class: 'sp-settings-nav', 'aria-label': 'Settings sections' },
      SECTIONS.map((s) => {
        const button = h(
          'button',
          { type: 'button', class: 'sp-settings-nav-item', dataset: { section: s.id }, onclick: () => this.show(s.id) },
          icon(s.icon),
          s.label,
        );
        this.navButtons.set(s.id, button);
        return button;
      }),
    );
    this.panel = h('div', { class: 'sp-settings-panel sp-scroll' });
    const body = h('div', { class: 'sp-settings' }, nav, this.panel);
    this.handle = openDialog({
      title: 'Settings',
      icon: 'settings',
      width: 760,
      className: 'sp-settings-dialog',
      body,
      buttons: [{ label: 'Done', kind: 'primary', isDefault: true }],
      onClose: () => {
        this.handle = null;
        this.syncGeneral = null;
        this.navButtons.clear();
      },
    });
    this.render();
  }

  private show(section: Section): void {
    this.section = section;
    this.panel.scrollTop = 0;
    this.render();
  }

  onStyleChanged(): void {
    if (this.isOpen && this.section === 'style') this.render();
  }

  onSettingsChanged(): void {
    if (this.isOpen) this.syncGeneral?.();
  }

  private render(): void {
    // Rebuilding a panel must not drop keyboard focus from the control the user is on.
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && this.panel.contains(active) ? active.dataset.key : undefined;

    this.syncGeneral = null;
    let content: HTMLElement;
    if (this.section === 'general') {
      const general = this.generalPanel();
      content = general.el;
      this.syncGeneral = general.sync;
    } else if (this.section === 'security') {
      content = this.securityPanel();
    } else {
      content = this.stylePanel();
    }
    clear(this.panel);
    this.panel.appendChild(content);

    for (const [id, button] of this.navButtons) {
      const on = id === this.section;
      button.classList.toggle('is-active', on);
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (focusKey) this.panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  // ----------------------------------------------------------------- style

  private stylePanel(): HTMLElement {
    const app = this.app;
    const def = app.style.def;
    return h(
      'div',
      { class: 'sp-settings-section' },
      h('h3', { class: 'sp-subhead' }, 'Style'),
      h(
        'div',
        { class: 'sp-style-grid' },
        allStyles().map((s) => styleCard(app, s, s.id === def.id)),
      ),
      h('h3', { class: 'sp-subhead' }, `Options for ${def.name}`),
      optionList(app, def),
    );
  }

  // --------------------------------------------------------------- general

  private generalPanel(): { el: HTMLElement; sync: () => void } {
    const app = this.app;
    const autosave = toggleRow(
      'Autosave',
      AUTOSAVE_HINT,
      () => app.settings.autosave,
      (v) => void app.updateSettings({ autosave: v }),
    );
    const delay = selectRow(
      'Autosave delay',
      null,
      DELAY_OPTIONS,
      () => String(app.settings.autosaveDelayMs),
      (v) => void app.updateSettings({ autosaveDelayMs: Number(v) }),
    );
    const restore = toggleRow(
      'Reopen my folder and tabs at start-up',
      RESTORE_HINT,
      () => app.settings.restoreSession,
      (v) => void app.updateSettings({ restoreSession: v }),
    );
    const toolbar = toggleRow(
      'Show toolbar',
      null,
      () => app.settings.toolbarVisible,
      (v) => void app.updateSettings({ toolbarVisible: v }),
    );
    const statusBar = toggleRow(
      'Show status bar',
      null,
      () => app.settings.statusBarVisible,
      (v) => void app.updateSettings({ statusBarVisible: v }),
    );
    const sidebar = toggleRow(
      'Show sidebar',
      null,
      () => app.settings.sidebarVisible,
      (v) => void app.updateSettings({ sidebarVisible: v }),
    );
    const zoom = selectRow(
      'Document zoom',
      null,
      ZOOM_OPTIONS,
      () => String(app.settings.zoom),
      (v) => void app.updateSettings({ zoom: Number(v) }),
    );
    const pageWidth = selectRow(
      'Page width',
      PAGE_WIDTH_HINT,
      PAGE_WIDTH_OPTIONS,
      () => app.settings.pageWidth,
      (v) => void app.updateSettings({ pageWidth: v as PageWidth }),
    );
    const rows = [autosave, delay, restore, toolbar, statusBar, sidebar, zoom, pageWidth];

    const sync = (): void => {
      for (const row of rows) row.sync();
      delay.control.disabled = !app.settings.autosave;
    };
    sync();

    const shortcuts = h(
      'button',
      { type: 'button', class: 'sp-btn sp-btn-ghost sp-link-btn', onclick: () => app.ui.openShortcuts() },
      icon('keyboard'),
      'Keyboard shortcuts…',
    );
    const el = h(
      'div',
      { class: 'sp-settings-section' },
      h('h3', { class: 'sp-subhead' }, 'General'),
      ...rows.map((row) => row.el),
      h('div', { class: 'sp-setting-link' }, shortcuts),
    );
    return { el, sync };
  }

  // -------------------------------------------------------------- security

  private securityPanel(): HTMLElement {
    const app = this.app;
    return h(
      'div',
      { class: 'sp-settings-section' },
      h('h3', { class: 'sp-subhead' }, 'Security'),
      h('div', { class: 'sp-info-box' }, icon('lock'), h('span', null, SECURITY_SUMMARY)),
      actionRow('Change key', KEY_HINT, 'Change key…', () => openKeyChangeWizard(app)),
      actionRow('Re-encrypt files', REENCRYPT_HINT, 'Re-encrypt files…', () => openReencryptWizard(app)),
      h('h3', { class: 'sp-subhead' }, 'What Sealpage keeps on this computer'),
      h(
        'ul',
        { class: 'sp-keep-list' },
        KEEP_ITEMS.map((item) => h('li', null, item)),
      ),
      h('p', { class: 'sp-keep-note' }, NO_TRACE),
    );
  }
}

// ---------------------------------------------------------------------------
// Style panel pieces
// ---------------------------------------------------------------------------

function styleCard(app: AppController, def: StyleDefinition, active: boolean): HTMLElement {
  const t = resolveTokens(def, app.settings.styleOptions[def.id]);
  return h(
    'button',
    {
      type: 'button',
      class: ['sp-style-card', active && 'is-active'],
      'aria-pressed': String(active),
      dataset: { key: `style:${def.id}` },
      onclick: () => void app.setStyle(def.id),
    },
    // The swatch previews this style's own tokens, so these inline colours are deliberate.
    h(
      'span',
      { class: 'sp-style-swatch', style: { background: t.colors.editorBg } },
      h('span', { class: 'sp-style-swatch-heading', style: { fontFamily: t.fonts.heading, color: t.colors.heading } }, 'Aa'),
      h('span', { class: 'sp-style-swatch-body', style: { fontFamily: t.fonts.body, color: t.colors.text } }, 'The quick brown fox'),
      h(
        'span',
        { class: 'sp-style-dots' },
        t.graph.palette.slice(0, 5).map((c) => h('span', { class: 'sp-style-dot', style: { background: c } })),
      ),
    ),
    h('span', { class: 'sp-style-name' }, def.name, active ? h('span', { class: 'sp-style-check' }, icon('check')) : null),
    h('span', { class: 'sp-style-desc' }, def.description),
  );
}

function optionList(app: AppController, def: StyleDefinition): HTMLElement {
  if (def.options.length === 0) return h('p', { class: 'sp-hint' }, 'This style has no options.');
  const values = effectiveOptionValues(def, app.settings.styleOptions[def.id]);
  return h(
    'div',
    { class: 'sp-option-list' },
    def.options.map((opt) => optionRow(app, def, opt, values[opt.id])),
  );
}

function optionRow(app: AppController, def: StyleDefinition, opt: StyleOption, value: boolean | string): HTMLElement {
  const text = h(
    'span',
    { class: 'sp-option-text' },
    h('span', { class: 'sp-option-label' }, opt.label),
    opt.description ? h('span', { class: 'sp-hint' }, opt.description) : null,
  );
  if (opt.kind === 'toggle') {
    const input = h('input', { class: 'sp-switch', type: 'checkbox', checked: value === true, dataset: { key: `opt:${opt.id}` } });
    input.addEventListener('change', () => void app.setStyleOption(def.id, opt.id, input.checked));
    return h('label', { class: 'sp-option-row' }, text, input);
  }
  return h(
    'div',
    { class: 'sp-option-row' },
    text,
    h(
      'div',
      { class: 'sp-segmented', role: 'group', 'aria-label': opt.label },
      opt.choices.map((c) =>
        h(
          'button',
          {
            type: 'button',
            class: c.id === value ? 'is-active' : undefined,
            'aria-pressed': String(c.id === value),
            dataset: { key: `opt:${opt.id}:${c.id}` },
            onclick: () => void app.setStyleOption(def.id, opt.id, c.id),
          },
          c.label,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// General and security row helpers
// ---------------------------------------------------------------------------

interface SettingRow {
  el: HTMLElement;
  control: HTMLInputElement | HTMLSelectElement;
  sync(): void;
}

function settingRow(label: string, hint: string | null, control: HTMLElement): HTMLElement {
  return h(
    'label',
    { class: 'sp-setting-row' },
    h('span', { class: 'sp-option-text' }, h('span', { class: 'sp-option-label' }, label), hint ? h('span', { class: 'sp-hint' }, hint) : null),
    control,
  );
}

function toggleRow(label: string, hint: string | null, read: () => boolean, write: (value: boolean) => void): SettingRow {
  const input = h('input', { class: 'sp-switch', type: 'checkbox' });
  input.addEventListener('change', () => write(input.checked));
  return {
    el: settingRow(label, hint, input),
    control: input,
    sync: () => {
      input.checked = read();
    },
  };
}

function selectRow(
  label: string,
  hint: string | null,
  options: { value: string; label: string }[],
  read: () => string,
  write: (value: string) => void,
): SettingRow {
  const select = h('select', { class: 'sp-select' });
  for (const o of options) select.appendChild(h('option', { value: o.value }, o.label));
  select.addEventListener('change', () => write(select.value));
  return {
    el: settingRow(label, hint, select),
    control: select,
    sync: () => {
      const value = read();
      // A value outside the offered list (set elsewhere) is still shown rather than lost.
      if (!Array.from(select.options).some((o) => o.value === value)) select.appendChild(h('option', { value }, value));
      select.value = value;
    },
  };
}

function actionRow(title: string, hint: string, buttonLabel: string, onClick: () => void): HTMLElement {
  return h(
    'div',
    { class: 'sp-setting-row sp-action-row' },
    h('span', { class: 'sp-option-text' }, h('span', { class: 'sp-option-label' }, title), h('span', { class: 'sp-hint' }, hint)),
    h('button', { type: 'button', class: 'sp-btn', onclick: () => onClick() }, buttonLabel),
  );
}

// ---------------------------------------------------------------------------
// Wizards
// ---------------------------------------------------------------------------

/**
 * A wizard dialog. Its close button and backdrop are off, because some steps
 * must not be left half-way. Escape closes it unless `canClose` refuses.
 */
function openWizard(opts: { title: string; className: string; body: HTMLElement; canClose: () => boolean; onClose: () => void }): DialogHandle {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !handle.isOpen || !opts.canClose()) return;
    event.preventDefault();
    event.stopPropagation();
    handle.close();
  };
  const handle: DialogHandle = openDialog({
    title: opts.title,
    body: opts.body,
    width: 560,
    className: `sp-wizard-dialog ${opts.className}`,
    dismissable: false,
    onClose: () => {
      document.removeEventListener('keydown', onKey, true);
      opts.onClose();
    },
  });
  document.addEventListener('keydown', onKey, true);
  return handle;
}

function stepLabel(n: number, total: number): HTMLElement {
  return h('p', { class: 'sp-hint sp-wizard-step-label' }, `Step ${n} of ${total}`);
}

function focusFirstInput(root: HTMLElement): void {
  root.querySelector<HTMLInputElement>('input')?.focus();
}

function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '');
}

function countOf(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** Files and folders chosen for re-encryption. Duplicates are ignored. */
interface PathListEditor {
  readonly el: HTMLElement;
  paths(): string[];
}

function pathListEditor(api: SealpageApi, initial: string[], onChange: () => void): PathListEditor {
  const items: string[] = [];
  const key = (p: string): string => p.replace(/\//g, '\\').toLowerCase();
  const list = h('ul', { class: 'sp-path-list', 'aria-label': 'Chosen files and folders' });

  const render = (): void => {
    clear(list);
    if (items.length === 0) {
      list.appendChild(h('li', { class: 'sp-path-empty sp-hint' }, 'No files or folders chosen yet.'));
      return;
    }
    items.forEach((p, i) => {
      list.appendChild(
        h(
          'li',
          { class: 'sp-path-item' },
          h('span', { class: 'sp-path-text', title: p }, p),
          h(
            'button',
            {
              type: 'button',
              class: 'sp-icon-btn',
              title: 'Remove',
              'aria-label': `Remove ${p}`,
              onclick: () => {
                items.splice(i, 1);
                render();
                onChange();
              },
            },
            icon('close'),
          ),
        ),
      );
    });
  };

  const addAll = (incoming: string[], notify: boolean): void => {
    const before = items.length;
    for (const p of incoming) {
      if (!items.some((x) => key(x) === key(p))) items.push(p);
    }
    if (items.length === before) return;
    render();
    if (notify) onChange();
  };

  addAll(initial, false);

  const folderButton = h(
    'button',
    {
      type: 'button',
      class: 'sp-btn',
      onclick: async () => {
        try {
          const dir = await api.pickReencryptFolder();
          if (dir) addAll([dir], true);
        } catch {
          // The picker failed to open: nothing is added.
        }
      },
    },
    icon('folder-plus'),
    'Add folder…',
  );
  const filesButton = h(
    'button',
    {
      type: 'button',
      class: 'sp-btn',
      onclick: async () => {
        try {
          addAll(await api.pickReencryptFiles(), true);
        } catch {
          // The picker failed to open: nothing is added.
        }
      },
    },
    icon('file-plus'),
    'Add files…',
  );

  render();
  return {
    el: h('div', { class: 'sp-path-editor' }, list, h('div', { class: 'sp-path-actions' }, folderButton, filesButton)),
    paths: () => [...items],
  };
}

interface WorkingView {
  readonly el: HTMLElement;
  /** Show a status line; `withProgress` shows the progress bar too. */
  start(status: string, withProgress: boolean): void;
  setProgress(progress: ReencryptProgress): void;
}

function workingView(): WorkingView {
  const status = h('p', { class: 'sp-working-status', role: 'status' });
  const bar = h('div', { class: 'sp-progress-bar' });
  const track = h(
    'div',
    { class: 'sp-progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
    bar,
  );
  const count = h('span', { class: 'sp-progress-count' });
  const current = h('span', { class: 'sp-progress-file' });
  const progress = h('div', { class: 'sp-progress' }, track, h('div', { class: 'sp-progress-line' }, count, current));
  return {
    el: h('div', { class: 'sp-working' }, status, progress),
    start(text, withProgress) {
      status.textContent = text;
      progress.hidden = !withProgress;
      bar.style.width = '0%';
      track.setAttribute('aria-valuenow', '0');
      count.textContent = 'Preparing…';
      current.textContent = '';
    },
    setProgress(p) {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      bar.style.width = `${pct}%`;
      track.setAttribute('aria-valuenow', String(pct));
      count.textContent = p.total > 0 ? `${p.done} of ${p.total}` : 'Preparing…';
      current.textContent = p.current ? fileName(p.current) : '';
    },
  };
}

/** Run a re-encryption, feeding progress into `working`. Never throws. */
async function reencryptWithProgress(api: SealpageApi, passphrase: string, paths: string[], working: WorkingView): Promise<Result<ReencryptReport>> {
  working.start('Re-encrypting files…', true);
  const off = api.onReencryptProgress((p) => working.setProgress(p));
  try {
    return await api.reencrypt(passphrase, paths);
  } catch {
    return unexpectedFailure(REENCRYPT_FAILED);
  } finally {
    off();
  }
}

function isFailure(status: ReencryptStatus): boolean {
  return status !== 'converted' && status !== 'already-current';
}

/** Failures first, then converted, then already current. */
function statusRank(status: ReencryptStatus): number {
  if (isFailure(status)) return 0;
  return status === 'converted' ? 1 : 2;
}

interface ReportInput {
  keyChanged: boolean;
  report: ReencryptReport | null;
  error: string | null;
  /** Titles of open documents that could not be stored under the new key. */
  unsaved: string[];
}

function buildReport(input: ReportInput): HTMLElement {
  const report = input.report;
  const rows: ReencryptFileResult[] = report ? [...report.results].sort((a, b) => statusRank(a.status) - statusRank(b.status)) : [];
  const children: Child[] = [];

  const summary: string[] = [];
  if (input.keyChanged) summary.push('Key changed.');
  if (report) {
    if (report.cancelled) summary.push('Stopped early.');
    summary.push(`${countOf(report.converted, 'file')} re-encrypted, ${report.alreadyCurrent} already current, ${report.failed} not converted.`);
  } else if (!input.error) {
    summary.push('No files were converted.');
  }
  if (summary.length > 0) children.push(h('p', { class: 'sp-report-summary' }, summary.join(' ')));
  if (report?.cancelled) children.push(h('p', { class: 'sp-hint' }, 'Files that were not reached are unchanged and still use the old key.'));
  if (input.error) children.push(h('p', { class: 'sp-error-text', role: 'alert' }, input.error));
  if (input.unsaved.length > 0) children.push(h('p', { class: 'sp-error-text' }, `Could not be saved: ${input.unsaved.join(', ')}`));
  if (rows.length > 0) children.push(reportTable(rows));
  if (rows.some((r) => isFailure(r.status))) children.push(h('p', { class: 'sp-hint' }, RETRY_NOTE));
  return h('div', { class: 'sp-report' }, children);
}

/** The last step of a wizard: a titled report. */
function reportStep(n: number, total: number, input: ReportInput): HTMLElement {
  return h('div', { class: 'sp-wizard-step' }, stepLabel(n, total), h('h3', { class: 'sp-subhead' }, 'Report'), buildReport(input));
}

function reportTable(rows: ReencryptFileResult[]): HTMLElement {
  return h(
    'div',
    { class: 'sp-report-scroll sp-scroll', tabIndex: 0, role: 'region', 'aria-label': 'Files' },
    h(
      'table',
      { class: 'sp-report-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'File'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'Details'))),
      h(
        'tbody',
        null,
        rows.map((r) =>
          h(
            'tr',
            { class: isFailure(r.status) ? 'is-failed' : undefined },
            h('td', { class: 'sp-report-path' }, r.path),
            h('td', null, STATUS_LABEL[r.status]),
            h('td', null, r.message),
          ),
        ),
      ),
    ),
  );
}

/** Change the key (current -> new), store open documents, then re-encrypt the chosen files. */
function openKeyChangeWizard(app: AppController): void {
  const api = app.api;
  type Step = 'passphrases' | 'files' | 'working' | 'report';
  let step: Step = 'passphrases';
  let verifying = false;
  let reencrypting = false;
  let stopping = false;

  const body = h('div', { class: 'sp-wizard' });

  // Step 1: passphrases. The inputs persist across steps, so going back keeps what was typed.
  const currentInput = passphraseInput(() => renderFooter());
  const newSet: PassphraseSet = passphraseSet({
    firstLabel: 'New passphrase',
    secondLabel: 'Repeat new passphrase',
    onChange: () => renderFooter(),
  });
  const step1Error = h('p', { class: 'sp-error-text', role: 'alert' });
  const passphraseStep = h(
    'div',
    { class: 'sp-wizard-step' },
    stepLabel(1, 4),
    h('h3', { class: 'sp-subhead' }, 'Passphrases'),
    h('p', { class: 'sp-hint' }, KEY_HINT),
    field('Current passphrase', currentInput),
    newSet.el,
    showRow(() => [currentInput, ...newSet.inputs]),
    noRecoveryWarning(),
    step1Error,
  );

  // Step 2: files.
  const paths = pathListEditor(api, app.folder ? [app.folder] : [], () => renderFooter());
  const noFiles = h('div', { class: 'sp-warning-box' }, icon('warning'), h('span', null, 'No files will be converted.'));
  const filesStep = h(
    'div',
    { class: 'sp-wizard-step' },
    stepLabel(2, 4),
    h('h3', { class: 'sp-subhead' }, 'Files to re-encrypt'),
    h('p', { class: 'sp-hint' }, KEY_CHANGE_FILES),
    paths.el,
    noFiles,
  );

  // Step 3: working. Step 4: report.
  const working = workingView();
  const workingStep = h('div', { class: 'sp-wizard-step' }, stepLabel(3, 4), h('h3', { class: 'sp-subhead' }, 'Working'), working.el);

  const show = (next: Step, el: HTMLElement): void => {
    step = next;
    clear(body);
    body.appendChild(el);
    renderFooter();
    focusFirstInput(el);
  };

  const renderFooter = (): void => {
    handle.setButtons(footerButtons());
    noFiles.hidden = paths.paths().length > 0;
  };

  const footerButtons = (): DialogButton[] => {
    switch (step) {
      case 'passphrases':
        return [
          { label: 'Cancel' },
          {
            label: 'Next',
            kind: 'primary',
            isDefault: true,
            disabled: verifying || currentInput.value === '' || !newSet.isValid(),
            onClick: goNext,
          },
        ];
      case 'files':
        return [
          {
            label: 'Back',
            onClick: () => {
              show('passphrases', passphraseStep);
              return false;
            },
          },
          {
            label: paths.paths().length > 0 ? 'Change key and re-encrypt' : 'Change key only',
            kind: 'danger',
            onClick: () => {
              void runChange();
              return false;
            },
          },
        ];
      case 'working':
        return reencrypting ? [{ label: 'Stop', disabled: stopping, onClick: stop }] : [];
      case 'report':
        return [{ label: 'Close', kind: 'primary', isDefault: true }];
    }
  };

  const goNext = async (): Promise<boolean> => {
    verifying = true;
    step1Error.textContent = '';
    renderFooter();
    let res: Result;
    try {
      res = await api.keyVerify(currentInput.value);
    } catch {
      res = unexpectedFailure(VERIFY_FAILED);
    }
    verifying = false;
    if (!handle.isOpen) return false;
    if (!res.ok) {
      step1Error.textContent = res.message;
      renderFooter();
      return false;
    }
    show('files', filesStep);
    return false;
  };

  const runChange = async (): Promise<void> => {
    show('working', workingStep);
    working.start('Changing the key…', false);
    let res: Result;
    try {
      res = await api.keyChange(currentInput.value, newSet.first.value);
    } catch {
      res = unexpectedFailure(CHANGE_FAILED);
    }
    newSet.clear();
    if (!res.ok) {
      // Nothing was changed: back to the passphrases with the reason.
      step1Error.textContent = res.message;
      show('passphrases', passphraseStep);
      return;
    }

    // The new key is in place. Store open documents under it, then convert the chosen files.
    working.start('Storing open documents under the new key…', false);
    const unsaved = await app.resaveOpenDocuments();
    const files = paths.paths();
    if (files.length === 0) {
      show('report', reportStep(4, 4, { keyChanged: true, report: null, error: null, unsaved }));
      return;
    }
    reencrypting = true;
    stopping = false;
    renderFooter();
    const result = await reencryptWithProgress(api, currentInput.value, files, working);
    reencrypting = false;
    // The old passphrase was needed only for this call.
    currentInput.value = '';
    show(
      'report',
      reportStep(4, 4, {
        keyChanged: true,
        report: result.ok ? result.value : null,
        error: result.ok ? null : result.message,
        unsaved,
      }),
    );
  };

  const stop = (): boolean => {
    stopping = true;
    api.reencryptCancel().catch(() => undefined);
    renderFooter();
    return false;
  };

  const handle = openWizard({
    title: 'Change key',
    className: 'sp-keychange',
    body,
    canClose: () => step !== 'working',
    onClose: () => {
      currentInput.value = '';
      newSet.clear();
    },
  });
  show('passphrases', passphraseStep);
}

/** Re-encrypt files that are still under an earlier passphrase. */
function openReencryptWizard(app: AppController): void {
  const api = app.api;
  type Step = 'files' | 'working' | 'report';
  let step: Step = 'files';
  let reencrypting = false;
  let stopping = false;

  const body = h('div', { class: 'sp-wizard' });
  const passInput = passphraseInput(() => renderFooter());
  const paths = pathListEditor(api, [], () => renderFooter());
  const filesStep = h(
    'div',
    { class: 'sp-wizard-step' },
    stepLabel(1, 3),
    h('h3', { class: 'sp-subhead' }, 'Re-encrypt files'),
    h('p', { class: 'sp-hint' }, REENCRYPT_EXPLAIN),
    field('Passphrase the files are encrypted with', passInput),
    showRow(() => [passInput]),
    paths.el,
  );
  const working = workingView();
  const workingStep = h('div', { class: 'sp-wizard-step' }, stepLabel(2, 3), h('h3', { class: 'sp-subhead' }, 'Working'), working.el);

  const show = (next: Step, el: HTMLElement): void => {
    step = next;
    clear(body);
    body.appendChild(el);
    renderFooter();
    focusFirstInput(el);
  };

  const renderFooter = (): void => {
    handle.setButtons(footerButtons());
  };

  const footerButtons = (): DialogButton[] => {
    switch (step) {
      case 'files':
        return [
          { label: 'Cancel' },
          {
            label: 'Re-encrypt',
            kind: 'primary',
            isDefault: true,
            disabled: passInput.value === '' || paths.paths().length === 0,
            onClick: start,
          },
        ];
      case 'working':
        return reencrypting ? [{ label: 'Stop', disabled: stopping, onClick: stop }] : [];
      case 'report':
        return [{ label: 'Close', kind: 'primary', isDefault: true }];
    }
  };

  const start = async (): Promise<boolean> => {
    stopping = false;
    reencrypting = true;
    show('working', workingStep);
    const result = await reencryptWithProgress(api, passInput.value, paths.paths(), working);
    reencrypting = false;
    passInput.value = '';
    show(
      'report',
      reportStep(3, 3, {
        keyChanged: false,
        report: result.ok ? result.value : null,
        error: result.ok ? null : result.message,
        unsaved: [],
      }),
    );
    return false;
  };

  const stop = (): boolean => {
    stopping = true;
    api.reencryptCancel().catch(() => undefined);
    renderFooter();
    return false;
  };

  const handle = openWizard({
    title: 'Re-encrypt files',
    className: 'sp-reencrypt',
    body,
    canClose: () => step !== 'working',
    onClose: () => {
      passInput.value = '';
    },
  });
  show('files', filesStep);
}
