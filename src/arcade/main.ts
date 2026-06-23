import { bloom, downsample, RenderTarget, toHalfBlock, toLuminance, toShapeGlyph } from '../engine/index.ts';
import { AttractScene } from './attract.ts';
import { ChessScene } from './chess.ts';
import { ChessGameScene } from './chess-game.ts';
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
// Cells-equivalent the arrow keys pan the chess camera per press (held keys
// repeat). Tuned to feel like a firm nudge; pan() scales it by distance.
const PAN_STEP = 10;
// Supersample factor for the attract screen (antialiasing + sub-cell detail
// for shape-matched glyph mode).
const SS = 3;
// Softmax "temperature" for glyph jitter when enabled (subtle variation).
const JITTER_TEMP = 0.04;
// Bottom rows reserved on the attract screen for the button bar + margin, so the
// scene doesn't render under the buttons and there's space below them.
const ATTRACT_RESERVE = 2;

type Mode = 'attract' | 'playing' | 'demo' | 'chess' | 'chess-game';
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
const chess = new ChessScene();
const chessGame = new ChessGameScene();

// The active turntable scene when in a chess view (drives orbit/pan/zoom), or null.
function orbitScene(): ChessScene | ChessGameScene | null {
  if (mode === 'chess') return chess;
  if (mode === 'chess-game') return chessGame;
  return null;
}

let mode: Mode = 'attract';
let renderMode: RenderMode = 'ascii';
let jitter = false;
let hoveredButton: string | null = null;
// Camera-drag tracking for the chess screens. `downX/downY` mark where a drag
// began, so an up close to it counts as a click (select) rather than a rotate.
let draggingCamera = false;
let lastMouseX = 0;
let lastMouseY = 0;
let downX = 0;
let downY = 0;
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

function enterChess(): void {
  mode = 'chess';
  draggingCamera = false;
  process.stdout.write('\x1b[2J');
}

function enterChessGame(): void {
  mode = 'chess-game';
  draggingCamera = false;
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
        { id: 'chess', label: '  Chess  ' },
        { id: 'chess-game', label: '  Chess Game  ' },
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
  if (mode === 'chess' || mode === 'chess-game') {
    return layoutButtons(
      [
        { id: 'back', label: '  Back  ' },
        { id: 'reset', label: '  Reset View  ' },
        { id: 'mode', label: modeLabel },
        { id: 'quit', label: '  Quit  ' },
      ],
      cols,
      row,
    );
  }
  return [];
}

// Presents the engine `target` (prism / demo cube / chess) in the active
// color/glyph mode. `withBloom` is the glowy post-process — on for the light
// effects, off for solid geometry like the chess pieces.
function presentScene(withBloom = true, hybridShadow = false): string {
  if (renderMode === 'ascii') {
    return toShapeGlyph(target, cols, rows - ATTRACT_RESERVE, {
      color: true,
      jitterTemp: jitter ? JITTER_TEMP : 0,
      hybrid: hybridShadow,
    });
  }
  if (renderMode === 'luminance') {
    return toLuminance(target, cols, rows - ATTRACT_RESERVE, { color: true });
  }
  display = downsample(target, SS, display);
  if (withBloom) bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  return toHalfBlock(display);
}

