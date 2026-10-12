/**
 * Inventory of the app data folder: lists exactly which files exist while the
 * app is running and after it exits, and fails if anything outside the
 * documented set appears. This keeps the README's "what is on disk" section
 * honest when Electron is upgraded.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Launched, PASSPHRASE, type Sandbox, closeApp, launch, listFiles, makeSandbox, stubSaveDialog, waitReady } from '../e2e/helpers';

let sandbox: Sandbox;
let run: Launched | null = null;

test.beforeEach(() => {
  sandbox = makeSandbox();
  mkdirSync(sandbox.docsDir, { recursive: true });
});

test.afterEach(async () => {
  await closeApp(run?.app);
  sandbox.cleanup();
});

/** Everything allowed at the top level of the data folder. */
const TOP = ['keystore.bin', 'settings.json', 'session.bin', 'chromium', 'lockfile'];

test('the data folder holds only the documented files', async () => {
  run = await launch(sandbox);
  const { page, app } = run;
  await page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  await closeApp(app);

  run = await launch(sandbox);
  await waitReady(run.page);
  const doc = run.page.locator('.sp-editor-pane.is-active .sp-document');
  await doc.click();
  await run.page.keyboard.type('inventory run');
  await stubSaveDialog(run.app, join(sandbox.docsDir, 'inv.slpg'));
  await run.page.keyboard.press('Control+s');
  await run.page.waitForTimeout(2500);

  const describe = (): string[] => listFiles(sandbox.dataDir).map((f) => `${f.slice(sandbox.dataDir.length + 1)} (${statSync(f).size} B)`);
  const scratch = join(sandbox.dataDir, 'chromium');

  const running = readdirSync(sandbox.dataDir).sort();
  console.log('DATA FOLDER WHILE RUNNING:\n  ' + describe().join('\n  '));
  test.info().annotations.push({ type: 'while running', description: describe().join('; ') });
  // top level: only Sealpage's own files and the Chromium scratch folder, even while running
  expect(running.filter((n) => !TOP.includes(n)), 'unexpected entries at the top of the data folder').toEqual([]);
  for (const name of ['keystore.bin', 'settings.json', 'chromium']) expect(running).toContain(name);
  expect(readdirSync(scratch)).toContain('Local State');
  // nothing Chromium keeps there is large enough to be a cache of content
  for (const f of listFiles(scratch)) expect(statSync(f).size, `${f} is unexpectedly large`).toBeLessThan(512 * 1024);

  await closeApp(run.app);
  run = null;
  await new Promise((r) => setTimeout(r, 1000));
  console.log('DATA FOLDER AFTER EXIT:\n  ' + describe().join('\n  '));
  test.info().annotations.push({ type: 'after exit', description: describe().join('; ') });
  expect(readdirSync(sandbox.dataDir).filter((n) => !TOP.includes(n)), 'entries left at the top level after exit').toEqual([]);

  // The next start-up must delete everything in the data folder that is not on
  // the allow-lists, before Chromium opens anything. Plant some stand-ins for
  // "things a previous run left behind" and check they are gone.
  // (Creation times cannot be used for this: NTFS keeps the old creation time
  // when a file is deleted and recreated under the same name within seconds.)
  const planted = [join(scratch, 'Leftover Cache'), join(scratch, 'leftover.db'), join(sandbox.dataDir, 'leftover-top.tmp'), join(sandbox.dataDir, 'Crashpad')];
  mkdirSync(planted[0]!, { recursive: true });
  writeFileSync(join(planted[0]!, 'data_0'), 'stale');
  writeFileSync(planted[1]!, 'stale');
  writeFileSync(planted[2]!, 'stale');
  mkdirSync(join(planted[3]!, 'reports'), { recursive: true });
  writeFileSync(join(planted[3]!, 'reports', 'old.dmp'), 'stale');

  run = await launch(sandbox);
  await waitReady(run.page);
  // the stored key survived the purge (no setup screen) and the document reopens
  await expect(run.page.locator('.sp-setup-screen')).toHaveCount(0);
  await expect(run.page.locator('.sp-editor-pane.is-active .sp-document')).toContainText('inventory run');
  for (const p of planted) expect(existsSync(p), `${p} survived the start-up purge`).toBe(false);
  expect(readdirSync(sandbox.dataDir).filter((n) => !TOP.includes(n))).toEqual([]);
});
