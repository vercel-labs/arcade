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
import { createInputParser, type KeyEvent, type MouseEvent } from '../platform/input.ts';
import { buildBar, buildGameOver, buildPromotion, type BarActions, type Mode, type RenderMode } from './bars.ts';
import { buildShowcase, mountShowcase } from './ui-showcase.ts';
import { buildChessGameRoot, type Commentary, mountChessHud, movesToPgn, refreshMoveHistory } from './chess-hud.ts';
import { copyToClipboard } from '../platform/clipboard.ts';
import { BLACK, type Color, type Move, WHITE } from '../games/chess/types.ts';
import type { ChessResult } from '../games/chess/chess.ts';
import type { RGB } from '../engine/index.ts';
import { Keymap, Renderer, Screen, type LayoutBox } from '../tui/index.ts';
import { renderDemo } from '../demo/scene.ts';
import * as term from '../platform/terminal.ts';
import { loadEnv } from '../ai/env.ts';
import { runMatch } from '../ai/match.ts';
import { ModelPlayer } from '../ai/model-player.ts';
import type { Player } from '../ai/player.ts';

// Populate process.env from .env.local before anything reads AI_GATEWAY_API_KEY.
loadEnv();

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

// The camera-controllable scene for the active mode: the chess turntables, the
// logos wisp orbit, or the chess board behind the UI playground. Drives the
// shared drag/pan/zoom mouse handler and the reset/pan key commands. (The 'ui'
// backdrop is camera-controllable too, so dragging on the scene behind the panel
// rotates it.) `orbitScene()` stays null for 'ui' so the tick uses the dedicated
// 'ui' branch, which always recomposites for live component edits.
function activeOrbit(): ChessScene | ChessGameScene | LogosScene | null {
  if (mode === 'logos') return logosScene;
  if (mode === 'ui') return chess;
  return orbitScene();
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
// Latest pointer cell (1-based), so scroll keys can target the hovered component.
let hoverX = 0;
let hoverY = 0;
let t = 0;
// Whether we currently hold a live (continuous-animation) lease on the renderer.
let liveHeld = false;

// AI-vs-AI match. The two sides default to distinct frontier models (distinct
// provider wisps in the HUD; at least one Claude). `matchAbort` cancels the
// running turn-loop (pause / stop / navigate away). `matchPlayers` are the two
// players for the current game — kept across a pause so resume continues with
// them. `matchPaused` halts the loop on the current turn (no thinking/moves)
// while keeping the match alive. `commentary` is the current pre-move rationale
// toast, shown until `t` passes `until`.
const DEFAULT_WHITE = 'anthropic/claude-sonnet-4.6';
const DEFAULT_BLACK = 'openai/gpt-5.4';
const COMMENTARY_SECS = 3.5;
let matchAbort: AbortController | null = null;
let matchPlayers: Player<Move>[] | null = null;
let matchPaused = false;
let commentary: Commentary | null = null;
// Whether the move-history panel is collapsed to its "Moves" header button
// (toggle with the 'h' key or by clicking the header / ✕). History persists.
let historyMinimized = false;
// The game-over result popup (chess-game only): set once the board is terminal,
// cleared on a new game; `dismissed` suppresses re-showing after Close until the
// board leaves the terminal state; `focused` is the focus-once edge.
let gameOver: ChessResult | null = null;
let gameOverDismissed = false;
let gameOverFocused = false;

// Map a chess result to the popup's display strings + winner tint (ivory/brown
// to match the piece sets; neutral for a draw).
function gameOverText(r: ChessResult): { title: string; subtitle: string; tint: RGB } {
  const reasons: Record<ChessResult['reason'], string> = {
    checkmate: 'checkmate',
    stalemate: 'stalemate',
    'fifty-move': 'the 50-move rule',
    repetition: 'repetition',
    'insufficient-material': 'insufficient material',
  };
  const title = r.winner === null ? 'Draw' : r.winner === WHITE ? 'White wins' : 'Black wins';
  const tint: RGB = r.winner === BLACK ? [184, 126, 74] : r.winner === WHITE ? [232, 228, 216] : [222, 224, 234];
  return { title, subtitle: `by ${reasons[r.reason]}`, tint };
}

function closeGameOver(): void {
  gameOver = null;
  gameOverDismissed = true; // don't reopen for this same terminal position
  gameOverFocused = false;
  forceFrame = true;
}
// Continuously-animating screens (attract prism, demo, logos) hold a live lease;
// the chess turntables are static and render on demand. Called on every screen
// transition (via fullRepaint).
function syncLive(): void {
  const want =
    mode === 'attract' || mode === 'demo' || mode === 'logos' || (mode === 'chess-game' && chessGame.isMatchActive());
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
  syncContext(); // keep the keymap's active layer in sync with the current mode
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
  stopAiMatch();
  mode = 'demo';
  fullRepaint();
}

function enterChess(): void {
  stopAiMatch();
  mode = 'chess';
  draggingCamera = false;
  fullRepaint();
}

function enterChessGame(): void {
  mode = 'chess-game';
  draggingCamera = false;
  mountChessHud(ui); // (re)register the move-history panel for its Slot
  fullRepaint();
}

// Collapse/expand the move-history panel (bound to 'h', and the panel's own
// header/✕ buttons call this too).
function toggleHistory(): void {
  historyMinimized = !historyMinimized;
  forceFrame = true;
}

// Copy the move history to the clipboard as PGN (the panel's copy button). The
// result token reflects the current outcome (or * for an unfinished game).
function copyMoves(): void {
  const r = chessGame.state().result();
  const token = !r ? '*' : r.winner === WHITE ? '1-0' : r.winner === BLACK ? '0-1' : '1/2-1/2';
  copyToClipboard(movesToPgn(chessGame.moves(), token));
  commentary = { text: 'Copied PGN to clipboard', model: '', until: t + 2 };
  forceFrame = true;
}

// ── AI-vs-AI match driver ──────────────────────────────────────────────────────
// Fully stop the match: cancel the loop, drop the players, and leave spectator
// mode (the final position stays on the board). Safe to call when idle. Used by
// reset-game and on navigating away — NOT by pause.
function stopAiMatch(): void {
  matchAbort?.abort();
  matchAbort = null;
  matchPlayers = null;
  matchPaused = false;
  commentary = null;
  chessGame.setMatchPaused(false);
  chessGame.endMatch();
}

// Run the turn-loop for the current `matchPlayers` against the live board. A new
// AbortController per run lets pause/stop cancel an in-flight model call. The loop
// lives beside the render tick (it awaits the network + each move's settle); a
// held live lease keeps frames flowing so the HUD wisps animate while we wait.
// On exit: if paused, the match stays alive on the current turn; otherwise it
// ended (terminal or stopped) and we leave spectator mode.
function runMatchLoop(): void {
  if (!matchPlayers) return;
  const ctrl = new AbortController();
  matchAbort = ctrl;
  syncLive();
  r.requestRender();
  runMatch<Move>(chessGame, matchPlayers, {
    signal: ctrl.signal,
    onCommentary: (text, player) => {
      commentary = { text, model: player.name, until: t + COMMENTARY_SECS };
    },
  })
    .catch(() => {}) // aborted mid-decision (pause/stop) — fine
    .finally(() => {
      if (matchAbort === ctrl) matchAbort = null;
      if (matchPaused) return; // paused: keep the match alive on the current turn
      chessGame.endMatch(); // ended (terminal or stopped); final position stays up
      matchPlayers = null;
      syncLive();
      r.requestRender();
    });
}

// Start a fresh AI-vs-AI game from the initial position.
function startAiMatch(): void {
  if (!process.env.AI_GATEWAY_API_KEY) {
    commentary = { text: 'Set AI_GATEWAY_API_KEY in .env.local to play (see .env.example)', model: '', until: t + 6 };
    r.requestRender();
    return;
  }
  const providerOf = (slug: string): string => slug.split('/')[0] ?? slug;
  chessGame.beginMatch(providerOf(DEFAULT_WHITE), providerOf(DEFAULT_BLACK));
  matchPaused = false;
  matchPlayers = [
    new ModelPlayer<Move>({ model: DEFAULT_WHITE, gameName: 'chess' }),
    new ModelPlayer<Move>({ model: DEFAULT_BLACK, gameName: 'chess' }),
  ];
  runMatchLoop();
}

// Pause on whoever's turn it is: cancel the in-flight model call (stop thinking)
// and halt the loop, but keep the match + HUD alive. The side-to-move wisp stops
// pulsing to show it's idle.
function pauseAiMatch(): void {
  matchPaused = true;
  chessGame.setMatchPaused(true);
  matchAbort?.abort(); // cancel any in-flight thinking
  matchAbort = null;
  r.requestRender();
}

// Resume from the current turn: the same players continue against the live board.
function resumeAiMatch(): void {
  matchPaused = false;
  chessGame.setMatchPaused(false);
  runMatchLoop();
}

// The AI button / 'p' key: play (idle) → pause (running) → resume (paused).
// Entering from elsewhere first opens the chess game.
function aiButton(): void {
  if (mode !== 'chess-game') enterChessGame();
  if (!chessGame.isMatchActive()) startAiMatch();
  else if (matchPaused) resumeAiMatch();
  else pauseAiMatch();
  r.requestRender();
}

// Reset to a fresh game: abort any running AI match, restore the start position,
// and clear the move history + captures.
function resetGame(): void {
  if (mode !== 'chess-game') return;
  stopAiMatch();
  chessGame.resetGame();
  syncLive(); // release the live lease the match held
  forceFrame = true;
  r.requestRender();
}

function enterLogos(): void {
  stopAiMatch();
  mode = 'logos';
  fullRepaint();
}

function toAttract(): void {
  stopAiMatch();
  mode = 'attract';
  fullRepaint();
}

// The component playground. (Re)mount the showcase instances each entry — the
// set-diff unmounts them on leave, but the module-level instances persist, so
// their state survives across visits.
function enterUi(): void {
  stopAiMatch();
  mode = 'ui';
  mountShowcase(ui);
  fullRepaint();
}

// Bar button actions, wired to the screen-transition functions above. buildBar
// closes each Button's onClick over these, so clicks and Enter dispatch the same
// way the old onMouse id→action branch did.
const actions: BarActions = {
  chessGame: enterChessGame,
  demo: enterDemo,
  logos: enterLogos,
  ui: enterUi,
  back: toAttract,
  reset: () => activeOrbit()?.resetView(),
  mode: cycleMode,
  quit,
  aiMatch: aiButton,
  resetGame,
};

// Named commands + a layered keymap (the OpenTUI-style command surface). Each
// action is registered once with a stable id; keys are bound to ids per context
// (mode). onKeyImpl collapses to `keymap.handle(ev)`. The id catalog
// (`keymap.commands()`) is also the surface an AI agent will drive the app
// through — a human key and an agent command id hit the same `run`.
const keymap = new Keymap();
for (const c of [
  { id: 'app.quit', title: 'Quit', run: quit },
  { id: 'view.cycleRenderMode', title: 'Cycle render style', run: cycleMode },
  { id: 'view.setColor', title: 'Render: color', run: () => setRenderMode('color') },
  { id: 'view.setLuminance', title: 'Render: luminance', run: () => setRenderMode('luminance') },
  { id: 'view.setAscii', title: 'Render: ascii', run: () => setRenderMode('ascii') },
  { id: 'view.toggleJitter', title: 'Toggle glyph jitter', run: toggleJitter },
  { id: 'nav.back', title: 'Back to attract', run: toAttract },
  { id: 'nav.demo', title: 'Open demo', run: enterDemo },
  { id: 'nav.chess', title: 'Open chess showcase', run: enterChess },
  { id: 'nav.chessGame', title: 'Open chess game', run: enterChessGame },
  { id: 'nav.ui', title: 'Open UI playground', run: enterUi },
  { id: 'chess.resetView', title: 'Reset camera', run: () => activeOrbit()?.resetView() },
  { id: 'chess.panLeft', title: 'Pan left', run: () => activeOrbit()?.pan(PAN_STEP, 0) },
  { id: 'chess.panRight', title: 'Pan right', run: () => activeOrbit()?.pan(-PAN_STEP, 0) },
  { id: 'chess.panUp', title: 'Pan up', run: () => activeOrbit()?.pan(0, PAN_STEP) },
  { id: 'chess.panDown', title: 'Pan down', run: () => activeOrbit()?.pan(0, -PAN_STEP) },
  { id: 'chess.cancelPromotion', title: 'Cancel promotion', run: cancelPromotion },
  { id: 'chess.toggleAI', title: 'Play / pause AI', run: aiButton },
  { id: 'chess.toggleHistory', title: 'Toggle move history', run: toggleHistory },
  { id: 'chess.resetGame', title: 'Reset game', run: resetGame },
  { id: 'chess.closeGameOver', title: 'Close result', run: closeGameOver },
]) {
  keymap.register(c);
}
// Global: work in every mode. (escape/ctrl+c/q all quit; the 'promoting' modal
// layer shadows escape to cancel instead — see syncBar.)
for (const b of [
  { key: 'q', cmd: 'app.quit' },
  { key: 'escape', cmd: 'app.quit' },
  { key: 'ctrl+c', cmd: 'app.quit' },
  { key: 'm', cmd: 'view.cycleRenderMode' },
  { key: 'c', cmd: 'view.setColor' },
  { key: 'l', cmd: 'view.setLuminance' },
  { key: 'a', cmd: 'view.setAscii' },
  { key: 'j', cmd: 'view.toggleJitter' },
]) {
  keymap.bind('global', b);
}
keymap.bind('chess', { key: 'p', cmd: 'chess.toggleAI' });
keymap.bind('chess', { key: 'h', cmd: 'chess.toggleHistory' });
keymap.bind('chess', { key: 'n', cmd: 'chess.resetGame' });
keymap.bind('attract', { key: 'd', cmd: 'nav.demo' });
keymap.bind('attract', { key: 'g', cmd: 'nav.chess' });
keymap.bind('attract', { key: 'n', cmd: 'nav.chessGame' });
keymap.bind('attract', { key: 'u', cmd: 'nav.ui' });
for (const layer of ['demo', 'logos', 'chess', 'ui']) keymap.bind(layer, { key: 'b', cmd: 'nav.back' });
// Orbit/pan/reset bindings are shared by the chess turntables, the logos wisp
// orbit, and the chess backdrop behind the UI playground (the commands resolve
// the active scene via activeOrbit()). In 'ui', a focused component consumes
// arrows first (Screen.handleKey runs before the keymap), so these pan only when
// the scene — not a widget — has focus.
for (const layer of ['chess', 'logos', 'ui']) {
  for (const b of [
    { key: 'r', cmd: 'chess.resetView' },
    { key: 'left', cmd: 'chess.panLeft' },
    { key: 'right', cmd: 'chess.panRight' },
    { key: 'up', cmd: 'chess.panUp' },
    { key: 'down', cmd: 'chess.panDown' },
  ]) {
    keymap.bind(layer, b);
  }
}
// Promotion picker is modal: Escape cancels; the modal layer (pushed in syncBar)
// swallows every other stray key so 'q' can't quit mid-choice.
keymap.bind('promoting', { key: 'escape', cmd: 'chess.cancelPromotion' });
// Game-over popup is modal too: Escape closes it (and the layer shadows 'q' etc.).
keymap.bind('gameover', { key: 'escape', cmd: 'chess.closeGameOver' });

// Point the keymap's base layer at the current mode (chess + chess-game share
// the orbit bindings). The 'promoting' modal is pushed/popped separately.
function syncContext(): void {
  const layer: string = mode === 'chess' || mode === 'chess-game' ? 'chess' : mode;
  keymap.setBase(layer);
}

// Toggle per-frame glyph jitter; forceFrame so an idle chess turntable repaints.
function toggleJitter(): void {
  jitter = !jitter;
  forceFrame = true;
}

// Cancel a pending chess promotion and repaint over the popup without a black
// flash (an ESC[2J here would blank the screen for one frame).
function cancelPromotion(): void {
  chessGame.cancelPromotion();
  forceFrame = true;
}

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
  // Game-over detection (chess-game only): open the result popup once the board is
  // terminal — for both human and AI games — until dismissed (Close) or a new game
  // leaves the terminal state. Cleared when in any other mode.
  if (mode === 'chess-game') {
    if (!chessGame.state().isTerminal()) {
      gameOver = null;
      gameOverDismissed = false;
      gameOverFocused = false;
    } else if (!gameOver && !gameOverDismissed) {
      gameOver = chessGame.state().result();
    }
  } else if (gameOver) {
    gameOver = null;
  }
  const popGameOver = (): void => {
    if (keymap.hasContext('gameover')) keymap.popContext('gameover');
  };

  const pc = promoColor();
  if (pc !== null) {
    // Keep the keymap's modal layer in lockstep with picker visibility (idempotent
    // each frame, so it self-heals even if a resize reset the base stack).
    if (!keymap.hasContext('promoting')) keymap.pushContext('promoting', true);
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
  } else if (mode === 'chess-game' && gameOver) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    promoFocused = false;
    if (!keymap.hasContext('gameover')) keymap.pushContext('gameover', true);
    const { title, subtitle, tint } = gameOverText(gameOver);
    ui.setRoot(buildGameOver({ title, subtitle, tint }, resetGame, closeGameOver), { x: 0, y: 0, w: cols, h: rows });
    if (!gameOverFocused) {
      ui.setFocus('over-newgame'); // default highlight so Enter starts a new game
      gameOverFocused = true;
      forceFrame = true;
    }
  } else if (mode === 'ui') {
    popGameOver();
    // The component playground: a full-screen tree (centered panel + the standard
    // bar) laid out over the scene, so Tab/typing reach the mounted components.
    ui.setRoot(buildShowcase({ x: 0, y: 0, w: cols, h: rows }, buildBar('ui', renderMode, actions)), {
      x: 0,
      y: 0,
      w: cols,
      h: rows,
    });
  } else if (mode === 'chess-game') {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    promoFocused = false;
    // Re-mount the move-history panel: a modal popup (game-over result, promotion)
    // replaces the whole root, dropping the Slot — which auto-unmounts the
    // ScrollBox. Re-registering the persistent instance here (idempotent; its rows
    // + scroll survive on the module-level object) restores the list when the popup
    // closes, so Close preserves the game for review / PGN copy.
    mountChessHud(ui);
    // Full-screen overlay: move-history panel (top-right) + commentary toast over
    // the board, with the standard bar beneath. Refresh the panel rows first.
    refreshMoveHistory(chessGame.moves());
    const ai = !chessGame.isMatchActive()
      ? { label: 'play ai', active: false }
      : matchPaused
        ? { label: 'resume ai', active: true }
        : { label: 'pause ai', active: true };
    ui.setRoot(
      buildChessGameRoot({ x: 0, y: 0, w: cols, h: rows }, buildBar(mode, renderMode, actions, ai), {
        minimized: historyMinimized,
        onToggle: toggleHistory,
        onCopy: copyMoves,
        commentary,
        t,
      }),
      { x: 0, y: 0, w: cols, h: rows },
    );
  } else {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
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

function onKeyImpl(ev: KeyEvent): void {
  // Focused widget first (the promotion picker's Tab/Enter/Space; future Inputs),
  // then a hovered scrollable (so ↑/↓/PageUp/PageDown scroll the move panel under
  // the cursor without a click to focus it), then the layered keymap. The keymap
  // is context-aware: the 'promoting' modal layer (pushed in syncBar) maps Escape
  // to cancel and swallows every other stray key.
  if (ui.handleKey(ev)) return;
  if (ui.tryScrollKey(hoverX, hoverY, ev)) return;
  keymap.handle(ev);
}

function onMouseImpl(e: MouseEvent): void {
  hoverX = e.x; // track the cursor so scroll keys can target what's under it
  hoverY = e.y;
  // Modal popups (promotion picker, game-over result): clicks/hover go to the
  // popup; the board and camera are frozen until it's dismissed.
  if (isPromoting() || gameOver) {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
  const orbit = activeOrbit();
  if (orbit) {
    if (e.type === 'wheel') {
      // A wheel over a scrollable component (ScrollBox/Select/Slider) scrolls it;
      // otherwise it zooms the scene.
      if (ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1)) return;
      orbit.zoomBy(e.wheel === -1 ? 0.9 : 1.1);
      return;
    }
    if (e.type === 'move') {
      ui.hover(e.x, e.y);
      return;
    }
    if (e.type === 'down') {
      // A hit on a UI node (bar button or component) fires its onClick / onMouse
      // and captures the pointer; a miss begins a camera drag (an up near here is
      // a click).
      if (!ui.pointerDown(e.x, e.y)) {
        draggingCamera = true;
        lastMouseX = downX = e.x;
        lastMouseY = downY = e.y;
      }
      return;
    }
    if (e.type === 'drag') {
      if (draggingCamera) {
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
      // Not a camera drag → route to a component that captured the down (a Slider
      // being dragged, a ScrollBox scrollbar).
      if (ui.drag(e.x, e.y)) return;
      return;
    }
    if (e.type === 'up') {
      ui.pointerUp();
      // A press that barely moved is a click (not a drag-orbit).
      const isClick = draggingCamera && Math.abs(e.x - downX) + Math.abs(e.y - downY) <= 1;
      if (isClick && mode === 'chess-game') {
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        chessGame.click(ndcX, ndcY, aspect);
      } else if (isClick && mode === 'logos') {
        // Click a wisp to play/pause its speaking pulse.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        logosScene.toggleAt(ndcX, ndcY);
      }
      draggingCamera = false;
      return;
    }
    return;
  }
  if (mode === 'attract' || mode === 'demo') {
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
  onKey(ev) {
    onKeyImpl(ev);
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

  if (mode === 'ui') {
    // The component playground sits over the chess board, which is itself
    // camera-controllable (drag to orbit, scroll to zoom, arrows to pan when no
    // component is focused). Re-render the scene only while the camera is moving
    // (forceFrame / needsRender); but ALWAYS recomposite the UI over the cached
    // scene, since a component edit (typing, slider) changes the tree without
    // tripping ui.dirty(). The empty diff of an idle frame writes nothing.
    syncBar();
    const sceneDirty = forceFrame || chess.needsRender();
    if (sceneDirty) chess.renderScene(target);
    if (UNIFIED) r.write(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
    else r.write(presentScene(false, true) + ui.frame());
    forceFrame = false;
    if (chess.needsRender()) r.requestRender(); // keep animating while the camera settles
    return;
  }

  const orbit = orbitScene();
  if (orbit) {
    // Dirty-flag gate: the chess turntables are static between interactions, so
    // skip the (expensive) re-render + full-screen write when nothing changed.
    // `jitter` intentionally animates (per-frame glyph noise) so it forces redraw.
    syncBar();
    const sceneDirty = forceFrame || jitter || orbit.needsRender();
    if (sceneDirty) orbit.renderScene(target, t);
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
syncContext(); // activate attract's key bindings from boot (no transition yet)
r.start();
r.requestRender();
