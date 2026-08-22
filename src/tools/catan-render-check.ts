// Visual regression check for the Catan scene. Renders a fixed set of views and fingerprints
// each frame, so a refactor can be *proven* not to change what's drawn rather than eyeballed.
//
//   pnpm catan:check capture    # record the current renders as the baseline
//   pnpm catan:check            # re-render and report which views changed (exit 1 if any)
//
// Two kinds of view. A scene view fingerprints the downsampled frame — the same bytes a .ppm
// snapshot would contain — so a match means the snapshot images are byte-identical too. A composite
// view paints the HUD over that frame and fingerprints the emitted cells instead, which is the only
// way the card rail, the game screen and the resource-card arcs get covered at all. The baseline is
// a small text manifest (one line per view), which diffs cleanly and costs nothing to keep.
//
// Every view must be deterministic. The dice roll is deliberately absent: it seeds itself from
// Math.random(), so it differs between any two runs and can't be fingerprinted.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { downsample, RenderTarget, shapeGlyphToSurface, type Surface } from '../engine/index.ts';
import { Screen } from '../tui/index.ts';
import { TileScene } from '../arcade/games/catan/tile-scene.ts';
import { type PortKind } from '../arcade/games/catan/mesh/index.ts';
import { buildCatanTileRoot, mountCatanTileHud } from '../arcade/games/catan/tile-hud.ts';
import { CATAN_LOCAL_COLOR, catanHandLandingCell, catanSidebarOpen, toggleCatanSidebar } from '../arcade/games/catan/card-hud.ts';
import { ResourceFlights } from '../arcade/games/catan/scene/resource-flight.ts';
import { CatanGameScene } from '../arcade/games/catan/game-scene.ts';
import { buildCatanGameRoot, mountCatanGameHud } from '../arcade/games/catan/game-hud.ts';
import { CatanDriver, type CatanSeatSpec } from '../arcade/match/catan-driver.ts';
import { mulberry32 } from '../engine/index.ts';
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
  { name: 'board-robber-move', cols: 140, rows: 50, setup: (s) => { s.setMode('board'); s.settle(); s.beginRobberMove(); s.previewRobberHex(5); } },
];

// A composited view: the scene *with the HUD painted over it*, fingerprinted from the Surface the
// terminal would emit rather than from scene pixels. The scene-only views above are blind to the
// UI layer, which is where the card rail, the game screen's seat panel, the resource-card arcs and
// every label actually live — so a HUD regression would pass them unnoticed.
interface CompositeView {
  name: string;
  cols?: number;
  rows?: number;
  render: (cols: number, rows: number) => Surface;
}

// Paint `root` over a scene render, the way the app composites Catan (no hybrid shading, so the
// water around the island stays plain black).
function composite(cols: number, rows: number, draw: (target: RenderTarget) => void, mount: (screen: Screen) => void): Surface {
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  draw(target);
  const screen = new Screen(cols, rows);
  mount(screen);
  return screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: false }));
}

// The tile bed's own HUD (terrain panel + bar) over a scene set up by `setup`. `rail` opens the
// card sidebar, which is module-level state — restored afterward so view order can't leak.
function tileComposite(setup: (s: TileScene) => void, opts: { time?: number; rail?: boolean; flights?: (s: TileScene, w: number, h: number) => ResourceFlights } = {}): (cols: number, rows: number) => Surface {
  return (cols, rows) => {
    const scene = new TileScene();
    setup(scene);
    const wasOpen = catanSidebarOpen();
    if (!!opts.rail !== wasOpen) toggleCatanSidebar();
    try {
      const flights = opts.flights?.(scene, cols, rows);
      return composite(
        cols,
        rows,
        (target) => scene.renderScene(target, opts.time ?? 0),
        (screen) => {
          mountCatanTileHud(screen);
          const region = { x: 0, y: 0, w: cols, h: rows };
          const singlePort = scene.portSailLabel(cols, rows);
          screen.setRoot(
            buildCatanTileRoot(region, () => {}, scene.boardTokens(cols, rows), scene.currentMode(), singlePort ? [singlePort] : scene.boardPortLabels(cols, rows), flights?.active() ?? [], scene.isMovingRobber()),
            region,
          );
        },
      );
    } finally {
      if (catanSidebarOpen() !== wasOpen) toggleCatanSidebar();
    }
  };
}

