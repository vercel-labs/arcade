import {
  applyTerminalColorMode,
  bloom,
  downsample,
  halfBlockLayerToSurface,
  halfBlockToSurface,
  mulberry32,
  RenderTarget,
  shapeGlyphToSurface,
  ShapeGlyphSurfaceCache,
  shapeGlyphLayerToSurface,
  Surface,
  STYLE_BOLD,
  STYLE_DIM,
  type TerminalColorMode,
  toHalfBlock,
  toShapeGlyph,
} from '../engine/index.ts';
import { TimedInkTransition } from '../cinematic/transitions/timed-ink-transition.ts';
import { PrismScene, SplashScene } from '../prism/index.ts';
import { coverFlowIndex } from '../cinematic/scenes/cover-flow.ts';
import { CoverFlowScene, LAUNCH_TOTAL } from './shell/coverflow.ts';
import { CoverFlowWheelInput } from './shell/coverflow-input.ts';
import { coverTail, HOME_MENU_INDEX, MENU_ITEMS, menuItemAction, TUTORIAL_MENU_INDEX } from './shell/menu.ts';
import { isFirstRun, markFirstRunSeen } from './shell/first-run.ts';
import { ChessGameScene } from './games/chess/scene.ts';
import { CardsScene } from './games/poker/cards-scene.ts';
import { type TileScene } from './games/islanders/tile-scene.ts';
import { IslandersController } from './games/islanders/islanders-controller.ts';
import { closeIslandersSidebar, ISLANDERS_RAIL_W, islandersRailVisible } from './games/islanders/card-hud.ts';
import { IslandersGameScene } from './games/islanders/game-scene.ts';
import { buildIslandersGameRoot, islandersChatComposer, mountIslandersGameHud } from './games/islanders/game-hud.ts';
import { IslandersDriver } from './match/islanders-driver.ts';
import { RESOURCES } from '../rules/islanders/types.ts';
import type { CommunicationMode } from '../harness/communication/types.ts';
import { islandersSetupCommunicationMode, islandersSetupSelection, setIslandersSetupChanged, setIslandersSetupCommunicationMode, setIslandersSetupModelCatalog } from './match/islanders-setup-panel.ts';
import { buildPokerRoot, mountPokerHud, pokerMode, setPokerHandlers } from './games/poker/hud.ts';
import { PokerGameScene } from './games/poker/poker-scene.ts';
import { buildPokerGameRoot, buildPokerNotesModal, clearPokerChat, type HeroContext, mountPokerGameHud, nudgePokerBet, pushPokerChat, setNotesObserverPick, setPokerGameHandlers, setPokerVoiceStage } from './games/poker/poker-hud.ts';
import { mountPokerNotes } from './games/poker/poker-notes.ts';
import { PokerMatch } from './match/poker-driver.ts';
import { buildPokerSetupPanel, mountPokerSetup, pokerPreviewSeats, pokerSetupReady, pokerSetupSelection, pokerStartingStack, setPokerSetupChanged, setPokerSetupModelCatalog } from './match/poker-setup.ts';
import { LogosScene } from './scenes/logos-scene.ts';
import { AudioScene } from './scenes/audio-scene.ts';
import { buildTrailerOverlay, TrailerScene } from './scenes/trailer-scene.ts';
import { createInputParser, type KeyEvent, type MouseEvent } from '../platform/input.ts';
import { detectTerminalColorMode } from '../platform/terminal-color-detection.ts';
import { buildBar, buildConfirm, buildGameMenu, buildGameOver, buildPromotion, buildShortcuts, buildUpdateModal, mouseControlsFor, type BarActions, type MenuItem, type Mode, type RenderMode } from './shell/bars.ts';
import { buildShowcase, mountShowcase } from './scenes/ui-showcase.ts';
import { buildChessGameRoot, chessMoveChat, type Commentary, type MatchSide, mountChessHud, movesToPgn, refreshMoveHistory, shortModel } from './games/chess/hud.ts';
import { CHESS_PALETTE } from './games/chess/palette.ts';
import { creatorTint } from './scenes/wisp.ts';
import { CHAT_WIDTH, clearChat, pushChatMessage } from './match/chat.ts';
import { buildMatchSetup, buildSwapSetup, chessPreviewSides, matchSetupOptions, matchSetupSelection, mountMatchSetup, mountSwapSetup, openSwapSetup, setMatchSetupChanged, setMatchSetupModelCatalog, swapSetupSelection } from './match/setup.ts';
import { fallbackArcadeModelCatalog, fetchTeamModelCatalog, type ArcadeModelCatalog } from './match/team-model-catalog.ts';
import { buildGatewayNoticePill, catalogAccessLine, gatewayNoticeFor, gatewayNoticeSentence, type GatewayNoticeKind } from './shell/gateway-notice.ts';
import { ChatComposer } from './match/chat-composer.ts';
import { CHAT_COMPOSER_W } from './match/chat-sidebar.ts';
import { copyToClipboard } from '../platform/clipboard.ts';
import { checkForUpdate, packageInfo, refreshLatestInBackground, type UpdateInfo } from './update.ts';
import { BLACK, type Color, WHITE } from '../rules/chess/types.ts';
import { evaluate } from '../rules/chess/eval.ts';
import type { ChessResult } from '../rules/chess/chess.ts';
import type { RGB, RGBA } from '../engine/index.ts';
import { Box, Button, NoticeToast, Text, wrapText, insetSceneViewport, pointerNdcInSceneViewport, Renderer, Screen, type LayoutBox, type Node } from '../tui/index.ts';
import { ARCADE_THEME, MENU_BUTTON_LABEL, UI_CHROME_PILL } from './theme.ts';
import { escapeBackRequiresConfirmation, installKeymap } from './shell/keybindings.ts';
import { TUTORIAL_PULSE, TutorialController, tutorialRailWidth, type TutorialChapter } from './tutorial/tutorial.ts';
import { eventToChord } from '../tui/index.ts';
import { buildGatewaySignInPrompt, buildTeamSwitch, markSwitchSucceeded, mountTeamSwitch, setTeamSwitchHandlers, setTeamSwitchTeams, type TeamSwitchView } from './shell/team-switch.ts';
import * as term from '../platform/terminal.ts';
import { availableTeams, ensureGatewayKey, GATEWAY_SPEND_URL, isLoggedIn, loadEnv, signInWithAnotherAccount, signOut as signOutVercel, type EnsureResult, type Team, useTeam } from '../auth/index.ts';
import { AiMatch, type Seat } from './match/driver.ts';
import { disambiguateLabels } from '../harness/labels.ts';
import { flushTelemetry, initTelemetry, isTelemetryEnabled, isTelemetryEnvironmentOptedOut, isTelemetryPreferenceEnabled, setTelemetryEnabled, telemetryStatus, toggleTelemetryPreference, trackSessionStart, type RecordEndReason } from '../telemetry/index.ts';
import { supersampleForMode, supersampleForViewport } from './render-quality.ts';
import { openBrowser } from '../platform/open-browser.ts';
import type { ModelFailureNotice } from '../harness/model-failure-notice.ts';
import { checkModelHealth } from '../harness/model-health.ts';
import { AccountOperations } from './account-operations.ts';

// Populate process.env from .env.local before anything reads AI_GATEWAY_API_KEY.
loadEnv();

const MAX_FPS = 60;
const MIN_FPS = 30;
// Animations advance by the renderer's real elapsed time (see tick), so they play
// at wall-clock speed even when a large terminal drops the loop below its target cadence. The step
// is clamped so a stall or an idle→interaction gap can't teleport the animation.
const MAX_STEP = 0.1;
const SCENE_CELL_PIXEL_ASPECT = 2;

const MODE_ORDER: RenderMode[] = ['ascii', 'pixels', 'hybrid'];
const COLOR_ORDER: TerminalColorMode[] = ['truecolor', '256-color'];
// Reserve the widest setting value so the popup keeps a stable width as either
// display or color cycles in place (see buildGameMenu `valueColW`).
const MENU_VALUE_W = Math.max(
  ...MODE_ORDER.map((m) => m.length),
  ...COLOR_ORDER.map((m) => m.length),
  'autoreply'.length,
);

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
let target = new RenderTarget(
  cols * supersampleForMode('ascii'),
  rows * SCENE_CELL_PIXEL_ASPECT * supersampleForMode('ascii'),
);
let display: RenderTarget | undefined;
let pixelDisplayPrepared = false;
let pixelDisplayBloom = false;
const prism = new PrismScene();
const coverflow = new CoverFlowScene();
const coverFlowWheelInput = new CoverFlowWheelInput();
const splash = new SplashScene();
const prismToMenu = new TimedInkTransition({
  duration: 1.35,
  cut: { from: { x: 0.62, y: 0.43 }, to: { x: 0.5, y: 0.5 }, direction: { x: -0.82, y: 0.57 } },
});
const chessGame = new ChessGameScene();
chessGame.onEvent = (event) => tutorial.signal(`chess.${event}`);
const logosScene = new LogosScene();
const audioScene = new AudioScene();
let trailerScene: TrailerScene | null = null;
let trailerStartedAt = 0;
function currentTrailerScene(): TrailerScene { return trailerScene ??= new TrailerScene(); }
const cardsScene = new CardsScene();
const pokerScene = new PokerGameScene();
// Game events (new hand, flop/turn/river, who won) go into the table-talk thread as grey
// lines. Betting actions are NOT here — those live on the bottom-left seat strips.
pokerScene.setEventSink((text) => pushPokerChat({ text, model: '', event: true }));
// The 2D UI overlay (button bar). Lays out + paints over the scene each frame.
const ui = new Screen(cols, rows, ARCADE_THEME);
const islandersGlyphCache = new ShapeGlyphSurfaceCache();
const sceneGlyphCache = new ShapeGlyphSurfaceCache();
// Render-on-demand loop. Animating screens hold a live lease; static screens
// (chess turntable) render only when an interaction requests it.
const r = new Renderer({ maxFps: MAX_FPS, minFps: MIN_FPS });

// The Islanders test-bed facade: owns its scene, menu/modal state, HUD wiring, UI roots, pointer,
// and render/dirty. main.ts only wires it into the shared mode/render/mouse plumbing below.
// (Shell callbacks are lazy so they can reference handlers declared later in this file.)
const islanders = new IslandersController({
  ui,
  requestRender: () => r.requestRender(),
  requestFrame: () => {
    forceFrame = true;
    r.requestRender();
  },
  shell: {
    renderMode: () => renderMode,
    colorMode: () => colorMode,
    onHome: () => enterMenu(),
    onCycleDisplay: () => cycleMode(),
    onCycleColor: () => cycleColor(),
    onControls: () => openShortcuts(),
    onQuit: () => quit(),
    menuValueColW: MENU_VALUE_W,
  },
});

// The Islanders GAME (distinct from the islanders-test bed above): the played board plus the driver
// that runs the seats through the rules engine. The scene wraps the same TileScene the test
// bed uses, so both screens share one renderer.
const islandersGameScene = new IslandersGameScene();
islandersGameScene.setActionPreviewDuration(260);
islandersGameScene.setActionAnimationSynchronization(true);
const islandersDriver = new IslandersDriver({
  scene: islandersGameScene,
  syncLive: () => {
    forceFrame = true;
    r.requestRender();
  },
  onFailureNotice: showFailureNotice,
  onBlocked: () => blockForFailure(() => islandersDriver.resumeAfterFailure()),
});
islandersGameScene.setOnChange(() => {
  forceFrame = true;
  r.requestRender();
});
let islandersGameTimer: ReturnType<typeof setInterval> | null = null;
// ~11 fps for the island's ambient motion (water, blades, livestock) — the same cadence the
// test bed runs at, and far cheaper than repainting the board at the full frame rate.
const ISLANDERS_ANIMATION_FRAME_MS = 90;
let islandersGameMenuOpen = false;
// The Islanders reads modal (the `reads` pill → each model's private plan + notes), the same
// modal poker uses; `islandersNotesIdx` picks the observer, `islandersNotesFocused` is the
// one-shot focus of its scroll body.
let islandersNotesOpen = false;
let islandersNotesIdx = 0;
let islandersNotesFocused = false;

// The interactive tutorial: a guide rail docked on the right over the real game screens.
// The controller owns progress; main stages each chapter's screen (showTutorialChapter),
// narrows the scene viewport + HUD region by the rail, and emits the signals its steps
// wait for from the places the real features fire. Any route home ends it.
const tutorial = new TutorialController({
  show: (chapter, previous) => showTutorialChapter(chapter, previous),
  // Match steps need the Gateway key the normal match setup needs; the tutorial never
  // gates the screen itself — a real match, and its real health-check popups, run as usual.
  stepAvailable: (step) => step.requires !== 'gateway' || Boolean(process.env.AI_GATEWAY_API_KEY),
  exit: () => enterMenu(),
  requestRender: () => {
    forceFrame = true;
    r.requestRender();
  },
});
// Width the rail takes from the right edge while the tutorial runs (0 otherwise).
function tutorialRailW(): number {
  return tutorial.active() ? tutorialRailWidth(cols, tutorial.chapter().screen) : 0;
}
// The region game HUDs and popups lay out into: the whole screen, less the tutorial rail.
function hudRegion(): LayoutBox {
  return { x: 0, y: 0, w: cols - tutorialRailW(), h: rows };
}
// Islanders' hand/log rail hides itself when the board area is too narrow for it.
function islandersRailShown(): boolean {
  return islandersRailVisible(hudRegion().w, rows);
}
// Poll-based tutorial detectors (state the games expose without events): which Islanders
// action records the tutorial has already seen, and whether the stocked opening hand landed.
let tutorialIslandersSeen = 0;
let tutorialIslandersStocked = false;

// Bar geometry: a band of pills composited over the scene, lifted off the very
// bottom edge by a margin so it doesn't hug it. BAR_HEIGHT must match the pill
// height (1 text row + the pill's vertical padding, top and bottom). Opaque
// pills overwrite the scene; the gaps and the margin row show it through.
const BAR_HEIGHT = 1;
const BAR_BOTTOM_MARGIN = 1;
function barRegion(): LayoutBox {
  return { x: 0, y: rows - BAR_HEIGHT - BAR_BOTTOM_MARGIN, w: cols, h: BAR_HEIGHT };
}

// The playable chess board when in the chess-game view (drives orbit/pan/zoom), or null.
function orbitScene(): ChessGameScene | null {
  if (mode === 'chess-game') return chessGame;
  return null;
}

// The camera-controllable scene for the active mode: the chess board, the logos
// wisp orbit, or the chess board behind the UI playground. Drives the shared
// drag/pan/zoom mouse handler and the reset/pan key commands. (The 'ui' backdrop
// is camera-controllable too, so dragging on the scene behind the panel rotates
// it.) `orbitScene()` stays null for 'ui' so the tick uses the dedicated 'ui'
// branch, which always recomposites for live component edits.
function activeOrbit(): { resetView(): void; pan(dx: number, dy: number): void; orbit(dx: number, dy: number): void; zoomBy(factor: number): void } | null {
  if (mode === 'logos') return logosScene;
  if (mode === 'audio') return audioScene;
  if (mode === 'cards') return cardsScene;
  if (mode === 'islanders-tiles') return islanders.scene;
  if (mode === 'islanders') return islandersGameScene.scene;
  if (mode === 'poker') return pokerScene;
  if (mode === 'ui') return chessGame;
  return orbitScene();
}

let mode: Mode = 'prism';
let renderMode: RenderMode = 'ascii';
// Update notifier: resolved once at startup (synchronous — reads a cache the previous
// run refreshed). Non-null iff a newer version is published. Surfaced three ways: a
// plain line before the alt-screen, a modal over the boot prism, and a line on exit.
const update = checkForUpdate();
let updateModalOpen = false; // the startup popup (opened at boot when `update` is set)
let updateModalFocused = false; // open→closed edge, so the popup focuses its default button once
let updateCopied = false; // the "copy command" button flipped to its "copied ✓" confirmation

// The plain-text startup notice (printed as the last boot line). The modal over the prism
// is the second, more prominent surface.
function updateNotice(u: UpdateInfo): string {
  return (
    `\x1b[38;2;120;200;150m↑ update available: v${u.current} → v${u.latest}\x1b[0m\n` +
    `  run \x1b[38;2;150;220;180m${u.command}\x1b[0m to update.`
  );
}
// Start from the universally safe palette. Startup detection upgrades this to
// truecolor before the alternate screen or first rendered frame is shown.
let colorMode: TerminalColorMode = '256-color';

