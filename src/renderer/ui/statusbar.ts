/**
 * Status bar: encryption and save state of the active document on the left;
 * word and character counts, the zoom (when not 100%) and the active style on
 * the right.
 */
import '../css/statusbar.css';
import type { AppController, DocStats } from '../app/controller';
import type { AppliedStyle } from '../styles/apply';
import { h, icon } from './dom';

type SaveEntry = { state: 'saving' | 'saved' | 'error'; message?: string };

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function mountStatusbar(container: HTMLElement, app: AppController): void {
  /** Last save event per tab. Pruned when tabs close. */
  const saves = new Map<string, SaveEntry>();
  let stats: DocStats = app.stats();

  const saveEl = h('span', { class: 'sp-status-save' });
  const wordsEl = h('span', { class: 'sp-status-item' });
  const charactersEl = h('span', { class: 'sp-status-item' });
  const zoomBtn = h('button', {
    class: 'sp-status-btn sp-status-zoom',
    type: 'button',
    title: 'Reset zoom to 100%',
    onclick: () => void app.updateSettings({ zoom: 1 }),
  });
  const styleNameEl = h('span', { class: 'sp-status-style-name' });
  const styleBtn = h(
    'button',
    {
      class: 'sp-status-btn sp-status-style',
      type: 'button',
      title: 'Change style',
      onclick: () => app.ui.openSettings('style'),
    },
    icon('palette', '1em'),
    styleNameEl,
  );

  container.replaceChildren(
    h(
      'div',
      { class: 'sp-statusbar' },
      h(
        'div',
        { class: 'sp-status-group sp-status-left' },
        h('span', { class: 'sp-status-item sp-status-encrypted', title: 'Documents are encrypted on disk.' }, icon('lock', '1em'), 'Encrypted'),
        saveEl,
      ),
      h('div', { class: 'sp-status-group sp-status-right' }, wordsEl, charactersEl, zoomBtn, styleBtn),
    ),
  );

  const updateSave = (): void => {
    const tab = app.activeTab;
    if (!tab) {
      saveEl.hidden = true;
      return;
    }
    saveEl.hidden = false;
    const save = saves.get(tab.id);
    let text: string;
    let tip = '';
    let failed = false;
    if (tab.path === null) {
      text = 'Not saved to a file';
      tip = 'Nothing is written to disk until you save.';
    } else if (save?.state === 'saving') {
      text = 'Saving…';
    } else if (save?.state === 'error') {
      text = 'Save failed';
      tip = save.message ?? '';
      failed = true;
    } else if (tab.dirty) {
      text = 'Unsaved changes';
    } else {
      text = 'Saved';
    }
    saveEl.textContent = text;
    saveEl.title = tip;
    saveEl.classList.toggle('is-error', failed);
  };

  const updateCounts = (): void => {
    wordsEl.textContent = plural(stats.words, 'word', 'words');
    charactersEl.textContent = plural(stats.characters, 'character', 'characters');
    charactersEl.title = `${stats.charactersNoSpaces.toLocaleString()} without spaces`;
  };

  const updateZoom = (): void => {
    const zoom = app.settings.zoom;
    zoomBtn.hidden = Math.abs(zoom - 1) < 0.001;
    zoomBtn.textContent = `${Math.round(zoom * 100)}%`;
  };

  // `style` is undefined until the controller has started; the style event covers that.
  const updateStyle = (style: AppliedStyle | undefined): void => {
    styleNameEl.textContent = style?.def.name ?? '';
  };

  app.on('stats', (next) => {
    stats = next;
    updateCounts();
  });
  app.on('settings', () => updateZoom());
  app.on('style', (style) => updateStyle(style));
  app.on('tabs', () => {
    const ids = new Set(app.tabs.map((t) => t.id));
    for (const id of [...saves.keys()]) if (!ids.has(id)) saves.delete(id);
    updateSave();
  });
  app.on('activeTab', () => updateSave());
  app.on('saveState', (event) => {
    saves.set(event.tabId, { state: event.state, message: event.message });
    updateSave();
  });

  updateCounts();
  updateZoom();
  updateStyle(app.style);
  updateSave();
}
