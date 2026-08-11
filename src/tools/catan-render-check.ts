// Visual regression check for the Catan scene. Renders a fixed set of views and fingerprints
// each frame, so a refactor can be *proven* not to change what's drawn rather than eyeballed.
//
//   pnpm catan:check capture    # record the current renders as the baseline
//   pnpm catan:check            # re-render and report which views changed (exit 1 if any)
//
// The fingerprint is a hash of the downsampled frame — the same bytes a .ppm snapshot would
// contain — so a match here means the snapshot images are byte-identical too. The baseline is a
// small text manifest (one line per view), which diffs cleanly and costs nothing to keep.
//
// Every view must be deterministic. The dice roll is deliberately absent: it seeds itself from
// Math.random(), so it differs between any two runs and can't be fingerprinted.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { downsample, RenderTarget } from '../engine/index.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { type PortKind } from '../arcade/games/catan/mesh/index.ts';
import { type PlayerColor, type Terrain, TERRAINS } from '../rules/catan/types.ts';

const MANIFEST = '.snapshots/catan-render.manifest';
const SS = 4; // supersample factor, matching `pnpm snapshot catan`

interface View {
  name: string;
  cols?: number;
  rows?: number;
  time?: number; // passed to renderScene: drives water + the animated tile overlays
  frames?: number; // step this many 60fps frames first (the board placement fly-in)
  setup: (scene: TileScene) => void;
}

const terrainViews: View[] = TERRAINS.map((t) => ({
  name: `tile-${t}`,
  setup: (s) => s.setTerrain(t as Terrain),
}));

const portViews: View[] = (['generic', 'brick', 'grain', 'lumber', 'ore', 'wool'] as const).map((kind) => ({
  name: `port-${kind}`,
  setup: (s: TileScene) => {
    s.setMode('port');
    s.setPortKind(kind as PortKind);
  },
}));

const pieceViews: View[] = (['red', 'blue', 'purple', 'orange'] as const).map((color) => ({
  name: `pieces-${color}`,
  setup: (s: TileScene) => {
    s.setMode('pieces');
    s.setActiveColor(color as PlayerColor);
  },
}));

const VIEWS: View[] = [
  ...terrainViews,
  { name: 'tile-desert-robber', setup: (s) => { s.setTerrain('desert'); s.setRobber(true); } },
  // Orbited, then time-driven: the second pair exercises the animated overlays (windmill rotor,
  // walking sheep) that a static render leaves frozen.
  { name: 'tile-fields-orbit', setup: (s) => { s.setTerrain('fields'); s.orbit(-84, 0); } },
  { name: 'tile-fields-t', time: 1.4, setup: (s) => s.setTerrain('fields') },
  { name: 'tile-pasture-t', time: 2.1, setup: (s) => s.setTerrain('pasture') },
  ...portViews,
  ...pieceViews,
  { name: 'board', cols: 140, rows: 50, setup: (s) => { s.setMode('board'); s.settle(); } },
  { name: 'board-water', cols: 140, rows: 50, time: 1.0, setup: (s) => { s.setMode('board'); s.settle(); } },
  { name: 'board-edit', cols: 140, rows: 50, setup: (s) => { s.setMode('board'); s.settle(); s.seedDemo(); } },
  { name: 'board-flyin', cols: 140, rows: 50, frames: 24, setup: (s) => { s.setMode('board'); s.reroll(); } },
];

// Render one view and hash the frame the terminal would actually show.
function fingerprint(view: View): string {
  const cols = view.cols ?? 120;
  const rows = view.rows ?? 44;
  const scene = new TileScene();
  view.setup(scene);
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (view.frames) for (let f = 1; f <= view.frames; f++) scene.renderScene(target, f / 60);
  else scene.renderScene(target, view.time ?? 0);
  const display = downsample(target, SS);
  const bytes = Buffer.alloc(display.width * display.height * 3);
  const c = display.color;
  for (let i = 0; i < bytes.length; i++) bytes[i] = c[i] <= 0 ? 0 : c[i] >= 255 ? 255 : Math.round(c[i]);
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function render(): Map<string, string> {
  const out = new Map<string, string>();
  for (const view of VIEWS) out.set(view.name, fingerprint(view));
  return out;
}

function readManifest(): Map<string, string> {
  const raw = readFileSync(MANIFEST, 'utf8');
  const m = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const [name, hash] = line.split('\t');
    if (name && hash) m.set(name, hash);
  }
  return m;
}

const mode = process.argv[2] ?? 'compare';

if (mode === 'capture') {
  const now = render();
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, [...now].map(([n, h]) => `${n}\t${h}`).join('\n') + '\n');
  console.log(`captured ${now.size} views → ${MANIFEST}`);
} else if (mode === 'compare') {
  let before: Map<string, string>;
  try {
    before = readManifest();
  } catch {
    console.error(`no baseline at ${MANIFEST} — run \`pnpm catan:check capture\` on the known-good tree first`);
    process.exit(2);
  }
  const now = render();
  const changed: string[] = [];
  for (const [name, hash] of now) {
    const was = before.get(name);
    if (was === undefined) console.log(`  new      ${name}`);
    else if (was !== hash) {
      changed.push(name);
      console.log(`  CHANGED  ${name}  ${was} → ${hash}`);
    }
  }
  for (const name of before.keys()) if (!now.has(name)) console.log(`  removed  ${name}`);
  if (changed.length) {
    console.error(`\n${changed.length}/${now.size} views changed. If intended, re-run with \`capture\`; else the change is not visually inert.`);
    process.exit(1);
  }
  console.log(`all ${now.size} views identical to the baseline`);
} else {
  console.error(`usage: pnpm catan:check [capture|compare]`);
  process.exit(2);
}