function writeFrame(output: string): void {
  r.write(applyTerminalColorMode(output, colorMode));
}
// Pointer pan used to pass raw cell deltas while one arrow press pans 16
// cell-equivalents. A 4x multiplier keeps right/modifier-drag responsive and
// visually attached to the mouse without changing orbit or keyboard speed.
const POINTER_PAN_SCALE = 4;
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
// The carousel opens on Chess. The very first launch of an install opens on the Tutorial cover
// (the slot just left of Chess) instead, and its title carries a "new here?" tail for the whole
// session. The landing happens once (the first time the menu opens); returning from a game
// lands on Chess as usual.
const firstLaunch = isFirstRun();
let firstMenuPending = firstLaunch;
function initialMenuSel(): number {
  return firstMenuPending && TUTORIAL_MENU_INDEX >= 0 ? TUTORIAL_MENU_INDEX : HOME_MENU_INDEX;
}
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
// The Cover Flow hub has one menu button. Its popup owns display, shortcuts,
// account, and quit; Account replaces it with the existing Vercel account modal.
let homeMenuOpen = false;
// `teamModalOpen` gates account-modal input; `teamModalFocused` is the focus-once
// edge for its dropdown; `teamView` drives the modal's contents (loading -> loaded
// -> switching, or the signed-out / error states).
let teamModalOpen = false;
let teamModalFocused = false;
let teamView: TeamSwitchView = { kind: 'loading' };
let currentAccountUsername: string | undefined;
const teamOperations = new AccountOperations();
// The team catalog as last fetched, kept for its request-wide billing verdict and its
// count of plan-restricted models; the setup pickers hold their own copies of the
// creators. `gatewayNoticeDismissed` is the kind the player put away with ×, for this
// launch only: a different kind (signing in, then finding no card) still shows.
let teamModelCatalog: ArcadeModelCatalog | null = null;
let gatewayNoticeDismissed: GatewayNoticeKind | null = null;

// AI-vs-AI match. The two sides are chosen in the setup modal (creator → model).
// The match turn-loop lifecycle lives in AiMatch (ai-match.ts); main owns the
// surrounding UI state. `commentary` is a transient system/notice toast, shown until
// `t` passes `until` (model dialogue now flows to the chat threads, not the toast).
// `matchSetupOpen` shows the model picker; `setupFocused` is its focus-once edge.
let commentary: Commentary | null = null;
interface ShellFailureNotice extends ModelFailureNotice { model: string; key: string }
let failureNotice: ShellFailureNotice | null = null;
let failureResume: (() => void) | null = null;

type SetupGame = 'chess' | 'poker' | 'islanders';
let modelHealthCheck: { game: SetupGame; controller: AbortController; id: number } | null = null;
let modelHealthFailure: { game: SetupGame; models: string[] } | null = null;
let nextModelHealthCheckId = 1;
let modelHealthAnimation: ReturnType<typeof setInterval> | null = null;

interface ModelHealthStatus { lines: string[]; failed: boolean }
function modelHealthStatus(game: SetupGame): ModelHealthStatus | undefined {
  const width = Math.max(24, Math.min(72, cols - 4));
  if (modelHealthCheck?.game === game) {
    const dots = '.'.repeat(1 + Math.floor(t * 2.5) % 3);
    return { lines: [`checking model health ${dots}`], failed: false };
  }
  if (modelHealthFailure?.game === game) {
    const names = modelHealthFailure.models.map(shortModel).join(', ');
    return { lines: wrapText(`${names} failed health check.`, width), failed: true };
  }
  return undefined;
}

function cancelModelHealthCheck(game?: SetupGame): void {
  if (modelHealthCheck && (!game || modelHealthCheck.game === game)) {
    modelHealthCheck.controller.abort();
    modelHealthCheck = null;
  }
  if (!game || modelHealthFailure?.game === game) modelHealthFailure = null;
  if (modelHealthAnimation) clearInterval(modelHealthAnimation);
  modelHealthAnimation = null;
  forceFrame = true;
  r.requestRender();
}

async function preflightModels(game: SetupGame, models: readonly string[]): Promise<boolean> {
  if (modelHealthCheck) return false;
  modelHealthFailure = null;
  const controller = new AbortController();
  const id = nextModelHealthCheckId++;
  modelHealthCheck = { game, controller, id };
  modelHealthAnimation = setInterval(() => r.requestRender(), 250);
  forceFrame = true;
  r.requestRender();
  try {
    const failures = await checkModelHealth(models, { signal: controller.signal });
    if (modelHealthCheck?.id !== id) return false;
    modelHealthCheck = null;
    if (modelHealthAnimation) clearInterval(modelHealthAnimation);
    modelHealthAnimation = null;
    if (failures.length) {
      modelHealthFailure = { game, models: failures.map((failure) => failure.model) };
      // Keep the modal bounded to one concrete failure. The persistent setup row
      // below names every failed model, but the first failed model in selector
      // order owns the error-specific explanation and resolver action.
      const failure = failures[0];
      showFailureNotice(failure.notice, failure.model, true);
      return false;
    }
    modelHealthFailure = null;
    return true;
  } catch {
    return false;
  } finally {
    if (modelHealthCheck?.id === id) modelHealthCheck = null;
    if (!modelHealthCheck && modelHealthAnimation) clearInterval(modelHealthAnimation);
    if (!modelHealthCheck) modelHealthAnimation = null;
    forceFrame = true;
    r.requestRender();
  }
}

function showFailureNotice(notice: ModelFailureNotice, model: string, forceModal = false): void {
  if (!notice.persistent && !forceModal) {
    commentary = { text: `${notice.title}. ${notice.body}`, model: '', until: t + 6 };
    forceFrame = true;
    r.requestRender();
    return;
  }
  const key = `${notice.code}:${model}`;
  if (failureNotice?.key === key) return;
  failureNotice = { ...notice, model, key };
  refreshFailureNoticeOverlay();
  forceFrame = true;
  r.requestRender();
}

function dismissFailureNotice(): void {
  failureNotice = null;
  refreshFailureNoticeOverlay();
  if (failureResume) ui.setFocus('gateway-failure-retry');
  forceFrame = true;
  r.requestRender();
}

function retryFailedTurn(): void {
  const resume = failureResume;
  failureResume = null;
  refreshFailureNoticeOverlay();
  forceFrame = true;
  r.requestRender();
  resume?.();
}

function clearFailureState(): void {
  failureNotice = null;
  failureResume = null;
  refreshFailureNoticeOverlay();
}

function blockForFailure(resume: () => void): void {
  failureResume = resume;
  refreshFailureNoticeOverlay();
  ui.setFocus(failureNotice?.action ? 'gateway-failure-action' : 'gateway-failure-close');
  forceFrame = true;
  r.requestRender();
}

function pausedFailureStatus(): Node {
  return Box({ position: 'absolute', left: 0, bottom: 0, width: cols, justifyContent: 'center' }, [
    Box({ flexDirection: 'row', alignItems: 'center', gap: 2 }, [
      Text({ text: 'game paused, model request failed.', style: { color: 'danger', bold: true } }),
      Button({
        id: 'gateway-failure-retry',
        label: 'retry request  ↻',
        onClick: retryFailedTurn,
        style: {
          padding: 0,
          color: 'textPrimary',
          hover: { color: 'textStrong', bold: true },
          focus: { color: 'textStrong', bold: true },
          pressed: { color: 'textMuted' },
        },
      }),
    ]),
  ]);
}

// The Screen has one global overlay slot; the auth gate, Gateway-failure modal, and
// tutorial rail share it. Failure paints last; the sign-in gate sits above Tutorial.
let failureOverlay: Node | null = null;
let gatewaySignInOverlay: Node | null = null;
let gatewaySignInResume: (() => void) | null = null;
let gatewaySignInBusy = false;
let gatewayAccountRecovery = false;
function applyGlobalOverlay(): void {
  const layers = [tutorial.active() ? tutorial.build(cols, rows) : null, gatewaySignInOverlay, failureOverlay].filter((l): l is Node => l !== null);
  if (layers.length === 0) ui.setGlobalOverlay(null);
  else if (layers.length === 1) ui.setGlobalOverlay(layers[0], gatewaySignInOverlay);
  else {
    ui.setGlobalOverlay(
      Box({ width: cols, height: rows, position: 'relative' }, layers.map((l) => ({ ...l, style: { ...l.style, position: 'absolute', top: 0, left: 0, width: cols, height: rows } }))),
      gatewaySignInOverlay,
    );
  }
}

function refreshGatewaySignInOverlay(): void {
  if (!gatewaySignInResume) {
    gatewayAccountRecovery = false;
    gatewaySignInOverlay = null;
  } else if (gatewayAccountRecovery) {
    mountTeamSwitch(ui);
    gatewaySignInOverlay = buildTeamSwitch(teamView, teamSwitchActions(dismissGatewaySignInPrompt), cols, rows);
  } else {
    gatewaySignInOverlay = buildGatewaySignInPrompt(signInFromGatewayPrompt, dismissGatewaySignInPrompt, cols, rows);
  }
  applyGlobalOverlay();
  if (gatewayAccountRecovery && teamView.kind === 'loaded' && !teamModalFocused) {
    ui.setFocus('team-switch-dropdown');
    teamModalFocused = true;
  }
}

function requireGateway(resume: () => void): boolean {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  gatewaySignInResume = resume;
  gatewayAccountRecovery = false;
  refreshGatewaySignInOverlay();
  ui.setFocus('gateway-signin-action');
  forceFrame = true;
  r.requestRender();
  return false;
}

function dismissGatewaySignInPrompt(): void {
  teamOperations.invalidate();
  gatewaySignInResume = null;
  gatewayAccountRecovery = false;
  teamModalFocused = false;
  refreshGatewaySignInOverlay();
  forceFrame = true;
  r.requestRender();
}

function signInFromGatewayPrompt(): void {
  const resume = gatewaySignInResume;
  if (!resume || gatewaySignInBusy) return;
  gatewaySignInBusy = true;
  void withSuspendedTui(async () => {
    try {
      const auth = await ensureGatewayKey();
      if (!auth) {
        gatewayAccountRecovery = true;
        teamModalFocused = false;
        teamView = isLoggedIn() ? { kind: 'loading' } : { kind: 'signedOut' };
        refreshGatewaySignInOverlay();
        if (isLoggedIn()) await loadTeams();
        return;
      }
      await refreshTeamModelCatalog(auth);
      gatewaySignInResume = null;
      refreshGatewaySignInOverlay();
      resume();
    } finally {
      gatewaySignInBusy = false;
      if (gatewaySignInResume) refreshGatewaySignInOverlay();
    }
  });
}

function refreshFailureNoticeOverlay(): void {
  const notice = failureNotice;
  if (!notice && !failureResume) {
    failureOverlay = null;
    applyGlobalOverlay();
    return;
  }
  if (!notice) {
    failureOverlay = Box({ width: cols, height: rows, position: 'relative' }, [pausedFailureStatus()]);
    applyGlobalOverlay();
    return;
  }
  const modal = NoticeToast({
    id: 'gateway-failure',
    severity: notice.severity,
    title: notice.title,
    body: notice.body,
    width: Math.min(48, Math.max(30, cols - 4)),
    actionColor: 'textStrong',
    actionBorderColor: 'textStrong',
    onDismiss: dismissFailureNotice,
    ...(notice.action ? { action: { label: notice.action.label, onClick: () => {
      copyToClipboard(notice.action!.url);
      openBrowser(notice.action!.url);
      failureNotice = { ...notice, body: `${notice.body} The URL was also copied to your clipboard.` };
      refreshFailureNoticeOverlay();
    } } } : {}),
  });
  // During a live persistent failure, retain the paused state beneath the modal.
  // Preflight failures have no game to pause, so they show only the modal.
  failureOverlay = failureResume
    ? Box({ width: cols, height: rows, position: 'relative' }, [
        pausedFailureStatus(),
        { ...modal, style: { ...modal.style, position: 'absolute', top: 0, left: 0, width: cols, height: rows } },
      ])
    : modal;
  applyGlobalOverlay();
}
let matchSetupOpen = false;
let setupFocused = false;
// The seat per side while a match is live (null when idle) — human, or an AI model.
// The source the wisp-swap popup seeds from (AI sides only), and what a swap
// updates. Set at start, updated on swap, cleared on stop.
let matchSeats: { white: Seat; black: Seat } | null = null;
// Resolve a seat to the match banner's label + color: a creator's brand hue for an AI
// (its short model name), or the piece tint for a human ("you"), so you can read the
// matchup — and which side you're on — at a glance.
function chessSideLabel(seat: Seat, color: Color, text: string): MatchSide {
  if (seat.kind === 'human') return { text, color: color === WHITE ? [232, 228, 216] : [184, 126, 74] };
  const t = creatorTint(seat.model.split('/')[0] ?? seat.model);
  return { text, color: [t.x | 0, t.y | 0, t.z | 0] };
}
function chessMatchupLabels(seats: { white: Seat; black: Seat }): { white: MatchSide; black: MatchSide } {
  const pair = [seats.white, seats.black];
  const labels = disambiguateLabels(
    pair.map((seat, index) =>
      seat.kind === 'human'
        ? { key: `human:${index}`, label: 'you' }
        : { key: seat.model, label: shortModel(seat.model) },
    ),
  );
  return {
    white: chessSideLabel(seats.white, WHITE, labels[0]),
    black: chessSideLabel(seats.black, BLACK, labels[1]),
  };
}
// The shared in-match model-swap popup (click a chess or poker wisp): the seat
// being edited and whether its match was already paused when it opened.
type WispSwap =
  | { game: 'chess'; color: Color; wasPaused: boolean }
  | { game: 'poker'; seat: number; wasPaused: boolean };
let wispSwap: WispSwap | null = null;
let wispSwapFocused = false;
// The poker new-match settings panel (an in-scene top-left stack, not a modal — the
// table stays interactive behind it), gated on a Gateway key like the chess match
// setup. `pokerSetupFocused` is its focus-once edge.
let pokerSetupOpen = false;
let pokerSetupFocused = false;
// The poker in-game menu popup (☰ pill → home / new game / display / quit).
let pokerMenuOpen = false;
// The poker opponent-notes modal (notes pill → each AI seat's private reads). `pokerNotesIdx`
// selects which AI seat's notebook is shown; ‹ › page through them.
let pokerNotesOpen = false;
let pokerNotesIdx = 0;
let pokerNotesFocused = false; // one-shot: focus the scroll body when the modal opens
// When on, AI moves bypass the rules: the model's move is parsed loosely and
// applied as-is. A thunk hands this live value to each ModelPlayer.
let illegalAllowed = false;
// How many chess half-moves have already been mirrored into the chat thread as grey
// (or red "(illegal)") move lines. Bumped as new moves settle; reset with the thread.
let chessChatPly = 0;
// Whether the move-history panel is collapsed to its "Moves" header button
// (toggle with the 'h' key or by clicking the header / ✕). History persists.
let historyMinimized = false;
// Whether the right-edge model-DM chat panel is shown (toggle with the 't' key or
// the top-right chat icon). Hidden by default; the thread persists while hidden, so
// opening it later shows the full backlog.
let chatVisible = false;
// Whether the right-edge eval bar is shown (toggle with the 'e' key or the ☰ menu).
// Default hidden; the score is recomputed from the live board each frame.
let evalBarVisible = false;
// The chess in-game menu popup (☰ pill → home / new game / display / eval bar / illegal /
// quit), mirroring the poker menu.
let chessMenuOpen = false;
// Whether the poker chat panel is expanded. The rail (chat + hand) only appears once a
// match starts, and the chat starts COLLAPSED (just the "chat" pill) — clicking it (or its
// ✕) toggles. Reset to collapsed on each new match; persists while a match runs.
let pokerChatOpen = false;

// Chat rails participate in the 3D layout instead of merely painting over it.
// The HUDs use the same CHAT_WIDTH, so the renderer, camera projection, and UI
// agree on the exact left-side viewport that remains visible.
function activeSceneViewport(): LayoutBox {
  const reservedRight =
    mode === 'chess-game' && chatVisible && matchSeats !== null
      ? CHAT_WIDTH
      : mode === 'poker' && pokerChatOpen && pokerScene.isActive()
        ? CHAT_WIDTH
        : mode === 'islanders-tiles' && islanders.scene.currentMode() === 'boardCards' && islandersRailShown()
          ? ISLANDERS_RAIL_W
          : // The game reserves the rail only once a session exists — the setup panel owns the
            // whole board area before that.
            mode === 'islanders' && islandersDriver.state() !== null && islandersRailShown()
            ? ISLANDERS_RAIL_W
            : 0;
  return insetSceneViewport(cols, rows, { right: reservedRight + tutorialRailW() });
}

// The engine target is pixel-sized while the viewport is terminal-cell-sized.
// Reallocate only when a rail or terminal resize changes the available geometry.
function ensureSceneTarget(): void {
  const viewport = activeSceneViewport();
  const supersample = supersampleForViewport(renderMode, cols, rows);
  const width = viewport.w * supersample;
  const height = viewport.h * SCENE_CELL_PIXEL_ASPECT * supersample;
  if (target.width === width && target.height === height) return;
  target = new RenderTarget(width, height);
  display = undefined;
  forceFrame = true;
}

