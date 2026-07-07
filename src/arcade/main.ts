import {
  bloom,
  downsample,
  halfBlockToSurface,
  luminanceToSurface,
  RenderTarget,
  shapeGlyphToSurface,
  STYLE_BOLD,
  STYLE_DIM,
  type Surface,
  toHalfBlock,
  toLuminance,
  toShapeGlyph,
} from '../engine/index.ts';
import { PrismScene, SplashScene } from '../prism/index.ts';
import { CoverFlowScene, LAUNCH_TOTAL } from './shell/coverflow.ts';
import { MENU_ITEMS } from './shell/menu.ts';
import { ChessScene } from './games/chess/turntable.ts';
import { ChessGameScene } from './games/chess/scene.ts';
import { CardsScene } from './games/poker/cards-scene.ts';
import { buildPokerRoot, mountPokerHud, pokerMode, setPokerHandlers } from './games/poker/hud.ts';
import { PokerGameScene } from './games/poker/poker-scene.ts';
import { buildPokerGameRoot, type HeroContext, mountPokerGameHud, refreshPokerLog, setPokerGameHandlers } from './games/poker/poker-hud.ts';
import { PokerMatch } from './match/poker-driver.ts';
import { buildPokerSetup, mountPokerSetup, pokerSetupSelection } from './match/poker-setup.ts';
import { LogosScene } from './scenes/logos-scene.ts';
import { AudioScene } from './scenes/audio-scene.ts';
import { createInputParser, type KeyEvent, type MouseEvent } from '../platform/input.ts';
import { buildBar, buildGameOver, buildPromotion, type BarActions, type Mode, type RenderMode } from './shell/bars.ts';
import { buildShowcase, mountShowcase } from './scenes/ui-showcase.ts';
import { buildChessGameRoot, type Commentary, mountChessHud, movesToPgn, refreshMoveHistory } from './games/chess/hud.ts';
import { clearChat, pushChatMessage } from './games/chess/chat.ts';
import { buildMatchSetup, buildSwapSetup, matchSetupSelection, mountMatchSetup, mountSwapSetup, openSwapSetup, swapSetupSelection } from './match/setup.ts';
import { copyToClipboard } from '../platform/clipboard.ts';
import { BLACK, type Color, WHITE } from '../rules/chess/types.ts';
import { evaluate } from '../rules/chess/eval.ts';
import type { ChessResult } from '../rules/chess/chess.ts';
import type { RGB, RGBA } from '../engine/index.ts';
import { Box, Button, Renderer, Screen, type LayoutBox, type Node, type Style } from '../tui/index.ts';
import { installKeymap } from './shell/keybindings.ts';
import { buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchHandlers, setTeamSwitchTeams, type TeamSwitchView } from './shell/team-switch.ts';
import * as term from '../platform/terminal.ts';
import { availableTeams, ensureGatewayKey, isLoggedIn, loadEnv, signOut as signOutVercel, switchTeam, type Team, useTeam } from '../auth/index.ts';
import { AiMatch, type Seat } from './match/driver.ts';

// Populate process.env from .env.local before anything reads AI_GATEWAY_API_KEY.
loadEnv();

const FPS = 30;
// Animations advance by the renderer's real elapsed time (see tick), so they play
// at wall-clock speed even when a large terminal drops the loop below FPS. The step
// is clamped so a stall or an idle→interaction gap can't teleport the animation.
const MAX_STEP = 0.1;
// Supersample factor for the prism screen (antialiasing + sub-cell detail
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

// The prism/chess/logos scenes render through the engine to a supersampled
// RGBA target at FULL height — the button bar composites on top of the scene's
// bottom row rather than sitting on a reserved blank strip.
let target = new RenderTarget(cols * SS, rows * 2 * SS);
let display: RenderTarget | undefined;
const prism = new PrismScene();
const coverflow = new CoverFlowScene();
const splash = new SplashScene();
const chess = new ChessScene();
const chessGame = new ChessGameScene();
const logosScene = new LogosScene();
const audioScene = new AudioScene();
const cardsScene = new CardsScene();
const pokerScene = new PokerGameScene();
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
function activeOrbit(): ChessScene | ChessGameScene | LogosScene | AudioScene | CardsScene | PokerGameScene | null {
  if (mode === 'logos') return logosScene;
  if (mode === 'audio') return audioScene;
  if (mode === 'cards') return cardsScene;
  if (mode === 'poker') return pokerScene;
  if (mode === 'ui') return chess;
  return orbitScene();
}

let mode: Mode = 'prism';
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
// The boot splash plays before the live prism becomes interactive. `mode` stays
// 'prism' underneath (so live lease + key context are already correct); this gate
// just swaps the splash scene in for the first few seconds. Any key/click skips it.
let splashing = true;
// Wii-menu hub state: selected tile index + horizontal pan (cells). Reset on entry.
let menuSel = 0;
// Continuous Cover Flow carousel position, eased toward menuSel each frame (the
// snap-to-slot). Integer = that cover centred head-on.
let coverPos = 0;
let menuHover = false; // mouse is over the focused cover (drives the hover highlight)
// Carousel snap rate (continuous-time): each frame approaches the slot by
// 1 - e^(-rate·dt). ~8.2 reproduces the old 0.24/frame feel at 30fps but stays
// consistent at any framerate.
const MENU_EASE_RATE = 8.2;
// Launch transition: clicking a cover plays the flip-to-title splash before the
// game opens. `launching` gates menu input; `launchT` is the splash clock (s);
// `launchSel` is the cover being launched.
let launching = false;
let launchT = 0;
let launchSel = 0;
// The menu's settings gear opens a modal team-switch picker. `teamModalOpen` gates
// menu input (like the chess modals); `teamModalFocused` is the focus-once edge for
// the team list; `teamView` drives the modal's contents (loading → the list →
// switching, or the signed-out / error states).
let teamModalOpen = false;
let teamModalFocused = false;
let teamView: TeamSwitchView = { kind: 'loading' };

