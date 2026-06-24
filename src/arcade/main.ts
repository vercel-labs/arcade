import {
  bloom,
  downsample,
  halfBlockToSurface,
  luminanceToSurface,
  RenderTarget,
  shapeGlyphToSurface,
  type Surface,
  toHalfBlock,
  toLuminance,
  toShapeGlyph,
} from '../engine/index.ts';
import { AttractScene } from './attract.ts';
import { ChessScene } from './chess.ts';
import { ChessGameScene } from './chess-game.ts';
import { LogosScene } from './logos-scene.ts';
import { createInputParser, type Key, type MouseEvent } from '../platform/input.ts';
import { buildBar, buildPromotion, type BarActions, type Mode, type RenderMode } from './bars.ts';
import type { Color } from '../games/chess/types.ts';
import { Renderer, Screen, type LayoutBox } from '../tui/index.ts';
import { renderDemo } from '../demo/scene.ts';
import * as term from '../platform/terminal.ts';

const FPS = 30;
const DT = 1 / FPS;
// Cells-equivalent the arrow keys pan the chess camera per press (held keys
// repeat). Tuned to feel like a firm nudge; pan() scales it by distance.
const PAN_STEP = 10;
// Supersample factor for the attract screen (antialiasing + sub-cell detail
// for shape-matched glyph mode).
const SS = 3;
// Softmax "temperature" for glyph jitter when enabled (subtle variation).
const JITTER_TEMP = 0.04;

const MODE_ORDER: RenderMode[] = ['ascii', 'color', 'luminance'];

// Unified compositing (OpenTUI keystone): the scene paints into the same Surface
// as the UI and a single diff is flushed, instead of "scene string + UI overlay
// string". Color parity fixed (setCell clamps) and UI-only frames reuse a cached
// scene layer (no per-hover re-sample). Flip to false to fall back to the legacy
// path instantly.
const UNIFIED = true;

let cols = process.stdout.columns ?? 80;
let rows = process.stdout.rows ?? 24;

// The attract/chess/logos scenes render through the engine to a supersampled
// RGBA target at FULL height — the button bar composites on top of the scene's
// bottom row rather than sitting on a reserved blank strip.
let target = new RenderTarget(cols * SS, rows * 2 * SS);
let display: RenderTarget | undefined;
const attract = new AttractScene();
const chess = new ChessScene();
const chessGame = new ChessGameScene();
const logosScene = new LogosScene();
// The 2D UI overlay (button bar). Lays out + paints over the scene each frame.
const ui = new Screen(cols, rows);
// Render-on-demand loop. Animating screens hold a live lease; static screens
// (chess turntable) render only when an interaction requests it.
const r = new Renderer({ targetFps: FPS });

// Bar geometry: a band of pills composited over the scene, lifted off the very
// bottom edge by a margin so it doesn't hug it. BAR_HEIGHT must match the pill
// height (1 text row + the pill's vertical padding, top and bottom). Opaque
// pills overwrite the scene; the gaps and the margin row show it through.
const BAR_HEIGHT = 1;
const BAR_BOTTOM_MARGIN = 1;
function barRegion(): LayoutBox {
  return { x: 0, y: rows - BAR_HEIGHT - BAR_BOTTOM_MARGIN, w: cols, h: BAR_HEIGHT };
}

// The active turntable scene when in a chess view (drives orbit/pan/zoom), or null.
function orbitScene(): ChessScene | ChessGameScene | null {
  if (mode === 'chess') return chess;
  if (mode === 'chess-game') return chessGame;
  return null;
}

let mode: Mode = 'attract';
let renderMode: RenderMode = 'ascii';
let jitter = false;
// Camera-drag tracking for the chess screens. `downX/downY` mark where a drag
// began, so an up close to it counts as a click (select) rather than a rotate.
let draggingCamera = false;
let lastMouseX = 0;
let lastMouseY = 0;
let downX = 0;
let downY = 0;
let t = 0;
// Whether we currently hold a live (continuous-animation) lease on the renderer.
let liveHeld = false;
// Continuously-animating screens (attract prism, demo, logos) hold a live lease;
// the chess turntables are static and render on demand. Called on every screen
// transition (via fullRepaint).
function syncLive(): void {
  const want = mode === 'attract' || mode === 'demo' || mode === 'logos';
  if (want === liveHeld) return;
  if (want) r.requestLive();
  else r.dropLive();
  liveHeld = want;
}
// Dirty-flag rendering for the static (turntable) chess scenes: skip re-render +
// re-write when nothing changed. `forceFrame` requests one unconditional repaint
// after a transition that clears the screen or changes the present output (mode
// switch, render-mode/jitter toggle, resize). A pure button-hover change is
// detected via `ui.dirty()`, which repaints just the bar without the scene.
let forceFrame = false;
const CLEAR = '\x1b[2J';

