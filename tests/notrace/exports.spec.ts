/**
 * PDF export and printing must render from memory. While a PDF is exported,
 * every file created or changed in the temp folders and the app data folder
 * is recorded; the only new document-like file allowed is the PDF at the
 * location the user chose.
 */
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { type FSWatcher, existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Launched, PASSPHRASE, type Sandbox, closeApp, findPlaintext, launch, makeSandbox, waitReady } from '../e2e/helpers';

let sandbox: Sandbox;
let run: Launched | null = null;

test.beforeEach(async () => {
  sandbox = makeSandbox();
  mkdirSync(sandbox.docsDir, { recursive: true });
  const first = await launch(sandbox);
  await first.page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  await closeApp(first.app);
});

test.afterEach(async () => {
  await closeApp(run?.app);
  run = null;
  sandbox.cleanup();
});

test('exporting a PDF writes exactly one file: the PDF the user asked for', async () => {
  const secret = `ZQPDF${randomBytes(9).toString('hex').toUpperCase()}QZ`;
  run = await launch(sandbox);
  const { page, app } = run;
  await waitReady(page);
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await doc.click();
  await page.keyboard.type(`Confidential ${secret}`);

  const outDir = join(sandbox.docsDir, 'out');
  mkdirSync(outDir);
  const target = join(outDir, 'export.pdf');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
  }, target);

  // watch every place an intermediate file could plausibly appear
  const roots = [...new Set([tmpdir(), process.env.TEMP, process.env.TMP, sandbox.dataDir].filter((d): d is string => !!d && existsSync(d)))];
  const touched = new Set<string>();
  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    try {
      watchers.push(
        watch(root, { recursive: true }, (_event, name) => {
          if (typeof name === 'string') touched.add(join(root, name));
        }),
      );
    } catch {
      /* folder cannot be watched */
    }
  }

  await page.keyboard.press('Control+Shift+e');
  const warn = page.locator('.sp-dialog').filter({ hasText: 'Unencrypted export' });
  await expect(warn).toBeVisible();
  // nothing may be rendered or written before the user confirms
  expect(existsSync(target)).toBe(false);
  await warn.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(1500);
  for (const w of watchers) w.close();

  expect(readFileSync(target).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // files touched during the export, minus the export itself and the test's own folders
  const sandboxRoot = join(sandbox.dataDir, '..');
  const suspicious = [...touched].filter((p) => {
    const lower = p.toLowerCase();
    if (lower.startsWith(outDir.toLowerCase())) return false;
    if (lower.startsWith(sandboxRoot.toLowerCase()) && !lower.startsWith(sandbox.dataDir.toLowerCase())) return false;
    return /\.(pdf|ps|xps|oxps|spl|shd|emf|prn|html?|svg|png|jpe?g|txt|md)$/i.test(p) || /print|spool|pdf/i.test(p.slice(p.lastIndexOf('\\') + 1));
  });
  expect(suspicious, 'intermediate files created while exporting').toEqual([]);

  // and the text itself appears nowhere but (possibly, inside) the chosen PDF
  const hits = findPlaintext([sandbox.dataDir], [secret]);
  expect(hits).toEqual([]);
  const tempHits: string[] = [];
  for (const p of touched) {
    if (p.toLowerCase().startsWith(outDir.toLowerCase())) continue;
    try {
      const data = readFileSync(p);
      if (data.includes(Buffer.from(secret, 'utf8')) || data.includes(Buffer.from(secret, 'utf16le'))) tempHits.push(p);
    } catch {
      /* a folder, or already deleted */
    }
  }
  expect(tempHits).toEqual([]);
  test.info().annotations.push({ type: 'paths touched during export', description: String(touched.size) });
});
