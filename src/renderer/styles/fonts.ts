/**
 * Catalogue of the fonts bundled in assets/fonts/. Style definitions pick the
 * families they need:  fontFaces: [...FONTS.inter, ...FONTS.jetbrainsMono]
 *
 * All fonts are open licensed; see assets/fonts/<family>/LICENSE.txt and the
 * README. A style that needs another font adds the files under assets/fonts/
 * and lists its own FontFaceDef entries.
 */
import type { FontFaceDef } from './schema';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const GREEK = 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const VIETNAMESE =
  'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB';

const RANGES = { latin: LATIN, 'latin-ext': LATIN_EXT, greek: GREEK, cyrillic: CYRILLIC, vietnamese: VIETNAMESE } as const;
type Subset = keyof typeof RANGES;

function variable(family: string, dir: string, prefix: string, subsets: Subset[], weight: string, italic: boolean): FontFaceDef[] {
  const faces: FontFaceDef[] = [];
  for (const subset of subsets) {
    faces.push({ family, file: `${dir}/${prefix}-${subset}-wght-normal.woff2`, weight, style: 'normal', unicodeRange: RANGES[subset] });
    if (italic) {
      faces.push({ family, file: `${dir}/${prefix}-${subset}-wght-italic.woff2`, weight, style: 'italic', unicodeRange: RANGES[subset] });
    }
  }
  return faces;
}

export const FONTS = {
  /** "Inter" - variable, weights 100-900, upright + italic. */
  inter: variable('Inter', 'inter', 'inter', ['latin', 'latin-ext', 'greek', 'cyrillic'], '100 900', true),
  /** "Bricolage Grotesque" - variable, weights 200-800, upright only. */
  bricolageGrotesque: variable('Bricolage Grotesque', 'bricolage-grotesque', 'bricolage-grotesque', ['latin', 'latin-ext', 'vietnamese'], '200 800', false),
  /** "Source Serif 4" - variable, weights 200-900, upright + italic. */
  sourceSerif4: variable('Source Serif 4', 'source-serif-4', 'source-serif-4', ['latin', 'latin-ext', 'greek', 'cyrillic'], '200 900', true),
  /** "JetBrains Mono" - variable, weights 100-800, upright + italic. */
  jetbrainsMono: variable('JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono', ['latin', 'latin-ext', 'greek', 'cyrillic'], '100 800', true),
  /** "Young Serif" - single weight 400, upright only. */
  youngSerif: [
    { family: 'Young Serif', file: 'young-serif/young-serif-latin-400-normal.woff2', weight: '400', style: 'normal', unicodeRange: LATIN },
    { family: 'Young Serif', file: 'young-serif/young-serif-latin-ext-400-normal.woff2', weight: '400', style: 'normal', unicodeRange: LATIN_EXT },
  ] as FontFaceDef[],
  /** "Glass TTY VT220" - bitmap-style pixel font, single weight, designed for 20px (and multiples). */
  glassTty: [{ family: 'Glass TTY VT220', file: 'glass-tty-vt220/Glass_TTY_VT220.ttf', weight: '400', style: 'normal' }] as FontFaceDef[],
} as const;

/** Fallback stacks to append after a bundled family. */
export const FALLBACK = {
  sans: 'system-ui, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", monospace',
} as const;
