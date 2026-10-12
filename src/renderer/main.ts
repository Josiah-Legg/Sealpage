/**
 * Renderer entry point: applies the style, runs first-launch key setup if
 * needed, then builds the application shell.
 */
import './css/base.css';
import './css/editor.css';
import './css/fx.css';
import './css/print.css';

import { CONTEXT_MENU } from './app/commands';
import { AppController } from './app/controller';
import { installKeybindings } from './app/keybindings';
import { applyStyle } from './styles/apply';
import { getStyle } from './styles/registry';
import { buildPopupItems } from './ui/commandMenu';
import { showMenu } from './ui/dialogs';
import { icon } from './ui/dom';
import { mountFindReplace } from './ui/findReplace';
import { mountGraphEditor } from './ui/graphEditor';
import { mountMenubar } from './ui/menubar';
import { mountSettingsDialog } from './ui/settingsDialog';
import { showSetupScreen } from './ui/setupScreen';
import { mountShortcutsDialog } from './ui/shortcutsDialog';
import { mountSidebar } from './ui/sidebar';
import { mountStatusbar } from './ui/statusbar';
import { mountTabs } from './ui/tabs';
import { mountToolbar } from './ui/toolbar';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

function installSidebarResizer(app: AppController): void {
  const handle = el('sidebar-resizer');
  handle.addEventListener('mousedown', (down) => {
    down.preventDefault();
    handle.classList.add('is-dragging');
    let width = app.settings.sidebarWidth;
    const move = (event: MouseEvent): void => {
      width = Math.min(600, Math.max(160, event.clientX));
      document.documentElement.style.setProperty('--sp-layout-sidebar-width', `${width}px`);
    };
    const up = (): void => {
      handle.classList.remove('is-dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      void app.updateSettings({ sidebarWidth: Math.round(width) });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

async function start(): Promise<void> {
  const api = window.sealpage;

  // Style first, so even the setup screen is themed.
  const settings = await api.getSettings();
  const def = getStyle(settings.styleId);
  const applied = applyStyle(def, settings.styleOptions[def.id]);
  void api.setChrome({ color: applied.tokens.chrome.titleBarColor, symbolColor: applied.tokens.chrome.titleBarSymbolColor, height: el('titlebar').offsetHeight || 36 });
  el('titlebar-brand').appendChild(icon('lock'));

  // Never let a dropped file or link navigate the window.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  const keyState = await api.keyState();
  if (keyState !== 'ready') {
    document.documentElement.classList.add('sp-setup');
    await showSetupScreen(el('overlay-root'), api, keyState);
    document.documentElement.classList.remove('sp-setup');
  }

  const app = new AppController(api, el('editor-host'), settings, applied);
  installKeybindings(app);
  mountMenubar(el('menubar'), app);
  mountToolbar(el('toolbar'), app);
  mountSidebar(el('sidebar'), app);
  mountTabs(el('tabbar'), app);
  mountStatusbar(el('statusbar'), app);
  mountFindReplace(el('findbar'), app);
  mountSettingsDialog(app);
  mountShortcutsDialog(app);
  mountGraphEditor(app);
  installSidebarResizer(app);

  // Right-click menu inside the document.
  el('editor-host').addEventListener('contextmenu', (event) => {
    if (!(event.target as HTMLElement).closest('.sp-document')) return;
    event.preventDefault();
    const items = buildPopupItems(CONTEXT_MENU, app);
    if (items.length > 0) showMenu(items, { x: event.clientX, y: event.clientY });
  });

  await app.init();
  document.documentElement.classList.add('sp-ready');
}

void start();
