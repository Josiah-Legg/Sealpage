/**
 * Main-process behaviour through the real IPC bridge, with real DPAPI-backed
 * key storage: key setup, encrypted save / load, wrong key, key change with
 * re-encryption, path validation, hardening.
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReencryptReport, Result } from '../../src/shared/ipc';
import { type Launched, PASSPHRASE, type Sandbox, closeApp, launch, makeSandbox } from './helpers';

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

const SECRET = 'The quick brown fox — секрет — 秘密 — 🔒 PLAINTEXT-MARKER-7f3a';
const MARKUP = `~sealpage 1\n\n= Title\n\n${SECRET}\n`;

test('key setup, encrypted save and load, and what ends up on disk', async () => {
  const { page } = run;
  const file = join(sandbox.docsDir, 'note.slpg');

  expect(await page.evaluate(() => window.sealpage.keyState())).toBe('unset');
  // nothing works before a key exists
  const early = (await page.evaluate((p) => window.sealpage.writeDocument(p, 'x'), file)) as Result;
  expect(early).toMatchObject({ ok: false, code: 'no-key' });

  const short = (await page.evaluate(() => window.sealpage.keySetup('short'))) as Result;
  expect(short).toMatchObject({ ok: false, code: 'invalid-argument' });

  expect(await page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE)).toEqual({ ok: true });
  expect(await page.evaluate(() => window.sealpage.keyState())).toBe('ready');
  expect(await page.evaluate((p) => window.sealpage.keyVerify(p), PASSPHRASE)).toEqual({ ok: true });
  expect(await page.evaluate(() => window.sealpage.keyVerify('not the passphrase'))).toMatchObject({ ok: false, code: 'wrong-passphrase' });

  expect(await page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [file, MARKUP])).toEqual({ ok: true });
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), file)).toEqual({ ok: true, value: MARKUP });

  // the file is a container, not text
  const raw = readFileSync(file);
  expect(raw.subarray(0, 8).equals(Buffer.from([0x89, 0x53, 0x4c, 0x50, 0x47, 0x0d, 0x0a, 0x1a]))).toBe(true);
  expect(raw.includes(Buffer.from('PLAINTEXT-MARKER'))).toBe(false);
  expect(raw.includes(Buffer.from('Title'))).toBe(false);
  // no temp files left next to it
  expect(readdirSync(sandbox.docsDir)).toEqual(['note.slpg']);

  // the key store holds no passphrase and no readable key
  const keystore = readFileSync(join(sandbox.dataDir, 'keystore.bin'));
  expect(keystore.subarray(0, 8).toString('ascii')).toBe('SLPGKEY1');
  expect(keystore.includes(Buffer.from(PASSPHRASE))).toBe(false);

  // saving twice produces completely different bytes (fresh salt and nonce)
  await page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [file, MARKUP]);
  const raw2 = readFileSync(file);
  expect(raw2.subarray(44).equals(raw.subarray(44))).toBe(false);
});

test('the key survives a restart without asking for the passphrase', async () => {
  const file = join(sandbox.docsDir, 'persist.slpg');
  await run.page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  await run.page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [file, MARKUP]);
  await run.app.close();

  run = await launch(sandbox);
  expect(await run.page.evaluate(() => window.sealpage.keyState())).toBe('ready');
  expect(await run.page.evaluate((p) => window.sealpage.readDocument(p), file)).toEqual({ ok: true, value: MARKUP });
});

test('wrong key, tampering and garbage give plain errors and no content', async () => {
  const { page } = run;
  const file = join(sandbox.docsDir, 'a.slpg');
  await page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  await page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [file, MARKUP]);
  const good = readFileSync(file);

  // tampered: one bit flipped in the ciphertext
  const tampered = Buffer.from(good);
  tampered[100] = tampered[100]! ^ 1;
  writeFileSync(join(sandbox.docsDir, 'tampered.slpg'), tampered);
  // truncated
  writeFileSync(join(sandbox.docsDir, 'truncated.slpg'), good.subarray(0, good.length - 5));
  // not a container
  writeFileSync(join(sandbox.docsDir, 'garbage.slpg'), 'this is just text');

  const read = (name: string): Promise<Result<string>> => page.evaluate((p) => window.sealpage.readDocument(p), join(sandbox.docsDir, name)) as Promise<Result<string>>;
  expect(await read('tampered.slpg')).toEqual({ ok: false, code: 'cannot-decrypt', message: 'Cannot decrypt this file.' });
  expect(await read('truncated.slpg')).toEqual({ ok: false, code: 'cannot-decrypt', message: 'Cannot decrypt this file.' });
  expect(await read('garbage.slpg')).toMatchObject({ ok: false, code: 'bad-format' });
  expect(await read('missing.slpg')).toMatchObject({ ok: false, code: 'not-found' });

  // a different installation (different key) cannot open the file: same plain message, nothing else
  await run.app.close();
  const other = makeSandbox();
  try {
    run = await launch(other);
    await run.page.evaluate(() => window.sealpage.keySetup('a different passphrase entirely'));
    const res = await run.page.evaluate((p) => window.sealpage.readDocument(p), file);
    expect(res).toEqual({ ok: false, code: 'cannot-decrypt', message: 'Cannot decrypt this file.' });
    await run.app.close();
  } finally {
    other.cleanup();
  }
  run = await launch(sandbox);
});

test('changing the key requires the current passphrase and re-encrypts chosen files', async () => {
  const { page } = run;
  const NEW = 'a brand new passphrase 67890';
  await page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  const sub = join(sandbox.docsDir, 'sub');
  mkdirSync(sub);
  const files = [join(sandbox.docsDir, 'one.slpg'), join(sandbox.docsDir, 'two.slpg'), join(sub, 'three.slpg')];
  for (const [i, f] of files.entries()) {
    await page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [f, `~sealpage 1\n\nfile ${i}\n`]);
  }
  const left = join(sandbox.docsDir, 'left-behind.slpg');
  await page.evaluate(([p, m]) => window.sealpage.writeDocument(p!, m!), [left, '~sealpage 1\n\nleft\n']);
  const before = files.map((f) => readFileSync(f));

  expect(await page.evaluate(([c, n]) => window.sealpage.keyChange(c!, n!), ['wrong current', NEW])).toMatchObject({ ok: false, code: 'wrong-passphrase' });
  // nothing changed: files still open
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), files[0]!)).toMatchObject({ ok: true });

  expect(await page.evaluate(([c, n]) => window.sealpage.keyChange(c!, n!), [PASSPHRASE, NEW])).toEqual({ ok: true });
  // old files are now unreadable with the new key: plain error
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), files[0]!)).toEqual({ ok: false, code: 'cannot-decrypt', message: 'Cannot decrypt this file.' });

  // re-encrypt two files and one folder's worth (the folder also contains the first two again: no duplicates)
  const res = (await page.evaluate(([old, a, dir]) => window.sealpage.reencrypt(old!, [a!, dir!]), [PASSPHRASE, files[0]!, sub])) as Result<ReencryptReport>;
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.value.converted).toBe(2);
  expect(res.value.failed).toBe(0);

  expect(await page.evaluate((p) => window.sealpage.readDocument(p), files[0]!)).toEqual({ ok: true, value: '~sealpage 1\n\nfile 0\n' });
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), files[2]!)).toEqual({ ok: true, value: '~sealpage 1\n\nfile 2\n' });
  expect(readFileSync(files[0]!).equals(before[0]!)).toBe(false);
  // files that were not chosen are untouched and still under the old key
  expect(readFileSync(files[1]!).equals(before[1]!)).toBe(true);
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), left)).toMatchObject({ ok: false, code: 'cannot-decrypt' });

  // with the wrong old passphrase nothing is converted and nothing is modified
  const untouched = readFileSync(left);
  const bad = (await page.evaluate(([old, dir]) => window.sealpage.reencrypt(old!, [dir!]), ['not the old passphrase', sandbox.docsDir])) as Result<ReencryptReport>;
  expect(bad.ok && bad.value.converted).toBe(0);
  expect(readFileSync(left).equals(untouched)).toBe(true);

  // later, the rest can still be converted with the old passphrase
  const rest = (await page.evaluate(([old, dir]) => window.sealpage.reencrypt(old!, [dir!]), [PASSPHRASE, sandbox.docsDir])) as Result<ReencryptReport>;
  expect(rest.ok && rest.value.converted).toBe(2);
  expect(rest.ok && rest.value.alreadyCurrent).toBe(2);
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), left)).toEqual({ ok: true, value: '~sealpage 1\n\nleft\n' });
  // no temp files anywhere
  expect(readdirSync(sandbox.docsDir).sort()).toEqual(['left-behind.slpg', 'one.slpg', 'sub', 'two.slpg']);
  expect(readdirSync(sub)).toEqual(['three.slpg']);

  // the new key is the stored one after a restart
  await run.app.close();
  run = await launch(sandbox);
  expect(await run.page.evaluate((p) => window.sealpage.keyVerify(p), NEW)).toEqual({ ok: true });
  expect(await run.page.evaluate((p) => window.sealpage.keyVerify(p), PASSPHRASE)).toMatchObject({ ok: false });
});

test('only .slpg paths are accepted, and stale temp files are cleaned up', async () => {
  const { page } = run;
  await page.evaluate((p) => window.sealpage.keySetup(p), PASSPHRASE);
  const txt = join(sandbox.docsDir, 'evil.txt');
  expect(await page.evaluate((p) => window.sealpage.writeDocument(p, 'x'), txt)).toMatchObject({ ok: false, code: 'invalid-argument' });
  expect(await page.evaluate(() => window.sealpage.writeDocument('relative.slpg', 'x'))).toMatchObject({ ok: false, code: 'invalid-argument' });
  expect(existsSync(txt)).toBe(false);
  expect(await page.evaluate((p) => window.sealpage.readDocument(p), join(sandbox.dataDir, 'settings.json'))).toMatchObject({ ok: false, code: 'invalid-argument' });

  // a leftover temp file from a "crash" disappears when the folder is next used
  const stale = join(sandbox.docsDir, '.old.slpg.0123456789abcdef.sealpage-tmp');
  writeFileSync(stale, 'ciphertext leftover');
  const listing = (await page.evaluate((d) => window.sealpage.listFolder(d), sandbox.docsDir)) as Result<{ name: string }[]>;
  expect(listing.ok && listing.value.map((e) => e.name)).toEqual([]);
  await expect.poll(() => existsSync(stale)).toBe(false);
});

test('the window is locked down: sandboxed, isolated, offline, no devtools surprises', async () => {
  const { page, app } = run;
  const facts = await page.evaluate(() => ({
    hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
    hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
    apiKeys: Object.keys(window.sealpage).sort(),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
  }));
  expect(facts.hasRequire).toBe(false);
  expect(facts.hasProcess).toBe(false);
  expect(facts.csp).toContain("default-src 'none'");
  expect(facts.csp).toContain("script-src 'self'");
  expect(facts.apiKeys).toContain('readDocument');
  // nothing key-shaped is exposed
  expect(facts.apiKeys.join(' ')).not.toMatch(/getKey|masterKey|exportKey|passphrase/i);

  // network requests are refused
  const fetched = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'ok';
    } catch {
      return 'blocked';
    }
  });
  expect(fetched).toBe('blocked');

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const ses = win.webContents.session;
    return { persistent: ses.isPersistent(), spell: ses.isSpellCheckerEnabled(), storagePath: ses.storagePath };
  });
  expect(prefs.persistent).toBe(false);
  expect(prefs.spell).toBe(false);
});
