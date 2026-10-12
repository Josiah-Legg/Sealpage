/**
 * Renders one document containing every block type in each of the four styles,
 * checks that each style really applies its bundled fonts and colours, and
 * writes screenshots to test-results/styles/ for visual review.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeMarkup } from '../../src/shared/markup';
import { type Doc, codeBlock, defaultGraph, divider, heading, lineBreak, list, listItem, paragraph, quote, table, text, title } from '../../src/shared/model';
import { type Launched, PASSPHRASE, ROOT, type Sandbox, closeApp, launch, makeSandbox, waitReady } from './helpers';

const SHOTS = join(ROOT, 'test-results', 'styles');

const SAMPLE: Doc = {
  blocks: [
    title([text('Field notes on a quiet system')]),
    paragraph([
      text('Every block type appears in this document. Body text carries '),
      text('bold', { bold: true }),
      text(', '),
      text('italic', { italic: true }),
      text(', '),
      text('inline code', { code: true }),
      text(' and a '),
      text('link', { href: 'https://example.com' }),
      text('.'),
      lineBreak(),
      text('A second line after a hard break.'),
    ]),
    heading(1, [text('Structure')]),
    list('bullet', [
      listItem([text('A bulleted item')], false, [list('numbered', [listItem([text('Nested, numbered')]), listItem([text('Second step')])])]),
      listItem([text('Another item')]),
    ]),
    list('check', [listItem([text('Seal the document')], true), listItem([text('Write the next page')], false)]),
    heading(2, [text('Quoted and coded')]),
    quote([[text('What is written without effort is in general read without pleasure.')], [text('— attributed to Samuel Johnson', { italic: true })]]),
    codeBlock('typescript', 'function seal(page: string, key: Uint8Array): Uint8Array {\n  // every save uses a fresh nonce\n  const nonce = randomBytes(12);\n  return encrypt(page, key, nonce);\n}'),
    heading(3, [text('Figures')]),
    table(
      [
        [[text('Quarter')], [text('Revenue')], [text('Change')]],
        [[text('Q1')], [text('120')], [text('+4%')]],
        [[text('Q2')], [text('142')], [text('+18%')]],
      ],
      true,
    ),
    divider(),
    {
      ...defaultGraph('grouped-bar'),
      title: 'Revenue by quarter',
      xLabel: 'Quarter',
      yLabel: 'Thousands',
      columns: ['Quarter', '2023', '2024', '2025'],
      rows: [
        ['Q1', '98', '120', '131'],
        ['Q2', '110', '142', '150'],
        ['Q3', '104', '135', '162'],
        ['Q4', '125', '151', '170'],
      ],
    },
    { ...defaultGraph('line'), title: 'Trend', columns: ['Month', 'A', 'B'], rows: [['Jan', '3', '5'], ['Feb', '4', '4.5'], ['Mar', '6', '5.5'], ['Apr', '5', '7'], ['May', '8', '7.5']] },
    { ...defaultGraph('pie'), title: 'Share', columns: ['Kind', 'Amount'], rows: [['Notes', '45'], ['Drafts', '30'], ['Letters', '15'], ['Other', '10']] },
    paragraph([text('The end of the sample.')]),
  ],
};

let sandbox: Sandbox;
let run: Launched | null = null;

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.beforeEach(async () => {
  sandbox = makeSandbox();
  mkdirSync(sandbox.docsDir, { recursive: true });
  const first = await launch(sandbox);
  await first.page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  await first.page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [join(sandbox.docsDir, 'Sample.slpg'), serializeMarkup(SAMPLE)]);
  await first.page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [join(sandbox.docsDir, 'Another note.slpg'), serializeMarkup({ blocks: [title([text('Another note')])] })]);
  await closeApp(first.app);
});

test.afterEach(async () => {
  await closeApp(run?.app);
  run = null;
  sandbox.cleanup();
});

const EXPECT: Record<string, { body: RegExp; heading: RegExp; scheme: 'light' | 'dark' }> = {
  'warm-grey': { body: /Inter/, heading: /Inter/, scheme: 'dark' },
  paper: { body: /Bricolage Grotesque/, heading: /Bricolage Grotesque/, scheme: 'light' },
  'dark-serif': { body: /Source Serif 4/, heading: /Young Serif/, scheme: 'dark' },
  terminal: { body: /Glass TTY VT220/, heading: /Glass TTY VT220/, scheme: 'dark' },
};

test('all four styles render the full document with their own bundled fonts', async () => {
  run = await launch(sandbox, [join(sandbox.docsDir, 'Sample.slpg')]);
  const { page, app } = run;
  await waitReady(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 900));
  await page.evaluate((dir) => window.sealpage.watchFolder(dir), sandbox.docsDir);

  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await expect(doc.locator('h1.sp-title')).toHaveText('Field notes on a quiet system');
  await expect(doc.locator('.sp-graph-figure svg')).toHaveCount(3);
  await expect(doc.locator('pre')).toContainText('function seal');

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = (await page.locator('html').getAttribute('data-style'))!;
    seen.push(id);
    const want = EXPECT[id]!;
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(350);

    const facts = await page.evaluate(() => {
      const cs = (sel: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(sel)!);
      const families = (sel: string): string => cs(sel).fontFamily;
      const firstFamily = (stack: string): string => stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
      const loaded = (sel: string): boolean => document.fonts.check(`16px "${firstFamily(families(sel))}"`);
      return {
        body: families('.sp-document p'),
        heading: families('.sp-document h1'),
        bodyLoaded: loaded('.sp-document p'),
        headingLoaded: loaded('.sp-document h1'),
        codeLoaded: loaded('.sp-document pre'),
        scheme: document.documentElement.style.colorScheme,
        pageBg: cs('.sp-editor-pane.is-active').backgroundColor,
        textColor: cs('.sp-document p').color,
        failedFonts: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
        graphFont: document.querySelector('.sp-graph-figure svg')?.getAttribute('font-family') ?? '',
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(facts.body, `${id}: body font`).toMatch(want.body);
    expect(facts.heading, `${id}: heading font`).toMatch(want.heading);
    expect(facts.bodyLoaded, `${id}: body font file loaded`).toBe(true);
    expect(facts.headingLoaded, `${id}: heading font file loaded`).toBe(true);
    expect(facts.codeLoaded, `${id}: code font file loaded`).toBe(true);
    expect(facts.failedFonts, `${id}: font files that failed to load`).toEqual([]);
    expect(facts.scheme).toBe(want.scheme);
    expect(facts.pageBg).not.toBe(facts.textColor);
    expect(facts.graphFont, `${id}: graphs use the style's font`).toMatch(want.body);
    expect(facts.overflowX, `${id}: no horizontal overflow of the window`).toBe(false);

    await page.screenshot({ path: join(SHOTS, `${id}-top.png`) });
    await page.locator('.sp-graph-block').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SHOTS, `${id}-graphs.png`) });
    await page.locator('.sp-document h1.sp-title').scrollIntoViewIfNeeded();

    await page.keyboard.press('F8');
    if (i < 3) await expect(page.locator('html')).not.toHaveAttribute('data-style', id);
  }
  expect([...seen].sort()).toEqual(['dark-serif', 'paper', 'terminal', 'warm-grey']);
});

test('the Terminal CRT effect can be switched off and never blocks input', async () => {
  run = await launch(sandbox, [join(sandbox.docsDir, 'Sample.slpg')]);
  const { page } = run;
  await waitReady(page);
  // switch to Terminal through the settings so it is persisted like a user would do it
  await page.evaluate(() => window.sealpage.updateSettings({ styleId: 'terminal' }));
  await closeApp(run.app);
  run = await launch(sandbox, [join(sandbox.docsDir, 'Sample.slpg')]);
  const page2 = run.page;
  await waitReady(page2);
  const html = page2.locator('html');
  await expect(html).toHaveAttribute('data-style', 'terminal');
  await expect(html).toHaveAttribute('data-fx-scanlines', '');

  // the effect layer must never intercept clicks or typing
  const fx = await page2.evaluate(() => getComputedStyle(document.getElementById('fx-layer')!).pointerEvents);
  expect(fx).toBe('none');
  const doc = page2.locator('.sp-editor-pane.is-active .sp-document');
  await doc.locator('p').last().click();
  await page2.keyboard.press('End');
  await page2.keyboard.type(' TYPED-THROUGH-CRT');
  await expect(doc).toContainText('TYPED-THROUGH-CRT');
  await page2.screenshot({ path: join(SHOTS, 'terminal-crt-on.png') });

  // open Settings > Style and switch the CRT toggle off
  await page2.keyboard.press('Control+,');
  const dialog = page2.locator('.sp-settings-dialog');
  await expect(dialog).toBeVisible();
  await page2.screenshot({ path: join(SHOTS, 'settings-style.png') });
  const crt = dialog.locator('label, .sp-settings-row, div').filter({ hasText: /^CRT effect/ }).locator('input.sp-switch').first();
  await crt.uncheck();
  await expect(html).not.toHaveAttribute('data-fx-scanlines', '');
  const glow = await page2.evaluate(() => getComputedStyle(document.body).textShadow);
  expect(glow).toBe('none');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page2.screenshot({ path: join(SHOTS, 'terminal-crt-off.png') });

  // remembered across restarts
  await closeApp(run.app);
  run = await launch(sandbox);
  await waitReady(run.page);
  await expect(run.page.locator('html')).toHaveAttribute('data-style', 'terminal');
  await expect(run.page.locator('html')).not.toHaveAttribute('data-fx-scanlines', '');
});

test('dialogs, panels and menus open and work (screenshots for review)', async () => {
  run = await launch(sandbox, [join(sandbox.docsDir, 'Sample.slpg')]);
  const { page, app } = run;
  await waitReady(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1360, 900));
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await expect(doc.locator('h1.sp-title')).toBeVisible();

  // sidebar: open the documents folder through the (stubbed) folder picker
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as unknown as typeof dialog.showOpenDialog;
  }, sandbox.docsDir);
  await page.keyboard.press('Control+Shift+o');
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toContainText('Sample');
  await expect(sidebar).toContainText('Another note');
  await sidebar.getByText('Another note').click();
  await expect(page.locator('#tabbar')).toContainText('Another note');
  await expect(page.locator('.sp-editor-pane.is-active .sp-document h1.sp-title')).toHaveText('Another note');
  await page.locator('#tabbar').getByText('Sample').click();
  await expect(doc.locator('h1.sp-title')).toHaveText('Field notes on a quiet system');
  await page.screenshot({ path: join(SHOTS, 'ui-sidebar-tabs.png') });

  // menu bar
  await page.locator('#menubar').getByRole('button', { name: 'Format' }).click();
  const menu = page.locator('.sp-popup-menu').first();
  await expect(menu).toContainText('Bold');
  await expect(menu).toContainText('Ctrl+B');
  await expect(menu).toContainText('Checklist');
  await page.screenshot({ path: join(SHOTS, 'ui-menu-format.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sp-popup-menu')).toHaveCount(0);

  // find and replace
  await doc.locator('p').first().click();
  await page.keyboard.press('Control+h');
  const find = page.locator('#findbar');
  await find.locator('input').first().fill('item');
  await expect(find).toContainText(/of 2|2 results/);
  await expect(doc.locator('.ProseMirror-search-match, .ProseMirror-active-search-match')).toHaveCount(2);
  await page.screenshot({ path: join(SHOTS, 'ui-find-replace.png') });
  await find.locator('input').nth(1).fill('entry');
  await find.getByRole('button', { name: 'Replace all' }).click();
  await expect(doc).toContainText('A bulleted entry');
  await expect(doc).not.toContainText('bulleted item');
  await page.keyboard.press('Escape');
  await expect(find).not.toHaveClass(/is-open/);
  // undo restores the text (one step per replace-all)
  await doc.locator('p').first().click();
  await page.keyboard.press('Control+z');
  await expect(doc).toContainText('A bulleted item');

  // slash menu
  await doc.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const slash = page.locator('.sp-slash-menu');
  await expect(slash).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'ui-slash-menu.png') });
  await page.keyboard.type('quo');
  await expect(slash.locator('.sp-menu-item')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(slash).toHaveCount(0);
  await page.keyboard.type('Inserted by slash');
  await expect(doc.locator('blockquote').last()).toHaveText('Inserted by slash');

  // checklist click toggles
  const box = doc.locator('ul.sp-list-check > li[data-checked="false"] .sp-check').first();
  await box.click();
  await expect(doc.locator('ul.sp-list-check > li[data-checked="true"]')).toHaveCount(2);

  // graph editor: live preview while editing data
  await doc.locator('.sp-graph-figure').first().dblclick();
  const editor = page.locator('.sp-graph-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('svg.sp-graph')).toHaveCount(1);
  const before = await editor.locator('svg.sp-graph').innerHTML();
  const cell = editor.locator('.sp-graph-grid input').nth(5);
  await cell.fill('999');
  await expect.poll(async () => (await editor.locator('svg.sp-graph').innerHTML()) !== before).toBe(true);
  await editor.locator('select').first().selectOption('stacked-bar');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(SHOTS, 'ui-graph-editor.png') });
  await editor.getByRole('button', { name: 'Apply' }).click();
  await expect(editor).toHaveCount(0);

  // keyboard shortcut reference
  await page.keyboard.press('Control+/');
  const shortcuts = page.locator('.sp-dialog').filter({ hasText: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  for (const expected of ['Bold', 'Ctrl', 'Checklist', 'Export as PDF', 'Find and replace']) await expect(shortcuts).toContainText(expected);
  await page.screenshot({ path: join(SHOTS, 'ui-shortcuts.png') });
  await shortcuts.getByRole('button', { name: 'Close', exact: true }).last().click();

  // settings: style, general, security
  await page.keyboard.press('Control+,');
  const settings = page.locator('.sp-settings-dialog');
  await expect(settings).toBeVisible();
  for (const name of ['Warm Grey Sans', 'Paper', 'Dark Serif', 'Terminal']) await expect(settings).toContainText(name);
  await page.screenshot({ path: join(SHOTS, 'ui-settings-style.png') });
  await settings.locator('.sp-settings-nav').getByText('Security').click();
  await expect(settings).toContainText('Change key');
  await expect(settings).toContainText(/no recovery/i);
  await page.screenshot({ path: join(SHOTS, 'ui-settings-security.png') });
  await settings.locator('.sp-settings-nav').getByText('General').click();
  await expect(settings).toContainText('Autosave');
  await page.screenshot({ path: join(SHOTS, 'ui-settings-general.png') });
  await settings.getByRole('button', { name: 'Done' }).click();

  // export warning: every export must be confirmed and says it is unencrypted
  await page.keyboard.press('Control+Shift+m');
  const warn = page.locator('.sp-dialog').filter({ hasText: 'Unencrypted export' });
  await expect(warn).toBeVisible();
  await expect(warn).toContainText(/not encrypted/i);
  await page.screenshot({ path: join(SHOTS, 'ui-export-warning.png') });
  await warn.getByRole('button', { name: 'Cancel' }).click();
  await expect(warn).toHaveCount(0);

  // the same screens in the Terminal style (largest UI font) must not overflow the window
  await page.evaluate(() => window.sealpage.updateSettings({ styleId: 'terminal' }));
});

test('exports: Markdown, PDF and graph images are written only after confirmation, to the chosen place', async () => {
  run = await launch(sandbox, [join(sandbox.docsDir, 'Sample.slpg')]);
  const { page, app } = run;
  await waitReady(page);
  const doc = page.locator('.sp-editor-pane.is-active .sp-document');
  await expect(doc.locator('h1.sp-title')).toBeVisible();
  const out = join(sandbox.docsDir, 'exports');
  mkdirSync(out, { recursive: true });
  const stub = (file: string): Promise<void> =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as unknown as typeof dialog.showSaveDialog;
    }, file);
  const confirm = async (): Promise<void> => {
    const warn = page.locator('.sp-dialog').filter({ hasText: 'Unencrypted export' });
    await expect(warn).toBeVisible();
    await warn.getByRole('button', { name: /Continue|Export/ }).click();
  };

  // Markdown
  const md = join(out, 'sample.md');
  await stub(md);
  await page.keyboard.press('Control+Shift+m');
  expect(existsSync(md)).toBe(false); // nothing is written before the confirmation
  await confirm();
  await expect.poll(() => existsSync(md)).toBe(true);
  const text = readFileSync(md, 'utf8');
  expect(text).toContain('# Field notes on a quiet system');
  expect(text).toContain('**bold**');
  expect(text).toContain('- [x] Seal the document');
  expect(text).toContain('```typescript');
  expect(text).toContain('| Quarter | Revenue | Change |');

  // PDF
  const pdf = join(out, 'sample.pdf');
  await stub(pdf);
  await page.keyboard.press('Control+Shift+e');
  expect(existsSync(pdf)).toBe(false);
  await confirm();
  await expect.poll(() => existsSync(pdf), { timeout: 30_000 }).toBe(true);
  const bytes = readFileSync(pdf);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(20_000);
  // the app returns to its normal layout afterwards
  await expect(page.locator('html')).not.toHaveClass(/sp-printing/);
  await expect(page.locator('#toolbar')).toBeVisible();

  // graph as SVG and PNG
  const fig = doc.locator('.sp-graph-block').first();
  await fig.scrollIntoViewIfNeeded();
  await fig.hover();
  const svg = join(out, 'graph.svg');
  await stub(svg);
  await fig.getByRole('button', { name: /SVG/ }).click();
  await confirm();
  await expect.poll(() => existsSync(svg)).toBe(true);
  const svgText = readFileSync(svg, 'utf8');
  expect(svgText.startsWith('<svg ')).toBe(true);
  expect(svgText).toContain('Revenue by quarter');

  const png = join(out, 'graph.png');
  await stub(png);
  await fig.hover();
  await fig.getByRole('button', { name: /PNG/ }).click();
  await confirm();
  await expect.poll(() => existsSync(png), { timeout: 30_000 }).toBe(true);
  const pngBytes = readFileSync(png);
  expect(pngBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(pngBytes.readUInt32BE(16)).toBe(2400); // width
  expect(pngBytes.readUInt32BE(20)).toBe(1400); // height
  expect(pngBytes.length).toBeGreaterThan(15_000);
});
