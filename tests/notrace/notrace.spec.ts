/**
 * No-trace check.
 *
 * Runs the real app, edits and saves documents, force-kills it (no chance to
 * clean up), then scans the app data folder, the documents folder, the system
 * temp folders and the Windows crash-dump folder for any trace of the text
 * that was typed. Only the encrypted .slpg files may exist, and they must not
 * contain it either.
 *
 * The marker strings are generated at run time, so they cannot appear in any
 * file on disk except through the application itself.
 */
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Launched, PASSPHRASE, type Sandbox, findPlaintext, forceKill, launch, listFiles, makeSandbox, stubSaveDialog, waitReady } from '../e2e/helpers';

const MAGIC = Buffer.from([0x89, 0x53, 0x4c, 0x50, 0x47, 0x0d, 0x0a, 0x1a]);

let sandbox: Sandbox;
let run: Launched | null = null;

function marker(label: string): string {
  return `ZQ${label}${randomBytes(9).toString('hex').toUpperCase()}QZ`;
}

/** Files under `dir` changed since `since`, at most `maxBytes` large (keeps the temp scan fast and relevant). */
function recentFiles(dir: string, since: number, maxBytes = 64 * 1024 * 1024): string[] {
  return listFiles(dir).filter((f) => {
    try {
      const st = statSync(f);
      return st.mtimeMs >= since - 2000 && st.size <= maxBytes;
    } catch {
      return false;
    }
  });
}

function scanFiles(files: string[], needles: string[]): { file: string; needle: string }[] {
  const hits: { file: string; needle: string }[] = [];
  for (const file of files) {
    let data: Buffer;
    try {
      data = readFileSync(file);
    } catch {
      continue;
    }
    for (const needle of needles) {
      if (data.includes(Buffer.from(needle, 'utf8')) || data.includes(Buffer.from(needle, 'utf16le'))) hits.push({ file, needle });
    }
  }
  return hits;
}

/** Folders outside the sandbox where an application could leave traces. */
function systemTraceDirs(): string[] {
  const dirs = new Set<string>([tmpdir()]);
  for (const v of ['TEMP', 'TMP']) if (process.env[v]) dirs.add(process.env[v]!);
  if (process.env.LOCALAPPDATA) {
    dirs.add(join(process.env.LOCALAPPDATA, 'Temp'));
    dirs.add(join(process.env.LOCALAPPDATA, 'CrashDumps'));
    dirs.add(join(process.env.LOCALAPPDATA, 'Sealpage'));
    dirs.add(join(process.env.LOCALAPPDATA, 'sealpage'));
  }
  if (process.env.APPDATA) {
    // the real profile's data folder must not be touched when another one is configured
    dirs.add(join(process.env.APPDATA, 'Sealpage'));
    dirs.add(join(process.env.APPDATA, 'sealpage'));
    dirs.add(join(process.env.APPDATA, 'Electron'));
  }
  return [...dirs].filter((d) => existsSync(d));
}

test.beforeEach(async () => {
  sandbox = makeSandbox();
  mkdirSync(sandbox.docsDir, { recursive: true });
  // create the key once, so later launches go straight to the editor
  const first = await launch(sandbox);
  expect(await first.page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE)).toEqual({ ok: true });
  await first.app.close();
});

test.afterEach(async () => {
  if (run) {
    forceKill(run.app);
    await run.app.close().catch(() => undefined);
    run = null;
  }
  sandbox.cleanup();
});

