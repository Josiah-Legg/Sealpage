/**
 * Sealpage main process: lifecycle, the single window, no-trace configuration
 * and wiring of the key store and IPC handlers.
 */
import { BrowserWindow, Menu, app, dialog, safeStorage, session } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { EVENT_CHANNELS, FILE_EXTENSION, IPC_PREFIX } from '../shared/ipc';
import { Keystore, type SecretProtector } from './crypto/keystore';
import { cleanStaleTempFiles } from './fs/atomic';
import { registerIpc } from './ipc';
import {
  KEYSTORE_FILE,
  MEMORY_PARTITION,
  SESSION_FILE,
  SETTINGS_FILE,
  applyCommandLineSwitches,
  configureDataDir,
  hardenSession,
  purgeDataDir,
} from './notrace';
import { SettingsStore } from './settingsStore';

/** OS secret protection through Electron safeStorage (DPAPI on Windows). */
const protector: SecretProtector = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  // safeStorage only wraps strings, so the binary blob travels as Base64.
  protect: (plain) => safeStorage.encryptString(plain.toString('base64')),
  unprotect: (blob) => Buffer.from(safeStorage.decryptString(blob), 'base64'),
};

/** .slpg files named on a command line (double-click, "Open with", second instance). */
function documentArgs(argv: readonly string[], cwd: string): string[] {
  const out: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || extname(arg).toLowerCase() !== FILE_EXTENSION) continue;
    const p = resolve(cwd, arg);
    try {
      if (existsSync(p) && statSync(p).isFile()) out.push(p);
    } catch {
      /* ignore unreadable arguments */
    }
  }
  return out;
}

async function main(dataDir: string): Promise<void> {
  let win: BrowserWindow | null = null;
  let rendererReady = false;
  let closeAllowed = false;
  let pendingPaths: string[] = documentArgs(process.argv, process.cwd());
  let boundsTimer: NodeJS.Timeout | null = null;

  const keystore = new Keystore(join(dataDir, KEYSTORE_FILE), protector);
  const store = new SettingsStore(join(dataDir, SETTINGS_FILE), join(dataDir, SESSION_FILE));

  const deliverPaths = (paths: string[]): void => {
    if (paths.length === 0) return;
    if (win && rendererReady && !win.isDestroyed()) win.webContents.send(IPC_PREFIX + EVENT_CHANNELS.onOpenPaths, paths);
    else pendingPaths.push(...paths);
  };

  app.on('second-instance', (_event, argv, cwd) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    deliverPaths(documentArgs(argv, cwd));
  });

  // Never let any web content open windows, navigate away or attach webviews.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    keystore.lock(); // zero the master key
    try {
      app.clearRecentDocuments();
    } catch {
      /* not available */
    }
    purgeDataDir(dataDir); // best effort; repeated at next launch before anything is read
  });

  await app.whenReady();

  app.setAppUserModelId('com.sealpage.app');
  Menu.setApplicationMenu(null); // the menu bar is drawn by the renderer so styles can theme it
  try {
    app.clearRecentDocuments();
    app.setJumpList([]); // no "Recent" category on the taskbar icon
  } catch {
    /* jump lists unavailable */
  }

  const settings = await store.load();
  await keystore.load();
  await cleanStaleTempFiles(dataDir);
  for (const p of pendingPaths) void cleanStaleTempFiles(dirname(p));

  const ses = session.fromPartition(MEMORY_PARTITION, { cache: false });
  hardenSession(ses);
  hardenSession(session.defaultSession);

  const b = settings.window;
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    ...(b.x !== null && b.y !== null ? { x: b.x, y: b.y } : {}),
    minWidth: 640,
    minHeight: 420,
    show: false,
    backgroundColor: '#151515',
    title: 'Sealpage',
    icon: join(__dirname, '..', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1917', symbolColor: '#d9d3ca', height: 36 },
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false, // a custom dictionary would store typed words on disk
      devTools: !app.isPackaged,
      enableWebSQL: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      backgroundThrottling: true,
    },
  });
  if (b.maximized) win.maximize();

  registerIpc({
    window: () => win,
    keystore,
    store,
    takePendingPaths: () => {
      const p = pendingPaths;
      pendingPaths = [];
      return p;
    },
    allowClose: () => {
      closeAllowed = true;
      win?.close();
    },
    markRendererReady: () => {
      rendererReady = true;
    },
  });

  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const maximized = win.isMaximized();
      const r = maximized ? win.getNormalBounds() : win.getBounds();
      void store.update({ window: { width: r.width, height: r.height, x: r.x, y: r.y, maximized } });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);

  win.once('ready-to-show', () => win?.show());

  // Closing: give the renderer the chance to save or ask about unsaved work.
  win.on('close', (event) => {
    if (closeAllowed || !rendererReady || !win || win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send(IPC_PREFIX + EVENT_CHANNELS.onCloseRequested);
  });
  win.webContents.on('render-process-gone', () => {
    rendererReady = false;
  });
  win.on('closed', () => {
    win = null;
  });

  await win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

// --- start-up ----------------------------------------------------------------
// Everything that decides what may touch the disk happens before 'ready'.
applyCommandLineSwitches();
const dataDir = configureDataDir();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Remove anything Chromium left behind last time, before it opens any file.
  purgeDataDir(dataDir);
  main(dataDir).catch(() => {
    // No details: an error message could quote a path or other user data.
    dialog.showErrorBox('Sealpage', 'Sealpage could not start.');
    app.exit(1);
  });
}