// AI-vs-AI match. The two sides are chosen in the setup modal (provider → model).
// The match turn-loop lifecycle lives in AiMatch (ai-match.ts); main owns the
// surrounding UI state. `commentary` is the current pre-move rationale toast, shown
// until `t` passes `until`. `matchSetupOpen` shows the model picker; `setupFocused`
// is its focus-once edge.
const COMMENTARY_SECS = 3.5;
let commentary: Commentary | null = null;
let matchSetupOpen = false;
let setupFocused = false;
// The seat per side while a match is live (null when idle) — human, or an AI model.
// The source the wisp-swap popup seeds from (AI sides only), and what a swap
// updates. Set at start, updated on swap, cleared on stop.
let matchSeats: { white: Seat; black: Seat } | null = null;
// The in-match model-swap popup (click a wisp): the side being edited and whether
// the match was ALREADY paused when it opened (so closing restores that state
// instead of unconditionally resuming). Null when closed. `wispSwapFocused` is the
// focus-once edge, like the setup modal.
let wispSwap: { color: Color; wasPaused: boolean } | null = null;
let wispSwapFocused = false;
// The poker setup modal (pick opponents + models), gated on a Gateway key like the
// chess match setup. `pokerSetupFocused` is its focus-once edge.
let pokerSetupOpen = false;
let pokerSetupFocused = false;
// When on, AI moves bypass the rules: the model's move is parsed loosely and
// applied as-is. A thunk hands this live value to each ModelPlayer.
let illegalAllowed = false;
// Whether the move-history panel is collapsed to its "Moves" header button
// (toggle with the 'h' key or by clicking the header / ✕). History persists.
let historyMinimized = false;
// Whether the right-edge model-DM chat panel is shown (toggle with the 't' key or
// the bar button). On by default; the thread itself persists while hidden.
let chatVisible = true;
// Whether the right-edge eval bar is shown (toggle with the 'e' key or the bar
// button). Default hidden; the score is recomputed from the live board each frame.
let evalBarVisible = false;
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
// Continuously-animating screens (prism, logos) hold a live lease;
// the chess turntables are static and render on demand. Called on every screen
// transition (via fullRepaint).
function syncLive(): void {
  const want =
    mode === 'prism' ||
    mode === 'menu' ||
    mode === 'logos' ||
    mode === 'audio' ||
    (mode === 'chess-game' && chessGame.isMatchActive()) ||
    (mode === 'poker' && pokerScene.isActive());
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

// Whether the active gateway key came from interactive login (vs. the env var).
// The in-app account actions only touch a login-sourced key; an explicit
// AI_GATEWAY_API_KEY is left alone.
let keyFromLogin = false;

// Run an async plain-text flow outside the alt-screen: stop the frame loop,
// detach the raw-mode input handler, restore the normal terminal, run `fn`, then
// re-enter and repaint. The account actions (switch team / sign out) prompt on
// stdout, so the renderer must be paused or it would clobber the prompt.
async function withSuspendedTui(fn: () => Promise<void>): Promise<void> {
  r.stop();
  process.stdin.off('data', parse);
  term.leave();
  try {
    await fn();
  } finally {
    term.enter();
    process.stdin.on('data', parse);
    r.start();
    fullRepaint();
  }
}

// In-app "switch team": re-pick the billing team (logging in first if needed)
// and re-mint the key. Suspends the TUI for the plain-text picker.
function accountSwitchTeam(): void {
  void withSuspendedTui(async () => {
    if (await switchTeam()) keyFromLogin = true;
  });
}

// In-app "sign out": forget the stored session and re-gate AI. No-op when the
// key came from the env (nothing of ours to clear).
function accountSignOut(): void {
  if (!keyFromLogin && !isLoggedIn()) return;
  void withSuspendedTui(async () => {
    const was = signOutVercel();
    keyFromLogin = false;
    process.stdout.write(was ? '\n  Signed out of Vercel.\n\n' : '\n  Not signed in.\n\n');
    await new Promise((res) => setTimeout(res, 700)); // let the line be read before the wipe
  });
}

// ── Settings gear: switch Vercel team (menu screen) ─────────────────────────────
// The gear top-right of the Cover Flow menu opens an in-screen modal team picker —
// the alt-screen-friendly counterpart to the plain-text `switchTeam()`. Opening
// kicks off an async team fetch; the menu holds a live render lease, so the
// loading → list → switching transitions paint as they land.
function openTeamSwitch(): void {
  if (mode !== 'menu' || teamModalOpen) return;
  teamModalOpen = true;
  teamModalFocused = false;
  teamView = isLoggedIn() ? { kind: 'loading' } : { kind: 'signedOut' };
  mountTeamSwitch(ui);
  forceFrame = true;
  r.requestRender();
  if (isLoggedIn()) void loadTeams();
}

async function loadTeams(): Promise<void> {
  try {
    const res = await availableTeams();
    if (!res) teamView = { kind: 'signedOut' };
    else if (res.teams.length === 0) teamView = { kind: 'error', message: 'No teams on this account.' };
    else {
      setTeamSwitchTeams(res.teams, res.current);
      teamView = { kind: 'loaded' };
    }
  } catch (err) {
    teamView = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  r.requestRender();
}

// Commit a picked team: show a "switching…" state, re-mint the key for it (silently
// — the TUI is live), and on success mark the row with a ✓ and stay open so the
// switch reads as confirmed (the user closes with the ✕ / Esc). The re-minted key
// lands in process.env, so subsequent model/voice calls bill the new team. On failure
// the modal stays open showing the error.
function pickTeamChoice(team: Team): void {
  if (!teamModalOpen) return;
  teamView = { kind: 'switching', team: team.name };
  r.requestRender();
  void (async () => {
    try {
      await useTeam(team);
      keyFromLogin = true;
      markSwitchSucceeded(team); // ✓ on the switched row
      teamView = { kind: 'loaded' }; // back to the list (now showing the ✓), modal stays open
    } catch (err) {
      // The list is still loaded, so offer "← back" to it (canReturn).
      teamView = { kind: 'error', message: err instanceof Error ? err.message : String(err), canReturn: true };
    }
    r.requestRender();
  })();
}

// The switch-error "← back": return to the loaded team list (still in memory).
function teamSwitchBack(): void {
  if (!teamModalOpen) return;
  teamView = { kind: 'loaded' };
  forceFrame = true;
  r.requestRender();
}

function closeTeamSwitch(): void {
  if (!teamModalOpen) return;
  teamModalOpen = false;
  teamModalFocused = false;
  forceFrame = true;
  r.requestRender();
}

// The signed-out modal's "Sign in" button: close the popup and fall back to the
// existing plain-text device-login + team-pick flow (it suspends the TUI).
function teamSwitchSignIn(): void {
  closeTeamSwitch();
  accountSwitchTeam();
}

setTeamSwitchHandlers({ onPick: pickTeamChoice });

// The menu's UI overlay: a settings gear pinned top-right over the Cover Flow
// scene. The root is transparent so clicks off the gear fall through to the
// carousel (only the gear pill is a hit surface). The team-switch modal replaces
// this whole root while open (see syncBar), matching the chess modals.
const GEAR: Style = {
  padding: [0, 1],
  background: [28, 30, 40],
  color: [200, 205, 220],
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};
function buildMenuOverlay(): Node {
  const gear = Button({ id: 'menu-settings', label: '⚙ settings', onClick: openTeamSwitch, style: GEAR });
  // Inset from the top-right corner by a row / a couple of columns so it breathes.
  return Box({ width: cols, height: rows }, [Box({ position: 'absolute', top: 1, right: 2 }, [gear])]);
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

// Show/hide the model-DM chat panel (bound to 't', and the panel's own header/✕).
function toggleChat(): void {
  chatVisible = !chatVisible;
  forceFrame = true;
  r.requestRender();
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
// The turn-loop lifecycle lives in AiMatch; main injects the renderer/commentary/
// illegal-moves seams and keeps the surrounding modal UI below.
const aiMatch = new AiMatch({
  chessGame,
  syncLive,
  requestRender: () => r.requestRender(),
  // A model's pre-move rationale is a chat line, not a toast — append it to the
  // persistent thread (the bottom toast is reserved for app/system notices).
  onCommentary: (text, model) => {
    pushChatMessage({ text, model });
    r.requestRender();
  },
  allowIllegal: () => illegalAllowed,
});

// Fully stop the match and clear the commentary toast. Used by reset-game and on
// navigating away (the enter*/toPrism/enterMenu transitions) — NOT by pause.
function stopAiMatch(): void {
  aiMatch.stop();
  commentary = null;
  matchSeats = null;
  if (wispSwap) closeWispSwap(); // a match ending under an open swap popup dismisses it
}

// Open the setup modal to pick the two models (needs a Gateway key). The four
// selects are (re)mounted for their Slots; pickers retain their last selection.
function openMatchSetup(): void {
  if (!process.env.AI_GATEWAY_API_KEY) {
    commentary = { text: 'Press s to sign in to Vercel and play (or set AI_GATEWAY_API_KEY)', model: '', until: t + 6 };
    r.requestRender();
    return;
  }
  mountMatchSetup(ui);
  matchSetupOpen = true;
  setupFocused = false;
  forceFrame = true;
  r.requestRender();
}

function closeMatchSetup(): void {
  matchSetupOpen = false;
  setupFocused = false;
  forceFrame = true;
}

// Start button: only fires when both sides are ready (human, or a committed model),
// so the selection is guaranteed.
function confirmMatchSetup(): void {
  const sel = matchSetupSelection();
  if (!sel) return;
  closeMatchSetup();
  matchSeats = { white: sel.white, black: sel.black };
  clearChat(); // fresh thread for the new game
  aiMatch.start(sel.white, sel.black);
}

// ── In-match model swap (click a wisp) ─────────────────────────────────────────
// Clicking a side's HUD wisp during a match opens a single-side model picker for
// it. The match freezes while the popup is up (we pause it if it wasn't already),
// then Switch swaps that side's player + wisp and resumes; Cancel just restores
// the prior run/pause state. The current model seeds the picker so Switch is live
// immediately.
function openWispSwap(color: Color): void {
  if (!matchSeats) return;
  const seat = color === WHITE ? matchSeats.white : matchSeats.black;
  if (seat.kind !== 'ai') return; // human sides have no wisp to click, nothing to swap
  const key = color === WHITE ? 'white' : 'black';
  const slug = seat.model;
  const wasPaused = aiMatch.isPaused();
  if (!wasPaused) aiMatch.pause(); // freeze the game during the switch
  wispSwap = { color, wasPaused };
  wispSwapFocused = false;
  mountSwapSetup(ui);
  openSwapSetup(key, slug);
  forceFrame = true;
  r.requestRender();
}

// Close the popup, restoring the match's prior run/pause state (resume only if we
// were the ones who paused it). Shared by Cancel and the match-ended path.
function closeWispSwap(): void {
  const s = wispSwap;
  wispSwap = null;
  wispSwapFocused = false;
  if (s && !s.wasPaused && aiMatch.isPaused()) aiMatch.resume();
  forceFrame = true;
  r.requestRender();
}

function cancelWispSwap(): void {
  closeWispSwap();
}

// Switch button: swap the clicked side's player + HUD wisp to the chosen model,
// record it in matchSeats, then close (resuming if we auto-paused). Guarded on a
// committed selection (the button is disabled otherwise).
function confirmWispSwap(): void {
  const s = wispSwap;
  if (!s) return;
  const slug = swapSetupSelection();
  if (!slug || !matchSeats) return;
  aiMatch.setPlayer(s.color === WHITE ? 0 : 1, slug);
  chessGame.setSideProvider(s.color, slug.split('/')[0] ?? slug);
  if (s.color === WHITE) matchSeats.white = { kind: 'ai', model: slug };
  else matchSeats.black = { kind: 'ai', model: slug };
  closeWispSwap();
}

// ── Poker session ───────────────────────────────────────────────────────────────
// The multi-hand poker driver (rotating button/blinds, carried stacks). main owns
// the surrounding UI — the setup modal, the commentary toast, the betting HUD.
const pokerMatch = new PokerMatch({
  scene: pokerScene,
  syncLive,
  requestRender: () => r.requestRender(),
  onCommentary: (text, model) => {
    commentary = { text, model, until: t + COMMENTARY_SECS };
  },
  onHandOver: () => {
    forceFrame = true;
    r.requestRender();
  },
});

// Wire the hero's betting controls to the scene (main owns the scene; the HUD owns
// the buttons/slider). Each commits the hero's action to the match loop, then asks
// for a repaint so the controls hide until the hero's next turn.
setPokerGameHandlers({
  onFold: () => {
    pokerScene.commitHumanAction({ type: 'fold' });
    forceFrame = true;
    r.requestRender();
  },
  onCheckCall: () => {
    const st = pokerScene.state();
    const action = st.toCall(st.toActSeat()) > 0 ? ({ type: 'call' } as const) : ({ type: 'check' } as const);
    pokerScene.commitHumanAction(action);
    forceFrame = true;
    r.requestRender();
  },
  onBetRaise: (amount) => {
    pokerScene.commitHumanAction({ type: 'raise', to: amount });
    forceFrame = true;
    r.requestRender();
  },
  onAllin: () => {
    pokerScene.commitHumanAction({ type: 'allin' });
    forceFrame = true;
    r.requestRender();
  },
  onSliderChange: () => {
    forceFrame = true;
    r.requestRender();
  },
});

// Stop the poker session (navigating away / new match). Safe when idle.
function stopPokerMatch(): void {
  pokerMatch.stop();
  commentary = null;
}

// Open the poker setup modal (needs a Gateway key, like the chess match setup).
function openPokerSetup(): void {
  if (!process.env.AI_GATEWAY_API_KEY) {
    commentary = { text: 'Press s to sign in to Vercel and play (or set AI_GATEWAY_API_KEY)', model: '', until: t + 6 };
    r.requestRender();
    return;
  }
  mountPokerSetup(ui);
  pokerSetupOpen = true;
  pokerSetupFocused = false;
  forceFrame = true;
  r.requestRender();
}

function closePokerSetup(): void {
  pokerSetupOpen = false;
  pokerSetupFocused = false;
  forceFrame = true;
  r.requestRender();
}

// Start button: begin a session with the chosen seats (guaranteed present).
function confirmPokerSetup(): void {
  const seats = pokerSetupSelection();
  if (!seats) return;
  closePokerSetup();
  pokerMatch.start(seats);
}

// The poker AI button / 'p' key: play (idle → open setup) → pause (running) → resume.
function pokerButton(): void {
  if (mode !== 'poker') enterPoker();
  if (!pokerMatch.isRunning()) openPokerSetup();
  else if (pokerMatch.isPaused()) pokerMatch.resume();
  else pokerMatch.pause();
  r.requestRender();
}

// New match: stop the current session and re-open the setup modal.
function pokerNewMatch(): void {
  if (mode !== 'poker') return;
  stopPokerMatch();
  openPokerSetup();
}

// Build the hero's decision context for the HUD from the live hand (seat 0 = hero).
function pokerHero(): HeroContext {
  const idle: HeroContext = { toAct: false, toCall: 0, minRaiseTo: 0, maxRaiseTo: 0, stack: 0, pot: 0, canRaise: false };
  if (mode !== 'poker' || !pokerScene.isActive()) return idle;
  let st;
  try {
    st = pokerScene.state();
  } catch {
    return idle;
  }
  return {
    toAct: pokerScene.heroToAct(),
    toCall: st.toCall(0),
    minRaiseTo: st.minRaiseTo(0),
    maxRaiseTo: st.maxRaiseTo(0),
    stack: st.stackOf(0),
    pot: st.potTotal(),
    canRaise: st.maxRaiseTo(0) > st.currentBetAmount(),
  };
}

// A short status line for the HUD when no commentary/turn prompt is showing.
function pokerStatus(): string {
  if (mode !== 'poker') return '';
  if (!pokerScene.isActive()) return 'Press play to start a match';
  if (!pokerMatch.isRunning()) return 'Session over — new match to play again';
  if (pokerMatch.isPaused()) return 'Paused';
  if (pokerScene.heroToAct()) return 'Your move';
  return '';
}

// Toggle illegal-moves mode (bar button / 'i' key). Takes effect on the next AI
// move (the ModelPlayers read it live via a thunk).
function toggleIllegal(): void {
  illegalAllowed = !illegalAllowed;
  forceFrame = true;
  r.requestRender();
}

// Show/hide the right-edge eval bar (bar button / 'e' key).
function toggleEvalBar(): void {
  evalBarVisible = !evalBarVisible;
  forceFrame = true;
  r.requestRender();
}

// The AI button / 'p' key: play (idle) → pause (running) → resume (paused).
// Entering from elsewhere first opens the chess game.
function aiButton(): void {
  if (mode !== 'chess-game') enterChessGame();
  if (!chessGame.isMatchActive()) openMatchSetup();
  else if (aiMatch.isPaused()) aiMatch.resume();
  else aiMatch.pause();
  r.requestRender();
}

// Reset to a fresh game: abort any running AI match, restore the start position,
// and clear the move history + captures.
function resetGame(): void {
  if (mode !== 'chess-game') return;
  stopAiMatch();
  chessGame.resetGame();
  clearChat(); // empty the DM thread for the fresh game
  syncLive(); // release the live lease the match held
  forceFrame = true;
  r.requestRender();
}

function enterLogos(): void {
  stopAiMatch();
  mode = 'logos';
  fullRepaint();
}

// The realtime voice screen: type-to-talk with a speech-to-speech model while its
// provider wisp pulses. The session opens lazily on the first message.
function enterAudio(): void {
  stopAiMatch();
  mode = 'audio';
  audioScene.activate();
  fullRepaint();
}

// The cards screen (poker card visuals): single / hand / deck sub-modes, driven by
// the poker HUD panel. No game rules yet — a place to dial in the card look.
function enterCards(): void {
  stopAiMatch();
  audioScene.deactivate();
  mode = 'cards';
  draggingCamera = false;
  mountPokerHud(ui);
  cardsScene.setMode(pokerMode()); // match the scene to the HUD's committed mode
  fullRepaint();
}

// The poker game screen: a 3D table where you play no-limit Hold'em against AI
// models. Entering shows the idle felt; the 'play' button opens the setup modal.
function enterPoker(): void {
  stopAiMatch();
  audioScene.deactivate();
  mode = 'poker';
  draggingCamera = false;
  mountPokerGameHud(ui);
  fullRepaint();
}

// Wire the poker HUD's controls to the scene. Stored once; the dropdowns/buttons
// call these on interaction.
setPokerHandlers({
  onMode: (m) => {
    cardsScene.setMode(m);
    forceFrame = true;
    r.requestRender();
  },
  onCard: (c) => {
    cardsScene.setCard(c);
    forceFrame = true;
    r.requestRender();
  },
  onShuffle: () => {
    cardsScene.shuffle();
    r.requestRender();
  },
  onDeal: () => {
    cardsScene.deal();
    r.requestRender();
  },
  onPlayers: (n) => {
    cardsScene.setPlayers(n);
    forceFrame = true;
    r.requestRender();
  },
});

function toPrism(): void {
  stopAiMatch();
  stopPokerMatch();
  audioScene.deactivate(); // tear down any open voice session when leaving
  mode = 'prism';
  ui.setRoot(null); // attract screen has no bar — clear any prior screen's overlay
  fullRepaint();
}

// The Wii-style menu hub. Reached from the prism attract screen (any key) and
// returned to by a game's "back". No bar — the tiles are the navigation surface.
function enterMenu(): void {
  stopAiMatch();
  stopPokerMatch();
  audioScene.deactivate(); // tear down any open voice session when leaving
  mode = 'menu';
  menuSel = 0;
  coverPos = 0;
  menuHover = false;
  launching = false;
  ui.setRoot(null);
  fullRepaint();
}

// Clicking/▶ a cover starts the flip-to-title launch splash (enabled covers only;
// placeholders are no-ops). enterGame runs when the splash finishes.
function launchSelected(): void {
  if (launching) return;
  const item = MENU_ITEMS[menuSel];
  if (!item?.enabled) return;
  launching = true;
  launchT = 0;
  launchSel = menuSel;
  ui.setRoot(null); // hide the settings gear during the flip-to-title launch splash
}

// Open the actual game screen for a cover id (the destinations the splash hands off to).
function enterGame(id: string): void {
  if (id === 'chess') enterChessGame();
  else if (id === 'logos') enterLogos();
  else if (id === 'audio') enterAudio();
  else if (id === 'poker') enterPoker();
  else if (id === 'poker-test') enterCards();
  else if (id === 'ui') enterUi();
}

// Step the Cover Flow selection by ±1 (clamped). The carousel eases to it in tick.
function menuNav(step: number): void {
  if (launching) return; // input is locked while the launch splash plays
  menuSel = Math.max(0, Math.min(MENU_ITEMS.length - 1, menuSel + step));
}

// The Cover Flow chrome over the 3D covers: the focused game's title centred below
// the carousel (dim "coming soon" tail for placeholders) and the control hint.
function drawCoverChrome(surf: Surface, cols: number, rows: number, sel: number): void {
  const item = MENU_ITEMS[sel];
  const suffix = item.enabled ? '' : '   coming soon';
  const tx = Math.max(0, Math.floor((cols - (item.title.length + suffix.length)) / 2));
  const ty = rows - 4;
  const chip: RGB = [10, 12, 18];
  surf.drawText(tx, ty, item.title, [240, 244, 255], chip, STYLE_BOLD);
  if (suffix) surf.drawText(tx + item.title.length, ty, suffix, [150, 156, 174], chip, STYLE_DIM);

  const hint = '← → select   ⏎ play   esc back';
  const hx = Math.max(0, Math.floor((cols - hint.length) / 2));
  surf.drawText(hx, rows - 2, hint, [120, 126, 142], [8, 10, 16], STYLE_DIM);
}

// The prism attract prompt: a small, subtle, lowercase line near the bottom whose
// opacity wavers (a slow sine, never fully gone) — the arcade "breathing" glow
// rather than a hard blink. Drawn with alpha-blending over the scene so the waver
// reads as real opacity.
const ATTRACT_TEXT = 'press any key to start';
function drawAttract(surf: Surface, cols: number, rows: number, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.2); // ~0.6 Hz, 0..1
  const alpha = 0.42 + 0.5 * pulse; // wavers ~0.42..0.92, always visible
  const x0 = Math.max(0, Math.floor((cols - ATTRACT_TEXT.length) / 2));
  const y = rows - 2;
  const fg: RGBA = [205, 210, 230, alpha];
  const bg: RGBA = [0, 0, 0, 0]; // keep the scene behind; only the glyph blends
  for (let i = 0; i < ATTRACT_TEXT.length; i++) {
    if (ATTRACT_TEXT[i] !== ' ') surf.setCellWithAlphaBlending(x0 + i, y, ATTRACT_TEXT[i], fg, bg);
  }
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
  back: enterMenu,
  reset: () => activeOrbit()?.resetView(),
  mode: cycleMode,
  quit,
  aiMatch: aiButton,
  resetGame,
  illegalMoves: toggleIllegal,
  evalBar: toggleEvalBar,
  audioModel: () => audioScene.cycleModel(),
  pokerAI: pokerButton,
  pokerNewMatch,
  pokerSeat: () => pokerScene.focusHero(),
};

// Named commands + a layered keymap (the OpenTUI-style command surface). Each
// action is registered once with a stable id; keys are bound to ids per context
// (mode). onKeyImpl collapses to `keymap.handle(ev)`. The id catalog
// (`keymap.commands()`) is also the surface an AI agent will drive the app
// through — a human key and an agent command id hit the same `run`.
// The command catalog + per-mode key bindings live in keybindings.ts; main owns
// the handlers and the live keymap (setBase / handle / modal push-pop below).
const keymap = installKeymap({
  quit,
  accountSwitchTeam,
  accountSignOut,
  openTeamSwitch,
  closeTeamSwitch,
  cycleMode,
  setRenderMode,
  toggleJitter,
  enterMenu,
  toPrism,
  menuNav,
  launchSelected,
  enterAudio,
  audioCycleModel: () => audioScene.cycleModel(),
  enterChess,
  enterChessGame,
  enterUi,
  activeOrbit,
  cancelPromotion,
  aiButton,
  toggleHistory,
  toggleChat,
  resetGame,
  toggleIllegal,
  toggleEvalBar,
  closeGameOver,
  closeMatchSetup,
  cancelWispSwap,
  pokerButton,
  pokerNewMatch,
  closePokerSetup,
});

// Point the keymap's base layer at the current mode (chess + chess-game share
// the orbit bindings). The 'promoting' modal is pushed/popped separately.
function syncContext(): void {
  const layer: string = mode === 'chess' || mode === 'chess-game' ? 'chess' : mode;
  keymap.setBase(layer); // 'poker' maps straight through to the poker layer
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
  if (mode !== 'chess-game') matchSetupOpen = false; // the picker only lives in the chess view
  if (mode !== 'poker') pokerSetupOpen = false; // the poker picker only lives in the poker view
  // The poker-setup modal layer is popped whenever its modal isn't open (any branch).
  if (!pokerSetupOpen && keymap.hasContext('poker-setup')) keymap.popContext('poker-setup');
  const popGameOver = (): void => {
    if (keymap.hasContext('gameover')) keymap.popContext('gameover');
  };
  const popSetup = (): void => {
    if (keymap.hasContext('setup')) keymap.popContext('setup');
  };
  const popSwap = (): void => {
    if (keymap.hasContext('swap')) keymap.popContext('swap');
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
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('gameover')) keymap.pushContext('gameover', true);
    const { title, subtitle, tint } = gameOverText(gameOver);
    ui.setRoot(buildGameOver({ title, subtitle, tint }, resetGame, closeGameOver), { x: 0, y: 0, w: cols, h: rows });
    if (!gameOverFocused) {
      ui.setFocus('over-newgame'); // default highlight so Enter starts a new game
      gameOverFocused = true;
      forceFrame = true;
    }
  } else if (matchSetupOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('setup')) keymap.pushContext('setup', true);
    ui.setRoot(buildMatchSetup({ x: 0, y: 0, w: cols, h: rows }, { onStart: confirmMatchSetup, onCancel: closeMatchSetup }), {
      x: 0,
      y: 0,
      w: cols,
      h: rows,
    });
    if (!setupFocused) {
      ui.setFocus('setup-white-provider'); // start in White's provider list
      setupFocused = true;
      forceFrame = true;
    }
  } else if (wispSwap) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    promoFocused = false;
    if (!keymap.hasContext('swap')) keymap.pushContext('swap', true);
    // Re-mount the swap dropdowns (a prior modal root may have dropped their Slots)
    // before rebuilding the one-column picker for the clicked side.
    mountSwapSetup(ui);
    const title = wispSwap.color === WHITE ? 'White' : 'Black';
    ui.setRoot(buildSwapSetup({ x: 0, y: 0, w: cols, h: rows }, { title, onConfirm: confirmWispSwap, onCancel: cancelWispSwap }), {
      x: 0,
      y: 0,
      w: cols,
      h: rows,
    });
    if (!wispSwapFocused) {
      ui.setFocus('setup-swap-provider'); // start in the provider list
      wispSwapFocused = true;
      forceFrame = true;
    }
  } else if (mode === 'menu') {
    popGameOver();
    popSetup();
    popSwap();
    // The Cover Flow menu: a settings gear overlay, or — while open — the team-switch
    // modal replacing the whole root (like the chess modals). Keep the team list
    // instance mounted either way so its rows survive the rebuild.
    mountTeamSwitch(ui);
    const region = { x: 0, y: 0, w: cols, h: rows };
    if (teamModalOpen) {
      if (!keymap.hasContext('teamswitch')) keymap.pushContext('teamswitch', true);
      ui.setRoot(buildTeamSwitch(teamView, { onClose: closeTeamSwitch, onSignIn: teamSwitchSignIn, onBack: teamSwitchBack }), region);
      // Focus the list once it's populated so ↑↓/Enter drive it (the Slot isn't in
      // the loading/switching trees, so wait for 'loaded').
      if (teamView.kind === 'loaded' && !teamModalFocused) {
        ui.setFocus('team-switch-list');
        teamModalFocused = true;
        forceFrame = true;
      }
    } else {
      if (keymap.hasContext('teamswitch')) keymap.popContext('teamswitch');
      ui.setRoot(buildMenuOverlay(), region);
    }
  } else if (pokerSetupOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('poker-setup')) keymap.pushContext('poker-setup', true);
    mountPokerSetup(ui); // a prior modal root may have dropped the Slots
    ui.setRoot(buildPokerSetup({ x: 0, y: 0, w: cols, h: rows }, { onStart: confirmPokerSetup, onCancel: closePokerSetup }), {
      x: 0,
      y: 0,
      w: cols,
      h: rows,
    });
    if (!pokerSetupFocused) {
      ui.setFocus('poker-oppcount'); // start on the opponent-count picker
      pokerSetupFocused = true;
      forceFrame = true;
    }
  } else if (mode === 'ui') {
    popGameOver();
    popSetup();
    popSwap();
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
    popSetup();
    popSwap();
    promoFocused = false;
    // Re-mount the move-history panel: a modal popup (game-over result, promotion)
    // replaces the whole root, dropping the Slot — which auto-unmounts the
    // ScrollBox. Re-registering the persistent instance here (idempotent; its rows
    // + scroll survive on the module-level object) restores the list when the popup
    // closes, so Close preserves the game for review / PGN copy.
    mountChessHud(ui);
    // Full-screen overlay: move-history panel (top-right) + commentary toast over
    // the board, with the standard bar beneath. Refresh the panel rows first.
    refreshMoveHistory(chessGame.moves(), chessGame.illegalFlags());
    const ai = !chessGame.isMatchActive()
      ? { label: 'play ai', active: false }
      : aiMatch.isPaused()
        ? { label: 'resume ai', active: true }
        : { label: 'pause ai', active: true };
    // White-POV centipawns for the eval bar (cheap 64-square scan; only when shown).
    const evalCp = evalBarVisible ? evaluate(chessGame.state().board) : 0;
    ui.setRoot(
      buildChessGameRoot({ x: 0, y: 0, w: cols, h: rows }, buildBar(mode, renderMode, actions, ai, illegalAllowed, evalBarVisible), {
        minimized: historyMinimized,
        onToggle: toggleHistory,
        onCopy: copyMoves,
        commentary,
        t,
        evalVisible: evalBarVisible,
        evalCp,
        evalResult: chessGame.state().result(),
        chatVisible,
        onToggleChat: toggleChat,
      }),
      { x: 0, y: 0, w: cols, h: rows },
    );
  } else if (mode === 'cards') {
    popGameOver();
    popSetup();
    popSwap();
    // Re-mount the poker dropdowns (a prior modal root may have dropped their
    // Slots), then build the control panel + bar over the scene.
    mountPokerHud(ui);
    ui.setRoot(buildPokerRoot({ x: 0, y: 0, w: cols, h: rows }, buildBar('cards', renderMode, actions)), { x: 0, y: 0, w: cols, h: rows });
  } else if (mode === 'poker') {
    popGameOver();
    popSetup();
    popSwap();
    // Re-mount the poker HUD components (a prior modal root may have dropped their
    // Slots), refresh the action log, then build the table HUD + bar over the scene.
    mountPokerGameHud(ui);
    let logRows: readonly string[] = [];
    try {
      logRows = pokerScene.isActive() ? pokerScene.state().history() : [];
    } catch {
      logRows = [];
    }
    refreshPokerLog(logRows);
    const ai = !pokerMatch.isRunning()
      ? { label: 'play', active: false }
      : pokerMatch.isPaused()
        ? { label: 'resume', active: true }
        : { label: 'pause', active: true };
    ui.setRoot(
      buildPokerGameRoot({ x: 0, y: 0, w: cols, h: rows }, buildBar('poker', renderMode, actions, ai), {
        hero: pokerHero(),
        blinds: '10/20',
        commentary,
        t,
        status: pokerStatus(),
      }),
      { x: 0, y: 0, w: cols, h: rows },
    );
  } else {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    ui.setRoot(buildBar(mode, renderMode, actions), barRegion());
  }
}

