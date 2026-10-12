// Renders build/icon.svg to build/icon.ico (16-256 px) using Electron's own
// renderer, so no image tooling is needed. Run with:  npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const SIZES = [256, 128, 64, 48, 32, 24, 16];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const pngs = SIZES.map((size) => ({ size, data: (size === 256 ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG() }));
  writeFileSync(join(root, 'build/icon.ico'), ico(pngs));
  writeFileSync(join(root, 'build/icon.png'), pngs[0].data);
  console.log('wrote build/icon.ico', pngs.map((p) => `${p.size}px:${p.data.length}b`).join(' '));
  app.quit();
});
