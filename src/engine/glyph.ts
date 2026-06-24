import { FONT } from './font8x8.ts';

// Shape-descriptor grid. Each character (and each image cell) is reduced to a
// GW×GH grid of coverage/brightness values, and a cell is rendered as the
// character whose descriptor is nearest in Euclidean distance — the shape-match
// approach from Alex Harri's "ASCII rendering" article (no luminance ramp).
export const GW = 3;
export const GH = 6;
const DIM = GW * GH;

// The character set the matcher may choose from. Defaults to all 95 printable
// ASCII characters (as in Alex Harri's article) for maximum shape diversity, so
// the genuinely-best-matching glyph always wins. If a scene ever reads as noisy
// "text soup", you can narrow to a symbol-only subset for a cleaner schematic
// look at the cost of match fidelity, e.g.:
//   const CHARSET = ' .,\'`":;!|-_=~^+*/\\<>()[]{}?#%&@$';
//   const keys = Object.keys(FONT).filter((k) => CHARSET.includes(k));
const keys = Object.keys(FONT);

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
// Space first: it's the nearest match for the majority of cells (dark/empty
// regions), so checking it before everything else seeds a tight `bestDist`
// immediately, which lets the partial-distance early-out below reject most
// other glyphs within a couple of dimensions.
const orderedKeys = keys.includes(' ') ? [' ', ...keys.filter((k) => k !== ' ')] : keys;
const charVectors = orderedKeys.map((k) => coverage(FONT[k]));
const charOutputs = orderedKeys.slice();

// Total coverage (brightness) per glyph. Used for an EXACT lower-bound prune in
// matchGlyph: by Cauchy-Schwarz, the squared distance is at least
// (Σcell − Σglyph)² / DIM, so a glyph whose total coverage is far from the cell's
// can't beat the current best — we skip its full 18-dim distance without changing
// which glyph wins (iteration order is preserved, so ties resolve identically).
const charSums = charVectors.map((v) => {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += v[i];
  return s;
});

// Reused top-K buffers so the sampled path allocates nothing per cell.
const SAMPLE_K = 6;
const kd = new Array(SAMPLE_K);
const ki = new Array(SAMPLE_K);
const kw = new Array(SAMPLE_K);

// Picks the character for a cell's (contrast-enhanced) brightness vector.
// temperature <= 0: deterministic nearest match (argmin distance).
// temperature > 0: softmax sampling over the K nearest — like an LLM picking a
// high-probability token rather than always the top one — so a cell with
// several near-equal matches varies among them instead of locking to one glyph.
export function matchGlyph(cell: number[], temperature = 0): string {
  let cellSum = 0;
  for (let i = 0; i < DIM; i++) cellSum += cell[i];

  if (temperature <= 0) {
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < charVectors.length; c++) {
      // Brightness lower bound: if (Σcell−Σglyph)²/DIM ≥ bestDist this glyph
      // can't win, so skip its full distance. Exact (no output change).
      const dsum = cellSum - charSums[c];
      if (dsum * dsum >= bestDist * DIM) continue;
      const v = charVectors[c];
      let d = 0;
      for (let i = 0; i < DIM; i++) {
        const diff = cell[i] - v[i];
        d += diff * diff;
        if (d >= bestDist) break; // partial distance already loses — skip rest
      }
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return charOutputs[best];
  }

  for (let k = 0; k < SAMPLE_K; k++) {
    kd[k] = Infinity;
    ki[k] = -1;
  }
  for (let c = 0; c < charVectors.length; c++) {
    const worst = kd[SAMPLE_K - 1];
    const dsum = cellSum - charSums[c];
    if (dsum * dsum >= worst * DIM) continue; // brightness too far for the top-K
    const v = charVectors[c];
    let d = 0;
    for (let i = 0; i < DIM; i++) {
      const diff = cell[i] - v[i];
      d += diff * diff;
      if (d >= worst) break; // can't enter the top-K — skip rest
    }
    if (d < kd[SAMPLE_K - 1]) {
      let p = SAMPLE_K - 1;
      while (p > 0 && kd[p - 1] > d) {
        kd[p] = kd[p - 1];
        ki[p] = ki[p - 1];
        p--;
      }
      kd[p] = d;
      ki[p] = c;
    }
  }

  const d0 = kd[0];
  let sum = 0;
  for (let k = 0; k < SAMPLE_K; k++) {
    kw[k] = ki[k] < 0 ? 0 : Math.exp(-(kd[k] - d0) / temperature);
    sum += kw[k];
  }
  let r = Math.random() * sum;
  for (let k = 0; k < SAMPLE_K; k++) {
    r -= kw[k];
    if (r <= 0 && ki[k] >= 0) return charOutputs[ki[k]];
  }
  return charOutputs[ki[0]];
}