// The "return to home screen?" confirm popup, shown when Escape is pressed inside a game
// (chess-game / poker) instead of leaving immediately. "Return home" is default-focused;
// Cancel (or Escape again) stays in the game.
let confirmHomeOpen = false;
let confirmHomeFocused = false;
// The shortcuts overlay (the '?' key, or the ☰ menu's "shortcuts" item): a generated list
// of the keys live on the current screen. Content comes from keymap.activeBindings().
let shortcutsOpen = false;
// The quit-confirm popup (the 'q' key): "quit" default-focused / "cancel". ctrl+c still
// hard-quits without a prompt (the instant hatch).
let confirmQuitOpen = false;
let confirmQuitFocused = false;
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
  const title = r.winner === null ? 'draw' : r.winner === WHITE ? 'white wins' : 'black wins';
  const tint: RGB = r.winner === BLACK ? CHESS_PALETTE.darkPiece : r.winner === WHITE ? CHESS_PALETTE.lightPiece : ARCADE_THEME.textStrong;
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
    prismToMenu.active() ||
    mode === 'menu' ||
    mode === 'trailer' ||
    mode === 'logos' ||
    mode === 'audio' ||
    (mode === 'chess-game' && chessGame.isMatchActive()) ||
    (mode === 'poker' && pokerScene.isActive()) ||
    tutorial.active(); // the rail's attention pulses animate
  if (want === liveHeld) return;
  if (want) r.requestLive();
  else r.dropLive();
  liveHeld = want;
}
// Dirty-flag rendering for the static (turntable) chess scenes: skip re-render +
// re-write when nothing changed. `forceFrame` requests one unconditional repaint
// after a transition that clears the screen or changes the present output (mode
// switch, display toggle, resize). A pure button-hover change is
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

let finalizing = false;
// One finalize path for every exit route (quit button, ctrl+c, SIGTERM/SIGHUP, uncaught
// crash). stop() writes any active canonical record to the durable outbox synchronously,
// so the record survives even if the async telemetry flush below can't finish. The cap
// keeps exit from ever visibly hanging on the network.
function finalizeAndExit(reason: Exclude<RecordEndReason, 'natural'>, code: number, err?: unknown): void {
  if (finalizing) return;
  finalizing = true;
  try { aiMatch.stop(reason); } catch {}
  try { pokerMatch.stop(reason); } catch {}
  try { islandersDriver.stop(reason); } catch {}
  try { r.destroy(); } catch {}
  try { term.leave(); } catch {}
  if (err !== undefined) console.error(err); // after leaving the alt-screen so it's readable
  void flushTelemetry(400).finally(() => process.exit(code));
}

function quit(): void {
  finalizeAndExit('user_stopped', 0);
}

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

async function refreshTeamModelCatalog(auth: EnsureResult | null, isCurrent: () => boolean = () => true): Promise<boolean> {
  const catalog = auth
    ? await fetchTeamModelCatalog(auth.key)
    : fallbackArcadeModelCatalog('not signed in');
  if (!isCurrent()) return false;
  teamModelCatalog = catalog;
  setMatchSetupModelCatalog(catalog.textCreators, catalog.realtimeCreators);
  setPokerSetupModelCatalog(catalog.textCreators);
  setIslandersSetupModelCatalog(catalog.textCreators);
  return true;
}

// Home menu + Vercel account modal.
function openHomeMenu(): void {
  if (mode !== 'menu' || homeMenuOpen || teamModalOpen || launching) return;
  homeMenuOpen = true;
  forceFrame = true;
  r.requestRender();
}

function closeHomeMenu(): void {
  if (!homeMenuOpen) return;
  homeMenuOpen = false;
  forceFrame = true;
  r.requestRender();
}

// Account opens the existing team picker while the home menu remains underneath.
// Closing Account therefore returns to the menu. Loading and switching stay live.
function openTeamSwitch(): void {
  if (mode !== 'menu' || teamModalOpen) return;
  teamOperations.invalidate();
  teamModalOpen = true;
  teamModalFocused = false;
  teamView = isLoggedIn() ? { kind: 'loading' } : { kind: 'signedOut' };
  mountTeamSwitch(ui);
  forceFrame = true;
  r.requestRender();
  if (isLoggedIn()) void loadTeams();
}

function accountSurfaceOpen(): boolean {
  return teamModalOpen || gatewayAccountRecovery;
}

function refreshAccountSurface(): void {
  if (gatewayAccountRecovery) refreshGatewaySignInOverlay();
  else r.requestRender();
}

function finishGatewayAccountRecovery(): boolean {
  const resume = gatewaySignInResume;
  if (!gatewayAccountRecovery || !resume) return false;
  teamOperations.invalidate();
  gatewaySignInResume = null;
  gatewayAccountRecovery = false;
  teamModalFocused = false;
  refreshGatewaySignInOverlay();
  resume();
  return true;
}

function teamSwitchActions(onClose: () => void): Parameters<typeof buildTeamSwitch>[1] {
  return {
    onClose,
    onSignIn: teamSwitchSignIn,
    onChangeAccount: teamSwitchChangeAccount,
    onRetry: () => {
      teamView = { kind: 'loading' };
      teamModalFocused = false;
      refreshAccountSurface();
      void loadTeams();
    },
    onOpenVercel: teamSwitchOpenVercel,
    onViewSpend: teamSwitchViewSpend,
    onBack: teamSwitchBack,
    onLogout: teamSwitchSignOut,
    modelAccess: teamModelAccess(),
  };
}

function teamModelAccess(): { text: string; onClick?: () => void } | null {
  const line = catalogAccessLine(teamModelCatalog);
  if (!line) return null;
  const url = line.url;
  return url ? { text: line.text, onClick: () => openBrowser(url) } : { text: line.text };
}

async function loadTeams(): Promise<void> {
  const operation = teamOperations.begin();
  try {
    const res = await availableTeams();
    if (!operation.isCurrent() || !accountSurfaceOpen()) return;
    if (!res) teamView = { kind: 'signedOut' };
    else if (res.teams.length === 0) {
      currentAccountUsername = res.username;
      teamView = { kind: 'noTeams', username: res.username };
    }
    else {
      currentAccountUsername = res.username;
      setTeamSwitchTeams(res.teams, res.current);
      teamView = { kind: 'loaded', username: res.username };
    }
  } catch (err) {
    if (!operation.isCurrent() || !accountSurfaceOpen()) return;
    teamView = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      canRetry: true,
      username: currentAccountUsername,
    };
  }
  refreshAccountSurface();
}

// Commit a picked team: show a "switching…" state and re-mint the key for it
// silently while the TUI stays live. On success the dropdown commits that account
// as its current value and the modal stays open. The re-minted key lands in
// process.env, so subsequent model/voice calls bill the new team.
function pickTeamChoice(team: Team): void {
  if (!accountSurfaceOpen()) return;
  const operation = teamOperations.begin();
  const isCurrent = (): boolean => operation.isCurrent() && accountSurfaceOpen();
  teamView = { kind: 'switching', team: team.name, username: currentAccountUsername };
  refreshAccountSurface();
  void (async () => {
    try {
      const auth = await useTeam(team, isCurrent);
      if (!auth || !await refreshTeamModelCatalog(auth, isCurrent)) return;
      if (finishGatewayAccountRecovery()) return;
      markSwitchSucceeded(team);
      teamView = { kind: 'loaded', username: currentAccountUsername }; // current account is now shown in the closed field
    } catch (err) {
      if (!isCurrent()) return;
      // The accounts are still loaded, so offer "← back" to it (canReturn).
      teamView = { kind: 'error', message: err instanceof Error ? err.message : String(err), canReturn: true };
    }
    refreshAccountSurface();
  })();
}

// The switch-error "← back": return to the loaded account dropdown (still in memory).
function teamSwitchBack(): void {
  if (!accountSurfaceOpen()) return;
  teamView = { kind: 'loaded', username: currentAccountUsername };
  forceFrame = true;
  refreshAccountSurface();
}

function closeTeamSwitch(): void {
  if (!teamModalOpen) return;
  teamOperations.invalidate();
  teamModalOpen = false;
  teamModalFocused = false;
  forceFrame = true;
  r.requestRender();
}

// The signed-out modal's "Sign in" button: close the popup and fall back to the
// existing plain-text device-login + team-pick flow (it suspends the TUI).
function teamSwitchSignIn(): void {
  teamSwitchChangeAccount();
}

// Authorize a replacement user while preserving the current account and key until
// the replacement can fully initialize. Failure/cancellation returns to the same
// working account; success refreshes the team list and model availability.
function teamSwitchChangeAccount(): void {
  teamOperations.invalidate();
  teamView = { kind: 'loading' };
  teamModalFocused = false;
  refreshAccountSurface();
  void withSuspendedTui(async () => {
    const auth = await signInWithAnotherAccount();
    if (auth) {
      await refreshTeamModelCatalog(auth);
      if (finishGatewayAccountRecovery()) return;
    }
    await loadTeams();
  });
}

// Sign out in place. Human-only play remains available, and Account immediately
// exposes sign-in again instead of coupling authentication state to quitting.
function teamSwitchSignOut(): void {
  teamOperations.invalidate();
  signOutVercel();
  setTeamSwitchTeams([], null);
  currentAccountUsername = undefined;
  teamView = { kind: 'signedOut' };
  void refreshTeamModelCatalog(null);
  forceFrame = true;
  refreshAccountSurface();
}

function teamSwitchOpenVercel(): void {
  openBrowser('https://vercel.com/account');
}

function teamSwitchViewSpend(): void {
  openBrowser(GATEWAY_SPEND_URL);
}

setTeamSwitchHandlers({ onPick: pickTeamChoice });

// The hub's one menu button is pinned top-right over Cover Flow. The root is
// transparent so clicks off the pill fall through to the carousel.
function buildMenuOverlay(): Node {
  const menuButton = Button({ id: 'menu-button', label: MENU_BUTTON_LABEL, onClick: openHomeMenu, style: UI_CHROME_PILL });
  // Inset from the top-right corner by a row / a couple of columns so it breathes.
  const region = hudRegion();
  const notice = currentGatewayNotice();
  const pill = notice
    ? buildGatewayNoticePill(notice, {
        maxWidth: region.w - 2 - (MENU_BUTTON_LABEL.length + 2) - 2 - 2,
        onAction: () => {
          if (notice.url) {
            copyToClipboard(notice.url);
            openBrowser(notice.url);
          } else teamSwitchSignIn();
        },
        onDismiss: () => {
          gatewayNoticeDismissed = notice.kind;
          forceFrame = true;
          r.requestRender();
        },
      })
    : null;
  return Box({ width: region.w, height: region.h }, [
    ...(pill ? [Box({ position: 'absolute', top: 1, left: 2 }, [pill])] : []),
    Box({ position: 'absolute', top: 1, right: 2 }, [menuButton]),
  ]);
}

function currentGatewayNotice() {
  const notice = gatewayNoticeFor(isLoggedIn(), teamModelCatalog);
  return notice && notice.kind !== gatewayNoticeDismissed ? notice : null;
}

// The setup panels repeat the notice as one muted sentence above Start, wrapped like the
// health-check lines, so the reason a match will not begin is in view before Start is.
function gatewayNoticeLines(): string[] | undefined {
  const notice = currentGatewayNotice();
  return notice ? wrapText(gatewayNoticeSentence(notice), Math.max(24, Math.min(72, cols - 4))) : undefined;
}

function cycleMode(): void {
  renderMode = MODE_ORDER[(MODE_ORDER.indexOf(renderMode) + 1) % MODE_ORDER.length];
  tutorial.signal('ui.display');
  fullRepaint();
}

function cycleColor(): void {
  colorMode = COLOR_ORDER[(COLOR_ORDER.indexOf(colorMode) + 1) % COLOR_ORDER.length];
  tutorial.signal('ui.color');
  fullRepaint();
}

function enterChessGame(): void {
  mode = 'chess-game';
  draggingCamera = false;
  evalBarVisible = false; // a fresh entry shows the default board; the bar insets the viewport, so a stale one reframes the scene
  mountChessHud(ui); // (re)register the move-history panel for its Slot
  chessChatComposer.mount(ui);
  fullRepaint();
}

// The human's table-talk field under each game's chat transcript. Present only while the
// human holds a seat in a live match (a spectator has nobody to speak as); the driver
// takes the line and prompts any @-addressed model, and the human's own line goes straight
// into the thread.
const chessChatComposer = new ChatComposer({ id: 'chess-chat-input' });
const pokerChatComposer = new ChatComposer({ id: 'poker-chat-input' });

function chessChatComposerNode(): Node | undefined {
  if (!chatVisible || !matchSeats || aiMatch.humanSeat() < 0) return undefined;
  chessChatComposer.configure({
    targets: aiMatch.chatTargets(),
    onSubmit: (text, targetSeats) => {
      if (!aiMatch.sendHumanChat(text, targetSeats)) return false;
      pushChatMessage({ text, model: 'you', label: 'you' });
      r.requestRender();
      return true;
    },
  });
  return chessChatComposer.build(CHAT_COMPOSER_W);
}

function pokerChatComposerNode(): Node | undefined {
  if (!pokerChatOpen || !pokerMatch.isRunning() || pokerMatch.humanSeat() < 0) return undefined;
  pokerChatComposer.configure({
    targets: pokerMatch.chatTargets(),
    onSubmit: (text, targetSeats) => {
      if (!pokerMatch.sendHumanChat(text, targetSeats)) return false;
      pushPokerChat({ text, model: 'you', label: 'you' });
      r.requestRender();
      return true;
    },
  });
  return pokerChatComposer.build(CHAT_COMPOSER_W);
}

// Collapse/expand the move-history panel (bound to 'h', and the panel's own
// header/✕ buttons call this too).
function toggleHistory(): void {
  historyMinimized = !historyMinimized;
  tutorial.signal('chess.history');
  forceFrame = true;
}

// Show/hide the model-DM chat panel (bound to 't', and the panel's own header/✕).
function toggleChat(): void {
  if (!matchSeats) return;
  chatVisible = !chatVisible;
  forceFrame = true;
  r.requestRender();
}

// Expand/collapse the poker table-talk panel (its ✕ and the collapsed reopen pill).
function togglePokerChat(): void {
  pokerChatOpen = !pokerChatOpen;
  tutorial.signal('poker.chat');
  forceFrame = true;
  r.requestRender();
}

// Copy the move history to the clipboard as PGN (the panel's copy button). The
// result token reflects the current outcome (or * for an unfinished game).
function copyMoves(): void {
  const r = chessGame.state().result();
  const token = !r ? '*' : r.winner === WHITE ? '1-0' : r.winner === BLACK ? '0-1' : '1/2-1/2';
  copyToClipboard(movesToPgn(chessGame.moves(), token));
  commentary = { text: 'copied PGN to clipboard', model: '', until: t + 2 };
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
  onCommentary: (text, model, label) => {
    pushChatMessage({ text, model, label });
    r.requestRender();
  },
  onFailureNotice: showFailureNotice,
  onBlocked: () => blockForFailure(() => aiMatch.resume()),
  allowIllegal: () => illegalAllowed,
});

// Fully stop the match and return chess to a clean free-play slate. Used by
// reset-game and on navigating away (the enter*/toPrism/enterMenu transitions) —
// NOT by pause. Navigating away already ends the match, so there's no live game to
// preserve: clearing the board, move history, and DM thread means returning to
// chess is a fresh start, not a stale, matchless transcript. (A match that ends
// while you STAY on the board is left intact — this only fires on leave/reset.)
function stopAiMatch(): void {
  cancelModelHealthCheck('chess');
  clearFailureState();
  aiMatch.stop();
  commentary = null;
  matchSeats = null;
  chatVisible = false;
  if (wispSwap?.game === 'chess') closeWispSwap(); // dismiss this match's open swap popup
  chessGame.resetGame();
  clearChat();
  chessChatPly = 0;
}

// Open the setup modal to pick the two models (needs a Gateway key). The four
// selects are (re)mounted for their Slots; pickers retain their last selection.
function openMatchSetup(): void {
  tutorial.signal('chess.setup'); // the tutorial's "open new match" counts even when signed out
  if (!requireGateway(openMatchSetup)) return;
  mountMatchSetup(ui);
  matchSetupOpen = true;
  setupFocused = false;
  chessGame.setPreview(chessPreviewSides()); // king wisps preview the chosen creators
  forceFrame = true;
  r.requestRender();
}

function closeMatchSetup(): void {
  cancelModelHealthCheck('chess');
  matchSetupOpen = false;
  setupFocused = false;
  chessGame.setPreview(null);
  forceFrame = true;
}

// Start button: only fires when both sides are ready (human, or a committed model),
// so the selection is guaranteed.
async function confirmMatchSetup(): Promise<void> {
  if (!requireGateway(() => { void confirmMatchSetup(); })) return;
  const sel = matchSetupSelection();
  if (!sel) return;
  const models = [sel.white, sel.black].flatMap((seat) => seat.kind === 'ai' ? [seat.model] : []);
  if (!await preflightModels('chess', models)) return;
  if (!matchSetupOpen) return;
  const options = matchSetupOptions();
  evalBarVisible = options.evalBar;
  illegalAllowed = options.illegalMoves;
  closeMatchSetup();
  matchSeats = { white: sel.white, black: sel.black };
  clearChat(); // fresh thread for the new game
  chessChatPly = 0;
  aiMatch.start(sel.white, sel.black);
  tutorial.signal('chess.matchStarted');
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
  if (seat.kind !== 'ai') return;
  const key = color === WHITE ? 'white' : 'black';
  const wasPaused = aiMatch.isPaused();
  if (!wasPaused) aiMatch.pause();
  wispSwap = { game: 'chess', color, wasPaused };
  wispSwapFocused = false;
  tutorial.signal('chess.swap');
  mountSwapSetup(ui);
  openSwapSetup(key, seat.model);
  forceFrame = true;
  r.requestRender();
}

