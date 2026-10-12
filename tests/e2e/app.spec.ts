/**
 * End-to-end: the real app, driven through its UI. Launch, first-run key
 * setup, create a document, save, close, reopen.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Launched, type Sandbox, closeApp, completeSetup, launch, makeSandbox, stubOpenDialog, stubSaveDialog, waitReady } from './helpers';

let sandbox: Sandbox;
let run: Launched;

test.beforeEach(async () => {
  sandbox = makeSandbox();
  mkdirSync(sandbox.docsDir, { recursive: true });
  run = await launch(sandbox);
});

test.afterEach(async () => {
  await closeApp(run?.app);
  sandbox.cleanup();
});

const MAGIC = Buffer.from([0x89, 0x53, 0x4c, 0x50, 0x47, 0x0d, 0x0a, 0x1a]);

test('first launch: the setup screen warns that there is no recovery and requires acknowledgement', async () => {
  const { page } = run;
  const screen = page.locator('.sp-setup-screen');
  await expect(screen).toBeVisible();
  await expect(screen).toContainText('There is no recovery');
  await expect(screen).toContainText(/permanently/i);
  const create = screen.getByRole('button', { name: 'Create key' });
  await expect(create).toBeDisabled();
  const fields = screen.locator('input[type="password"]');
  await fields.nth(0).fill('a good long passphrase');
  await fields.nth(1).fill('a good long passphrase');
  await expect(create).toBeDisabled(); // the acknowledgement is still missing
  await fields.nth(1).fill('a different passphrase!');
  await screen.locator('input[type="checkbox"]').check();
  await expect(create).toBeDisabled(); // mismatch
  await fields.nth(1).fill('a good long passphrase');
  await expect(create).toBeEnabled();
  // the editor is not reachable before a key exists
  await expect(page.locator('.sp-document')).toHaveCount(0);
});

test('create, save, close and reopen a document', async () => {
  const { page, app } = run;
  await completeSetup(page);

  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await expect(doc).toBeVisible();
  await doc.click();
  await page.keyboard.press('Control+Alt+1');
  await page.keyboard.type('Quarterly notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The first paragraph, with ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' text.');
  await expect(doc.locator('h1.sp-title')).toHaveText('Quarterly notes');
  await expect(doc.locator('p strong')).toHaveText('bold');

  const file = join(sandbox.docsDir, 'Quarterly notes.slpg');
  await stubSaveDialog(app, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);

  // what is on disk is the encrypted container, not the text
  const raw = readFileSync(file);
  expect(raw.subarray(0, 8).equals(MAGIC)).toBe(true);
  expect(raw.includes(Buffer.from('Quarterly'))).toBe(false);
  expect(raw.includes(Buffer.from('paragraph'))).toBe(false);
  await expect(page.locator('#titlebar-title')).toHaveText('Quarterly notes');

  await app.close();

  // reopen: no passphrase prompt, the previous tab comes back with its content
  run = await launch(sandbox);
  await waitReady(run.page);
  await expect(run.page.locator('.sp-setup-screen')).toHaveCount(0);
  const again = run.page.locator('.sp-editor-pane.is-active .sp-document');
  await expect(again.locator('h1.sp-title')).toHaveText('Quarterly notes');
  await expect(again.locator('p')).toContainText('The first paragraph, with bold text.');
  await expect(again.locator('p strong')).toHaveText('bold');
});

test('autosave writes the encrypted file while typing, and a file can be opened from the command line', async () => {
  const { page, app } = run;
  await completeSetup(page);
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await doc.click();
  await page.keyboard.type('first version');
  const file = join(sandbox.docsDir, 'auto.slpg');
  await stubSaveDialog(app, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  const first = readFileSync(file);

  await page.keyboard.type(' and then some more');
  // no Ctrl+S: the autosave timer (1.5 s by default) must write the new version
  await expect.poll(() => readFileSync(file).equals(first), { timeout: 10_000 }).toBe(false);
  expect(readFileSync(file).subarray(0, 8).equals(MAGIC)).toBe(true);
  await app.close();

  // turn session restore off so the only way the file opens is the command line argument
  writeFileSync(join(sandbox.dataDir, 'settings.json'), JSON.stringify({ restoreSession: false }));
  run = await launch(sandbox, [file]);
  await waitReady(run.page);
  await expect(run.page.locator('.sp-editor-pane.is-active .sp-document')).toContainText('first version and then some more');
});

test('every block type survives save and reopen through the UI', async () => {
  const { page, app } = run;
  await completeSetup(page);
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await doc.click();
  const kb = page.keyboard;

  await kb.press('Control+Alt+1');
  await kb.type('All blocks');
  await kb.press('Enter');
  await kb.press('Control+Alt+2');
  await kb.type('Section');
  await kb.press('Enter');
  await kb.type('Body with ');
  await kb.press('Control+i');
  await kb.type('italic');
  await kb.press('Control+i');
  await kb.type(' and ');
  await kb.press('Control+e');
  await kb.type('code');
  await kb.press('Control+e');
  await kb.press('Enter');

  await kb.press('Control+Shift+8'); // bullet list
  await kb.type('bullet one');
  await kb.press('Enter');
  await kb.press('Tab'); // nest
  await kb.type('nested bullet');
  await kb.press('Enter');
  await kb.press('Enter'); // back out one level
  await kb.press('Enter'); // leave the list
  await kb.press('Control+Shift+7'); // numbered
  await kb.type('number one');
  await kb.press('Enter');
  await kb.press('Enter');
  await kb.press('Control+Shift+9'); // checklist
  await kb.type('task done');
  await kb.press('Control+Enter'); // tick it
  await kb.press('Enter');
  await kb.type('task open');
  await kb.press('Enter');
  await kb.press('Enter');

  await kb.press('Control+Shift+.'); // quote
  await kb.type('A quoted line');
  await kb.press('Enter');
  await kb.press('Enter');
  await kb.press('Control+Alt+c'); // code block
  await kb.type('const a = "*not bold*";');
  await kb.press('Shift+Enter'); // leave the code block
  await kb.press('Control+Shift+-'); // divider
  await kb.press('Control+Alt+t'); // table (cursor lands in the first cell)
  await kb.type('H1');
  await kb.press('Tab');
  await kb.type('H2');
  await kb.press('Control+End');
  await kb.press('Control+Alt+g'); // graph: opens the editor dialog
  const dialog = page.locator('.sp-graph-editor');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);

  const check = async (root: typeof doc): Promise<void> => {
    await expect(root.locator('h1.sp-title')).toHaveText('All blocks');
    await expect(root.locator('h2')).toHaveText('Section');
    await expect(root.locator('p em').first()).toHaveText('italic');
    await expect(root.locator('p code').first()).toHaveText('code');
    await expect(root.locator('ul.sp-list-bullet > li').first()).toContainText('bullet one');
    await expect(root.locator('ul.sp-list-bullet ul.sp-list-bullet li')).toContainText('nested bullet');
    await expect(root.locator('ol.sp-list-numbered li')).toContainText('number one');
    await expect(root.locator('ul.sp-list-check > li[data-checked="true"]')).toContainText('task done');
    await expect(root.locator('ul.sp-list-check > li[data-checked="false"]')).toContainText('task open');
    await expect(root.locator('blockquote')).toContainText('A quoted line');
    await expect(root.locator('pre')).toContainText('const a = "*not bold*";');
    await expect(root.locator('hr')).toHaveCount(1);
    await expect(root.locator('table th').first()).toHaveText('H1');
    await expect(root.locator('table th').nth(1)).toHaveText('H2');
    await expect(root.locator('table tr')).toHaveCount(3);
    await expect(root.locator('.sp-graph-figure svg')).toHaveCount(1);
  };
  await check(doc);

  const file = join(sandbox.docsDir, 'blocks.slpg');
  await stubSaveDialog(app, file);
  await kb.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(page.locator('#titlebar-title')).toHaveText('blocks');
  await app.close();

  run = await launch(sandbox);
  await waitReady(run.page);
  await check(run.page.locator('.sp-editor-pane.is-active .sp-document'));
});

test('a file that cannot be decrypted shows a plain message and nothing else', async () => {
  const { page, app } = run;
  await completeSetup(page);
  const bad = join(sandbox.docsDir, 'foreign.slpg');
  // a structurally valid container made with some other key: header + random body
  const header = Buffer.alloc(88);
  MAGIC.copy(header, 0);
  header.writeUInt8(1, 8);
  header.writeUInt8(1, 9);
  header.writeUInt8(1, 10);
  header.writeUInt8(1, 11);
  header.writeUInt16BE(88, 12);
  header.writeUInt32BE(262144, 16);
  header.writeUInt32BE(3, 20);
  header.writeUInt32BE(4, 24);
  writeFileSync(bad, Buffer.concat([header, Buffer.alloc(64, 7)]));

  await stubOpenDialog(app, [bad]);
  await page.keyboard.press('Control+o');
  const dialog = page.locator('.sp-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.sp-dialog-message')).toHaveText('Cannot decrypt this file.');
  // no hints, no recovery offers
  await expect(dialog).not.toContainText(/password|passphrase|recover|hint|try/i);
  await dialog.getByRole('button', { name: 'OK' }).click();
  // nothing was opened
  await expect(page.locator('.sp-document')).not.toContainText(/./);
});

test('styles restyle the app instantly and are remembered, but never stored in documents', async () => {
  const { page, app } = run;
  await completeSetup(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-style', 'warm-grey'); // the default
  const bg = (): Promise<string> => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sp-color-editor-bg').trim());
  expect((await bg()).toLowerCase()).toBe('#151515');

  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await doc.click();
  await page.keyboard.type('style test');
  const file = join(sandbox.docsDir, 'styled.slpg');
  await stubSaveDialog(app, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  const before = await page.evaluate((p) => window.sealpage.readDocument(p), file);

  const seen = new Set<string>(['warm-grey']);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('F8'); // next style
    await expect.poll(async () => seen.has((await html.getAttribute('data-style')) ?? '')).toBe(false);
    seen.add((await html.getAttribute('data-style'))!);
  }
  expect([...seen].sort()).toEqual(['dark-serif', 'paper', 'terminal', 'warm-grey']);

  // the document on disk does not change when the style does
  await page.keyboard.press('Control+s');
  const after = await page.evaluate((p) => window.sealpage.readDocument(p), file);
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toMatch(/warm-grey|terminal|paper|dark-serif/);

  const current = await html.getAttribute('data-style');
  await app.close();
  run = await launch(sandbox);
  await waitReady(run.page);
  await expect(run.page.locator('html')).toHaveAttribute('data-style', current!);
});
