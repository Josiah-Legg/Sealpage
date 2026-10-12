import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFile, cleanStaleTempFiles, isTempFileName, tempPathFor } from '../../../src/main/fs/atomic';
import { makeTempDir } from './helpers';

describe('atomic file replacement', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => ({ dir, cleanup } = makeTempDir()));
  afterEach(() => cleanup());

  it('creates and replaces files, leaving no temp files', async () => {
    const target = join(dir, 'doc.slpg');
    await atomicWriteFile(target, Buffer.from('one'));
    expect(readFileSync(target, 'utf8')).toBe('one');
    await atomicWriteFile(target, Buffer.from('two, longer than before'), { verify: true });
    expect(readFileSync(target, 'utf8')).toBe('two, longer than before');
    await atomicWriteFile(target, Buffer.alloc(0));
    expect(readFileSync(target).length).toBe(0);
    expect(readdirSync(dir)).toEqual(['doc.slpg']);
  });

  it('survives many concurrent saves of different files', async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => atomicWriteFile(join(dir, `f${i}.slpg`), Buffer.from(`content ${i}`))));
    for (let i = 0; i < 40; i++) expect(readFileSync(join(dir, `f${i}.slpg`), 'utf8')).toBe(`content ${i}`);
    expect(readdirSync(dir).some(isTempFileName)).toBe(false);
  });

  it('leaves the target untouched when the write cannot happen', async () => {
    const target = join(dir, 'missing-folder', 'doc.slpg');
    await expect(atomicWriteFile(target, Buffer.from('x'))).rejects.toThrow();
    expect(existsSync(target)).toBe(false);

    // target is a directory: rename must fail, original stays, temp is removed
    const asDir = join(dir, 'occupied.slpg');
    mkdirSync(asDir);
    writeFileSync(join(asDir, 'keep.txt'), 'keep');
    await expect(atomicWriteFile(asDir, Buffer.from('x'))).rejects.toThrow();
    expect(readFileSync(join(asDir, 'keep.txt'), 'utf8')).toBe('keep');
    expect(readdirSync(dir).some(isTempFileName)).toBe(false);
  });

  it('names temp files recognisably and in the same folder as the target', () => {
    const target = join(dir, 'My Notes.slpg');
    const tmp = tempPathFor(target);
    expect(tmp.startsWith(dir)).toBe(true);
    const name = tmp.slice(dir.length + 1);
    expect(name).toMatch(/^\.My Notes\.slpg\.[0-9a-f]{16}\.sealpage-tmp$/);
    expect(isTempFileName(name)).toBe(true);
    expect(isTempFileName('My Notes.slpg')).toBe(false);
    expect(isTempFileName('.hidden.slpg')).toBe(false);
    expect(isTempFileName('notes.sealpage-tmp')).toBe(false);
    expect(tempPathFor(target)).not.toBe(tmp);
  });

  it('removes stale temp files and nothing else', async () => {
    const stale1 = join(dir, '.doc.slpg.0123456789abcdef.sealpage-tmp');
    const stale2 = join(dir, '.other.slpg.fedcba9876543210.sealpage-tmp');
    writeFileSync(stale1, 'ciphertext');
    writeFileSync(stale2, 'ciphertext');
    writeFileSync(join(dir, 'doc.slpg'), 'real');
    writeFileSync(join(dir, 'notes.txt'), 'real');
    mkdirSync(join(dir, '.dir.slpg.0123456789abcdef.sealpage-tmp'));
    expect(await cleanStaleTempFiles(dir)).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['.dir.slpg.0123456789abcdef.sealpage-tmp', 'doc.slpg', 'notes.txt']);
    expect(await cleanStaleTempFiles(dir)).toBe(0);
    expect(await cleanStaleTempFiles(join(dir, 'does-not-exist'))).toBe(0);
  });
});