// A practice bot's flame opens the same picker with no seeded model — replacing the bot with
// a real model, which needs the Gateway key like any match does.
function openPokerWispSwap(seat: number): void {
  const spec = pokerMatch.seatSpecs()[seat];
  if (spec?.kind !== 'ai' && spec?.kind !== 'bot') return;
  if (spec.kind === 'bot' && !requireGateway(() => openPokerWispSwap(seat))) return;
  const wasPaused = pokerMatch.isPaused();
  if (!wasPaused) pokerMatch.pause();
  wispSwap = { game: 'poker', seat, wasPaused };
  wispSwapFocused = false;
  mountSwapSetup(ui);
  if (spec.kind === 'ai') openSwapSetup('white', spec.model, spec.runtime);
  else openSwapSetup('white', null);
  forceFrame = true;
  r.requestRender();
}

// Close the popup, restoring only the match that was paused to open it.
function closeWispSwap(): void {
  const swapState = wispSwap;
  wispSwap = null;
  wispSwapFocused = false;
  if (swapState && !swapState.wasPaused) {
    if (swapState.game === 'chess' && aiMatch.isPaused()) aiMatch.resume();
    if (swapState.game === 'poker' && pokerMatch.isPaused()) pokerMatch.resume();
  }
  forceFrame = true;
  r.requestRender();
}

function cancelWispSwap(): void {
  closeWispSwap();
}

// Swap the clicked seat to the committed model, then restore its prior pause state.
function confirmWispSwap(): void {
  const swapState = wispSwap;
  const slug = swapSetupSelection();
  if (!swapState || !slug) return;

  if (swapState.game === 'poker') {
    pokerMatch.setSeatModel(swapState.seat, slug);
    closeWispSwap();
    return;
  }

  if (!matchSeats) return;
  aiMatch.setPlayer(swapState.color === WHITE ? 0 : 1, slug);
  chessGame.setSideCreator(swapState.color, slug.split('/')[0] ?? slug);
  if (swapState.color === WHITE) matchSeats.white = { kind: 'ai', model: slug };
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
  // A model's pre-move line is in-character TABLE TALK — append it to the poker
  // thread (like the chess DMs), not the bottom toast (reserved for system notices).
  onCommentary: (text, model, label) => {
    pushPokerChat({ text, model, label });
    r.requestRender();
  },
  onFailureNotice: showFailureNotice,
  onBlocked: () => blockForFailure(() => pokerMatch.resume()),
  onHandOver: () => {
    forceFrame = true;
    r.requestRender();
  },
  // Heads-up voice: spoken lines (bot + human) and game-event lines to the chat rail.
  onChat: (text, speaker, event, label) => {
    pushPokerChat({ text, model: event ? '' : speaker, label: event ? undefined : label, event });
    r.requestRender();
  },
  // A human action parsed from speech, awaiting confirm — shown as a callout right above
  // the bottom-right action buttons (see poker-hud). Cleared when it resolves.
  onVoiceStage: (label) => {
    setPokerVoiceStage(label);
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
    tutorial.signal('poker.fold');
    forceFrame = true;
    r.requestRender();
  },
  onCheckCall: () => {
    const st = pokerScene.state();
    const action = st.toCall(st.toActSeat()) > 0 ? ({ type: 'call' } as const) : ({ type: 'check' } as const);
    pokerScene.commitHumanAction(action);
    tutorial.signal('poker.checkCall');
    forceFrame = true;
    r.requestRender();
  },
  onBetRaise: (amount) => {
    pokerScene.commitHumanAction({ type: 'raise', to: amount });
    tutorial.signal('poker.raise');
    forceFrame = true;
    r.requestRender();
  },
  onAllin: () => {
    pokerScene.commitHumanAction({ type: 'allin' });
    tutorial.signal('poker.raise');
    forceFrame = true;
    r.requestRender();
  },
  onAmountChange: () => {
    forceFrame = true;
    r.requestRender();
  },
});

// The raise-amount ± steppers, bound to keys (hold to repeat via key autorepeat). No-op
// unless it's the hero's turn with a raiseable range; the HUD owns the amount + clamping.
function pokerBetStep(dir: number): void {
  if (mode !== 'poker' || !pokerScene.heroToAct()) return;
  nudgePokerBet(dir);
  forceFrame = true;
  r.requestRender();
}

// Stop the poker session (navigating away / new match). Safe when idle.
function stopPokerMatch(): void {
  cancelModelHealthCheck('poker');
  clearFailureState();
  pokerMatch.stop(); // scene.endSession() returns the felt to its idle framing
  if (wispSwap?.game === 'poker') closeWispSwap();
  commentary = null;
  clearPokerChat(); // don't leave a stale table-talk thread behind on leave/new-game
  pokerChatOpen = false;
}

// Open the new-match settings panel (needs a Gateway key, like the chess match setup).
// Non-modal: it stacks down the top-left while the table stays orbit/zoomable, and the
// idle scene previews the chosen seats live (chairs + creator wisps).
function openPokerSetup(): void {
  if (!requireGateway(openPokerSetup)) return;
  mountPokerSetup(ui);
  pokerSetupOpen = true;
  pokerSetupFocused = false;
  pokerScene.setPreview(pokerPreviewSeats(), pokerStartingStack());
  forceFrame = true;
  r.requestRender();
}

function closePokerSetup(): void {
  cancelModelHealthCheck('poker');
  pokerSetupOpen = false;
  pokerSetupFocused = false;
  pokerScene.setPreview(null); // back to the bare idle ring
  forceFrame = true;
  r.requestRender();
}

// The setup panel's Cancel button: dismiss the panel and leave the poker screen for the
// home hub (Escape just closes the panel, staying on the idle table).
function cancelPokerSetup(): void {
  closePokerSetup();
  enterMenu();
}

// Any committed settings change (players / mode / provider / model) reshapes the idle
// table live: the chair ring follows the player count, the wisps follow the providers.
setPokerSetupChanged(() => {
  cancelModelHealthCheck('poker');
  if (!pokerSetupOpen) return;
  pokerScene.setPreview(pokerPreviewSeats(), pokerStartingStack());
  forceFrame = true;
  r.requestRender();
});

// Islanders's setup panel has no scene preview to drive — the island looks the same whoever is
// about to sit at it — but the panel itself has to repaint, because a committed change can
// add or remove a seat row and re-tint the seat labels.
setIslandersSetupChanged(() => {
  cancelModelHealthCheck('islanders');
  if (mode !== 'islanders') return;
  forceFrame = true;
  r.requestRender();
});

// The chess mirror: any committed setup change (mode / creator / model) updates the
// king-wisp preview behind the panel — each side's wisp follows its chosen creator,
// a human side shows none.
setMatchSetupChanged(() => {
  cancelModelHealthCheck('chess');
  if (!matchSetupOpen) return;
  chessGame.setPreview(chessPreviewSides());
  forceFrame = true;
  r.requestRender();
});

// Start-match button: begin a session with the chosen seats (guaranteed present).
async function confirmPokerSetup(): Promise<void> {
  if (!requireGateway(() => { void confirmPokerSetup(); })) return;
  const seats = pokerSetupSelection();
  if (!seats) return;
  const models = seats.flatMap((seat) => seat.kind === 'ai' && seat.runtime === 'text' ? [seat.model] : []);
  if (!await preflightModels('poker', models)) return;
  if (!pokerSetupOpen) return;
  closePokerSetup();
  clearPokerChat(); // fresh chat thread for the new session
  pokerChatOpen = false; // the chat starts collapsed (just the pill) each new match
  pokerMatch.start(seats, { stack: pokerStartingStack() });
}

// The bottom-left "new match" button: tear down a finished session if one is still on
// screen, then open the settings panel (which becomes the "start match" state).
function pokerNewMatch(): void {
  if (pokerScene.isActive()) stopPokerMatch(); // session over → back to the idle felt first
  openPokerSetup();
}

// The poker AI button / 'p' key: new match (idle → open setup), start (setup open),
// pause (running), resume (paused).
function pokerButton(): void {
  if (mode !== 'poker') enterPoker();
  if (!pokerMatch.isRunning()) {
    if (pokerSetupOpen) confirmPokerSetup();
    else pokerNewMatch();
  } else if (pokerMatch.isPaused() && failureResume) retryFailedTurn();
  else if (pokerMatch.isPaused()) pokerMatch.resume();
  else pokerMatch.pause();
  r.requestRender();
}

// The bottom-right pause/resume button: just toggles a live session (no new-match /
// start handling — the button only exists while a match is running or paused).
function togglePokerPause(): void {
  if (!pokerMatch.isRunning()) return;
  if (pokerMatch.isPaused() && failureResume) retryFailedTurn();
  else if (pokerMatch.isPaused()) pokerMatch.resume();
  else pokerMatch.pause();
  forceFrame = true;
  r.requestRender();
}

// The ☰ in-game menu popup (home / new game / display / quit).
function openPokerMenu(): void {
  if (mode !== 'poker') return;
  pokerMenuOpen = true;
  tutorial.signal('ui.menuOpen');
  forceFrame = true;
  r.requestRender();
}
function closePokerMenu(): void {
  if (pokerMenuOpen) tutorial.signal('ui.menuClose');
  pokerMenuOpen = false;
  forceFrame = true;
  r.requestRender();
}

// The "notes" pill popup: each AI seat's private opponent reads, switched via the
// modal's colored observer dropdown (which routes selection to setNotesObserverPick).
function openPokerNotes(): void {
  if (mode !== 'poker' || !pokerMatch.isRunning()) return;
  const observers = pokerMatch.noteObservers();
  if (!observers.length) return; // no AI seats → nothing to show
  if (pokerNotesIdx >= observers.length) pokerNotesIdx = 0;
  pokerNotesOpen = true;
  tutorial.signal('poker.reads');
  forceFrame = true;
  r.requestRender();
}
function closePokerNotes(): void {
  pokerNotesOpen = false;
  pokerNotesFocused = false;
  forceFrame = true;
  r.requestRender();
}
// The observer dropdown picks which seat's reads to show (the modal is shared by poker and
// Islanders; whichever screen is up owns the pick).
setNotesObserverPick((i) => {
  if (mode === 'islanders') islandersNotesIdx = i;
  else pokerNotesIdx = i;
  forceFrame = true;
  r.requestRender();
});

// The Islanders reads modal: every model seat's notebook (its plan and its reads on the others).
function openIslandersNotes(): void {
  if (mode !== 'islanders' || !islandersDriver.state()) return;
  const observers = islandersDriver.noteObservers();
  if (!observers.length) return;
  if (islandersNotesIdx >= observers.length) islandersNotesIdx = 0;
  islandersNotesOpen = true;
  forceFrame = true;
  r.requestRender();
}
function closeIslandersNotes(): void {
  islandersNotesOpen = false;
  islandersNotesFocused = false;
  forceFrame = true;
  r.requestRender();
}

// The chess ☰ in-game menu popup (home / new game / display / eval bar / illegal / quit).
function openChessMenu(): void {
  if (mode !== 'chess-game') return;
  chessMenuOpen = true;
  tutorial.signal('ui.menuOpen');
  forceFrame = true;
  r.requestRender();
}
function closeChessMenu(): void {
  if (chessMenuOpen) tutorial.signal('ui.menuClose');
  chessMenuOpen = false;
  forceFrame = true;
  r.requestRender();
}

// Esc = back one level. Inside a game it opens the "return home?"
// confirm so a stray keypress can't drop a match; every other non-menu screen goes straight
// back to the menu. (The menu's own esc → prism and each modal's esc → close are handled by
// higher keymap layers, so they never reach here.)
function escBack(): void {
  if (escapeBackRequiresConfirmation(mode)) openConfirmHome();
  else enterMenu();
}
function openConfirmHome(): void {
  confirmHomeOpen = true;
  forceFrame = true;
  r.requestRender();
}
function closeConfirmHome(): void {
  confirmHomeOpen = false;
  confirmHomeFocused = false;
  forceFrame = true;
  r.requestRender();
}
function confirmHomeYes(): void {
  confirmHomeOpen = false;
  confirmHomeFocused = false;
  enterMenu();
}

// The shortcuts overlay: '?' anywhere (or a ☰ menu item) opens it; '?'/esc/✕ close it.
function openShortcuts(): void {
  shortcutsOpen = true;
  tutorial.signal('ui.controls');
  forceFrame = true;
  r.requestRender();
}
function closeShortcuts(): void {
  shortcutsOpen = false;
  forceFrame = true;
  r.requestRender();
}

// The quit-confirm popup: 'q' opens it (from any non-modal screen); esc / cancel dismiss;
// the "quit" button (default-focused, Enter) calls quit(). ctrl+c bypasses this entirely.
function openConfirmQuit(): void {
  confirmQuitOpen = true;
  forceFrame = true;
  r.requestRender();
}
function closeConfirmQuit(): void {
  confirmQuitOpen = false;
  confirmQuitFocused = false;
  forceFrame = true;
  r.requestRender();
}

// The startup update popup. It only ever lives over the boot prism, so closing it tears
// down its overlay + keymap layer directly (syncBar isn't run for the prism once it's
// gone) and leaves the prism bare. "quit to update" just quits — the on-exit line then
// prints the upgrade command. "copy command" copies it to the clipboard and flips the
// button to a "copied ✓" confirmation.
function closeUpdateModal(): void {
  updateModalOpen = false;
  updateModalFocused = false;
  updateCopied = false;
  if (keymap.hasContext('update')) keymap.popContext('update');
  ui.setRoot(null); // the prism screen has no overlay
  forceFrame = true;
  r.requestRender();
}
function copyUpdateCommand(): void {
  if (!update) return;
  copyToClipboard(update.command);
  updateCopied = true;
  forceFrame = true;
  r.requestRender();
}

// New game (menu): tear the current session down to the idle empty table (the looping
// shuffling deck), then open the setup modal to pick opponents for a fresh match.
function pokerNewGame(): void {
  closePokerMenu();
  stopPokerMatch(); // scene.endSession() → idle framing on the shuffling deck
  openPokerSetup();
}

// Build the hero's decision context for the HUD from the live hand (seat 0 = hero).
function pokerHero(): HeroContext {
  const idle: HeroContext = { toAct: false, toCall: 0, minRaiseTo: 0, maxRaiseTo: 0, stack: 0, pot: 0, currentBet: 0, bigBlind: 0, canRaise: false };
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
    currentBet: st.currentBetAmount(),
    bigBlind: st.bigBlind(),
    canRaise: st.maxRaiseTo(0) > st.currentBetAmount(),
  };
}

// A short status line for the HUD when no commentary/turn prompt is showing. Idle
// needs no prompt — the bottom-left "new match" button is the affordance.
function pokerStatus(): string {
  if (mode !== 'poker' || !pokerScene.isActive()) return '';
  if (!pokerMatch.isRunning()) return 'session over';
  // Paused state is shown by the bottom-right resume button, not a status line.
  // No "Your move" toast: the hero's turn is already shown by the lit player strip and the
  // Fold/Check/Bet/Raise action bar, so the label above the strips would be redundant.
  return '';
}

// Illegal moves is chosen during match setup but remains adjustable from the visible Chess
// menu. Keep it menu-only rather than restoring the old hidden keyboard shortcut.
function toggleIllegal(): void {
  illegalAllowed = !illegalAllowed;
  forceFrame = true;
  r.requestRender();
}

// Show/hide the right-edge eval bar (bar button / 'e' key).
function toggleEvalBar(): void {
  evalBarVisible = !evalBarVisible;
  tutorial.signal('chess.evalBar');
  forceFrame = true;
  r.requestRender();
}

// Persist the anonymous-telemetry opt-in/out from the home menu (no key binding), the
// in-app companion to `arcade telemetry enable|disable`.
function toggleTelemetry(): void {
  if (isTelemetryEnvironmentOptedOut()) return;
  toggleTelemetryPreference();
  forceFrame = true;
  r.requestRender();
}

// The AI button / 'p' key: play (idle) → pause (running) → resume (paused).
// Entering from elsewhere first opens the chess game.
function aiButton(): void {
  if (mode !== 'chess-game') enterChessGame();
  if (!chessGame.isMatchActive()) openMatchSetup();
  else if (aiMatch.isPaused() && failureResume) retryFailedTurn();
  else if (aiMatch.isPaused()) aiMatch.resume();
  else aiMatch.pause();
  r.requestRender();
}