// Clear the screen and force the next frame to paint in full. Used on every
// screen transition / resize: updates the live lease for the new mode and
// requests the (single) repaint that follows the clear.
function fullRepaint(): void {
  process.stdout.write(CLEAR);
  forceFrame = true;
  if (UNIFIED) ui.resetDiff(); // the screen was cleared — next composite emits in full
  syncLive();
  r.requestRender();
}

function quit(): void {
  r.destroy();
  term.leave();
  process.exit(0);
}

function cycleMode(): void {
  renderMode = MODE_ORDER[(MODE_ORDER.indexOf(renderMode) + 1) % MODE_ORDER.length];
  fullRepaint();
}

function setRenderMode(next: RenderMode): void {
  if (renderMode === next) return;
  renderMode = next;
  fullRepaint();
}

function enterDemo(): void {
  mode = 'demo';
  fullRepaint();
}

function enterChess(): void {
  mode = 'chess';
  draggingCamera = false;
  fullRepaint();
}

function enterChessGame(): void {
  mode = 'chess-game';
  draggingCamera = false;
  fullRepaint();
}

function enterLogos(): void {
  mode = 'logos';
  fullRepaint();
}

function toAttract(): void {
  mode = 'attract';
  fullRepaint();
}

// Bar button actions, wired to the screen-transition functions above. buildBar
// closes each Button's onClick over these, so clicks and Enter dispatch the same
// way the old onMouse id→action branch did.
const actions: BarActions = {
  chessGame: enterChessGame,
  demo: enterDemo,
  logos: enterLogos,
  back: toAttract,
  reset: () => orbitScene()?.resetView(),
  mode: cycleMode,
  quit,
};

// The promoting pawn's color while the chess promotion picker is up, else null.
// (Compared with `!== null` because WHITE is 0 — falsy.)
function promoColor(): Color | null {
  return mode === 'chess-game' ? chessGame.pendingPromotion() : null;
}
function isPromoting(): boolean {
  return promoColor() !== null;
}
// Tracks the open→closed edge so the picker focuses its default option once.
let promoFocused = false;

// Rebuild the overlay tree for the current screen (cheap; the Screen retains
// hover/focus state by id across rebuilds). While a promotion is pending the
// overlay becomes the centered, full-screen picker instead of the bottom bar.
function syncBar(): void {
  const pc = promoColor();
  if (pc !== null) {
    ui.setRoot(
      buildPromotion(pc, (t) => {
        chessGame.choosePromotion(t);
        // Force a scene repaint (which overwrites the popup's cells) rather than
        // a full clear — ESC[2J here would blank the screen for a frame, flashing
        // black before the move animation paints.
        forceFrame = true;
      }),
      { x: 0, y: 0, w: cols, h: rows },
    );
    if (!promoFocused) {
      ui.setFocus('promo-queen'); // default highlight so Enter promotes to queen
      promoFocused = true;
      forceFrame = true; // ensure the freshly-opened popup paints this frame
    }
  } else {
    promoFocused = false;
    ui.setRoot(buildBar(mode, renderMode, actions), barRegion());
  }
}

// Presents the engine `target` (prism / demo cube / chess) in the active
// color/glyph mode. `withBloom` is the glowy post-process — on for the light
// effects, off for solid geometry like the chess pieces.
function presentScene(withBloom = true, hybridShadow = false): string {
  if (renderMode === 'ascii') {
    return toShapeGlyph(target, cols, rows, {
      color: true,
      jitterTemp: jitter ? JITTER_TEMP : 0,
      hybrid: hybridShadow,
    });
  }
  if (renderMode === 'luminance') {
    return toLuminance(target, cols, rows, { color: true });
  }
  display = downsample(target, SS, display);
  if (withBloom) bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  return toHalfBlock(display);
}

// Cell-writing twin of presentScene for the unified path: paints the scene into
// `surf` (the bottom layer) instead of returning a string. Same mode logic.
function presentSceneInto(surf: Surface, withBloom = true, hybridShadow = false): void {
  if (renderMode === 'ascii') {
    shapeGlyphToSurface(surf, target, cols, rows, {
      color: true,
      jitterTemp: jitter ? JITTER_TEMP : 0,
      hybrid: hybridShadow,
    });
    return;
  }
  if (renderMode === 'luminance') {
    luminanceToSurface(surf, target, cols, rows, { color: true });
    return;
  }
  display = downsample(target, SS, display);
  if (withBloom) bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  halfBlockToSurface(surf, display);
}

// Maps a 1-based terminal mouse cell to a normalized device coordinate (−1..1,
// +y up) plus the aspect the scene renders at — for ray-picking the board.
function pointerNdc(x: number, y: number): { ndcX: number; ndcY: number; aspect: number } {
  const sceneRows = rows;
  return {
    ndcX: ((x - 0.5) / cols) * 2 - 1,
    ndcY: 1 - ((y - 0.5) / sceneRows) * 2,
    aspect: cols / (sceneRows * 2),
  };
}

