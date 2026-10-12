import { type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..', '..');
export const PASSPHRASE = 'e2e test passphrase 12345';

export interface Sandbox {
  /** Isolated app data folder (keystore, settings…). */
  dataDir: string;
  /** Folder for the test's documents. */
  docsDir: string;
  cleanup(): void;
}

export function makeSandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), 'sealpage-e2e-'));
  const dataDir = join(base, 'data');
  const docsDir = join(base, 'docs');
  return {
    dataDir,
    docsDir,
    cleanup: () => {
      for (let i = 0; i < 5; i++) {
        try {
          rmSync(base, { recursive: true, force: true });
          return;
        } catch {
          /* a just-killed process may still hold a handle for a moment */
        }
      }
    },
  };
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/** Start the built app against an isolated data folder. Extra args are passed on the command line (e.g. a file to open). */
export async function launch(sandbox: Sandbox, extraArgs: string[] = []): Promise<Launched> {
  const app = await electron.launch({
    args: [ROOT, ...extraArgs],
    cwd: ROOT,
    env: { ...process.env, SEALPAGE_DATA_DIR: sandbox.dataDir, ELECTRON_ENABLE_LOGGING: '0' } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** Kill the whole process tree immediately (no clean-up), like a crash or a power cut. */
export function forceKill(app: ElectronApplication): void {
  const pid = app.process().pid;
  if (pid === undefined) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
}

/**
 * Close the app the normal way; if it does not exit (for example because a
 * failed test left an "unsaved document" question open), kill it.
 */
export async function closeApp(app: ElectronApplication | undefined | null): Promise<void> {
  if (!app) return;
  let done = false;
  await Promise.race([
    app.close().then(
      () => (done = true),
      () => (done = true),
    ),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  if (!done) forceKill(app);
}

/** Make the next native "Save" dialog return `path` (the dialog itself cannot be driven by tests). */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
  }, path);
}

/** Make the next native "Open" dialog return `paths`. */
export async function stubOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as unknown as typeof dialog.showOpenDialog;
  }, paths);
}

/** Complete the first-launch setup screen through the real UI. */
export async function completeSetup(page: Page, passphrase = PASSPHRASE): Promise<void> {
  const screen = page.locator('.sp-setup-screen');
  await screen.waitFor({ state: 'visible' });
  const fields = screen.locator('input[type="password"]');
  await fields.nth(0).fill(passphrase);
  await fields.nth(1).fill(passphrase);
  await screen.locator('input[type="checkbox"]').check();
  await screen.getByRole('button', { name: 'Create key' }).click();
  await screen.waitFor({ state: 'detached', timeout: 60_000 });
  await page.locator('html.sp-ready').waitFor({ timeout: 30_000 });
}

/** Wait for the main UI (no setup needed because a key already exists). */
export async function waitReady(page: Page): Promise<void> {
  await page.locator('html.sp-ready').waitFor({ timeout: 30_000 });
}

/** Every file below `dir`, recursively. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/**
 * Search every file under the given folders for each needle, as UTF-8 and as
 * UTF-16LE (how Windows and Chromium often store text). Returns the hits.
 */
export function findPlaintext(dirs: string[], needles: string[]): { file: string; needle: string; encoding: string }[] {
  const hits: { file: string; needle: string; encoding: string }[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      let data: Buffer;
      try {
        data = readFileSync(file);
      } catch {
        continue; // locked by another process: reported separately by the caller if needed
      }
      for (const needle of needles) {
        if (data.includes(Buffer.from(needle, 'utf8'))) hits.push({ file, needle, encoding: 'utf8' });
        if (data.includes(Buffer.from(needle, 'utf16le'))) hits.push({ file, needle, encoding: 'utf16le' });
      }
    }
  }
  return hits;
}
