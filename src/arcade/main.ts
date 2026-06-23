import { bloom, downsample, RenderTarget, toHalfBlock, toLuminance, toShapeGlyph } from '../engine/index.ts';
import { AttractScene } from './attract.ts';
import { Framebuffer } from './framebuffer.ts';
import { Game, PLAY_RANGE } from './game.ts';
import { createInputParser } from '../platform/input.ts';
import { drawReticle, renderScene } from './renderer.ts';
import { hitButtons, layoutButtons, renderButtons, type ButtonRect } from './ui.ts';
import { renderDemo } from '../demo/scene.ts';
import * as term from '../platform/terminal.ts';

const FPS = 30;
const DT = 1 / FPS;
const NUDGE = 0.4;
// Supersample factor for the attract screen (antialiasing + sub-cell detail
// for shape-matched glyph mode).
const SS = 3;
// Softmax "temperature" for glyph jitter when enabled (subtle variation).
const JITTER_TEMP = 0.04;
// Bottom rows reserved on the attract screen for the button bar + margin, so the
// scene doesn't render under the buttons and there's space below them.
const ATTRACT_RESERVE = 2;

type Mode = 'attract' | 'playing' | 'demo';
type RenderMode = 'color' | 'ascii' | 'luminance';
const MODE_ORDER: RenderMode[] = ['ascii', 'color', 'luminance'];

let cols = process.stdout.columns ?? 80;
let rows = process.stdout.rows ?? 24;

// The game draws ASCII glyphs (legacy char framebuffer); the attract screen
// renders through the engine to a supersampled RGBA target. Both reserve the
// bottom row (HUD / prompt).
const fb = new Framebuffer(cols, rows - 1);
let target = new RenderTarget(cols * SS, (rows - ATTRACT_RESERVE) * 2 * SS);
let display: RenderTarget | undefined;
const attract = new AttractScene();
const game = new Game();

let mode: Mode = 'attract';
let renderMode: RenderMode = 'ascii';
let jitter = false;
let hoveredButton: string | null = null;
let t = 0;
let frame: ReturnType<typeof setInterval> | undefined;

function quit(): void {
  if (frame) clearInterval(frame);
  term.leave();
  process.exit(0);
}

function startGame(): void {
  mode = 'playing';
  game.reset();
  process.stdout.write('\x1b[2J');
}

function aimAt(mx: number, my: number): void {
  const nx = ((mx - 1) / Math.max(1, cols - 1)) * 2 - 1;
  const ny = ((my - 1) / Math.max(1, rows - 1)) * 2 - 1;
  game.movePlayerTo(nx * PLAY_RANGE, -ny * PLAY_RANGE);
}

function cycleMode(): void {
  renderMode = MODE_ORDER[(MODE_ORDER.indexOf(renderMode) + 1) % MODE_ORDER.length];
  process.stdout.write('\x1b[2J');
}

function setRenderMode(next: RenderMode): void {
  if (renderMode === next) return;
  renderMode = next;
  process.stdout.write('\x1b[2J');
}

function enterDemo(): void {
  mode = 'demo';
  process.stdout.write('\x1b[2J');
}

function toAttract(): void {
  mode = 'attract';
  process.stdout.write('\x1b[2J');
}

// The bottom button bar for the current screen (empty during gameplay).
function currentBar(): ButtonRect[] {
  const modeLabel = `  mode: ${renderMode.padEnd(9)}  `;
  const row = rows - 1;
  if (mode === 'attract') {
    return layoutButtons(
      [
        { id: 'start', label: '  Start  ' },
        { id: 'demo', label: '  Demo  ' },
        { id: 'mode', label: modeLabel },
        { id: 'quit', label: '  Quit  ' },
      ],
      cols,
      row,
    );
  }
  if (mode === 'demo') {
    return layoutButtons(
      [
        { id: 'back', label: '  Back  ' },
        { id: 'mode', label: modeLabel },
        { id: 'quit', label: '  Quit  ' },
      ],
      cols,
      row,
    );
  }
  return [];
}

