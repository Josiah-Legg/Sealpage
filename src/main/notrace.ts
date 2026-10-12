/**
 * No-trace configuration.
 *
 * Goal: after Sealpage exits, however it exits, the only things on disk are
 * the user's encrypted .slpg files plus the minimum persistent app state:
 *
 *     keystore.bin          master key, wrapped by the OS (DPAPI via safeStorage)
 *     settings.json         non-sensitive preferences
 *     session.bin           open folder / tabs, encrypted with the master key
 *     chromium/Local State  Chromium's file holding the DPAPI-wrapped safeStorage key
 *
 * Document plaintext only ever lives in process memory. On top of that, this
 * module keeps Chromium itself from persisting anything: the window uses an
 * in-memory session partition, disk caches and crash reporting are switched
 * off, and on every launch anything Chromium may still have written to the
 * data folder during the previous run is deleted before it can be reused.
 */
import { app, type Session } from 'electron';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** In-memory partition name. Without a "persist:" prefix Chromium keeps it in RAM only. */
export const MEMORY_PARTITION = 'sealpage-memory';

export const KEYSTORE_FILE = 'keystore.bin';
export const SETTINGS_FILE = 'settings.json';
export const SESSION_FILE = 'session.bin';
/** Chromium's own scratch folder inside the data folder. Deleted on every start and exit. */
export const CHROMIUM_SCRATCH = 'chromium';

const LOCKS = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];

/** The only entries allowed to survive in the data folder between runs. */
const KEEP_TOP = new Set([KEYSTORE_FILE, SETTINGS_FILE, SESSION_FILE, CHROMIUM_SCRATCH, ...LOCKS]);

/**
 * The only entries allowed to survive inside the Chromium scratch folder.
 * "Local State" MUST stay: it holds the DPAPI-protected key that safeStorage
 * uses to wrap keystore.bin. Deleting it would lock the user out of the
 * stored key (they would then need the passphrase and a file to restore it).
 */
const KEEP_SCRATCH = new Set(['Local State', ...LOCKS]);

/** Chromium switches that minimise what is written to disk. Must be set before app 'ready'. */
export function applyCommandLineSwitches(): void {
  const cl = app.commandLine;
  cl.appendSwitch('disable-http-cache');
  cl.appendSwitch('disk-cache-size', '1');
  cl.appendSwitch('media-cache-size', '1');
  cl.appendSwitch('disable-gpu-shader-disk-cache');
  cl.appendSwitch('disable-gpu-program-cache');
  cl.appendSwitch('disable-breakpad');
  cl.appendSwitch('disable-crash-reporter');
  cl.appendSwitch('disable-logging');
  cl.appendSwitch('disable-background-networking');
  cl.appendSwitch('disable-component-update');
  cl.appendSwitch('disable-domain-reliability');
  cl.appendSwitch('disable-sync');
  cl.appendSwitch('disable-client-side-phishing-detection');
  cl.appendSwitch('no-pings');
  cl.appendSwitch('no-first-run');
  cl.appendSwitch('disable-speech-api');
  cl.appendSwitch('disable-print-preview');
  cl.appendSwitch(
    'disable-features',
    [
      'Translate',
      'MediaRouter',
      'OptimizationHints',
      'AutofillServerCommunication',
      'CertificateTransparencyComponentUpdater',
      'SpellcheckServiceMultilingual',
      'UseOsCryptAsyncForCookieEncryption',
      'WinUseBrowserSpellChecker',
      'HardwareMediaKeyHandling',
      'GlobalMediaControls',
    ].join(','),
  );
}

/**
 * Choose the data folder. SEALPAGE_DATA_DIR overrides the default
 * (%APPDATA%\Sealpage); the automated tests use it to run in isolation.
 */
export function configureDataDir(): string {
  const override = process.env.SEALPAGE_DATA_DIR;
  if (override && override.trim() !== '') {
    const dir = resolve(override);
    mkdirSync(dir, { recursive: true });
    app.setPath('userData', dir);
  }
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  // Everything Chromium itself generates (network state, GPU cache, storage
  // back-ends...) goes into one scratch sub-folder that purgeDataDir() wipes.
  app.setPath('sessionData', join(dir, CHROMIUM_SCRATCH));
  return dir;
}

function purgeFolder(dir: string, keep: ReadonlySet<string>, removed: string[], prefix: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (keep.has(name)) continue;
    const full = join(dir, name);
    try {
      // never follow a link out of the data folder
      const st = lstatSync(full);
      rmSync(full, { recursive: st.isDirectory() && !st.isSymbolicLink(), force: true, maxRetries: 2, retryDelay: 50 });
      if (!existsSync(full)) removed.push(prefix + name);
    } catch {
      /* locked by the running browser process; it is removed on the next launch */
    }
  }
}

/**
 * Delete everything in the data folder that is not on the allow-lists. Called
 * at start-up before Chromium opens any file, and again (best effort, since
 * Chromium still holds some files) on quit. Returns the names that were removed.
 */
export function purgeDataDir(dir: string): string[] {
  const removed: string[] = [];
  purgeFolder(dir, KEEP_TOP, removed, '');
  purgeFolder(join(dir, CHROMIUM_SCRATCH), KEEP_SCRATCH, removed, CHROMIUM_SCRATCH + '/');
  return removed;
}

/** Lock a session down: no network, no permissions, no downloads, no spell-check dictionary. */
export function hardenSession(ses: Session): void {
  ses.setSpellCheckerEnabled(false);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  // The app is fully offline: refuse every network request.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_details, callback) => {
    callback({ cancel: true });
  });
}
