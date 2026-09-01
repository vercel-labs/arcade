import { FONT } from '../../engine/font8x8.ts';
import type { RGB } from '../../engine/color.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { isRed, RANK_LABELS, type Card } from '../../rules/poker/cards.ts';

const W = 250;
const H = 350;
const WHITE: RGB = [252, 250, 246];
const BLACK: RGB = [14, 14, 18];
const RED: RGB = [208, 20, 34];
const faceCache = new Map<string, Texture>();
const suitTextures = new Map<number, Texture>();
const courtTextures = new Map<string, Texture>();
let preparation: Promise<void> | null = null;

const SUITS = ['spade', 'heart', 'diamond', 'club'] as const;
const COURTS = ['jack', 'queen', 'king'] as const;

/** Load the exact PNG artwork used by the terminal card-face provider. */
export function preparePokerCardTextures(): Promise<void> {
  const runtime = globalThis as unknown as { createImageBitmap?: unknown };
  if (!runtime.createImageBitmap) return Promise.resolve();
  preparation ??= Promise.all([
    ...SUITS.map(async (name, suit) => suitTextures.set(suit, await loadTexture(new URL(`../../../assets/poker/${name}.png`, import.meta.url).toString()))),
    ...COURTS.flatMap((court, rankIndex) => SUITS.map(async (suit, suitIndex) => {
      courtTextures.set(`${rankIndex + 10}:${suitIndex}`, await loadTexture(new URL(`../../../assets/poker/face cards/${court} of ${suit}s.png`, import.meta.url).toString()));
    })),
  ]).then(() => { faceCache.clear(); });
  return preparation;
}

/** Browser-safe counterpart to Arcade's production card-face generator. */
export function pokerCardFaceTexture(card: Card): Texture {
  const key = `${card.rank}:${card.suit}`;
  const cached = faceCache.get(key);
  if (cached) return cached;
  const texture = solidTexture(W, H, WHITE);
  const ink = isRed(card) ? RED : BLACK;
  drawLabel(texture, RANK_LABELS[card.rank], 7, 6, ink, 5);
  drawSuit(texture, card.suit, 25, 78, 13, ink);
  drawLabel(texture, RANK_LABELS[card.rank], W - 7, H - 6, ink, 5, true);
  drawSuit(texture, card.suit, W - 25, H - 78, 13, ink, true);
  const court = courtTextures.get(`${card.rank}:${card.suit}`);
  if (court) stampTexture(texture, court, 38, 30, 174, 290, ink, false);
  else {
    const layout = pipLayout(card.rank);
    for (const [x, y, invert] of layout) drawSuit(texture, card.suit, x * W, y * H, card.rank === 0 ? 45 : 24, ink, invert);
  }
  faceCache.set(key, texture);
  return texture;
}

let back: Texture | undefined;
export function pokerCardBackTexture(): Texture {
  if (back) return back;
  back = solidTexture(200, 280, [156, 22, 30]);
  const cx = back.width / 2;
  const halfBase = back.width * 0.14;
  const triangleHeight = halfBase * Math.sqrt(3);
  const middleY = back.height * 0.47;
  const apexY = middleY - triangleHeight / 2;
  const baseY = middleY + triangleHeight / 2;
  for (let y = Math.floor(apexY); y <= Math.ceil(baseY); y++) {
    const halfWidth = halfBase * ((y - apexY) / (baseY - apexY));
    for (let x = Math.ceil(cx - halfWidth); x <= Math.floor(cx + halfWidth); x++) put(back, x, y, [244, 242, 238]);
  }
  return back;
}

function solidTexture(width: number, height: number, color: RGB): Texture {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = color[0]; data[i * 4 + 1] = color[1]; data[i * 4 + 2] = color[2]; data[i * 4 + 3] = 255; }
  return { width, height, data };
}

function drawLabel(tex: Texture, label: string, x: number, y: number, color: RGB, scale: number, rotate = false): void {
  const width = label.length * 7 * scale;
  for (const ch of label) {
    const glyph = FONT[ch] ?? FONT['?'];
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) if (glyph[gy][gx] === '1') {
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = x + gx * scale + sx;
        const py = y + gy * scale + sy;
        put(tex, rotate ? x - (px - (x - width)) : px, rotate ? y - (py - (y - 8 * scale)) : py, color);
      }
    }
    x += 7 * scale;
  }
}

