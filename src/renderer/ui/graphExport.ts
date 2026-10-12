/**
 * Graph export as SVG or PNG. Exports are not encrypted, so each one asks for
 * confirmation first. The PNG path embeds the graph's fonts into the SVG,
 * because an SVG rasterised as an image cannot load the page's fonts.
 */
import type { AppController } from '../app/controller';
import { renderGraph } from '../../shared/graph/render';
import type { GraphTheme } from '../../shared/graph/types';
import type { Result } from '../../shared/ipc';
import { type GraphBlock, normalizeBlock } from '../../shared/model';
import { confirmDialog } from './dialogs';

const EXPORT_SIZE = { width: 1200, height: 700 };
const PNG_WIDTH = 2400;
const PNG_HEIGHT = 1400;
const BASE64_CHUNK = 0x8000;

export async function exportGraphAsSvg(app: AppController, spec: GraphBlock): Promise<void> {
  if (!(await confirmUnencrypted())) return;
  const svg = renderGraph(normalizeBlock(spec) as GraphBlock, exportTheme(app), EXPORT_SIZE).svg;
  const res = await app.api.exportGraph(exportName(spec), 'svg', svg);
  reportResult(app, res);
}

export async function exportGraphAsPng(app: AppController, spec: GraphBlock): Promise<void> {
  try {
    if (!(await confirmUnencrypted())) return;
    const theme = exportTheme(app);
    const svg = renderGraph(normalizeBlock(spec) as GraphBlock, theme, EXPORT_SIZE).svg;
    const withFonts = await embedFonts(app, svg, theme);
    const bytes = await rasterise(withFonts);
    const res = await app.api.exportGraph(exportName(spec), 'png', bytes);
    reportResult(app, res);
  } catch {
    app.toast('The graph could not be exported.', 'error');
  }
}

function confirmUnencrypted(): Promise<boolean> {
  return confirmDialog({
    title: 'Unencrypted export',
    message: 'The exported image is not encrypted. Anyone who can reach the file can see this graph and its data.',
    confirmLabel: 'Export',
    warning: true,
  });
}

/** The graph theme with the editor background, so light text stays readable outside the app. */
function exportTheme(app: AppController): GraphTheme {
  return { ...app.style.graphTheme, background: app.style.tokens.colors.editorBg };
}

/** A file name from the title: letters, digits, spaces, "-" and "_" only. */
function exportName(spec: GraphBlock): string {
  const cleaned = spec.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim();
  return cleaned === '' ? 'Graph' : cleaned;
}

function reportResult(app: AppController, res: Result<string>): void {
  if (res.ok) {
    app.toast('Graph exported (not encrypted).');
  } else if (res.code !== 'cancelled') {
    app.toast(res.message, 'error');
  }
}

/**
 * Insert an <defs><style> block with @font-face rules right after the opening
 * <svg> tag. Each font file is read once and embedded as a Base64 data URI.
 */
async function embedFonts(app: AppController, svg: string, theme: GraphTheme): Promise<string> {
  const families = new Set<string>();
  for (const stack of [theme.fontFamily, theme.titleFontFamily]) {
    for (const part of stack.split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '').trim();
      if (name !== '') families.add(name);
    }
  }
  const faces = app.style.def.fontFaces.filter((face) => families.has(face.family));
  const encoded = new Map<string, string>();
  for (const file of new Set(faces.map((face) => face.file))) {
    const bytes = await app.api.fontData(file);
    if (bytes) encoded.set(file, toBase64(bytes));
  }

  const rules: string[] = [];
  for (const face of faces) {
    const data = encoded.get(face.file);
    if (data === undefined) continue;
    const lower = face.file.toLowerCase();
    const format = lower.endsWith('.woff2') ? 'woff2' : lower.endsWith('.woff') ? 'woff' : 'ttf';
    const formatName = format === 'ttf' ? 'truetype' : format;
    const family = face.family.replace(/["\\]/g, '');
    const range = face.unicodeRange ? `unicode-range:${face.unicodeRange};` : '';
    rules.push(
      `@font-face{font-family:"${family}";src:url(data:font/${format};base64,${data}) format("${formatName}");` +
        `font-weight:${face.weight};font-style:${face.style};${range}}`,
    );
  }
  if (rules.length === 0) return svg;

  const end = svg.indexOf('>');
  if (end < 0) return svg;
  return `${svg.slice(0, end + 1)}<defs><style>${rules.join('')}</style></defs>${svg.slice(end + 1)}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Draw an SVG document onto a 2x canvas and return the PNG bytes. */
async function rasterise(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The graph image could not be loaded.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = PNG_WIDTH;
    canvas.height = PNG_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('A canvas is not available.');
    ctx.drawImage(image, 0, 0, PNG_WIDTH, PNG_HEIGHT);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('The PNG could not be encoded.'))), 'image/png');
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
