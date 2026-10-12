import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptContainer, encryptContainer, parseHeader } from '../../../src/main/crypto/container';
import { Keystore, KeystoreError } from '../../../src/main/crypto/keystore';
import { FAST_KDF, FakeProtector, makeTempDir } from './helpers';

const PASS = 'correct horse battery staple';
const OTHER = 'a completely different passphrase';

async function expectKeystoreError(p: Promise<unknown>, code: string): Promise<void> {
  let error: unknown;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(KeystoreError);
  expect((error as KeystoreError).code).toBe(code);
}

describe('keystore', () => {
  let dir: string;
  let cleanup: () => void;
  let file: string;

  beforeEach(() => {
    ({ dir, cleanup } = makeTempDir());
    file = join(dir, 'keystore.bin');
  });
  afterEach(() => cleanup());

  const open = (user = 'alice'): Keystore => new Keystore(file, new FakeProtector(user), FAST_KDF);

  it('starts unset, becomes ready after setup, and reloads on the same account', async () => {
    const ks = open();
    expect(await ks.load()).toBe('unset');
    expect(ks.current).toBeNull();
    await ks.setup(PASS);
    expect(ks.state).toBe('ready');
    const key = Buffer.from(ks.current!.key);
    expect(key.length).toBe(32);
    expect(ks.current!.salt.length).toBe(16);

    const again = open();
    expect(await again.load()).toBe('ready');
    expect(again.current!.key.equals(key)).toBe(true);
    expect(again.current!.salt.equals(ks.current!.salt)).toBe(true);
    expect(again.current!.params).toEqual(FAST_KDF);
  });

  it('stores only a protected blob: no raw key, no passphrase', async () => {
    const ks = open();
    await ks.setup(PASS);
    const raw = readFileSync(file);
    expect(raw.subarray(0, 8).toString('ascii')).toBe('SLPGKEY1');
    expect(raw.includes(ks.current!.key)).toBe(false);
    expect(raw.includes(Buffer.from(PASS, 'utf8'))).toBe(false);
    // and no temp files are left behind
    expect(readdirSync(dir)).toEqual(['keystore.bin']);
  });

  it('is locked out for a different account or a corrupted blob, without throwing', async () => {
    await open('alice').setup(PASS);
    const bob = open('bob');
    expect(await bob.load()).toBe('locked-out');
    expect(bob.current).toBeNull();

    const raw = readFileSync(file);
    writeFileSync(file, raw.subarray(0, raw.length - 3));
    expect(await open('alice').load()).toBe('locked-out');
    writeFileSync(file, Buffer.from('not a keystore'));
    expect(await open('alice').load()).toBe('locked-out');
  });

  it('reports unavailable secret storage and refuses to store a key', async () => {
    const protector = new FakeProtector();
    protector.available = false;
    const ks = new Keystore(file, protector, FAST_KDF);
    expect(await ks.load()).toBe('unavailable');
    await expectKeystoreError(ks.setup(PASS), 'keystore-unavailable');
    expect(existsSync(file)).toBe(false);
    expect(ks.current).toBeNull();
  });

  it('enforces a minimum passphrase length and refuses to overwrite a working key', async () => {
    const ks = open();
    await ks.load();
    await expectKeystoreError(ks.setup('short'), 'invalid-argument');
    await expectKeystoreError(ks.setup(''), 'invalid-argument');
    await expectKeystoreError(ks.setup('x'.repeat(2000)), 'invalid-argument');
    expect(existsSync(file)).toBe(false);
    await ks.setup(PASS);
    await expectKeystoreError(ks.setup(OTHER), 'already-exists');
  });

  it('verifies passphrases', async () => {
    const ks = open();
    await ks.setup(PASS);
    expect(await ks.verify(PASS)).toBe(true);
    expect(await ks.verify(PASS + ' ')).toBe(false);
    expect(await ks.verify(OTHER)).toBe(false);
    expect(await ks.verify('')).toBe(false);
    await expectKeystoreError(open('carol').verify(PASS), 'no-key');
  });

  it('changes the key only with the correct current passphrase', async () => {
    const ks = open();
    await ks.setup(PASS);
    const oldKey = { key: Buffer.from(ks.current!.key), salt: Buffer.from(ks.current!.salt), params: { ...ks.current!.params } };
    const oldFile = readFileSync(file);
    const doc = encryptContainer(Buffer.from('written under the old key'), ks.current!);

    await expectKeystoreError(ks.change(OTHER, 'new passphrase 123'), 'wrong-passphrase');
    expect(ks.current!.key.equals(oldKey.key)).toBe(true);
    expect(readFileSync(file).equals(oldFile)).toBe(true);

    await expectKeystoreError(ks.change(PASS, 'short'), 'invalid-argument');
    expect(ks.current!.key.equals(oldKey.key)).toBe(true);
    expect(readFileSync(file).equals(oldFile)).toBe(true);

    await ks.change(PASS, 'new passphrase 123');
    expect(ks.state).toBe('ready');
    expect(ks.current!.key.equals(oldKey.key)).toBe(false);
    expect(ks.current!.salt.equals(oldKey.salt)).toBe(false);
    expect(await ks.verify('new passphrase 123')).toBe(true);
    expect(await ks.verify(PASS)).toBe(false);

    // the new key is what is stored
    const reloaded = open();
    expect(await reloaded.load()).toBe('ready');
    expect(reloaded.current!.key.equals(ks.current!.key)).toBe(true);

    // files written under the old key no longer open: plain "cannot decrypt"
    expect(() => decryptContainer(doc, ks.current!)).toThrowError('Cannot decrypt this file.');
    // ...but the old key still opens them
    expect(decryptContainer(doc, oldKey).toString()).toBe('written under the old key');
    expect(readdirSync(dir)).toEqual(['keystore.bin']);
  });

  it('changing to the same passphrase still produces a new, unrelated key', async () => {
    const ks = open();
    await ks.setup(PASS);
    const before = Buffer.from(ks.current!.key);
    await ks.change(PASS, PASS);
    expect(ks.current!.key.equals(before)).toBe(false);
  });

  it('restores a key on a new machine from the passphrase and an existing file', async () => {
    const original = open('alice');
    await original.setup(PASS);
    const sample = encryptContainer(Buffer.from('~sealpage 1\n\nhello\n'), original.current!);
    const originalKey = Buffer.from(original.current!.key);

    // "new machine": different protector, empty keystore
    const { dir: dir2, cleanup: cleanup2 } = makeTempDir();
    try {
      const file2 = join(dir2, 'keystore.bin');
      const fresh = new Keystore(file2, new FakeProtector('new-machine'), FAST_KDF);
      expect(await fresh.load()).toBe('unset');

      await expectKeystoreError(fresh.restore(OTHER, sample), 'cannot-decrypt');
      expect(fresh.state).toBe('unset');
      expect(existsSync(file2)).toBe(false);

      await expectKeystoreError(fresh.restore(PASS, Buffer.from('garbage that is not a container')), 'bad-format');
      expect(existsSync(file2)).toBe(false);

      await fresh.restore(PASS, sample);
      expect(fresh.state).toBe('ready');
      expect(fresh.current!.key.equals(originalKey)).toBe(true);
      expect(parseHeader(sample).kdfSalt.equals(fresh.current!.salt)).toBe(true);
      expect(decryptContainer(sample, fresh.current!).toString()).toBe('~sealpage 1\n\nhello\n');

      const reloaded = new Keystore(file2, new FakeProtector('new-machine'), FAST_KDF);
      expect(await reloaded.load()).toBe('ready');
      expect(reloaded.current!.key.equals(originalKey)).toBe(true);
    } finally {
      cleanup2();
    }
  });

  it('a locked-out keystore can be replaced by setup or restore', async () => {
    await open('alice').setup(PASS);
    const bob = open('bob');
    expect(await bob.load()).toBe('locked-out');
    await bob.setup(OTHER);
    expect(bob.state).toBe('ready');
    expect(await open('bob').load()).toBe('ready');
  });

  it('lock() wipes the key from memory', async () => {
    const ks = open();
    await ks.setup(PASS);
    const ref = ks.current!.key; // same underlying buffer
    expect(ref.some((b) => b !== 0)).toBe(true);
    ks.lock();
    expect(ks.current).toBeNull();
    expect(ref.every((b) => b === 0)).toBe(true);
    // the stored key is unaffected
    expect(await ks.load()).toBe('ready');
  });

  it('change() wipes the previous key from memory', async () => {
    const ks = open();
    await ks.setup(PASS);
    const ref = ks.current!.key;
    await ks.change(PASS, 'another passphrase');
    expect(ref.every((b) => b === 0)).toBe(true);
  });
});