// Reset to a fresh game: abort any running AI match, restore the start position,
// and clear the move history + captures.
function resetGame(): void {
  if (mode !== 'chess-game') return;
  stopAiMatch(); // stops the match and clears the board, move history, and DM thread
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
// creator wisp pulses. The session opens lazily on the first message.
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

// The Islanders tile test bed: a single 3D hex tile on a turntable, switchable between terrains
// from the top-left dropdown. No game rules — a place to dial in the tile look.
function enterIslandersTiles(): void {
  stopAiMatch();
  audioScene.deactivate();
  mode = 'islanders-tiles';
  draggingCamera = false;
  islanders.enter();
  fullRepaint();
}

// The Islanders game screen: the played board. Entering shows the setup panel (mode / players /
// your color / a model per AI seat) over an idle island; "start game" builds the state and
// runs the complete rules-authoritative match. Distinct from islanders-tiles, which stays a
// free-placement graphics bed with no rules attached.
function enterIslandersGame(): void {
  stopAiMatch();
  audioScene.deactivate();
  mode = 'islanders';
  draggingCamera = false;
  mountIslandersGameHud(ui);
  islandersGameScene.scene.resetView();
  islandersGameScene.prepareBoard();
  // The island animates (water, blades, livestock) on its own timer, like the test bed's.
  if (islandersGameTimer === null) {
    islandersGameTimer = setInterval(() => {
      islandersGameScene.requestAnimationFrame();
      // The tutorial's attention pulses need frames too, even on a still island.
      if (islandersGameScene.needsRender() || ui.animating()) r.requestRender();
    }, ISLANDERS_ANIMATION_FRAME_MS);
  }
  fullRepaint();
}

// Begin a session from the setup panel's committed choices.
async function startIslandersGame(): Promise<void> {
  if (!requireGateway(() => { void startIslandersGame(); })) return;
  const seats = islandersSetupSelection();
  if (!seats) return;
  const models = seats.flatMap((seat) => seat.kind === 'ai' ? [seat.model] : []);
  if (!await preflightModels('islanders', models)) return;
  if (mode !== 'islanders' || islandersDriver.state()) return;
  const islandersCommunicationMode = islandersSetupCommunicationMode();
  const board = islandersGameScene.preparedBoard();
  islandersDriver.start(seats, { communicationMode: islandersCommunicationMode, ...(board ? { board } : {}) });
  fullRepaint();
}

// Tear the session down and return to the setup panel.
function newIslandersGame(): void {
  cancelModelHealthCheck('islanders');
  clearFailureState();
  islandersDriver.reset();
  islandersGameScene.prepareBoard();
  fullRepaint();
}

function cycleIslandersCommunicationMode(): void {
  const next: CommunicationMode = islandersSetupCommunicationMode() === 'ambient' ? 'autoreply' : 'ambient';
  setIslandersSetupCommunicationMode(next);
  islandersDriver.setCommunicationMode(next);
  fullRepaint();
}

// The Islanders game's ☰ popup — the same shell menu every game screen uses.
function buildIslandersGameMenu(): Node {
  const groups: MenuItem[][] = [
    [{ id: 'islanders-game-menu-home', label: 'home', onClick: () => enterMenu() }],
    [
      { id: 'islanders-game-menu-new', label: 'new game', onClick: () => { newIslandersGame(); closeIslandersGameMenu(); } },
      { id: 'islanders-game-menu-reset', label: 'reset camera', onClick: () => { islandersGameScene.scene.resetView(); closeIslandersGameMenu(); } },
      { id: 'islanders-game-menu-communication', label: 'communication', value: islandersSetupCommunicationMode(), onClick: cycleIslandersCommunicationMode },
      { id: 'islanders-game-menu-mode', label: 'display', value: renderMode, onClick: () => cycleMode() },
      { id: 'islanders-game-menu-color', label: 'color', value: colorMode, onClick: () => cycleColor() },
    ],
    [
      { id: 'islanders-game-menu-shortcuts', label: 'controls', onClick: () => openShortcuts() },
      { id: 'islanders-game-menu-quit', label: 'quit', onClick: () => quit() },
    ],
  ];
  return buildGameMenu({ groups, onClose: closeIslandersGameMenu, valueColW: MENU_VALUE_W });
}
function closeIslandersGameMenu(): void {
  if (islandersGameMenuOpen) tutorial.signal('ui.menuClose');
  islandersGameMenuOpen = false;
  fullRepaint();
}
function openIslandersGameMenu(): void {
  if (mode !== 'islanders') return;
  islandersGameMenuOpen = true;
  tutorial.signal('ui.menuOpen');
  fullRepaint();
}

// Leaving the Islanders game screen entirely.
function leaveIslandersGame(): void {
  const wasActive = islandersDriver.state() !== null || islandersGameTimer !== null;
  cancelModelHealthCheck('islanders');
  if (wasActive) clearFailureState();
  islandersDriver.reset();
  closeIslandersSidebar();
  if (islandersGameTimer !== null) {
    clearInterval(islandersGameTimer);
    islandersGameTimer = null;
  }
}

// The poker game screen: a 3D table where you play no-limit Hold'em against AI
// models. Entering shows the idle felt (shuffling deck + chair ring); the bottom-left
// "new match" button opens the settings panel, then reads "start match" to deal.
function enterPoker(): void {
  stopAiMatch();
  audioScene.deactivate();
  mode = 'poker';
  draggingCamera = false;
  mountPokerGameHud(ui);
  pokerChatComposer.mount(ui);
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
  stopTutorial();
  stopAiMatch();
  stopPokerMatch();
  audioScene.deactivate(); // tear down any open voice session when leaving
  mode = 'prism';
  ui.setRoot(null); // the prism screen has no bar — clear any prior screen's overlay
  fullRepaint();
}

// The Wii-style menu hub. Reached from the prism loading screen (any key) and
// returned to by a game's "back". No bar — the tiles are the navigation surface.
// Going home is how every route out of the tutorial ends it.
function enterMenu(clear = true): void {
  stopTutorial();
  stopAiMatch();
  stopPokerMatch();
  audioScene.deactivate(); // tear down any open voice session when leaving
  mode = 'menu';
  homeMenuOpen = false;
  teamModalOpen = false;
  teamModalFocused = false;
  menuSel = initialMenuSel();
  coverPos = menuSel;
  if (firstMenuPending) {
    firstMenuPending = false;
    markFirstRunSeen();
  }
  menuHover = false;
  coverFlowWheelInput.reset();
  launching = false;
  ui.setRoot(null);
  if (clear) fullRepaint();
  else {
    forceFrame = true;
    syncLive();
    syncContext();
    r.requestRender();
  }
}

function enterTrailer(): void {
  stopAiMatch();
  stopPokerMatch();
  audioScene.deactivate();
  mode = 'trailer';
  if (!currentTrailerScene().start()) {
    enterMenu();
    return;
  }
  trailerStartedAt = performance.now();
  ui.setRoot(null);
  fullRepaint();
}

// The CLI owns only the trigger and wall-clock lifecycle. The actual transition
// is the same platform-neutral Surface compositor used by browser cinematics.
function startPrismToMenu(): void {
  if (prismToMenu.active()) return;
  homeMenuOpen = false;
  ui.setRoot(null);
  prismToMenu.start();
  forceFrame = true;
  syncLive();
  r.requestRender();
}

// Clicking/▶ a cover starts the flip-to-title launch splash (enabled covers only;
// placeholders are no-ops). enterGame runs when the splash finishes.
function launchSelected(): void {
  if (launching) return;
  const item = MENU_ITEMS[coverFlowIndex(menuSel, MENU_ITEMS.length)];
  const action = menuItemAction(item);
  if (!action) return;
  if (action.kind === 'external') {
    openBrowser(action.url);
    return;
  }
  launching = true;
  launchT = 0;
  launchSel = menuSel;
  ui.setRoot(null); // hide the menu pill during the flip-to-title launch splash
  if (item?.id === 'trailer') setTimeout(() => { void currentTrailerScene().prepare().catch(() => {}); }, 0);
}

// Open the actual game screen for a cover id (the destinations the splash hands off to).
function enterGame(id: string): void {
  if (id === 'tutorial') tutorial.start();
  else if (id === 'chess') enterChessGame();
  else if (id === 'logos') enterLogos();
  else if (id === 'audio') enterAudio();
  else if (id === 'poker') enterPoker();
  else if (id === 'poker-test') enterCards();
  else if (id === 'islanders') enterIslandersGame();
  else if (id === 'islanders-test') enterIslandersTiles();
  else if (id === 'trailer') enterTrailer();
  else if (id === 'ui') enterUi();
}

// Step the virtual Cover Flow selection by ±1. Rendering and launch identity
// resolve modulo the catalogue, so navigation remains continuous at both seams.
function menuNav(step: number): void {
  if (launching) return; // input is locked while the launch splash plays
  menuSel += step;
}

function menuWheelNav(e: MouseEvent): void {
  menuNav(coverFlowWheelInput.step(e));
}

// The Cover Flow chrome over the 3D covers: the focused game's title centred below
// the carousel, with its dim tail (see coverTail).
function drawCoverChrome(surf: Surface, cols: number, rows: number, sel: number): void {
  const item = MENU_ITEMS[coverFlowIndex(sel, MENU_ITEMS.length)];
  const tail = coverTail(item, firstLaunch);
  const suffix = tail ? `   ${tail}` : '';
  const tx = Math.max(0, Math.floor((cols - (item.title.length + suffix.length)) / 2));
  const ty = rows - 4;
  surf.drawTextOver(tx, ty, item.title, [240, 244, 255], STYLE_BOLD);
  if (suffix) surf.drawTextOver(tx + item.title.length, ty, suffix, [150, 156, 174], STYLE_DIM);
}

// The prism loading-screen prompt: a small, subtle, lowercase line near the bottom whose
// opacity wavers (a slow sine, never fully gone) — the arcade "breathing" glow
// rather than a hard blink. Drawn with alpha-blending over the scene so the waver
// reads as real opacity.
const PRISM_PROMPT_TEXT = 'press any key to start';
function drawPrismPrompt(surf: Surface, cols: number, rows: number, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.2); // ~0.6 Hz, 0..1
  const alpha = 0.42 + 0.5 * pulse; // wavers ~0.42..0.92, always visible
  const x0 = Math.max(0, Math.floor((cols - PRISM_PROMPT_TEXT.length) / 2));
  const y = rows - 2;
  const fg: RGBA = [205, 210, 230, alpha];
  const bg: RGBA = [0, 0, 0, 0]; // keep the scene behind; only the glyph blends
  for (let i = 0; i < PRISM_PROMPT_TEXT.length; i++) {
    if (PRISM_PROMPT_TEXT[i] !== ' ') surf.setCellWithAlphaBlending(x0 + i, y, PRISM_PROMPT_TEXT[i], fg, bg);
  }
}

// ── Tutorial staging ─────────────────────────────────────────────────────────────
// Open a chapter's screen. Chapters that share a screen keep it as-is (the board position
// carries from Chess into Menu); a change of screen enters the game the normal way, then
// seats the practice bots. The previous chapter's session is torn down first — the shell's
// enter* functions only stop chess on their own.
function showTutorialChapter(chapter: TutorialChapter, previous: TutorialChapter | null): void {
  if (previous?.screen === 'poker' && chapter.screen !== 'poker') stopPokerMatch();
  closeTutorialPopups();
  tutorialIslandersSeen = 0;
  tutorialIslandersStocked = false;
  if (chapter.screen === 'chess') {
    if (mode !== 'chess-game') enterChessGame();
    if (previous?.screen !== 'chess') chessGame.resetGame();
    fullRepaint();
  } else if (chapter.screen === 'poker') {
    // Consecutive poker chapters (poker → keyboard) keep the same table and hand running.
    if (previous?.screen !== 'poker' || !pokerMatch.isRunning()) {
      enterPoker();
      pokerMatch.start([{ kind: 'human' }, { kind: 'bot' }, { kind: 'bot' }]);
      pokerChatOpen = false;
      pushPokerChat({ text: 'practice table: the bots only check and call. in a real game each model talks here between actions, in character.', model: '', event: true });
    }
    fullRepaint();
  } else {
    // Consecutive island chapters (islanders → done) keep the same game going.
    if (previous?.screen !== 'islanders' || !islandersDriver.state()) {
      enterIslandersGame();
      // A fixed seed makes the dice and dev deck replay identically every time the chapter is
      // played; the island itself is the freshly prepared preview board.
      const board = islandersGameScene.preparedBoard();
      islandersDriver.start(
        [
          { kind: 'human', color: 'red' },
          { kind: 'bot', color: 'blue' },
          { kind: 'bot', color: 'orange' },
        ],
        { rng: mulberry32(0x7a7e), communicationMode: islandersSetupCommunicationMode(), ...(board ? { board } : {}) },
      );
    }
    fullRepaint();
  }
}

// Dismiss whatever popup a chapter left open (its menu, the controls overlay, the match
// picker, a confirm) so the next chapter starts on a clean screen.
function closeTutorialPopups(): void {
  if (matchSetupOpen) closeMatchSetup();
  chessMenuOpen = false;
  pokerMenuOpen = false;
  islandersGameMenuOpen = false;
  homeMenuOpen = false;
  shortcutsOpen = false;
  confirmHomeOpen = false;
  confirmQuitOpen = false;
}

// End the tutorial in place: drop the rail, its pulses, and the live lease it held. Callers
// repaint. Every route home (enterMenu / toPrism / launching a cover) runs through here.
function stopTutorial(): void {
  if (!tutorial.active()) return;
  tutorial.stop();
  ui.setAttention([], TUTORIAL_PULSE);
  applyGlobalOverlay();
  syncLive();
}

// Detectors for steps the games don't announce: the poker peek/lift (scene state) and the
// human's Islanders actions (the rules' action records). Runs once per frame while active.
function tutorialPoll(): void {
  if (mode === 'poker' && pokerScene.isActive()) {
    const hero = pokerScene.tableView()?.seats[0];
    if (hero?.cards.some((c) => c !== null)) tutorial.signal('poker.peek');
    if (pokerScene.heroCardLifted()) tutorial.signal('poker.lift');
  }
  if (mode === 'islanders') {
    const state = islandersDriver.state();
    if (!state) return;
    const human = islandersDriver.humanSeat();
    const records = state.actionRecords();
    for (; tutorialIslandersSeen < records.length; tutorialIslandersSeen++) {
      const record = records[tutorialIslandersSeen];
      if (record.player !== human) continue;
      const type = record.action.type;
      if (type === 'initialSettlement') tutorial.signal('islanders.settlement');
      else if (type === 'initialRoad') tutorial.signal('islanders.road');
      else if (type === 'roll') tutorial.signal('islanders.roll');
      else if (type === 'buildRoad' || type === 'buildSettlement' || type === 'buildCity') tutorial.signal('islanders.build');
      else if (type === 'maritimeTrade' || type === 'maritimeBulkTrade') tutorial.signal('islanders.trade');
      else if (type === 'endTurn') tutorial.signal('islanders.endTurn');
    }
    if (state.initialPlacementComplete()) {
      tutorial.signal('islanders.setupDone');
      // Stock the opening hand once so every build and a 4:1 trade are possible on the first
      // turn, whatever order they're tried in. The chapter's fixed seed opens with a non-7 roll,
      // so the big hand isn't hit by a discard before it can be spent.
      if (!tutorialIslandersStocked && human >= 0) {
        tutorialIslandersStocked = true;
        state.grantResources(human, RESOURCES.map(() => 6));
        forceFrame = true;
      }
    }
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
  reset: () => {
    activeOrbit()?.resetView();
    tutorial.signal('camera.reset');
  },
  mode: cycleMode,
  quit,
  aiMatch: aiButton,
  newGame: resetGame,
  audioModel: () => audioScene.cycleModel(),
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
  closeTeamSwitch,
  openHomeMenu,
  closeHomeMenu,
  cycleMode,
  enterMenu,
  toPrism,
  menuNav,
  launchSelected,
  enterAudio,
  audioCycleModel: () => audioScene.cycleModel(),
  enterChessGame,
  enterUi,
  // The keyboard camera commands report to the tutorial (the pointer path reports from
  // onMouseImpl), so "arrow keys pan" and "r resets" can be ticked separately.
  activeOrbit: () => {
    const orbit = activeOrbit();
    if (!orbit || !tutorial.active()) return orbit;
    return {
      resetView: () => {
        orbit.resetView();
        tutorial.signal('camera.reset');
      },
      pan: (dx: number, dy: number) => {
        orbit.pan(dx, dy);
        tutorial.signal('camera.panKey');
      },
    };
  },
  cancelPromotion,
  aiButton,
  toggleHistory,
  toggleChat,
  resetGame,
  toggleEvalBar,
  closeGameOver,
  closeMatchSetup,
  cancelWispSwap,
  pokerButton,
  pokerBetStep,
  closePokerSetup,
  closePokerMenu,
  closePokerNotes,
  closeChessMenu,
  openIslandersMenu: () => islanders.openMenu(),
  openIslandersGameMenu,
  closeIslandersMenu: () => islanders.closeMenu(),
  closeIslandersPieceEdit: () => islanders.closePieceModal(),
  closeIslandersGameMenu,
  closeIslandersNotes,
  openChessMenu,
  openPokerMenu,
  togglePokerChat,
  escBack,
  closeConfirmHome,
  enterPoker,
  enterCards,
  openShortcuts,
  closeShortcuts,
  openConfirmQuit,
  closeConfirmQuit,
  closeUpdateModal,
});

