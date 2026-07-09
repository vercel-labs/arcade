// Bake the menu's game-tile art to public/assets/games/<id>.png. The tiles render
// these as blocky (half-block) backgrounds, so simple, bold icons read best at the
// tiny tile size. Source: Google's Noto Emoji (Apache-2.0 / OFL) — permissive and
// hotlinkable via jsDelivr. Run:
//
//   pnpm exec tsx src/tools/fetch-games.ts
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from '../engine/index.ts';

const noto = (cp: string): string => `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/png/128/emoji_u${cp}.png`;

// Menu item id → Noto emoji codepoint. Chosen to read as the game at a glance.
const ART: Record<string, string> = {
  chess: '265f', // ♟ chess pawn
  logos: '1f916', // 🤖 robot
  audio: '1f3a4', // 🎤 microphone
  ui: '1f3a8', // 🎨 artist palette
  codenames: '1f575', // 🕵 detective
  poker: '2660', // ♠ black spade suit
  // pacman: not a Noto emoji — its cover is the classic sprite from Wikimedia
  // Commons (File:Original PacMan.png, transparent, "PD shape"), committed
  // directly to public/assets/games/pacman.png and NOT managed by this tool.
  frogger: '1f438', // 🐸 frog
  'space-invaders': '1f47e', // 👾 alien monster
  'street-fighter': '1f94a', // 🥊 boxing glove
};

const DIR = 'public/assets/games';
mkdirSync(DIR, { recursive: true });

for (const [id, cp] of Object.entries(ART)) {
  const url = noto(cp);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAIL ${id}: ${res.status} ${res.statusText} (${url})`);
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tex = decodePng(bytes); // validate it decodes before baking
  writeFileSync(`${DIR}/${id}.png`, bytes);
  console.log(`baked ${id} (${tex.width}x${tex.height}) <- ${url}`);
}
