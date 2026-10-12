import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptContainer, encryptContainer, headerMatchesKey, parseHeader } from '../../../src/main/crypto/container';
import { type MasterKey, KDF_SALT_BYTES, deriveKey } from '../../../src/main/crypto/kdf';
import { Keystore } from '../../../src/main/crypto/keystore';
import { collectDocumentFiles, reencryptFiles } from '../../../src/main/crypto/reencrypt';
import { isTempFileName } from '../../../src/main/fs/atomic';
import { FAST_KDF, FakeProtector, makeTempDir } from './helpers';

const OLD_PASS = 'the old passphrase';
const NEW_PASS = 'the new passphrase';

function listAll(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listAll(p));
    else out.push(p);
  }
  return out.sort();
}

function snapshot(key: MasterKey): MasterKey {
  return { key: Buffer.from(key.key), salt: Buffer.from(key.salt), params: { ...key.params } };
}

describe('key change and re-encryption', () => {
  let dir: string;
  let cleanup: () => void;
  let ks: Keystore;
  let oldKey: MasterKey;
  let docs: Map<string, string>;

  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    mkdirSync(join(dir, 'docs', 'nested', 'deeper'), { recursive: true });
    ks = new Keystore(join(dir, 'keystore.bin'), new FakeProtector(), FAST_KDF);
    await ks.setup(OLD_PASS);
    oldKey = snapshot(ks.current!);
    docs = new Map([
      [join(dir, 'docs', 'a.slpg'), '~sealpage 1\n\n= Alpha\n'],
      [join(dir, 'docs', 'b.slpg'), '~sealpage 1\n\nBravo 漢字 😀\n'],
      [join(dir, 'docs', 'nested', 'c.slpg'), '~sealpage 1\n\n' + 'Charlie '.repeat(5000) + '\n'],
      [join(dir, 'docs', 'nested', 'deeper', 'd.SLPG'), '~sealpage 1\n'],
    ]);
    for (const [path, text] of docs) writeFileSync(path, encryptContainer(Buffer.from(text, 'utf8'), oldKey));
    writeFileSync(join(dir, 'docs', 'notes.txt'), 'not a sealpage file');
    await ks.change(OLD_PASS, NEW_PASS);
  });
  afterEach(() => cleanup());

  it('collects .slpg files recursively from files and folders, without duplicates', async () => {
    const files = await collectDocumentFiles([join(dir, 'docs'), join(dir, 'docs', 'a.slpg'), join(dir, 'missing')]);
    expect(files).toEqual([...docs.keys()].sort((a, b) => a.localeCompare(b)));
  });

  it('re-encrypts every file under the new key and reports it', async () => {
    const files = await collectDocumentFiles([join(dir, 'docs')]);
    const progress: number[] = [];
    const report = await reencryptFiles({
      files,
      passphrase: OLD_PASS,
      current: ks.current!,
      onProgress: (p) => progress.push(p.done),
    });
    expect(report.converted).toBe(4);
    expect(report.failed).toBe(0);
    expect(report.alreadyCurrent).toBe(0);
    expect(report.cancelled).toBe(false);
    expect(report.results.map((r) => r.status)).toEqual(['converted', 'converted', 'converted', 'converted']);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(4);

    for (const [path, text] of docs) {
      const data = readFileSync(path);
      expect(headerMatchesKey(parseHeader(data), ks.current!)).toBe(true);
      expect(decryptContainer(data, ks.current!).toString('utf8')).toBe(text);
      expect(() => decryptContainer(data, oldKey)).toThrowError('Cannot decrypt this file.');
    }
    // no temp files anywhere, nothing else touched
    expect(listAll(dir).filter((p) => isTempFileName(p.split(/[\\/]/).pop()!))).toEqual([]);
    expect(readFileSync(join(dir, 'docs', 'notes.txt'), 'utf8')).toBe('not a sealpage file');
  });

  it('is idempotent: a second run reports everything as already current and changes nothing', async () => {
    const files = await collectDocumentFiles([join(dir, 'docs')]);
    await reencryptFiles({ files, passphrase: OLD_PASS, current: ks.current! });
    const before = files.map((f) => readFileSync(f));
    const report = await reencryptFiles({ files, passphrase: OLD_PASS, current: ks.current! });
    expect(report.alreadyCurrent).toBe(4);
    expect(report.converted).toBe(0);
    expect(report.failed).toBe(0);
    files.forEach((f, i) => expect(readFileSync(f).equals(before[i]!)).toBe(true));
  });

  it('with the wrong old passphrase nothing is modified and every file is reported', async () => {
    const files = await collectDocumentFiles([join(dir, 'docs')]);
    const before = files.map((f) => readFileSync(f));
    const report = await reencryptFiles({ files, passphrase: 'not the old passphrase', current: ks.current! });
    expect(report.converted).toBe(0);
    expect(report.failed).toBe(4);
    expect(report.results.every((r) => r.status === 'cannot-decrypt')).toBe(true);
    files.forEach((f, i) => expect(readFileSync(f).equals(before[i]!)).toBe(true));
    expect(listAll(dir).some((p) => p.endsWith('.sealpage-tmp'))).toBe(false);
  });

  it('handles a mix of convertible, foreign, damaged and non-Sealpage files independently', async () => {
    const thirdKey: MasterKey = { key: await deriveKey('some third passphrase', Buffer.alloc(KDF_SALT_BYTES, 9), FAST_KDF), params: FAST_KDF, salt: Buffer.alloc(KDF_SALT_BYTES, 9) };
    const foreign = join(dir, 'docs', 'foreign.slpg');
    const garbage = join(dir, 'docs', 'garbage.slpg');
    const damaged = join(dir, 'docs', 'damaged.slpg');
    const truncated = join(dir, 'docs', 'truncated.slpg');
    const current = join(dir, 'docs', 'current.slpg');
    const damagedCurrent = join(dir, 'docs', 'damaged-current.slpg');
    writeFileSync(foreign, encryptContainer(Buffer.from('foreign'), thirdKey));
    writeFileSync(garbage, Buffer.from('this is plain text pretending to be a document'));
    const dmg = encryptContainer(Buffer.from('damaged body'), oldKey);
    dmg[dmg.length - 20] = dmg[dmg.length - 20]! ^ 1;
    writeFileSync(damaged, dmg);
    writeFileSync(truncated, encryptContainer(Buffer.from('to be truncated'), oldKey).subarray(0, 60));
    writeFileSync(current, encryptContainer(Buffer.from('current'), ks.current!));
    const dc = encryptContainer(Buffer.from('damaged current'), ks.current!);
    dc[dc.length - 1] = dc[dc.length - 1]! ^ 1;
    writeFileSync(damagedCurrent, dc);

    const files = await collectDocumentFiles([join(dir, 'docs')]);
    const before = new Map(files.map((f) => [f, readFileSync(f)]));
    const report = await reencryptFiles({ files, passphrase: OLD_PASS, current: ks.current! });
    const status = new Map(report.results.map((r) => [r.path, r.status]));

    expect(status.get(foreign)).toBe('cannot-decrypt');
    expect(status.get(garbage)).toBe('bad-format');
    expect(status.get(damaged)).toBe('cannot-decrypt');
    expect(status.get(truncated)).toBe('bad-format');
    expect(status.get(current)).toBe('already-current');
    expect(status.get(damagedCurrent)).toBe('cannot-decrypt');
    for (const path of docs.keys()) expect(status.get(path)).toBe('converted');
    expect(report.converted).toBe(4);
    expect(report.alreadyCurrent).toBe(1);
    expect(report.failed).toBe(5);

    // every file that was not converted is byte-for-byte unchanged
    for (const f of [foreign, garbage, damaged, truncated, current, damagedCurrent]) {
      expect(readFileSync(f).equals(before.get(f)!)).toBe(true);
    }
    for (const [path, text] of docs) expect(decryptContainer(readFileSync(path), ks.current!).toString('utf8')).toBe(text);
  });

  it('can be cancelled between files, leaving the rest untouched and still valid', async () => {
    const files = await collectDocumentFiles([join(dir, 'docs')]);
    let seen = 0;
    const report = await reencryptFiles({
      files,
      passphrase: OLD_PASS,
      current: ks.current!,
      isCancelled: () => seen++ >= 2,
    });
    expect(report.cancelled).toBe(true);
    expect(report.results.length).toBe(2);
    expect(report.converted).toBe(2);
    // every file opens under exactly one of the two keys: none is half converted
    for (const [path, text] of docs) {
      const data = readFileSync(path);
      const underNew = headerMatchesKey(parseHeader(data), ks.current!);
      expect(decryptContainer(data, underNew ? ks.current! : oldKey).toString('utf8')).toBe(text);
    }
    // the remainder can be finished later
    const second = await reencryptFiles({ files, passphrase: OLD_PASS, current: ks.current! });
    expect(second.converted).toBe(2);
    expect(second.alreadyCurrent).toBe(2);
  });

  it('a file that cannot be replaced is reported and stays intact (never half converted)', async () => {
    const target = join(dir, 'docs', 'a.slpg');
    const before = readFileSync(target);
    chmodSync(target, 0o444); // read-only: on Windows the final rename is refused
    try {
      const report = await reencryptFiles({ files: [target], passphrase: OLD_PASS, current: ks.current! });
      const status = report.results[0]!.status;
      expect(['io-error', 'converted']).toContain(status);
      const after = readFileSync(target);
      if (status === 'io-error') {
        expect(after.equals(before)).toBe(true);
        expect(decryptContainer(after, oldKey).toString('utf8')).toBe(docs.get(target));
      } else {
        expect(decryptContainer(after, ks.current!).toString('utf8')).toBe(docs.get(target));
      }
      expect(readdirSync(join(dir, 'docs')).some((n) => isTempFileName(n))).toBe(false);
    } finally {
      chmodSync(target, 0o666);
    }
  });

  it('converts files written under several previous keys that share the old passphrase', async () => {
    // a second "old" key with the same passphrase but a different salt (e.g. another machine's setup)
    const salt2 = Buffer.alloc(KDF_SALT_BYTES, 5);
    const key2: MasterKey = { key: await deriveKey(OLD_PASS, salt2, FAST_KDF), params: FAST_KDF, salt: salt2 };
    const extra = join(dir, 'docs', 'extra.slpg');
    writeFileSync(extra, encryptContainer(Buffer.from('from another salt'), key2));
    const files = await collectDocumentFiles([join(dir, 'docs')]);
    const report = await reencryptFiles({ files, passphrase: OLD_PASS, current: ks.current! });
    expect(report.converted).toBe(5);
    expect(decryptContainer(readFileSync(extra), ks.current!).toString()).toBe('from another salt');
  });
});