// Presents the engine `target` (prism or demo cube) in the active color/glyph mode.
function presentScene(): string {
  if (renderMode === 'ascii') {
    return toShapeGlyph(target, cols, rows - ATTRACT_RESERVE, { color: true, jitterTemp: jitter ? JITTER_TEMP : 0 });
  }
  if (renderMode === 'luminance') {
    return toLuminance(target, cols, rows - ATTRACT_RESERVE, { color: true });
  }
  display = downsample(target, SS, display);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  return toHalfBlock(display);
}

const parse = createInputParser({
  onKey(key) {
    if (key === 'quit' || key === 'q' || key === 'escape') {
      quit();
      return;
    }
    if (mode === 'attract') {
      if (key === 's' || key === 'S') startGame();
      else if (key === 'd' || key === 'D') enterDemo();
      else if (key === 'm' || key === 'M') cycleMode();
      else if (key === 'c' || key === 'C') setRenderMode('color');
      else if (key === 'l' || key === 'L') setRenderMode('luminance');
      else if (key === 'a' || key === 'A') setRenderMode('ascii');
      else if (key === 'j' || key === 'J') jitter = !jitter;
      return;
    }
    if (mode === 'demo') {
      if (key === 'b' || key === 'B') toAttract();
      else if (key === 'm' || key === 'M') cycleMode();
      else if (key === 'j' || key === 'J') jitter = !jitter;
      return;
    }
    switch (key) {
      case 'r':
      case 'R':
        if (game.over) game.reset();
        break;
      case 'left':
        game.nudge(-NUDGE, 0);
        break;
      case 'right':
        game.nudge(NUDGE, 0);
        break;
      case 'up':
        game.nudge(0, NUDGE);
        break;
      case 'down':
        game.nudge(0, -NUDGE);
        break;
    }
  },
  onMouse(e) {
    if (mode === 'attract' || mode === 'demo') {
      hoveredButton = hitButtons(currentBar(), e.x, e.y);
      if (e.type === 'down' && hoveredButton) {
        if (hoveredButton === 'start') startGame();
        else if (hoveredButton === 'demo') enterDemo();
        else if (hoveredButton === 'back') toAttract();
        else if (hoveredButton === 'mode') cycleMode();
        else if (hoveredButton === 'quit') quit();
      }
      return;
    }
    if (e.type === 'move' || e.type === 'drag' || e.type === 'down') {
      aimAt(e.x, e.y);
    }
  },
});

function hud(): string {
  const text = ` score ${game.score}   speed ${game.speed.toFixed(1)}   ·   move: mouse / arrows   ·   q: quit `;
  return `\x1b[${rows};1H\x1b[2m${text.slice(0, cols)}\x1b[0m\x1b[K`;
}

function gameOverOverlay(): string {
  const lines = ['  GAME OVER  ', `  score ${game.score}  `, '  R: restart · Q: quit  '];
  const top = Math.floor(rows / 2) - 1;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const col = Math.max(1, Math.floor((cols - line.length) / 2));
    out += `\x1b[${top + i};${col}H\x1b[1;97;41m${line}\x1b[0m`;
  }
  return out;
}

function tick(): void {
  t += DT;

  if (mode === 'attract') {
    attract.renderScene(target, t);
    process.stdout.write(presentScene() + renderButtons(currentBar(), hoveredButton));
    return;
  }

  if (mode === 'demo') {
    renderDemo(target, t);
    process.stdout.write(presentScene() + renderButtons(currentBar(), hoveredButton));
    return;
  }

  game.update(DT);
  fb.clear();
  renderScene(fb, game.obstacles, { x: game.player.x, y: game.player.y, z: 0 });
  drawReticle(fb);
  let out = fb.toFrameString() + hud();
  if (game.over) out += gameOverOverlay();
  process.stdout.write(out);
}

process.stdout.on('resize', () => {
  cols = process.stdout.columns ?? 80;
  rows = process.stdout.rows ?? 24;
  fb.resize(cols, rows - 1);
  target = new RenderTarget(cols * SS, (rows - ATTRACT_RESERVE) * 2 * SS);
  display = undefined;
});

term.enter();
process.stdin.on('data', parse);
frame = setInterval(tick, 1000 / FPS);