function onKeyImpl(key: Key): void {
  // While the promotion picker is up it's modal: Escape cancels, Tab cycles
  // options, Enter/Space picks the focused one. Swallow everything else (so
  // 'q' doesn't quit mid-choice).
  if (isPromoting()) {
    if (key === 'escape') {
      chessGame.cancelPromotion();
      forceFrame = true; // repaint over the popup without an ESC[2J black flash
    } else {
      ui.handleKey(key);
    }
    return;
  }
  if (key === 'quit' || key === 'q' || key === 'escape') {
    quit();
    return;
  }
  // The UI consumes only Tab (focus) and Enter/Space (activate) when something
  // is focused — never bare letters — so per-screen shortcuts and the camera
  // arrows below still work.
  if (ui.handleKey(key)) return;
  if (mode === 'attract') {
    if (key === 'd' || key === 'D') enterDemo();
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
  if (mode === 'logos') {
    if (key === 'b' || key === 'B') toAttract();
    else if (key === 'm' || key === 'M') cycleMode();
    else if (key === 'c' || key === 'C') setRenderMode('color');
    else if (key === 'l' || key === 'L') setRenderMode('luminance');
    else if (key === 'a' || key === 'A') setRenderMode('ascii');
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
    else if (key === 'j' || key === 'J') {
      jitter = !jitter;
      forceFrame = true; // toggling jitter changes the present even if the scene is idle
    }
    // Arrow keys pan the camera in their direction (the content moves opposite).
    else if (key === 'left') orbit.pan(PAN_STEP, 0);
    else if (key === 'right') orbit.pan(-PAN_STEP, 0);
    else if (key === 'up') orbit.pan(0, PAN_STEP);
    else if (key === 'down') orbit.pan(0, -PAN_STEP);
    return;
  }
}

function onMouseImpl(e: MouseEvent): void {
  // Modal promotion picker: clicks/hover go to the popup; the board and camera
  // are frozen until a choice is made.
  if (isPromoting()) {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
  const orbit = orbitScene();
  if (orbit) {
    if (e.type === 'wheel') {
      orbit.zoomBy(e.wheel === -1 ? 0.9 : 1.1);
      return;
    }
    if (e.type === 'move') {
      ui.hover(e.x, e.y);
      return;
    }
    if (e.type === 'down') {
      // A hit on the bar fires that button's onClick; otherwise it's the board.
      if (!ui.pointerDown(e.x, e.y)) {
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
      ui.pointerUp();
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
  if (mode === 'attract' || mode === 'demo' || mode === 'logos') {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
}

// Wrap the handlers so every input requests a render — essential for the
// on-demand chess screens (idle until interacted with), harmless for the
// continuously-live attract/demo/logos screens.
const parse = createInputParser({
  onKey(key) {
    onKeyImpl(key);
    r.requestRender();
  },
  onMouse(e) {
    onMouseImpl(e);
    r.requestRender();
  },
});

function tick(): void {
  t += DT;

  if (mode === 'attract') {
    attract.renderScene(target, t);
    syncBar();
    r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene() + ui.frame());
    return;
  }

  if (mode === 'demo') {
    renderDemo(target, t);
    syncBar();
    r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene() + ui.frame());
    return;
  }

  if (mode === 'logos') {
    logosScene.renderScene(target, t);
    syncBar();
    r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene() + ui.frame());
    return;
  }

  const orbit = orbitScene();
  if (orbit) {
    // Dirty-flag gate: the chess turntables are static between interactions, so
    // skip the (expensive) re-render + full-screen write when nothing changed.
    // `jitter` intentionally animates (per-frame glyph noise) so it forces redraw.
    syncBar();
    const sceneDirty = forceFrame || jitter || orbit.needsRender();
    if (sceneDirty) orbit.renderScene(target);
    if (UNIFIED) {
      // Composite scene + UI into one diffed buffer; skip when nothing changed.
      // Pass sceneDirty so a hover-only frame reuses the cached scene layer
      // instead of re-sampling the whole scene.
      if (sceneDirty || ui.dirty()) {
        r.write(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
      }
    } else if (sceneDirty) {
      r.write(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      // Only a button hover/focus changed: repaint just the bar, not the scene.
      r.write(ui.frame());
    }
    forceFrame = false;
    // Render-on-demand: chess holds no live lease, so re-arm the next frame while
    // the scene is still animating (a move/camera settle) or jitter is on.
    if (orbit.needsRender() || jitter) r.requestRender();
    return;
  }
}

process.stdout.on('resize', () => {
  cols = process.stdout.columns ?? 80;
  rows = process.stdout.rows ?? 24;
  target = new RenderTarget(cols * SS, rows * 2 * SS);
  ui.resize(cols, rows);
  display = undefined;
  // The scene repaints every cell it owns each frame, but the reserved button
  // row does not, and the buttons re-center when the width changes — so without
  // a wipe the old (differently-positioned) bar lingers as ghosts. Clear once on
  // resize; the next tick repaints everything at the new geometry.
  fullRepaint();
});

term.enter();
process.stdin.on('data', parse);
r.onFrame(tick);
syncLive(); // attract starts live (continuously animating)
r.start();
r.requestRender();
