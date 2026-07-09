import { inflateSync } from 'node:zlib';
import type { RGBA } from './color.ts';

// An RGBA8 image in memory: row-major, top-left origin, 4 bytes/pixel. The
// engine's only image primitive — decode a PNG into one (decodePng) then read it
// with sampleTexture. Knows nothing about where the bytes came from (the app
// reads files / fetches URLs and hands us the buffer), matching parseObj.
export interface Texture {
  width: number;
  height: number;
  data: Uint8Array;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// colorType -> channels per pixel. 0 gray, 2 rgb, 3 palette(index), 4 gray+a, 6 rgba.
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Decode a PNG (8-bit, non-interlaced) to an RGBA8 Texture using only node:zlib —
// no native deps. Handles all five color types plus tRNS transparency, which
// covers the AI Gateway logos (8-bit RGBA) and typical web PNGs. Throws on the
// formats we don't need yet (16-bit, Adam7 interlace) rather than guessing.
export function decodePng(input: Uint8Array): Texture {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  for (let i = 0; i < 8; i++) {
    if (b[i] !== PNG_SIG[i]) throw new Error('decodePng: not a PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];

  for (let pos = 8; pos < b.length; ) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('decodePng: interlaced PNGs are unsupported');
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len; // length(4) + type(4) + data + crc(4)
  }

  if (bitDepth !== 8) throw new Error(`decodePng: only 8-bit supported (got ${bitDepth})`);
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`decodePng: bad color type ${colorType}`);

  const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, channels);
  return { width, height, data: toRgba(raw, width, height, colorType, channels, palette, trns) };
}

// Reverse PNG per-scanline filters (None/Sub/Up/Average/Paeth) in place, leaving
// `channels` bytes per pixel with no filter bytes. Each scanline is prefixed by
// one filter byte that references the pixel to the left (a) and above (b/c).
function unfilter(inflated: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[p++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const cur = inflated[p++];
      const a = x >= channels ? out[row + x - channels] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const ul = y > 0 && x >= channels ? out[prev + x - channels] : 0;
      let v: number;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + up;
      else if (filter === 3) v = cur + ((a + up) >> 1);
      else if (filter === 4) v = cur + paeth(a, up, ul);
      else throw new Error(`decodePng: bad filter ${filter}`);
      out[row + x] = v & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Expand unfiltered channel bytes into a flat RGBA8 buffer, resolving palette
// indices and tRNS transparency (palette alpha table, or an rgb/gray color key).
function toRgba(
  raw: Buffer,
  width: number,
  height: number,
  colorType: number,
  channels: number,
  palette: Buffer | null,
  trns: Buffer | null,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const s = i * channels;
    const o = i * 4;
    let r: number;
    let g: number;
    let bl: number;
    let a = 255;
    if (colorType === 6) {
      r = raw[s];
      g = raw[s + 1];
      bl = raw[s + 2];
      a = raw[s + 3];
    } else if (colorType === 2) {
      r = raw[s];
      g = raw[s + 1];
      bl = raw[s + 2];
      if (trns && trns[1] === r && trns[3] === g && trns[5] === bl) a = 0; // 16-bit-padded rgb key
    } else if (colorType === 3 && palette) {
      const idx = raw[s];
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      bl = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 4) {
      r = g = bl = raw[s];
      a = raw[s + 1];
    } else {
      r = g = bl = raw[s]; // grayscale
      if (trns && trns[1] === r) a = 0;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
    out[o + 3] = a;
  }
  return out;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// Bilinearly sample a texture at uv in [0,1] (clamped at the edges). Returns the
// engine's RGBA convention: rgb 0..255, alpha 0..1 — so the result drops straight
// into blendOver()/plot() without conversion. v=0 is the top row.
//
// Writes into a single reused tuple (no per-pixel array + `lerp` closure): the
// textured fragment shaders (coverMaterial for cards, logoMaterial for wisps) call
// this once per covered pixel, so a fresh 4-array + closure each time was real GC
// churn at high resolution. Callers read the result synchronously into scalars
// before the next call, so a shared mutable return is safe.
const SAMPLE: RGBA = [0, 0, 0, 0];
export function sampleTexture(tex: Texture, u: number, v: number): RGBA {
  const { width: W, height: H, data: d } = tex;
  const fx = clamp01(u) * (W - 1);
  const fy = clamp01(v) * (H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1);
  const y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * W + x0) * 4;
  const i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4;
  const i11 = (y1 * W + x1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = d[i00 + k] + (d[i10 + k] - d[i00 + k]) * tx;
    const bot = d[i01 + k] + (d[i11 + k] - d[i01 + k]) * tx;
    SAMPLE[k] = top + (bot - top) * ty;
  }
  SAMPLE[3] /= 255;
  return SAMPLE;
}