// Presents the engine `target` (prism / chess) in the active
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
  // Any key skips the boot splash straight to the live prism (the wrapper requests
  // a render, so the next tick falls through to the prism branch).
  if (splashing) {
    splashing = false;
    return;
  }
  // Prism attract screen: any key starts (→ menu). ctrl+c still quits (falls to keymap).
  if (mode === 'prism' && !(ev.ctrl && ev.name === 'c')) {
    enterMenu();
    return;
  }
  // Audio screen: type-to-talk. Printable keys + enter/backspace/tab feed the
  // prompt; everything else (escape → back, arrows → pan) falls to the keymap.
  if (mode === 'audio') {
    if (audioScene.handleKey(ev)) return;
    keymap.handle(ev);
    return;
  }
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
  // A click also skips the boot splash to the live prism.
  if (splashing && e.type === 'down') {
    splashing = false;
    return;
  }
  // Prism attract: a click starts (→ menu).
  if (mode === 'prism' && e.type === 'down') {
    enterMenu();
    return;
  }
  // Cover Flow: the wheel steps selection; clicking the focused cover (its real
  // projected border) launches it, clicking off to a side steps that way, and
  // hovering the focused cover lights it up.
  if (mode === 'menu') {
    if (launching) return; // ignore pointer input during the launch splash
    // Team-switch modal up: the carousel is frozen behind the scrim; route pointer
    // input to the popup (like the chess modal block below).
    if (teamModalOpen) {
      if (e.type === 'move') ui.hover(e.x, e.y);
      else if (e.type === 'down') ui.pointerDown(e.x, e.y);
      else if (e.type === 'drag') ui.drag(e.x, e.y);
      else if (e.type === 'wheel') ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1);
      else if (e.type === 'up') ui.pointerUp();
      return;
    }
    const rect = coverflow.coverScreenRect(menuSel - coverPos, cols, rows);
    const mx = e.x - 1;
    const my = e.y - 1;
    const inside = mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h;
    if (e.type === 'move') {
      ui.hover(e.x, e.y); // light the settings gear when the cursor is over it
      menuHover = inside;
    } else if (e.type === 'wheel') {
      menuNav(e.wheel === -1 ? -1 : 1);
    } else if (e.type === 'down') {
      // A hit on the gear (a UI surface) opens the modal; a miss falls through to
      // carousel navigation.
      if (ui.pointerDown(e.x, e.y)) return;
      if (inside) launchSelected();
      else if (mx < rect.x) menuNav(-1);
      else if (mx >= rect.x + rect.w) menuNav(1);
    } else if (e.type === 'up') {
      ui.pointerUp();
    }
    return;
  }
  // Modal popups (promotion picker, game-over result, match setup, wisp model
  // swap): clicks/hover go to the popup; the board and camera are frozen until
  // it's dismissed.
  if (isPromoting() || gameOver || matchSetupOpen || wispSwap || pokerSetupOpen) {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'drag') ui.drag(e.x, e.y); // e.g. dragging a dropdown's scrollbar
    else if (e.type === 'wheel') ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1); // scroll an open dropdown
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
      // Cards screen / poker table: pointer-move drives the hole-card peek hover.
      if (mode === 'cards') {
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        cardsScene.hover(ndcX, ndcY, aspect);
      } else if (mode === 'poker') {
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        pokerScene.hoverCard(ndcX, ndcY, aspect);
      }
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
        // In a match, a click on a side's HUD wisp opens its model-swap popup;
        // otherwise the click goes to the board — which the scene ignores unless
        // it's a human's turn (then it selects/moves). Outside a match it's a normal
        // free-play piece/destination click.
        if (chessGame.isMatchActive()) {
          const side = chessGame.wispAt(ndcX, ndcY, aspect);
          if (side !== null) openWispSwap(side);
          else chessGame.click(ndcX, ndcY, aspect);
        } else {
          chessGame.click(ndcX, ndcY, aspect);
        }
      } else if (isClick && mode === 'logos') {
        // Click a wisp to play/pause its speaking pulse.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        logosScene.toggleAt(ndcX, ndcY);
      } else if (isClick && mode === 'cards') {
        // Click a hand card to lift it (hand mode); a no-op in single/deck.
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        cardsScene.click(ndcX, ndcY, aspect);
      } else if (isClick && mode === 'poker') {
        // Click one of your own hole cards to lift it fully face-on.
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        pokerScene.clickCard(ndcX, ndcY, aspect);
      }
      draggingCamera = false;
      return;
    }
    return;
  }
  if (mode === 'prism') {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
}

