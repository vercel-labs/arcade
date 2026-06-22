import { FONT } from './font8x8.ts';

// Shape-descriptor grid. Each character (and each image cell) is reduced to a
// GW×GH grid of coverage/brightness values, and a cell is rendered as the
// character whose descriptor is nearest in Euclidean distance — the shape-match
// approach from Alex Harri's "ASCII rendering" article (no luminance ramp).
export const GW = 3;
export const GH = 6;
const DIM = GW * GH;

// The character set the matcher may choose from. Letters/digits are excluded:
// with the full font, dense regions match dense letters (W, M, N) which reads as
// random "text soup". A symbol-only set keeps the shape matching but renders as
// a clean ASCII schematic. Widen to Object.keys(FONT) for the full-font look.
const CHARSET = ' .,\'`":;!|-_=~^+*/\\<>()[]{}?#%&@$';
const keys = Object.keys(FONT).filter((k) => CHARSET.includes(k));

// Coverage of a glyph: fraction of inked pixels falling in each grid region.
function coverage(rows: string[]): number[] {
  const sum = new Array(DIM).fill(0);
  const cnt = new Array(DIM).fill(0);
  for (let y = 0; y < 8; y++) {
    const row = rows[y];
    for (let x = 0; x < 8; x++) {
      const gx = Math.floor((x * GW) / 8);
      const gy = Math.floor((y * GH) / 8);
      const idx = gy * GW + gx;
      cnt[idx]++;
      if (row[x] === '1') sum[idx]++;
    }
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

// Raw coverage (fraction of ink per region). Alex normalizes each component by
// its cross-character max to spread glyphs apart for photographic input; but our
// scenes are high-contrast (bright shapes on black), and that normalization
// makes uniform-bright cells drift toward edge-ink glyphs. Raw coverage matches
// density faithfully here — a fully-lit cell goes to the densest glyph, a
// half-lit cell to the glyph inked on that half.
const charVectors = keys.map((k) => coverage(FONT[k]));
const charOutputs = keys.slice();

// Nearest character to a cell's (already contrast-enhanced) brightness vector.
export function matchGlyph(cell: number[]): string {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < charVectors.length; c++) {
    const v = charVectors[c];
    let d = 0;
    for (let i = 0; i < DIM; i++) {
      const diff = cell[i] - v[i];
      d += diff * diff;
    }
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return charOutputs[best];
}
