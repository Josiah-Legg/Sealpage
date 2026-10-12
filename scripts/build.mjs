// Bundles the three targets (main, preload, renderer) into dist/ with esbuild
// and copies static assets. Usage: node scripts/build.mjs [--production]
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const dist = join(root, 'dist');

execFileSync(process.execPath, [join(root, 'scripts/gen-style-index.mjs')], { stdio: 'inherit' });

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, 'src/main/main.ts')],
    outfile: join(dist, 'main/main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/preload/preload.ts')],
    outfile: join(dist, 'preload/preload.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: { app: join(root, 'src/renderer/main.ts') },
    outdir: join(dist, 'renderer'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
]);

cpSync(join(root, 'src/renderer/index.html'), join(dist, 'renderer/index.html'));
cpSync(join(root, 'assets/fonts'), join(dist, 'renderer/fonts'), { recursive: true });
if (existsSync(join(root, 'build/icon.ico'))) cpSync(join(root, 'build/icon.ico'), join(dist, 'icon.ico'));

console.log(`Built Sealpage (${production ? 'production' : 'development'}) into dist/`);