// Wrap the handlers so every input requests a render — essential for the
// on-demand chess screens (idle until interacted with), harmless for the
// continuously-live prism/logos screens.
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

function tick(dt: number): void {
  const step = Math.min(dt, MAX_STEP); // real seconds since the last rendered frame, clamped
  t += step;

  if (splashing) {
    // Boot splash: no button bar (the ui root is unmounted until syncBar runs, so
    // frameComposited paints scene-only). When it finishes, fall through to the
    // live prism in this same frame — the differ swaps in the bar with no clear,
    // so there's no black flash and the handoff is seamless.
    if (!splash.done(t)) {
      splash.renderScene(target, t);
      r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene());
      return;
    }
    splashing = false;
  }

  if (mode === 'prism') {
    // Attract screen: live prism + a flashing "press any key" marquee, no bar.
    prism.renderScene(target, t);
    r.write(
      UNIFIED
        ? ui.frameComposited((s) => {
            presentSceneInto(s);
            drawAttract(s, cols, rows, t);
          })
        : presentScene(),
    );
    return;
  }

  if (mode === 'menu') {
    // Launch splash: flip the clicked cover to its title, then open the game.
    if (launching) {
      launchT += step;
      coverflow.renderLaunch(target, launchSel, launchT);
      r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene());
      if (launchT >= LAUNCH_TOTAL) {
        launching = false;
        enterGame(MENU_ITEMS[launchSel].id);
      }
      return;
    }
    // Cover Flow hub: ease the carousel toward the selected slot (snap-to-slot),
    // render the 3D covers full-screen, then draw the title + hint chrome on top.
    // syncBar builds the settings-gear overlay (or the open team-switch modal) that
    // frameComposited then paints above the chrome.
    coverPos += (menuSel - coverPos) * (1 - Math.exp(-MENU_EASE_RATE * step));
    if (Math.abs(menuSel - coverPos) < 0.0015) coverPos = menuSel;
    coverflow.renderScene(target, coverPos, menuHover ? menuSel : -1);
    syncBar();
    r.write(
      UNIFIED
        ? ui.frameComposited((s) => {
            presentSceneInto(s);
            drawCoverChrome(s, cols, rows, menuSel);
          })
        : presentScene() + ui.frame(),
    );
    return;
  }

  if (mode === 'logos') {
    logosScene.renderScene(target, t);
    syncBar();
    r.write(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene() + ui.frame());
    return;
  }

  if (mode === 'audio') {
    // Live wisp + the conversation overlay (drawn over the composited frame, like
    // the menu). The bar composites on top via syncBar's root.
    audioScene.renderScene(target, t);
    syncBar();
    r.write(
      UNIFIED
        ? ui.frameComposited((s) => {
            presentSceneInto(s);
            audioScene.drawOverlay(s, cols, rows);
          })
        : presentScene() + ui.frame(),
    );
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

  if (mode === 'cards') {
    // The cards screen: on-demand like the chess turntable (static between camera
    // moves), but the card animations (hand peek/flip, deck shuffle/deal) keep the
    // scene dirty and re-arm the loop until they settle.
    syncBar();
    const sceneDirty = forceFrame || cardsScene.needsRender();
    if (sceneDirty) cardsScene.renderScene(target, t);
    if (UNIFIED) {
      if (sceneDirty || ui.dirty()) r.write(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
    } else if (sceneDirty) {
      r.write(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      r.write(ui.frame());
    }
    forceFrame = false;
    if (cardsScene.needsRender()) r.requestRender();
    return;
  }

  if (mode === 'poker') {
    // The poker table: an active session animates the wisps continuously (a held
    // live lease keeps frames flowing while the driver awaits the network); between
    // moves it's dirty-gated like the cards screen. The stack/pot labels are drawn
    // as a projected overlay in the scene layer (like the audio conversation).
    syncBar();
    const sceneDirty = forceFrame || pokerScene.needsRender();
    if (sceneDirty) pokerScene.renderScene(target, t);
    if (UNIFIED) {
      if (sceneDirty || ui.dirty()) {
        r.write(
          ui.frameComposited((s) => {
            presentSceneInto(s, false, true);
            pokerScene.drawOverlay(s, cols, rows);
          }, sceneDirty),
        );
      }
    } else if (sceneDirty) {
      r.write(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      r.write(ui.frame());
    }
    forceFrame = false;
    if (pokerScene.needsRender()) r.requestRender();
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

// Resolve the AI Gateway key (env override → stored Vercel session → device
// login + team pick), then launch. The interactive flow is plain text and runs
// BEFORE term.enter(), so it reads like `vercel login` on the normal terminal;
// once it returns, every model/voice call works via process.env.AI_GATEWAY_API_KEY.
const argv = process.argv.slice(2);
if (argv.includes('--logout')) {
  const was = signOutVercel();
  console.log(was ? 'Signed out of Vercel.' : 'Not signed in.');
  process.exit(0);
}
const auth = await ensureGatewayKey({
  forceLogin: argv.includes('--login'),
  forceTeamPick: argv.includes('--switch-team'),
});
keyFromLogin = auth?.source === 'login';

term.enter();
process.stdin.on('data', parse);
r.onFrame(tick);
syncLive(); // prism starts live (continuously animating)
syncContext(); // activate prism's key bindings from boot (no transition yet)
r.start();
r.requestRender();
