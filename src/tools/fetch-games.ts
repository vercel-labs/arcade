// Bake the menu's game-tile art to assets/games/<id>.png. The tiles render
// these as blocky (half-block) backgrounds, so simple, bold icons read best at the
// tiny tile size. Source: Google's Noto Emoji (Apache-2.0 / OFL) — permissive and
// hotlinkable via jsDelivr. Run:
//
//   pnpm exec tsx src/tools/fetch-games.ts [cover-id ...]
//
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Texture } from '../engine/index.ts';
import { decodePng, encodePng } from '../engine/texture.ts';

const noto = (cp: string): string => `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/png/128/emoji_u${cp}.png`;
const artSource = (id: string, cp: string): string =>
  id === 'achievements'
    ? 'https://www.emoji.family/api/emojis/1f396/noto/png'
    : noto(cp);

// Menu item id → Noto emoji codepoint. Chosen to read as the game at a glance.
const ART: Record<string, string> = {
  chess: '265f', // ♟ chess pawn
  logos: '1f916', // 🤖 robot
  audio: '1f3a4', // 🎤 microphone
  ui: '1f3a8', // 🎨 artist palette
  leaderboard: '1f3c6', // 🏆 trophy
  achievements: '1f396', // 🎖 military medal
  codenames: '1f575', // 🕵 detective
  // pacman: not a Noto emoji — its cover is the classic sprite from Wikimedia
  // Commons (File:Original PacMan.png, transparent, "PD shape"), committed
  // directly to assets/games/pacman.png and NOT managed by this tool.
  frogger: '1f438', // 🐸 frog
  'space-invaders': '1f47e', // 👾 alien monster
  'street-fighter': '1f94a', // 🥊 boxing glove
};

// Poker's cover is a 2×2 grid of the four card suits rather than a single emoji,
// laid out so the two black suits sit on one diagonal and the two red on the other:
//   ♠ ♥
//   ♦ ♣
const POKER_SUITS = [
  { cp: '2660', kind: 'black' }, // ♠
  { cp: '2665', kind: 'red' }, //   ♥
  { cp: '2666', kind: 'red' }, //   ♦
  { cp: '2663', kind: 'black' }, // ♣
] as const;

const DIR = 'assets/games';
const requested = new Set(process.argv.slice(2));
const wanted = (id: string): boolean => requested.size === 0 || requested.has(id);
mkdirSync(DIR, { recursive: true });

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Balance the suits so both colours read on the dark card stock: lift the
// near-black slate of ♠/♣ toward a lighter grey, and take a little heat out of the
// ♥/♦ red by nudging it toward its own luminance (a gentle desaturation). Alpha is
// left alone, so the transparent field and anti-aliased edges are unchanged.
function balanceSuit(tex: Texture, kind: 'black' | 'red'): void {
  const d = tex.data;
  const BLACK_LIFT = 0.32; // fraction toward the light grey below
  const LIGHT = [205, 209, 218];
  const RED_DESAT = 0.16; // fraction toward luminance
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    if (kind === 'black') {
      d[i] = Math.round(r + (LIGHT[0] - r) * BLACK_LIFT);
      d[i + 1] = Math.round(g + (LIGHT[1] - g) * BLACK_LIFT);
      d[i + 2] = Math.round(b + (LIGHT[2] - b) * BLACK_LIFT);
    } else {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = Math.round(r + (lum - r) * RED_DESAT);
      d[i + 1] = Math.round(g + (lum - g) * RED_DESAT);
      d[i + 2] = Math.round(b + (lum - b) * RED_DESAT);
    }
  }
}

// Compose 2×2 tiles into one transparent square, each tile centred in its cell.
function grid2x2(tiles: Texture[]): Texture {
  const cell = Math.max(...tiles.map((t) => Math.max(t.width, t.height)));
  const side = cell * 2;
  const out: Texture = { width: side, height: side, data: new Uint8Array(side * side * 4) };
  tiles.forEach((tile, i) => {
    const cx = (i % 2) * cell + Math.floor((cell - tile.width) / 2);
    const cy = Math.floor(i / 2) * cell + Math.floor((cell - tile.height) / 2);
    for (let y = 0; y < tile.height; y++) {
      const src = y * tile.width * 4;
      const dst = ((cy + y) * side + cx) * 4;
      out.data.set(tile.data.subarray(src, src + tile.width * 4), dst);
    }
  });
  return out;
}

// Single-emoji covers: bake the fetched PNG bytes as-is (decode first only to validate).
for (const [id, cp] of Object.entries(ART)) {
  if (!wanted(id)) continue;
  try {
    const source = artSource(id, cp);
    const bytes = await fetchBytes(source);
    const tex = decodePng(bytes);
    writeFileSync(`${DIR}/${id}.png`, bytes);
    console.log(`baked ${id} (${tex.width}x${tex.height}) <- ${source}`);
  } catch (err) {
    console.error(`FAIL ${id}: ${err instanceof Error ? err.message : err}`);
  }
}

// Poker: composite the four suits into a grid and re-encode as one PNG.
if (wanted('poker')) try {
  const suits = await Promise.all(
    POKER_SUITS.map(async ({ cp, kind }) => {
      const tile = decodePng(await fetchBytes(noto(cp)));
      balanceSuit(tile, kind);
      return tile;
    }),
  );
  const tex = grid2x2(suits);
  writeFileSync(`${DIR}/poker.png`, encodePng(tex));
  console.log(`baked poker (${tex.width}x${tex.height}) <- 2×2 suit grid`);
} catch (err) {
  console.error(`FAIL poker: ${err instanceof Error ? err.message : err}`);
}