// Point the keymap's base layer at the current mode (chess-game uses the shared
// 'chess' orbit layer). The 'promoting' modal is pushed/popped separately.
function syncContext(): void {
  const layer: string = mode === 'chess-game' ? 'chess' : mode;
  keymap.setBase(layer); // 'poker' maps straight through to the poker layer
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
  // Everything below lays out into the HUD region — the screen, less the tutorial rail. The
  // rail itself is the global overlay, refreshed here so it tracks progress every frame.
  const region = hudRegion();
  if (tutorial.active()) {
    ui.setAttention(tutorial.attentionIds(), TUTORIAL_PULSE);
    applyGlobalOverlay();
  }
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
  if (mode !== 'poker') pokerMenuOpen = false; // the in-game menu only lives in the poker view
  if (mode !== 'poker') pokerNotesOpen = false; // ditto for the notes modal
  if (mode !== 'chess-game') chessMenuOpen = false; // ditto for the chess menu
  if (mode !== 'islanders-tiles') islanders.reset(); // drop the islanders menu + piece-edit modal state
  if (mode !== 'islanders') {
    islandersGameMenuOpen = false;
    islandersNotesOpen = false;
    leaveIslandersGame(); // abort a running placement session and stop its animation timer
  }
  if (mode !== 'chess-game' && mode !== 'poker' && mode !== 'islanders') confirmHomeOpen = false; // the confirm only lives in a game
  if (mode !== 'menu') {
    homeMenuOpen = false;
    teamModalOpen = false;
    teamModalFocused = false;
  }
  // The poker/chess modal layers are popped whenever their modal isn't open (any branch).
  if (!pokerSetupOpen && keymap.hasContext('poker-setup')) keymap.popContext('poker-setup');
  if (!pokerMenuOpen && keymap.hasContext('poker-menu')) keymap.popContext('poker-menu');
  if (!pokerNotesOpen && keymap.hasContext('poker-notes')) keymap.popContext('poker-notes');
  if (!pokerNotesOpen) pokerNotesFocused = false; // re-focus the scroll body on the next open
  if (!chessMenuOpen && keymap.hasContext('chess-menu')) keymap.popContext('chess-menu');
  if (!islanders.isMenuOpen() && keymap.hasContext('islanders-menu')) keymap.popContext('islanders-menu');
  if (!islanders.hasPieceEdit() && keymap.hasContext('islanders-piece-edit')) keymap.popContext('islanders-piece-edit');
  if (!islandersGameMenuOpen && keymap.hasContext('islanders-game-menu')) keymap.popContext('islanders-game-menu');
  if (!islandersNotesOpen && keymap.hasContext('islanders-notes')) keymap.popContext('islanders-notes');
  if (!islandersNotesOpen) islandersNotesFocused = false;
  if (!confirmHomeOpen && keymap.hasContext('confirm-home')) keymap.popContext('confirm-home');
  if (!confirmHomeOpen) confirmHomeFocused = false; // re-focus "return home" on the next open
  if (!shortcutsOpen && keymap.hasContext('shortcuts')) keymap.popContext('shortcuts');
  if (!confirmQuitOpen && keymap.hasContext('confirm-quit')) keymap.popContext('confirm-quit');
  if (!confirmQuitOpen) confirmQuitFocused = false; // re-focus "quit" on the next open
  if (!updateModalOpen && keymap.hasContext('update')) keymap.popContext('update');
  if (!homeMenuOpen && keymap.hasContext('home-menu')) keymap.popContext('home-menu');
  if (!teamModalOpen && keymap.hasContext('teamswitch')) keymap.popContext('teamswitch');
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
  if (updateModalOpen && update) {
    // The startup update popup takes precedence over everything (it only appears at boot,
    // over the prism, before any game screen exists — the pops are defensive/self-healing).
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('update')) keymap.pushContext('update', true);
    ui.setRoot(
      buildUpdateModal({
        current: update.current,
        latest: update.latest,
        command: update.command,
        copied: updateCopied,
        onQuit: quit,
        onCopy: copyUpdateCommand,
        onClose: closeUpdateModal,
      }),
      region,
    );
    if (!updateModalFocused) {
      ui.setFocus('update-quit'); // default highlight so Enter quits to update
      updateModalFocused = true;
      forceFrame = true;
    }
  } else if (shortcutsOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('shortcuts')) keymap.pushContext('shortcuts', true);
    // activeBindings() skips modal layers, so it reports the screen beneath this overlay.
    // Mouse rows are per-screen (orbit drag/zoom, menu browse/launch, chess click-to-move).
    ui.setRoot(buildShortcuts(keymap.activeBindings(), closeShortcuts, { mouse: mouseControlsFor(mode) }), region);
  } else if (confirmQuitOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('confirm-quit')) keymap.pushContext('confirm-quit', true);
    ui.setRoot(buildConfirm({ prompt: 'quit arcade?', confirmLabel: 'quit', idPrefix: 'confirm-quit', onConfirm: quit, onCancel: closeConfirmQuit }), region);
    if (!confirmQuitFocused) {
      ui.setFocus('confirm-quit-yes'); // default highlight so Enter quits
      confirmQuitFocused = true;
      forceFrame = true;
    }
  } else if (confirmHomeOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('confirm-home')) keymap.pushContext('confirm-home', true);
    ui.setRoot(buildConfirm({ prompt: 'return to home screen?', confirmLabel: 'return', idPrefix: 'confirm-home', onConfirm: confirmHomeYes, onCancel: closeConfirmHome }), region);
    if (!confirmHomeFocused) {
      ui.setFocus('confirm-home-yes'); // default highlight so Enter returns home
      confirmHomeFocused = true;
      forceFrame = true;
    }
  } else if (pc !== null) {
    // Keep the keymap's modal layer in lockstep with picker visibility (idempotent
    // each frame, so it self-heals even if a resize reset the base stack).
    if (!keymap.hasContext('promoting')) keymap.pushContext('promoting', true);
    ui.setRoot(
      buildPromotion(
        pc,
        (t) => {
          chessGame.choosePromotion(t);
          // Force a scene repaint (which overwrites the popup's cells) rather than
          // a full clear — ESC[2J here would blank the screen for a frame, flashing
          // black before the move animation paints.
          forceFrame = true;
        },
        cancelPromotion,
      ),
      region,
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
    ui.setRoot(buildGameOver({ title, subtitle, tint }, resetGame, closeGameOver), region);
    if (!gameOverFocused) {
      ui.setFocus('over-newgame'); // default highlight so Enter starts a new game
      gameOverFocused = true;
      forceFrame = true;
    }
  } else if (matchSetupOpen && !chessMenuOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSwap();
    promoFocused = false;
    if (!keymap.hasContext('setup')) keymap.pushContext('setup', true);
    ui.setRoot(buildMatchSetup(region, { onStart: () => { void confirmMatchSetup(); }, onCancel: closeMatchSetup, onOpenMenu: openChessMenu, healthStatus: modelHealthStatus('chess'), gatewayNote: gatewayNoticeLines() }), region);
    if (!setupFocused) {
      ui.setFocus('setup-mode'); // start on the mode picker (the human side has no creator list)
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
    const title = wispSwap.game === 'chess'
      ? (wispSwap.color === WHITE ? 'white' : 'black')
      : 'seat ' + (wispSwap.seat + 1);
    ui.setRoot(buildSwapSetup(region, { title, onConfirm: confirmWispSwap, onCancel: cancelWispSwap }), region);
    if (!wispSwapFocused) {
      ui.setFocus('setup-swap-creator'); // start in the creator list
      wispSwapFocused = true;
      forceFrame = true;
    }
  } else if (mode === 'trailer') {
    popGameOver();
    popSetup();
    popSwap();
    ui.setRoot(buildTrailerOverlay(cols, rows, enterMenu));
  } else if (mode === 'menu') {
    popGameOver();
    popSetup();
    popSwap();
    // Cover Flow gets one menu button. The menu, shortcuts, quit confirmation, and
    // Account modal replace the overlay in turn. Keep the account dropdown mounted
    // so its committed selection and search interaction survive rebuilds.
    mountTeamSwitch(ui);
    if (teamModalOpen) {
      if (!keymap.hasContext('teamswitch')) keymap.pushContext('teamswitch', true);
      ui.setRoot(
        buildTeamSwitch(teamView, teamSwitchActions(closeTeamSwitch), cols, rows),
        region,
      );
      // Focus the dropdown once it's populated so ↑↓/Enter drive it (the Slot isn't in
      // the loading/switching trees, so wait for 'loaded').
      if (teamView.kind === 'loaded' && !teamModalFocused) {
        ui.setFocus('team-switch-dropdown');
        teamModalFocused = true;
        forceFrame = true;
      }
    } else if (homeMenuOpen) {
      if (keymap.hasContext('teamswitch')) keymap.popContext('teamswitch');
      if (!keymap.hasContext('home-menu')) keymap.pushContext('home-menu', true);
      const telemetryForcedOff = isTelemetryEnvironmentOptedOut();
      const groups: MenuItem[][] = [
        [
          { id: 'home-menu-display', label: 'display', value: renderMode, onClick: cycleMode },
          { id: 'home-menu-color', label: 'color', value: colorMode, onClick: cycleColor },
        ],
        [
          { id: 'home-menu-shortcuts', label: 'controls', onClick: openShortcuts },
          { id: 'home-menu-account', label: 'account', onClick: openTeamSwitch },
          {
            id: 'home-menu-telemetry',
            label: 'telemetry',
            value: telemetryForcedOff ? 'off (env)' : isTelemetryPreferenceEnabled() ? 'on' : 'off',
            onClick: toggleTelemetry,
            disabled: telemetryForcedOff,
          },
          { id: 'home-menu-quit', label: 'quit', onClick: openConfirmQuit },
        ],
      ];
      ui.setRoot(buildGameMenu({ groups, onClose: closeHomeMenu, valueColW: MENU_VALUE_W }), region);
    } else {
      if (keymap.hasContext('teamswitch')) keymap.popContext('teamswitch');
      if (keymap.hasContext('home-menu')) keymap.popContext('home-menu');
      ui.setRoot(buildMenuOverlay(), region);
    }
  } else if (mode === 'ui') {
    popGameOver();
    popSetup();
    popSwap();
    // The component playground: a full-screen tree (centered panel + the standard
    // bar) laid out over the scene, so Tab/typing reach the mounted components.
    ui.setRoot(buildShowcase(region, buildBar('ui', renderMode, actions)), region);
  } else if (chessMenuOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    // The chess in-game menu popup. Home/new game/quit act and dismiss; display/eval bar/
    // illegal update in place (menu stays open, labels reflect current state). Escape
    // (chess-menu layer) and the header ✕ close it. No default focus (uniform buttons).
    if (!keymap.hasContext('chess-menu')) keymap.pushContext('chess-menu', true);
    const groups: MenuItem[][] = [
      [
        { id: 'chess-menu-home', label: 'home', onClick: enterMenu },
        { id: 'chess-menu-new', label: 'reset board', onClick: () => { resetGame(); closeChessMenu(); } },
      ],
      [
        { id: 'chess-menu-reset', label: 'reset camera', onClick: () => { actions.reset(); closeChessMenu(); } },
        { id: 'chess-menu-mode', label: 'display', value: renderMode, onClick: cycleMode },
        { id: 'chess-menu-color', label: 'color', value: colorMode, onClick: cycleColor },
        { id: 'chess-menu-eval', label: 'eval bar', value: evalBarVisible ? 'on' : 'off', onClick: toggleEvalBar },
        { id: 'chess-menu-illegal', label: 'illegal moves', value: illegalAllowed ? 'on' : 'off', onClick: toggleIllegal },
      ],
      [
        { id: 'chess-menu-shortcuts', label: 'controls', onClick: openShortcuts },
        { id: 'chess-menu-quit', label: 'quit', onClick: quit },
      ],
    ];
    ui.setRoot(buildGameMenu({ groups, onClose: closeChessMenu, valueColW: MENU_VALUE_W }), region);
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
    chessChatComposer.mount(ui);
    // Full-screen overlay: move-history panel (top-right) + commentary toast over
    // the board, with the standard bar beneath. Refresh the panel rows first.
    refreshMoveHistory(chessGame.moves(), chessGame.illegalFlags());
    // Mirror each newly-settled move into the chat thread as a grey line (red + "(illegal)"
    // for a move played under the illegal toggle), with the moved piece's glyph.
    const chessMoves = chessGame.moves();
    if (chessMoves.length > chessChatPly) {
      const flags = chessGame.illegalFlags();
      for (let i = chessChatPly; i < chessMoves.length; i++) pushChatMessage(chessMoveChat(chessMoves[i], i, flags[i] ?? false));
      chessChatPly = chessMoves.length;
    }
    const ai = !chessGame.isMatchActive()
      ? { label: 'new match', active: false }
      : aiMatch.isPaused()
        ? { label: 'resume', active: true }
        : { label: 'pause', active: true };
    // White-POV centipawns for the eval bar (cheap 64-square scan; only when shown).
    const evalCp = evalBarVisible ? evaluate(chessGame.state().board) : 0;
    ui.setRoot(
      buildChessGameRoot(region, buildBar(mode, renderMode, actions, ai), {
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
        onOpenMenu: openChessMenu,
        chatActive: matchSeats !== null,
        chatComposer: chessChatComposerNode(),
        illegalOn: illegalAllowed,
        matchup: matchSeats ? chessMatchupLabels(matchSeats) : null,
      }),
      region,
    );
  } else if (mode === 'cards') {
    popGameOver();
    popSetup();
    popSwap();
    // Re-mount the poker dropdowns (a prior modal root may have dropped their
    // Slots), then build the control panel + bar over the scene.
    mountPokerHud(ui);
    ui.setRoot(buildPokerRoot(region, buildBar('cards', renderMode, actions)), region);
  } else if (islanders.isMenuOpen()) {
    popGameOver();
    popSetup();
    popSwap();
    if (!keymap.hasContext('islanders-menu')) keymap.pushContext('islanders-menu', true);
    ui.setRoot(islanders.buildMenuRoot(cols, rows), region);
  } else if (mode === 'islanders-tiles' && islanders.hasPieceEdit()) {
    popGameOver();
    popSetup();
    popSwap();
    if (!keymap.hasContext('islanders-piece-edit')) keymap.pushContext('islanders-piece-edit', true);
    // The piece-edit modal over the board (null if the piece went stale — then the next frame
    // falls through to the normal root).
    const root = islanders.buildPieceModalRoot();
    if (root) ui.setRoot(root, region);
  } else if (mode === 'islanders-tiles') {
    popGameOver();
    popSetup();
    popSwap();
    ui.setRoot(islanders.buildRoot(cols, rows, activeSceneViewport().w), region);
  } else if (mode === 'islanders' && islandersNotesOpen) {
    popGameOver();
    popSetup();
    popSwap();
    if (!keymap.hasContext('islanders-notes')) keymap.pushContext('islanders-notes', true);
    mountPokerNotes(ui); // the reads modal (its observer dropdown + scroll body) is shared with poker
    const observers = islandersDriver.noteObservers();
    const activeIdx = Math.min(islandersNotesIdx, observers.length - 1);
    const observer = observers[activeIdx];
    const notebook = observer ? islandersDriver.notesView(observer.seat) : { plan: '', reads: [] };
    ui.setRoot(
      buildPokerNotesModal({
        observers,
        activeIndex: activeIdx,
        entries: [{ label: 'plan', notes: notebook.plan ? [notebook.plan] : [] }, ...notebook.reads],
        onClose: closeIslandersNotes,
      }),
      region,
    );
    if (!islandersNotesFocused) {
      ui.setFocus('poker-notes-scroll');
      islandersNotesFocused = true;
      forceFrame = true;
    }
  } else if (mode === 'islanders' && islandersGameMenuOpen) {
    popGameOver();
    popSetup();
    popSwap();
    if (!keymap.hasContext('islanders-game-menu')) keymap.pushContext('islanders-game-menu', true);
    ui.setRoot(buildIslandersGameMenu(), region);
  } else if (mode === 'islanders') {
    popGameOver();
    popSetup();
    popSwap();
    // Re-mount the setup dropdowns + history scrollbox (a prior modal root may have dropped
    // their Slots), then build whichever face the session state calls for.
    mountIslandersGameHud(ui);
    if (islandersDriver.state()) {
      islandersGameScene.setResourceFlightLayout(
        region,
        islandersDriver.seatCount(),
        islandersRailShown(),
        islandersDriver.humanSeat() >= 0 && islandersRailShown() ? islandersChatComposer.rows() : 0,
      );
    }
    ui.setRoot(
      buildIslandersGameRoot(
        region,
        {
          driver: islandersDriver,
          scene: islandersGameScene,
          tokens: islandersGameScene.scene.boardTokens(activeSceneViewport().w, rows),
          sails: islandersGameScene.scene.boardPortLabels(activeSceneViewport().w, rows),
          resourceFlights: islandersGameScene.activeResourceFlights(),
          resourceAdjustments: islandersGameScene.resourceViewAdjustments(),
          onOpenMenu: () => {
            openIslandersGameMenu();
          },
          onOpenNotes: openIslandersNotes,
          onStart: () => { void startIslandersGame(); },
          healthStatus: modelHealthStatus('islanders'),
          gatewayNote: gatewayNoticeLines(),
          notice: commentary && t < commentary.until ? commentary.text : undefined,
        },
      ),
      region,
    );
  } else if (pokerNotesOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    // The opponent-notes modal, over the poker view. The colored observer dropdown
    // switches AI seats; the header ✕ and Escape (poker-notes layer) close it.
    if (!keymap.hasContext('poker-notes')) keymap.pushContext('poker-notes', true);
    const observers = pokerMatch.noteObservers();
    const activeIdx = Math.min(pokerNotesIdx, observers.length - 1);
    const observer = observers[activeIdx];
    ui.setRoot(
      buildPokerNotesModal({
        observers,
        activeIndex: activeIdx,
        entries: observer ? pokerMatch.notesView(observer.seat) : [],
        onClose: closePokerNotes,
      }),
      region,
    );
    if (!pokerNotesFocused) {
      ui.setFocus('poker-notes-scroll'); // so ↑/↓/PageUp scroll the reads immediately
      pokerNotesFocused = true;
      forceFrame = true;
    }
  } else if (pokerMenuOpen) {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    // The in-game menu popup, over the poker view. Home/New game/Reset camera/Quit dismiss;
    // Display cycles the render style in place (menu stays open). Escape (poker-menu layer)
    // and the header ✕ close it.
    if (!keymap.hasContext('poker-menu')) keymap.pushContext('poker-menu', true);
    // No default focus: every button shares one style, so pre-focusing one would read as
    // "a different color". Hover (mouse) lights a button; Tab still reaches them.
    const groups: MenuItem[][] = [
      [
        { id: 'poker-menu-home', label: 'home', onClick: enterMenu },
        { id: 'poker-menu-new', label: 'new game', onClick: pokerNewGame },
      ],
      [
        { id: 'poker-menu-reset', label: 'reset camera', onClick: () => { actions.reset(); closePokerMenu(); } },
        { id: 'poker-menu-mode', label: 'display', value: renderMode, onClick: cycleMode },
        { id: 'poker-menu-color', label: 'color', value: colorMode, onClick: cycleColor },
      ],
      [
        { id: 'poker-menu-shortcuts', label: 'controls', onClick: openShortcuts },
        { id: 'poker-menu-quit', label: 'quit', onClick: quit },
      ],
    ];
    ui.setRoot(buildGameMenu({ groups, onClose: closePokerMenu, valueColW: MENU_VALUE_W }), region);
  } else if (mode === 'poker') {
    popGameOver();
    popSetup();
    popSwap();
    // Re-mount the poker HUD components (a prior modal root may have dropped their
    // Slots), then build the WSOP table HUD over the scene. The poker bar is empty (no
    // transport pill) — play/pause is the 'p' key, the rest lives in the ☰ menu.
    // The new-match settings panel (when open) is part of this same root — top-left,
    // non-modal — with a NON-modal keymap layer, so Esc closes it but the camera keys
    // (and 'p' to start) still reach the poker layer.
    if (pokerSetupOpen) {
      if (!keymap.hasContext('poker-setup')) keymap.pushContext('poker-setup');
      mountPokerSetup(ui); // a prior modal root may have dropped the Slots
    }
    mountPokerGameHud(ui);
    pokerChatComposer.mount(ui);
    // The bottom-left corner controls: "start" + "cancel" while the panel is up (start
    // disabled until every shown seat has a model), "new match" whenever no session is
    // running, nothing mid-session.
    const matchControls = pokerSetupOpen
      ? { setup: true, onPrimary: pokerSetupReady() && modelHealthCheck?.game !== 'poker' ? () => { void confirmPokerSetup(); } : undefined, onCancel: cancelPokerSetup }
      : !pokerMatch.isRunning()
        ? { setup: false, onPrimary: pokerNewMatch }
        : null;
    ui.setRoot(
      buildPokerGameRoot(region, buildBar('poker', renderMode, actions), {
        hero: pokerHero(),
        blinds: (() => {
          const level = pokerMatch.tournamentState();
          return `${level.smallBlind}/${level.bigBlind} · L${level.level} · ${level.handsUntilNextLevel} left`;
        })(),
        commentary,
        t,
        status: pokerStatus(),
        table: pokerScene.tableView(),
        active: pokerScene.isActive(),
        chatOpen: pokerChatOpen,
        onToggleChat: togglePokerChat,
        chatComposer: pokerChatComposerNode(),
        onOpenMenu: openPokerMenu,
        onOpenNotes: openPokerNotes,
        setup: pokerSetupOpen ? buildPokerSetupPanel(modelHealthStatus('poker'), gatewayNoticeLines()) : null,
        matchControls,
        pauseControl:
          pokerScene.isActive() && pokerMatch.isRunning()
            ? { paused: pokerMatch.isPaused(), onToggle: togglePokerPause }
            : null,
        hideHud: pokerScene.cineHidesHud(),
        cineLabel: pokerScene.cineLabel(),
        resultLabel: pokerScene.resultLabel(),
        awaitingContinue: pokerScene.awaitingContinue(),
        continueIn: pokerScene.continueCountdown(),
      }),
      region,
    );
    if (pokerSetupOpen && !pokerSetupFocused) {
      ui.setFocus('poker-players'); // start on the player-count picker
      pokerSetupFocused = true;
      forceFrame = true;
    }
  } else {
    if (keymap.hasContext('promoting')) keymap.popContext('promoting');
    popGameOver();
    popSetup();
    popSwap();
    promoFocused = false;
    ui.setRoot(buildBar(mode, renderMode, actions), barRegion());
  }
}

// Pixel mode preserves every bright texel, so Cover Flow's 1.1x face lighting
// plus the global low-threshold bloom washes broad areas of the cover art toward
// white. Give only the menu a lower exposure and a restrained highlight bloom.
// ASCII bypasses this path entirely, preserving its existing contrast.
function preparePixelDisplay(withBloom: boolean): RenderTarget {
  // Islanders's dice are composited twice from the same rendered target: once as part of the full
  // scene, then as a sparse foreground layer above projected HUD labels. Reuse the prepared
  // pixel frame for that second pass instead of repeating the full gamma-correct downsample.
  if (pixelDisplayPrepared && pixelDisplayBloom === withBloom && display) return display;
  display = downsample(target, supersampleForViewport(renderMode, cols, rows), display);
  if (mode === 'menu') {
    const colors = display.color;
    for (let i = 0; i < colors.length; i++) colors[i] *= 0.86;
    if (withBloom) {
      bloom(display, { threshold: 180, intensity: 0.12, radius: 1, passes: 1 });
    }
  } else if (withBloom) {
    bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  }

  pixelDisplayPrepared = true;
  pixelDisplayBloom = withBloom;
  return display;
}

// Presents the engine `target` (prism / chess) in the active
// Pixel/glyph display style. `withBloom` is the glowy post-process — on for the light
// effects, off for solid geometry like the chess pieces.
function presentScene(withBloom = true, hybridShadow = false): string {
  const viewport = activeSceneViewport();
  if (renderMode !== 'pixels') {
    return toShapeGlyph(target, viewport.w, viewport.h, {
      color: true,
      hybrid: hybridShadow,
      coloredBackground: renderMode === 'hybrid',
    });
  }
  return toHalfBlock(preparePixelDisplay(withBloom));
}

// Cell-writing twin of presentScene for the unified path: paints the scene into
// `surf` (the bottom layer) instead of returning a string. Same display logic.
function presentSceneInto(surf: Surface, withBloom = true, hybridShadow = false): void {
  const viewport = activeSceneViewport();
  const islandersForegroundActive =
    (mode === 'islanders-tiles' && islanders.scene.hasForegroundSceneLayer()) ||
    (mode === 'islanders' && islandersGameScene.scene.hasForegroundSceneLayer());
  const reservedX = viewport.x + viewport.w;
  if (reservedX < surf.cols) {
    // The UI rail is translucent. Paint its reserved area black so opening it
    // cannot blend over scene colors left behind by the previous full-width frame.
    surf.fillRect(reservedX, 0, surf.cols - reservedX, surf.rows, [0, 0, 0]);
  }
  if (renderMode !== 'pixels') {
    shapeGlyphToSurface(
      surf,
      target,
      viewport.w,
      viewport.h,
      {
        color: true,
        hybrid: hybridShadow,
        coloredBackground: renderMode === 'hybrid',
        // Dice deliberately replace depth with a sparse foreground mask. During that phase the
        // color buffer still contains the board, but depth bounds describe only the dice.
        blankOutsideDepthBounds: (mode === 'islanders' || mode === 'islanders-tiles') && !islandersForegroundActive,
      },
      viewport.x,
      viewport.y,
      mode === 'islanders' || mode === 'islanders-tiles' ? islandersGlyphCache : sceneGlyphCache,
    );
    return;
  }
  halfBlockToSurface(surf, preparePixelDisplay(withBloom), viewport.x, viewport.y);
}

// Sparse scene layer inserted by Screen between ordinary projected UI and portal chrome.
// RenderTarget depth is the transparency mask: Islanders clears it immediately before drawing its
// dice, so finite pixels are dice and infinite pixels leave the already-painted TUI untouched.
function presentSceneForegroundInto(surf: Surface, withBloom = true, hybridShadow = false): void {
  const viewport = activeSceneViewport();
  if (renderMode !== 'pixels') {
    shapeGlyphLayerToSurface(
      surf,
      target,
      viewport.w,
      viewport.h,
      { color: true, hybrid: hybridShadow, coloredBackground: renderMode === 'hybrid' },
      viewport.x,
      viewport.y,
    );
    return;
  }
  halfBlockLayerToSurface(surf, preparePixelDisplay(withBloom), viewport.x, viewport.y);
}

// Maps a 1-based terminal mouse cell to a normalized device coordinate (−1..1,
// +y up) plus the aspect the scene renders at — for ray-picking the board.
function pointerNdc(x: number, y: number): { ndcX: number; ndcY: number; aspect: number } {
  return pointerNdcInSceneViewport(x, y, activeSceneViewport(), SCENE_CELL_PIXEL_ASPECT);
}

function onKeyImpl(ev: KeyEvent): void {
  // ctrl+c is the guaranteed escape hatch: quit from ANY state, before any modal / gate /
  // type-to-talk screen can swallow it (in raw mode ctrl+c arrives as a keypress, not SIGINT).
  if (ev.ctrl && ev.name === 'c') {
    quit();
    return;
  }
  if (gatewaySignInResume) {
    if (ev.name === 'escape') {
      if (!gatewayAccountRecovery || !ui.handleKey(ev)) dismissGatewaySignInPrompt();
    }
    else ui.handleKey(ev);
    return;
  }
  // Trailer is an uninterrupted film surface. Its sole visible control is Menu;
  // suppress global display/shortcuts/quit actions until playback returns home.
  if (mode === 'trailer') {
    if (ev.name === 'escape' || ev.name === 'm') enterMenu();
    else ui.handleKey(ev);
    return;
  }
  if (failureNotice) {
    if (ev.name === 'escape') dismissFailureNotice();
    else ui.handleKey(ev);
    return;
  }
  if (failureResume) {
    if (ev.name === 'escape') keymap.handle(ev);
    else ui.handleKey(ev);
    return;
  }
  // Any key skips the boot splash straight to the live prism (the wrapper requests
  // a render, so the next tick falls through to the prism branch).
  if (splashing) {
    splashing = false;
    return;
  }
  if (prismToMenu.active()) return;
  // Space advances a poker countdown immediately; other keys retain their normal behavior.
  if (mode === 'poker' && pokerScene.awaitingContinue() && ev.name === 'space') {
    pokerScene.continueGesture();
    return;
  }
  // Prism loading screen: any key starts (→ menu), EXCEPT Escape, which falls through to the
  // keymap (global esc → quit) so esc stays a consistent "back one level" and prism is the
  // last level. (ctrl+c is already handled at the top of this function.)
  if (mode === 'prism' && !updateModalOpen) {
    if (ev.name !== 'escape') {
      startPrismToMenu();
      return;
    }
  }
  // While the startup update popup is up (over the prism), keys drive it instead of
  // advancing to the menu: non-escape keys fall to ui.handleKey (the popup's buttons),
  // and escape falls to the keymap's 'update' modal layer (dismiss).
  // Audio screen: type-to-talk. Printable keys + enter/backspace/tab feed the
  // prompt; everything else (escape → back, arrows → pan) falls to the keymap.
  if (mode === 'audio') {
    if (audioScene.handleKey(ev)) return;
    keymap.handle(ev);
    return;
  }
  // The tutorial's keyboard chapter ticks on the key itself, whatever it ends up doing.
  tutorial.signal(`key.${eventToChord(ev)}`);
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
  // A Gateway failure is a blocking modal: all pointer input belongs to its
  // action, close control, or scrim. Never let a click fall through to a board
  // move, poker action, or camera gesture while the failed turn is paused.
  if (gatewaySignInResume || failureNotice || failureResume) {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y, e.button);
    else if (e.type === 'drag') ui.drag(e.x, e.y);
    else if (e.type === 'wheel' && e.wheelAxis !== 'horizontal')
      ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
  // A click also skips the boot splash to the live prism.
  if (splashing && e.type === 'down') {
    splashing = false;
    return;
  }
  if (prismToMenu.active()) return;
  // The poker continue gate advances on Space only (see onKeyImpl); the mouse stays free
  // here to orbit/zoom/pan the scene while the banner and prompt are up.
  // Prism loading screen: a click starts (→ menu) — unless the startup update popup is up,
  // in which case clicks fall through to its buttons (the prism pointer routing below).
  if (mode === 'prism' && e.type === 'down' && !updateModalOpen) {
    startPrismToMenu();
    return;
  }
  // Cover Flow: the wheel steps selection; clicking the focused cover (its real
  // projected border) launches it, clicking off to a side steps that way, and
  // hovering the focused cover lights it up.
  if (mode === 'menu') {
    if (launching) {
      // A click during the flip-to-title splash skips it: jump the clock to the end so
      // the next frame's handoff (the render loop's LAUNCH_TOTAL check) opens the game
      // immediately. Non-click pointer input is still ignored while the splash plays.
      if (e.type === 'down') launchT = LAUNCH_TOTAL;
      return;
    }
    // Any hub popup freezes the carousel and owns pointer input.
    if (homeMenuOpen || teamModalOpen || shortcutsOpen || confirmQuitOpen) {
      if (e.type === 'move') ui.hover(e.x, e.y);
      else if (e.type === 'down') ui.pointerDown(e.x, e.y);
      else if (e.type === 'drag') ui.drag(e.x, e.y);
      else if (e.type === 'wheel' && e.wheelAxis !== 'horizontal')
        ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1);
      else if (e.type === 'up') ui.pointerUp();
      return;
    }
    const rect = coverflow.coverScreenRect(menuSel - coverPos, cols, rows);
    const mx = e.x - 1;
    const my = e.y - 1;
    const inside = mx >= rect.x && mx < rect.x + rect.w && my >= rect.y && my < rect.y + rect.h;
    if (e.type === 'move') {
      ui.hover(e.x, e.y); // light the menu pill when the cursor is over it
      menuHover = inside;
    } else if (e.type === 'wheel') {
      // Cover Flow follows the gesture's visual direction on either axis. Horizontal reports are
      // normalized for the lower event cadence most terminals produce from side-to-side swipes.
      menuWheelNav(e);
    } else if (e.type === 'down') {
      // A hit on the menu pill opens the popup; a miss falls through to carousel
      // navigation.
      if (ui.pointerDown(e.x, e.y)) return;
      if (inside) launchSelected();
      else if (mx < rect.x) menuNav(-1);
      else if (mx >= rect.x + rect.w) menuNav(1);
    } else if (e.type === 'up') {
      ui.pointerUp();
    }
    return;
  }
  if (mode === 'trailer') {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y, e.button);
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
  // Modal popups (promotion picker, game-over result, wisp model swap): clicks/hover go
  // to the popup; the board and camera are frozen until it's dismissed. The new-match
  // setup panels (chess AND poker) are NOT here — they're non-modal, so pointer input
  // falls through the orbit branch: UI hits go to the panel/pickers, misses rotate/zoom/
  // pan the board/table behind it.
  if (isPromoting() || gameOver || wispSwap || islanders.hasPieceEdit()) {
    if (e.type === 'move') ui.hover(e.x, e.y);
    else if (e.type === 'down') ui.pointerDown(e.x, e.y);
    else if (e.type === 'drag') ui.drag(e.x, e.y); // e.g. dragging a dropdown's scrollbar
    else if (e.type === 'wheel' && e.wheelAxis !== 'horizontal')
      ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1); // scroll an open dropdown
    else if (e.type === 'up') ui.pointerUp();
    return;
  }
  const orbit = activeOrbit();
  if (orbit) {
    if (e.type === 'wheel') {
      // Horizontal trackpad gestures are reserved for explicitly horizontal experiences such as
      // Cover Flow. They must not unexpectedly scroll a vertical panel or zoom an orbit scene.
      if (e.wheelAxis === 'horizontal') return;
      // A wheel over a scrollable component (ScrollBox/Select/Slider) scrolls it;
      // otherwise it zooms the scene.
      if (ui.wheel(e.x, e.y, e.wheel === -1 ? -1 : 1)) return;
      orbit.zoomBy(e.wheel === -1 ? 0.9 : 1.1);
      tutorial.signal('camera.zoom');
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
      } else if (mode === 'islanders-tiles') {
        // Board mode: highlight the vertex/edge under the cursor.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        islanders.hoverAt(ndcX, ndcY);
      } else if (mode === 'islanders') {
        // Only the current prompt's legal spots highlight; everything else reads as water.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        islandersGameScene.hoverAt(ndcX, ndcY);
        if (islandersGameScene.needsRender()) r.requestRender();
      }
      return;
    }
    if (e.type === 'down') {
      // A hit on a UI node (bar button or component) fires its onClick / onMouse
      // and captures the pointer; a miss begins a camera drag (an up near here is
      // a click). The button goes along so an onMouse can tell left from right.
      if (!ui.pointerDown(e.x, e.y, e.button, { shift: e.shift, meta: e.meta, ctrl: e.ctrl })) {
        draggingCamera = true;
        if (mode === 'islanders-tiles') islanders.scene.setCameraInteracting(true);
        else if (mode === 'islanders') islandersGameScene.scene.setCameraInteracting(true);
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
        if (e.meta || e.shift || e.ctrl || e.button === 2) {
          orbit.pan(dx * POINTER_PAN_SCALE, dy * POINTER_PAN_SCALE);
          tutorial.signal('camera.pan');
        } else {
          orbit.orbit(dx, dy);
          tutorial.signal('camera.orbit');
        }
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
        // Click an AI wisp to switch its model; otherwise click one of your own
        // hole cards to lift it fully face-on.
        const { ndcX, ndcY, aspect } = pointerNdc(e.x, e.y);
        const seat = pokerScene.wispAt(ndcX, ndcY, aspect);
        if (seat !== null) openPokerWispSwap(seat);
        else pokerScene.clickCard(ndcX, ndcY, aspect);
      } else if (isClick && mode === 'islanders-tiles') {
        // Board mode: place a piece on an empty vertex/edge, or open the edit modal on a piece.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        islanders.clickAt(ndcX, ndcY);
      } else if (isClick && mode === 'islanders') {
        // A click on a highlighted spot commits the awaiting human placement; anything else
        // is ignored, since the gate already excluded every illegal target.
        const { ndcX, ndcY } = pointerNdc(e.x, e.y);
        islandersGameScene.clickAt(ndcX, ndcY);
      }
      draggingCamera = false;
      if (mode === 'islanders-tiles') islanders.scene.setCameraInteracting(false);
      else if (mode === 'islanders') islandersGameScene.scene.setCameraInteracting(false);
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

function tick(dt: number, now = performance.now()): void {
  // Prepared pixel output may be reused by multiple compositor phases within this tick, never
  // across rendered frames whose source target may have changed.
  pixelDisplayPrepared = false;
  const step = Math.min(dt, MAX_STEP); // real seconds since the last rendered frame, clamped
  t += step;
  ui.setTime(t);
  // Before the mode dispatch, so the detectors read game state that settled last frame.
  if (tutorial.active()) tutorialPoll();
  ensureSceneTarget();

  if (splashing) {
    // Boot splash: no button bar (the ui root is unmounted until syncBar runs, so
    // frameComposited paints scene-only). When it finishes, fall through to the
    // live prism in this same frame — the differ swaps in the bar with no clear,
    // so there's no black flash and the handoff is seamless.
    if (!splash.done(t)) {
      splash.renderScene(target, t);
      writeFrame(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene());
      return;
    }
    splashing = false;
  }

  if (mode === 'prism') {
    // Prism loading screen: live prism + a breathing "press any key" prompt, no bar —
    // except the startup update popup, which syncBar mounts as an overlay over the prism.
    if (updateModalOpen) syncBar();
    prism.renderScene(target, t);
    if (prismToMenu.active()) {
      // The wipe reveals the slot the menu will land on (the Tutorial, on a first launch).
      const source = sceneSurface((surface) => drawPrismPrompt(surface, cols, rows, t));
      coverflow.renderScene(target, initialMenuSel(), null);
      const destination = sceneSurface((surface) => drawCoverChrome(surface, cols, rows, initialMenuSel()));
      const complete = prismToMenu.step(step);
      const composed = prismToMenu.compose(source, destination);
      writeFrame(ui.frameComposited((surface) => composed.copyInto(surface)));
      if (complete) {
        prismToMenu.cancel();
        enterMenu(false);
      }
      return;
    }
    writeFrame(
      UNIFIED
        ? ui.frameComposited((s) => {
            presentSceneInto(s);
            drawPrismPrompt(s, cols, rows, t);
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
      writeFrame(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene());
      if (launchT >= LAUNCH_TOTAL) {
        launching = false;
        enterGame(MENU_ITEMS[coverFlowIndex(launchSel, MENU_ITEMS.length)].id);
      }
      return;
    }
    // Cover Flow hub: ease the carousel toward the selected slot (snap-to-slot),
    // render the 3D covers full-screen, then draw the title + hint chrome on top.
    // syncBar builds the menu pill or whichever hub popup is active;
    // frameComposited paints it above the chrome.
    coverPos += (menuSel - coverPos) * (1 - Math.exp(-MENU_EASE_RATE * step));
    if (Math.abs(menuSel - coverPos) < 0.0015) coverPos = menuSel;
    coverflow.renderScene(target, coverPos, menuHover ? menuSel : null);
    syncBar();
    writeFrame(
      UNIFIED
        ? ui.frameComposited((s) => {
            presentSceneInto(s);
            drawCoverChrome(s, cols, rows, menuSel);
          })
        : presentScene() + ui.frame(),
    );
    return;
  }

  if (mode === 'trailer') {
    const trailer = currentTrailerScene();
    trailer.seek((now - trailerStartedAt) / 1000);
    syncBar();
    const frame = trailer.frame(cols, rows);
    writeFrame(ui.frameComposited((surface) => frame.copyInto(surface)));
    if (trailer.done()) enterMenu();
    return;
  }

  if (mode === 'logos') {
    logosScene.renderScene(target, t);
    syncBar();
    writeFrame(UNIFIED ? ui.frameComposited((s) => presentSceneInto(s)) : presentScene() + ui.frame());
    return;
  }

  if (mode === 'audio') {
    // Live wisp + the conversation overlay (drawn over the composited frame, like
    // the menu). The bar composites on top via syncBar's root.
    audioScene.renderScene(target, t);
    syncBar();
    writeFrame(
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
    const sceneDirty = forceFrame || chessGame.needsRender();
    if (sceneDirty) chessGame.renderScene(target);
    if (UNIFIED) writeFrame(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
    else writeFrame(presentScene(false, true) + ui.frame());
    forceFrame = false;
    if (chessGame.needsRender()) r.requestRender(); // keep animating while the camera settles
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
      if (sceneDirty || ui.dirty()) writeFrame(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
    } else if (sceneDirty) {
      writeFrame(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      writeFrame(ui.frame());
    }
    forceFrame = false;
    if (cardsScene.needsRender()) r.requestRender();
    return;
  }

  if (mode === 'islanders-tiles') {
    // The tile test bed: static + on-demand like the chess turntable — renders only when the
    // camera moves or the tile changes, then the loop idles.
    syncBar();
    const sceneDirty = forceFrame || islanders.needsRender();
    if (sceneDirty) islanders.renderScene(target, t);
    // Hybrid shading off for the board: it replaces the shape matcher's "empty cell" verdict with
    // a luminance-ramp glyph, which speckles the space around the island with faint dots. Islanders
    // wants that space plain black so the board and the rail both have a clean edge against it.
    if (UNIFIED) {
      if (sceneDirty || ui.dirty()) {
        writeFrame(
          ui.frameComposited(
            (s) => presentSceneInto(s, false, false),
            sceneDirty,
            islanders.scene.hasForegroundSceneLayer() ? (s) => presentSceneForegroundInto(s, false, false) : undefined,
          ),
        );
      }
    } else if (sceneDirty) {
      writeFrame(presentScene(false, false) + ui.frame());
    } else if (ui.dirty()) {
      writeFrame(ui.frame());
    }
    forceFrame = false;
    if (islanders.needsRender()) r.requestRender();
    return;
  }

  if (mode === 'islanders') {
    // The played board renders on the same on-demand terms as the test bed, and with the same
    // hybrid-shading choice — plain black around the island so the board and rail keep a clean
    // edge against it.
    syncBar();
    const sceneDirty = forceFrame || islandersGameScene.needsRender();
    if (sceneDirty) islandersGameScene.renderScene(target, t);
    if (UNIFIED) {
      if (sceneDirty || ui.dirty()) {
        writeFrame(
          ui.frameComposited(
            (s) => presentSceneInto(s, false, false),
            sceneDirty,
            islandersGameScene.scene.hasForegroundSceneLayer() ? (s) => presentSceneForegroundInto(s, false, false) : undefined,
          ),
        );
      }
    } else if (sceneDirty) {
      writeFrame(presentScene(false, false) + ui.frame());
    } else if (ui.dirty()) {
      writeFrame(ui.frame());
    }
    forceFrame = false;
    if (islandersGameScene.needsRender()) r.requestRender();
    return;
  }

  if (mode === 'poker') {
    // The poker table: an active session animates the wisps continuously (a held
    // live lease keeps frames flowing while the driver awaits the network); between
    // moves it's dirty-gated like the cards screen. Pot / per-seat state is drawn by
    // the TUI HUD overlay (poker-hud.ts), so the felt itself carries no labels.
    syncBar();
    const sceneDirty = forceFrame || pokerScene.needsRender();
    if (sceneDirty) pokerScene.renderScene(target, t);
    if (UNIFIED) {
      if (sceneDirty || ui.dirty()) {
        writeFrame(
          ui.frameComposited((s) => {
            presentSceneInto(s, false, true);
          }, sceneDirty),
        );
      }
    } else if (sceneDirty) {
      writeFrame(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      writeFrame(ui.frame());
    }
    forceFrame = false;
    if (pokerScene.needsRender()) r.requestRender();
    return;
  }

  const orbit = orbitScene();
  if (orbit) {
    // Dirty-flag gate: the chess turntables are static between interactions, so
    // skip the (expensive) re-render + full-screen write when nothing changed.
    syncBar();
    const sceneDirty = forceFrame || orbit.needsRender();
    if (sceneDirty) orbit.renderScene(target, t);
    if (UNIFIED) {
      // Composite scene + UI into one diffed buffer; skip when nothing changed.
      // Pass sceneDirty so a hover-only frame reuses the cached scene layer
      // instead of re-sampling the whole scene.
      if (sceneDirty || ui.dirty()) {
        writeFrame(ui.frameComposited((s) => presentSceneInto(s, false, true), sceneDirty));
      }
    } else if (sceneDirty) {
      writeFrame(presentScene(false, true) + ui.frame());
    } else if (ui.dirty()) {
      // Only a button hover/focus changed: repaint just the bar, not the scene.
      writeFrame(ui.frame());
    }
    forceFrame = false;
    // Render-on-demand: chess holds no live lease, so re-arm the next frame while
    // the scene is still animating (a move/camera settle).
    if (orbit.needsRender()) r.requestRender();
    return;
  }
}

function sceneSurface(overlay?: (surface: Surface) => void): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, [0, 0, 0]);
  if (renderMode === 'pixels') halfBlockToSurface(surface, downsample(target, supersampleForViewport(renderMode, cols, rows)));
  else shapeGlyphToSurface(surface, target, cols, rows, { color: true, hybrid: renderMode === 'hybrid', coloredBackground: renderMode === 'hybrid' });
  overlay?.(surface);
  return surface;
}

// The tutorial's font-size steps watch the cell grid, since the terminal keeps the ⌘−/⌘+
// chord to itself: a resize that adds cells is one "smaller" step, one that removes cells a
// "bigger" step. Some terminals report a couple of intermediate sizes per keypress, so
// events inside a short window fold into the step that began it.
const RESIZE_STEP_COALESCE_MS = 200;
let lastResizeAt = 0;
let lastResizeDirection = 0;
function signalResizeStep(before: number, after: number): void {
  if (!tutorial.active() || after === before) return;
  const direction = after > before ? 1 : -1;
  const now = Date.now();
  const sameStep = direction === lastResizeDirection && now - lastResizeAt < RESIZE_STEP_COALESCE_MS;
  lastResizeAt = now;
  lastResizeDirection = direction;
  if (!sameStep) tutorial.signal(direction > 0 ? 'terminal.denser' : 'terminal.coarser');
}

process.stdout.on('resize', () => {
  const cellsBefore = cols * rows;
  cols = process.stdout.columns ?? 80;
  rows = process.stdout.rows ?? 24;
  signalResizeStep(cellsBefore, cols * rows);
  const viewport = activeSceneViewport();
  const supersample = supersampleForViewport(renderMode, cols, rows);
  target = new RenderTarget(viewport.w * supersample, viewport.h * SCENE_CELL_PIXEL_ASPECT * supersample);
  ui.resize(cols, rows);
  if (gatewaySignInResume) refreshGatewaySignInOverlay();
  display = undefined;
  // The scene repaints every cell it owns each frame, but the reserved button
  // row does not, and the buttons re-center when the width changes — so without
  // a wipe the old (differently-positioned) bar lingers as ghosts. Clear once on
  // resize; the next tick repaints everything at the new geometry.
  fullRepaint();
});

// Resolve the AI Gateway key from the stored Vercel session (or device login +
// team pick), then launch. Inherited shell keys are deliberately ignored so an
// unrelated credential cannot silently change the billed team. The interactive
// flow runs BEFORE term.enter(); once resolved, model/voice calls read the
// process-local AI_GATEWAY_API_KEY minted for Arcade.
const argv = process.argv.slice(2);
// `--version` / `--help` run before any side effect (no auth, network, or alt-screen)
// and exit, so they stay fast and scriptable — the standard CLI convention.
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(packageInfo().version);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  const { name, version, description } = packageInfo();
  console.log(
    [
      `${name} ${version}`,
      description,
      '',
      'usage: arcade [options]',
      '       arcade telemetry [status|enable|disable]',
      '',
      'options:',
      '  --login          re-run the Vercel sign-in device flow',
      '  --switch-team    pick a different team for the AI Gateway key',
      '  --logout         sign out of Vercel',
      '  -v, --version    print the version and exit',
      '  -h, --help       print this help and exit',
    ].join('\n'),
  );
  process.exit(0);
}
if (argv.includes('--logout')) {
  const was = signOutVercel();
  console.log(was ? 'signed out of Vercel.' : 'not signed in.');
  process.exit(0);
}
// `arcade telemetry [status|enable|disable]` — mirrors `vercel telemetry …`. Runs before
// the OAuth/render setup and exits, so it's scriptable and never launches the UI.
if (argv[0] === 'telemetry') {
  const sub = argv[1];
  if (sub === 'enable' || sub === 'disable') {
    setTelemetryEnabled(sub === 'enable');
    console.log(`telemetry ${sub}d.`);
  } else if (sub === undefined || sub === 'status') {
    console.log(`telemetry is ${telemetryStatus()}.`);
  } else {
    console.log('usage: arcade telemetry [status|enable|disable]');
  }
  process.exit(0);
}
colorMode = await detectTerminalColorMode();
const colorStatus =
  colorMode === 'truecolor' ? 'truecolor detected.' : 'truecolor not detected. using 256-color.';
process.stdout.write(`\x1b[38;2;135;135;175m  \u2713 ${colorStatus}\x1b[0m\n`);

// Arm the modal (shown over the prism) and refresh the version cache for the next launch.
// The plain-text startup notice itself is printed below, after the auth/team line.
if (update) updateModalOpen = true;
refreshLatestInBackground();

const gatewayAuth = await ensureGatewayKey({
  forceLogin: argv.includes('--login'),
  forceTeamPick: argv.includes('--switch-team'),
});
await refreshTeamModelCatalog(gatewayAuth);

// Resolve the anonymous install id + (once) print the opt-out notice while still in
// plain text, then record the launch. Both are no-ops when telemetry is off (opt-out
// or a dev checkout without an endpoint override).
initTelemetry();
trackSessionStart({
  colorMode,
  authed: isLoggedIn(),
  cols: process.stdout.columns ?? 0,
  rows: process.stdout.rows ?? 0,
});

// External termination (terminal closed, `kill`) and uncaught crashes finalize through
// the same path, so an in-progress game is still recorded. ctrl+c arrives as a keypress
// in raw mode (handled by the quit button), not SIGINT.
process.once('SIGTERM', () => finalizeAndExit('user_stopped', 0));
process.once('SIGHUP', () => finalizeAndExit('user_stopped', 0));
process.once('uncaughtException', (err) => finalizeAndExit('process_exit_recovered', 1, err));
process.once('unhandledRejection', (err) => finalizeAndExit('process_exit_recovered', 1, err));

// Update notice (startup): the last boot line before the alt-screen — beneath the
// truecolor + AI Gateway lines. The modal over the prism is the more prominent surface.
if (update) process.stdout.write(`\n${updateNotice(update)}\n`);

term.enter();
process.stdin.on('data', parse);
r.onFrame(tick);
syncLive(); // prism starts live (continuously animating)
syncContext(); // activate prism's key bindings from boot (no transition yet)
r.start();
r.requestRender();