// Maps a 1-based terminal mouse cell to a normalized device coordinate (−1..1,
// +y up) plus the aspect the scene renders at — for ray-picking the board.
function pointerNdc(x: number, y: number): { ndcX: number; ndcY: number; aspect: number } {
  const sceneRows = rows - ATTRACT_RESERVE;
  return {
    ndcX: ((x - 0.5) / cols) * 2 - 1,
    ndcY: 1 - ((y - 0.5) / sceneRows) * 2,
    aspect: cols / (sceneRows * 2),
  };
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
      else if (key === 'g' || key === 'G') enterChess();
      else if (key === 'n' || key === 'N') enterChessGame();
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
    const orbit = orbitScene();
    if (orbit) {
      if (key === 'b' || key === 'B') toAttract();
      else if (key === 'r' || key === 'R') orbit.resetView();
      else if (key === 'm' || key === 'M') cycleMode();
      else if (key === 'c' || key === 'C') setRenderMode('color');
      else if (key === 'l' || key === 'L') setRenderMode('luminance');
      else if (key === 'a' || key === 'A') setRenderMode('ascii');
      else if (key === 'j' || key === 'J') jitter = !jitter;
      // Arrow keys pan the scene in their direction (the content follows).
      else if (key === 'left') orbit.pan(-PAN_STEP, 0);
      else if (key === 'right') orbit.pan(PAN_STEP, 0);
      else if (key === 'up') orbit.pan(0, -PAN_STEP);
      else if (key === 'down') orbit.pan(0, PAN_STEP);
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
    const orbit = orbitScene();
    if (orbit) {
      if (e.type === 'wheel') {
        orbit.zoomBy(e.wheel === -1 ? 0.9 : 1.1);
        return;
      }
      if (e.type === 'move') {
        hoveredButton = hitButtons(currentBar(), e.x, e.y);
        // Hover-highlight the piece under the cursor (chess-game only).
        if (mode === 'chess-game') {
          if (hoveredButton) chessGame.clearHover();
          else {
            const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
            chessGame.setHover(ndcX, ndcY, aspect);
          }
        }
        return;
      }
      if (e.type === 'down') {
        hoveredButton = hitButtons(currentBar(), e.x, e.y);
        if (hoveredButton === 'back') toAttract();
        else if (hoveredButton === 'reset') orbit.resetView();
        else if (hoveredButton === 'mode') cycleMode();
        else if (hoveredButton === 'quit') quit();
        else {
          // On the board: begin a potential drag (rotate); an up near here is a click.
          draggingCamera = true;
          lastMouseX = downX = e.x;
          lastMouseY = downY = e.y;
        }
        return;
      }
      if (e.type === 'drag' && draggingCamera) {
        const dx = e.x - lastMouseX;
        const dy = e.y - lastMouseY;
        lastMouseX = e.x;
        lastMouseY = e.y;
        // Pan with a modifier (⌘/Option/Shift/Ctrl) or right-drag; orbit otherwise.
        // Right-click usually pops the terminal menu, so the modifier is primary.
        if (e.meta || e.shift || e.ctrl || e.button === 2) orbit.pan(dx, dy);
        else orbit.orbit(dx, dy);
        return;
      }
      if (e.type === 'up') {
        // A press that barely moved is a click → select/move (chess-game only).
        if (draggingCamera && mode === 'chess-game' && Math.abs(e.x - downX) + Math.abs(e.y - downY) <= 1) {
          const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
          chessGame.click(ndcX, ndcY, aspect);
        }
        draggingCamera = false;
        return;
      }
      return;
    }
    if (mode === 'attract' || mode === 'demo') {
      hoveredButton = hitButtons(currentBar(), e.x, e.y);
      if (e.type === 'down' && hoveredButton) {
        if (hoveredButton === 'start') startGame();
        else if (hoveredButton === 'chess') enterChess();
        else if (hoveredButton === 'chess-game') enterChessGame();
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

  const orbit = orbitScene();
  if (orbit) {
    orbit.renderScene(target);
    process.stdout.write(presentScene(false, true) + renderButtons(currentBar(), hoveredButton));
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
  // The scene repaints every cell it owns each frame, but the reserved button
  // row does not, and the buttons re-center when the width changes — so without
  // a wipe the old (differently-positioned) bar lingers as ghosts. Clear once on
  // resize; the next tick repaints everything at the new geometry.
  process.stdout.write('\x1b[2J');
});

term.enter();
process.stdin.on('data', parse);
frame = setInterval(tick, 1000 / FPS);