function drawSuit(tex: Texture, suit: number, cx: number, cy: number, r: number, color: RGB, invert = false): void {
  const source = suitTextures.get(suit);
  if (source) {
    stampTexture(tex, source, cx - r, cy - r * 1.2, r * 2, r * 2.4, color, invert);
    return;
  }
  const ySign = invert ? -1 : 1;
  for (let py = -r * 1.45; py <= r * 1.55; py++) for (let px = -r; px <= r; px++) {
    const x = px / r;
    const y = (py / r) * ySign;
    let inside = false;
    if (suit === 1) inside = heart(x, y);
    else if (suit === 2) inside = Math.abs(x) + Math.abs(y) < 1.05;
    else if (suit === 0) inside = spade(x, y);
    else inside = club(x, y);
    if (inside) put(tex, Math.round(cx + px), Math.round(cy + py), color);
  }
}

function stampTexture(target: Texture, source: Texture, x: number, y: number, width: number, height: number, color: RGB, invert: boolean): void {
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const sx = Math.max(0, Math.min(source.width - 1, Math.floor((px / width) * source.width)));
    const sy0 = Math.max(0, Math.min(source.height - 1, Math.floor((py / height) * source.height)));
    const sy = invert ? source.height - 1 - sy0 : sy0;
    const si = (sy * source.width + sx) * 4;
    const coverage = Math.max(0, Math.min(1, (255 - Math.min(source.data[si], source.data[si + 1], source.data[si + 2])) / 190)) * (source.data[si + 3] / 255);
    if (coverage < 0.08) continue;
    blend(target, Math.floor(x + px), Math.floor(y + py), color, coverage);
  }
}

function heart(x: number, y: number): boolean { const xx = x * x + (y + 0.15) * (y + 0.15) - 0.75; return xx * xx * xx - x * x * (y + 0.15) * (y + 0.15) * 1.7 <= 0; }
function spade(x: number, y: number): boolean { return heart(x, -y - 0.18) || (Math.abs(x) < 0.2 + Math.max(0, y) * 0.08 && y > 0.35 && y < 1.35); }
function club(x: number, y: number): boolean {
  const circle = (cx: number, cy: number, rr: number) => (x - cx) ** 2 + (y - cy) ** 2 < rr * rr;
  return circle(0, -0.42, 0.48) || circle(-0.4, 0.05, 0.48) || circle(0.4, 0.05, 0.48) || (Math.abs(x) < 0.2 && y > 0.18 && y < 1.35);
}

function pipLayout(rank: number): Array<[number, number, boolean]> {
  if (rank >= 10) return [[0.5, 0.52, false]];
  const rows = rank === 0 ? [0.5] : rank < 4 ? [0.28, 0.72] : rank < 7 ? [0.25, 0.5, 0.75] : [0.22, 0.4, 0.6, 0.78];
  const count = rank + 1;
  const out: Array<[number, number, boolean]> = [];
  for (let i = 0; i < count; i++) {
    const row = rows[i % rows.length];
    const x = count <= 3 || i === count - 1 && count % 2 ? 0.5 : i % 2 ? 0.68 : 0.32;
    out.push([x, row, row > 0.5]);
  }
  return out;
}

function put(tex: Texture, x: number, y: number, color: RGB): void {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return;
  const i = (Math.floor(y) * tex.width + Math.floor(x)) * 4;
  tex.data[i] = color[0]; tex.data[i + 1] = color[1]; tex.data[i + 2] = color[2]; tex.data[i + 3] = 255;
}

function blend(tex: Texture, x: number, y: number, color: RGB, alpha: number): void {
  if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return;
  const i = (y * tex.width + x) * 4;
  tex.data[i] = tex.data[i] * (1 - alpha) + color[0] * alpha;
  tex.data[i + 1] = tex.data[i + 1] * (1 - alpha) + color[1] * alpha;
  tex.data[i + 2] = tex.data[i + 2] * (1 - alpha) + color[2] * alpha;
}

async function loadTexture(url: string): Promise<Texture> {
  const runtime = globalThis as unknown as PokerImageRuntime;
  const response = await runtime.fetch(url);
  const bitmap = await runtime.createImageBitmap(await response.blob());
  const canvas = runtime.OffscreenCanvas ? new runtime.OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(runtime.document!.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to decode Poker artwork');
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data) };
}

interface PokerImageRuntime {
  fetch(input: string): Promise<{ blob(): Promise<unknown> }>;
  createImageBitmap(blob: unknown): Promise<{ width: number; height: number }>;
  OffscreenCanvas?: new (width: number, height: number) => PokerCanvas;
  document?: { createElement(tag: 'canvas'): PokerCanvas };
}
interface PokerCanvas {
  width: number;
  height: number;
  getContext(id: '2d'): null | { drawImage(image: unknown, x: number, y: number): void; getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> } };
}