test('after a forced kill, no plaintext exists anywhere on disk', async () => {
  const started = Date.now();
  const saved = marker('SAVED');
  const autosaved = marker('AUTOSAVED');
  const unsaved = marker('UNSAVED');
  const neverSaved = marker('NEVERSAVED');
  const searched = marker('SEARCHED');
  const copied = marker('GRAPHCELL');
  const needles = [saved, autosaved, unsaved, neverSaved, searched, copied];

  run = await launch(sandbox);
  const { page, app } = run;
  await waitReady(page);
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');

  // document 1: saved explicitly, then autosaved, then edited again without time to autosave
  await doc.click();
  await page.keyboard.press('Control+Alt+1');
  await page.keyboard.type(`Title ${saved}`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Unicode body: секрет 秘密 🔒 ');
  const file1 = join(sandbox.docsDir, 'first.slpg');
  await stubSaveDialog(app, file1);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file1)).toBe(true);
  const v1 = readFileSync(file1);

  await page.keyboard.type(autosaved);
  await expect.poll(() => readFileSync(file1).equals(v1), { timeout: 10_000 }).toBe(false); // autosave happened

  // a graph whose data contains a marker
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Alt+g');
  const graphDialog = page.locator('.sp-graph-editor');
  await expect(graphDialog).toBeVisible();
  const titleField = graphDialog.locator('input[type="text"]').first();
  await titleField.fill(copied);
  await graphDialog.getByRole('button', { name: 'Apply' }).click();
  await expect(graphDialog).toHaveCount(0);

  // search for something (search text must not be persisted either)
  await page.keyboard.press('Control+f');
  const find = page.locator('#findbar input').first();
  await expect(find).toBeVisible();
  await find.fill(searched);
  await page.keyboard.press('Escape');

  // document 2: a second file in the same folder
  await page.keyboard.press('Control+n');
  const doc2 = page.locator('.sp-editor-pane.is-active .sp-document');
  await doc2.click();
  await page.keyboard.type(`Second document ${saved}`);
  const file2 = join(sandbox.docsDir, 'second.slpg');
  await stubSaveDialog(app, file2);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file2)).toBe(true);

  // document 3: never saved to a file at all
  await page.keyboard.press('Control+n');
  await page.locator('.sp-editor-pane.is-active .sp-document').click();
  await page.keyboard.type(`Scratch ${neverSaved}`);

  // back to document 2: type and kill immediately, before autosave can run
  await page.keyboard.press('Control+Shift+Tab');
  await page.locator('.sp-editor-pane.is-active .sp-document').click();
  await page.keyboard.type(unsaved);

  // the text really is in the app right now
  await expect(page.locator('.sp-editor-pane.is-active .sp-document')).toContainText(unsaved);

  // --- pull the plug -------------------------------------------------------
  forceKill(run.app);
  await run.app.close().catch(() => undefined);
  run = null;
  await new Promise((r) => setTimeout(r, 1500));

  // --- scan ----------------------------------------------------------------
  const sandboxHits = findPlaintext([sandbox.dataDir, sandbox.docsDir], needles);
  expect(sandboxHits, `plaintext found: ${JSON.stringify(sandboxHits)}`).toEqual([]);

  const systemFiles = systemTraceDirs().flatMap((d) => recentFiles(d, started));
  const systemHits = scanFiles(systemFiles, needles);
  expect(systemHits, `plaintext found outside the sandbox: ${JSON.stringify(systemHits)}`).toEqual([]);

  // the documents folder holds only encrypted containers (plus, at worst, ciphertext temp files)
  for (const f of listFiles(sandbox.docsDir)) {
    const data = readFileSync(f);
    expect(data.subarray(0, 8).equals(MAGIC), `${f} is not an encrypted container`).toBe(true);
  }
  expect(readdirSync(sandbox.docsDir).filter((n) => n.endsWith('.slpg')).sort()).toEqual(['first.slpg', 'second.slpg']);

  // the data folder contains nothing that looks like a document, a log or a crash dump
  const dataFiles = listFiles(sandbox.dataDir).map((f) => f.slice(sandbox.dataDir.length + 1));
  // top level: only Sealpage's own files plus Chromium's scratch folder
  expect(readdirSync(sandbox.dataDir).filter((n) => !['keystore.bin', 'settings.json', 'session.bin', 'chromium', 'lockfile'].includes(n))).toEqual([]);
  // no crash dumps or document-like files anywhere (Chromium's storage engines keep small binary journals named *.log / LOG)
  expect(dataFiles.filter((f) => /\.(dmp|txt|md|html?|pdf|bak|old|slpg)$/i.test(f)), 'unexpected file types in the data folder').toEqual([]);
  expect(dataFiles).toContain('keystore.bin');

  // --- restart: saved work is there, unsaved work is gone, leftovers are purged -----
  run = await launch(sandbox);
  await waitReady(run.page);
  const text1 = await run.page.evaluate((p) => window.sealpage.readDocument(p), file1);
  expect(text1.ok && text1.value.includes(saved)).toBe(true);
  expect(text1.ok && text1.value.includes(autosaved)).toBe(true);
  const text2 = await run.page.evaluate((p) => window.sealpage.readDocument(p), file2);
  expect(text2.ok && text2.value.includes(saved)).toBe(true);
  // typed right before the kill and never saved: gone for good, by design
  expect(text2.ok && text2.value.includes(unsaved)).toBe(false);
  await expect(run.page.locator('#app')).not.toContainText(neverSaved);

  // no temp files survive the next launch
  await run.page.evaluate((d) => window.sealpage.listFolder(d), sandbox.docsDir);
  await expect.poll(() => readdirSync(sandbox.docsDir).filter((n) => n.endsWith('.sealpage-tmp'))).toEqual([]);

  await run.app.close();
  run = null;

  // after a normal close: still nothing, and the data folder is down to its allow-list (+ Chromium's own state)
  const finalHits = findPlaintext([sandbox.dataDir, sandbox.docsDir], needles);
  expect(finalHits).toEqual([]);
  const top = readdirSync(sandbox.dataDir).sort();
  for (const required of ['keystore.bin', 'settings.json', 'chromium']) expect(top).toContain(required);
  expect(readdirSync(join(sandbox.dataDir, 'chromium'))).toContain('Local State');
  test.info().annotations.push({ type: 'data folder after clean exit', description: top.join(', ') });
});