// Pay out `roll` to the local seat and step the arcs to `at` seconds — the resource-card animation
// mid-flight, which only the composited surface can see.
function rollFlights(roll: number, at: number): (s: TileScene, w: number, h: number) => ResourceFlights {
  return (scene, w, h) => {
    const flights = new ResourceFlights();
    let thrown = 0;
    for (const source of scene.rollSources(CATAN_LOCAL_COLOR, roll, w, h)) {
      flights.spawn(source.resource, source.count, source, catanHandLandingCell({ x: 0, y: 0, w, h }, source.resource), thrown);
      thrown += source.count;
    }
    for (let f = 1; f <= Math.round(at * 60); f++) flights.advance(f / 60);
    return flights;
  };
}

// The game screen. Placement is walked with the rules engine's own first legal option and the board
// is seeded, so the still needs no model call and lands the same hexes every run.
function gameComposite(opts: { plies?: number; setup?: boolean } = {}): (cols: number, rows: number) => Surface {
  return (cols, rows) => {
    const gameScene = new CatanGameScene();
    const driver = new CatanDriver({ scene: gameScene, syncLive: () => {} });
    if (!opts.setup) {
      const colors: PlayerColor[] = ['red', 'blue', 'purple', 'orange'];
      const specs: CatanSeatSpec[] = colors.map((color, i) => (i === 0 ? { kind: 'human', color } : { kind: 'ai', color, model: 'openai/gpt-5.4-nano' }));
      const state = driver.start(specs, { autoRun: false, rng: mulberry32(0xca7a4) });
      gameScene.setResourceFlightLayout({ x: 0, y: 0, w: cols, h: rows }, colors.length, catanSidebarOpen());
      for (let i = 0; i < (opts.plies ?? 5) && !state.isTerminal(); i++) {
        const action = state.legalActions()[0];
        if (!action) break;
        void gameScene.playMove(action);
      }
      if (state.currentPlayer() === 0) void gameScene.requestHumanMove();
    }
    gameScene.scene.settle();
    return composite(
      cols,
      rows,
      (target) => gameScene.renderScene(target, 0.7),
      (screen) => {
        mountCatanGameHud(screen);
        const region = { x: 0, y: 0, w: cols, h: rows };
        screen.setRoot(buildCatanGameRoot(region, {
          driver,
          scene: gameScene,
          tokens: gameScene.scene.boardTokens(cols, rows),
          sails: gameScene.scene.boardPortLabels(cols, rows),
          resourceFlights: gameScene.activeResourceFlights(),
          resourceAdjustments: gameScene.resourceViewAdjustments(),
          onOpenMenu: () => {},
          onStart: () => {},
          onNewGame: () => {},
        }), region);
      },
    );
  };
}

const COMPOSITE_VIEWS: CompositeView[] = [
  { name: 'hud-tile', render: tileComposite((s) => s.setTerrain('forest')) },
  { name: 'hud-board', cols: 140, rows: 50, render: tileComposite((s) => { s.setMode('board'); s.settle(); }) },
  { name: 'hud-board-cards-rail', cols: 140, rows: 50, render: tileComposite((s) => { s.setMode('boardCards'); s.settle(); }, { rail: true }) },
  { name: 'hud-robber-move', cols: 140, rows: 50, render: tileComposite((s) => { s.setMode('board'); s.settle(); s.beginRobberMove(); s.previewRobberHex(5); }) },
  // Roll 5 is one the sample board actually pays — and its corner is upgraded to a city, so it
  // throws the two staggered cards rather than one. A non-paying roll would fingerprint an empty
  // flight list and cover nothing.
  { name: 'hud-flights-roll5', cols: 140, rows: 50, render: tileComposite((s) => { s.setMode('boardCards'); s.settle(); s.seedDemo(); s.upgradeBuilding(0); }, { rail: true, flights: rollFlights(5, 0.4) }) },
  { name: 'game-placement', cols: 170, rows: 52, render: gameComposite() },
  { name: 'game-setup', cols: 170, rows: 52, render: gameComposite({ setup: true }) },
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

// The composited surface hashes its serialized cells — the glyphs, colors and styles the terminal
// would receive — so a moved label or a recolored chip changes the hash just as a moved vertex does.
function fingerprintComposite(view: CompositeView): string {
  const surf = view.render(view.cols ?? 120, view.rows ?? 44);
  return createHash('sha256').update(surf.serialize()).digest('hex').slice(0, 16);
}

function render(): Map<string, string> {
  const out = new Map<string, string>();
  for (const view of VIEWS) out.set(view.name, fingerprint(view));
  for (const view of COMPOSITE_VIEWS) out.set(view.name, fingerprintComposite(view));
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