test('a kill in the middle of saving never leaves a damaged or readable file', async () => {
  const body = marker('BIGDOC');
  const file = join(sandbox.docsDir, 'big.slpg');
  const big = `~sealpage 1\n\n${(body + ' lorem ipsum dolor sit amet ').repeat(40000)}\n`; // ~1.8 MB

  for (let round = 0; round < 3; round++) {
    run = await launch(sandbox);
    await waitReady(run.page);
    if (round === 0) {
      expect(await run.page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [file, big])).toEqual({ ok: true });
    }
    // hammer the file with saves and kill at an arbitrary moment
    void run.page
      .evaluate(
        async ([p, m]) => {
          for (let i = 0; i < 400; i++) await window.sealpage.writeDocument(p!, `${m}\nrevision ${i}\n`);
        },
        [file, big],
      )
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150 + round * 170));
    forceKill(run.app);
    await run.app.close().catch(() => undefined);
    run = null;
    await new Promise((r) => setTimeout(r, 800));

    // whatever is on disk is ciphertext only
    expect(findPlaintext([sandbox.docsDir, sandbox.dataDir], [body])).toEqual([]);
    for (const f of listFiles(sandbox.docsDir)) {
      const head = readFileSync(f).subarray(0, 8);
      // a temp file may be cut short, but never plaintext; a complete one starts with the magic
      if (f.endsWith('.slpg')) expect(head.equals(MAGIC)).toBe(true);
    }

    // and the document itself is a complete, valid version (old or new, never half)
    run = await launch(sandbox);
    await waitReady(run.page);
    const res = await run.page.evaluate((p) => window.sealpage.readDocument(p), file);
    expect(res.ok, 'the document must still decrypt after a kill during save').toBe(true);
    if (res.ok) {
      expect(res.value.startsWith('~sealpage 1\n')).toBe(true);
      expect(res.value.includes(body)).toBe(true);
    }
    // stale temp files are removed once the folder is used again
    await expect.poll(() => readdirSync(sandbox.docsDir).filter((n) => n.endsWith('.sealpage-tmp'))).toEqual([]);
    await run.app.close();
    run = null;
  }
});
