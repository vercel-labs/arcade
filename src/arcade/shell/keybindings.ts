// The arcade's command catalog + layered keymap, extracted from main.ts. Each
// action is registered once with a stable id; keys are bound to ids per context
// (mode). The id catalog (`keymap.commands()`) is also the surface an AI agent
// will drive the app through — a human key and an agent command id hit the same
// `run`. main.ts owns the handlers and the live keymap (it still drives setBase /
// handle / push-pop modal contexts); this module just builds it once at startup.
import { Keymap } from '../../tui/index.ts';

// The camera-controllable scene for the active mode (chess turntables, logos wisp
// orbit, audio wisp). Structural — keeps this module from importing the scenes.
interface OrbitLike {
  pan(dx: number, dy: number): void;
  resetView(): void;
}

// The handlers main.ts wires in. Named to match main's functions so the call site
// is mostly shorthand. `run` closures below capture these.
export interface KeyHandlers {
  quit(): void;
  closeTeamSwitch(): void;
  cycleMode(): void;
  openHomeMenu(): void;
  closeHomeMenu(): void;
  enterMenu(): void;
  toPrism(): void;
  menuNav(step: number): void;
  launchSelected(): void;
  enterAudio(): void;
  audioCycleModel(): void;
  enterChessGame(): void;
  enterUi(): void;
  enterPoker(): void;
  enterCards(): void;
  activeOrbit(): OrbitLike | null;
  cancelPromotion(): void;
  aiButton(): void;
  toggleHistory(): void;
  toggleChat(): void;
  resetGame(): void;
  toggleEvalBar(): void;
  openChessMenu(): void;
  closeGameOver(): void;
  closeMatchSetup(): void;
  cancelWispSwap(): void;
  pokerButton(): void;
  togglePokerChat(): void;
  openPokerMenu(): void;
  pokerBetStep(dir: number): void;
  closePokerSetup(): void;
  closePokerMenu(): void;
  closePokerNotes(): void;
  closeChessMenu(): void;
  escBack(): void;
  closeConfirmHome(): void;
  openShortcuts(): void;
  closeShortcuts(): void;
  openConfirmQuit(): void;
  closeConfirmQuit(): void;
  closeUpdateModal(): void;
}

// Cells-equivalent the arrow keys pan the camera per press (held keys repeat) —
// shared by every orbit screen (chess, poker, logos, ui, cards, audio). A firm
// nudge; pan() scales it by distance and eases the camera to the new target, so a
// larger step pans faster while staying smooth.
const PAN_STEP = 16;

// Build the command surface + per-mode key bindings and return the keymap.
export function installKeymap(h: KeyHandlers): Keymap {
  const keymap = new Keymap();
  for (const c of [
    { id: 'app.quit', title: 'Quit', run: h.quit },
    { id: 'menu.closeTeamSwitch', title: 'Close team switcher', run: h.closeTeamSwitch },
    { id: 'menu.openMenu', title: 'Open menu', run: h.openHomeMenu },
    { id: 'menu.closeMenu', title: 'Close menu', run: h.closeHomeMenu },
    // Render style changes via the bar / menu "display" setting or the global 'd' shortcut.
    // ASCII remains the default; each trigger advances through ascii → pixels → hybrid.
    { id: 'view.cycleRenderMode', title: 'Cycle display style', run: h.cycleMode },
    { id: 'nav.back', title: 'Back to menu', run: h.enterMenu },
    { id: 'nav.toPrism', title: 'Back to prism', run: h.toPrism },
    { id: 'nav.escBack', title: 'Back', run: h.escBack },
    { id: 'nav.confirmHomeCancel', title: 'Stay in game', run: h.closeConfirmHome },
    { id: 'app.shortcuts', title: 'Show controls', run: h.openShortcuts },
    { id: 'app.closeShortcuts', title: 'Close controls', run: h.closeShortcuts },
    { id: 'app.confirmQuit', title: 'Quit', run: h.openConfirmQuit },
    { id: 'app.closeConfirmQuit', title: 'Keep playing', run: h.closeConfirmQuit },
    { id: 'app.closeUpdateModal', title: 'Dismiss update notice', run: h.closeUpdateModal },
    { id: 'menu.left', title: 'previous', run: () => h.menuNav(-1) },
    { id: 'menu.right', title: 'next', run: () => h.menuNav(1) },
    { id: 'menu.select', title: 'launch selected', run: h.launchSelected },
    { id: 'nav.audio', title: 'Open audio', run: h.enterAudio },
    { id: 'audio.nextModel', title: 'Audio: next model', run: h.audioCycleModel },
    { id: 'nav.chessGame', title: 'Open chess game', run: h.enterChessGame },
    { id: 'nav.ui', title: 'Open UI playground', run: h.enterUi },
    { id: 'nav.poker', title: 'Open poker', run: h.enterPoker }, // agent-only (no user key)
    { id: 'nav.cards', title: 'Open cards (poker-test)', run: h.enterCards }, // agent-only (no user key)
    { id: 'camera.resetView', title: 'Reset camera', run: () => h.activeOrbit()?.resetView() },
    { id: 'camera.panLeft', title: 'Pan left', run: () => h.activeOrbit()?.pan(PAN_STEP, 0) },
    { id: 'camera.panRight', title: 'Pan right', run: () => h.activeOrbit()?.pan(-PAN_STEP, 0) },
    { id: 'camera.panUp', title: 'Pan up', run: () => h.activeOrbit()?.pan(0, PAN_STEP) },
    { id: 'camera.panDown', title: 'Pan down', run: () => h.activeOrbit()?.pan(0, -PAN_STEP) },
    { id: 'chess.cancelPromotion', title: 'Cancel promotion', run: h.cancelPromotion },
    { id: 'chess.toggleAI', title: 'Play / pause AI', run: h.aiButton },
    { id: 'chess.toggleHistory', title: 'Toggle move history', run: h.toggleHistory },
    { id: 'chess.toggleChat', title: 'Toggle chat', run: h.toggleChat },
    { id: 'chess.resetGame', title: 'Reset board', run: h.resetGame }, // menu / bar button only (no user key)
    { id: 'chess.toggleEvalBar', title: 'Toggle eval bar', run: h.toggleEvalBar },
    { id: 'chess.closeGameOver', title: 'Close result', run: h.closeGameOver },
    { id: 'chess.cancelSetup', title: 'Cancel match setup', run: h.closeMatchSetup },
    { id: 'chess.cancelSwap', title: 'Cancel model swap', run: h.cancelWispSwap },
    { id: 'poker.toggleAI', title: 'Poker: play / pause', run: h.pokerButton },
    { id: 'poker.betDown', title: 'Poker: lower the raise amount', run: () => h.pokerBetStep(-1) },
    { id: 'poker.betUp', title: 'Poker: raise the raise amount', run: () => h.pokerBetStep(1) },
    { id: 'poker.cancelSetup', title: 'Cancel poker setup', run: h.closePokerSetup },
    { id: 'poker.openMenu', title: 'Poker: open menu', run: h.openPokerMenu },
    { id: 'poker.toggleChat', title: 'Poker: toggle chat', run: h.togglePokerChat },
    { id: 'poker.closeMenu', title: 'Close poker menu', run: h.closePokerMenu },
    { id: 'poker.closeNotes', title: 'Close poker notes', run: h.closePokerNotes },
    { id: 'chess.openMenu', title: 'Open menu', run: h.openChessMenu },
    { id: 'chess.closeMenu', title: 'Close chess menu', run: h.closeChessMenu },
  ]) {
    keymap.register(c);
  }
  // Global: the always-available keys. `ctrl+c` is the instant quit hatch (caught in
  // onKeyImpl before the keymap, so it works even under a modal). `q` opens the quit-confirm
  // popup. `escape` = back one level — overridden per screen (see below), so it only reaches
  // this quit binding on the prism (the last level). `d` cycles display style everywhere the
  // normal keymap is active; `?` opens the shortcuts overlay.
  for (const b of [
    { key: 'q', cmd: 'app.confirmQuit' },
    { key: 'escape', cmd: 'app.quit' },
    { key: 'ctrl+c', cmd: 'app.quit' },
    { key: 'd', cmd: 'view.cycleRenderMode' },
    { key: '?', cmd: 'app.shortcuts' }, // show the shortcuts overlay for the current screen
  ]) {
    keymap.bind('global', b);
  }
  keymap.bind('chess', { key: 'p', cmd: 'chess.toggleAI' });
  keymap.bind('chess', { key: 'h', cmd: 'chess.toggleHistory' });
  keymap.bind('chess', { key: 'c', cmd: 'chess.toggleChat' }); // chat toggle (was 't')
  keymap.bind('chess', { key: 'e', cmd: 'chess.toggleEvalBar' });
  keymap.bind('chess', { key: 'm', cmd: 'chess.openMenu' }); // ☰ menu (chess-game only; no-op in the showcase)
  // Poker: play/pause ('p'), ☰ menu ('m'), toggle table-talk chat ('c'), plus −/+ to nudge the
  // raise amount by a big blind (hold to repeat via key autorepeat; the on-screen ± buttons and
  // the type-in amount field do the same). When the amount field is focused the −/+ are typed
  // instead (filtered to digits), so they only step when the felt (not the field) has focus.
  // Home / new game / display / quit live in the ☰ menu ('m').
  keymap.bind('poker', { key: 'p', cmd: 'poker.toggleAI' });
  keymap.bind('poker', { key: 'm', cmd: 'poker.openMenu' });
  keymap.bind('poker', { key: 'c', cmd: 'poker.toggleChat' });
  keymap.bind('poker', { key: '-', cmd: 'poker.betDown' });
  keymap.bind('poker', { key: '=', cmd: 'poker.betUp' }); // unshifted "+"
  keymap.bind('poker', { key: '+', cmd: 'poker.betUp' });
  // Menu hub: arrows move, Enter/Space launch, Escape returns to the prism loading
  // screen. Escape here shadows the global Escape→quit because the 'menu' base layer
  // is searched before 'global'.
  for (const b of [
    { key: 'left', cmd: 'menu.left' },
    { key: 'right', cmd: 'menu.right' },
    { key: 'enter', cmd: 'menu.select' },
    { key: 'space', cmd: 'menu.select' },
    { key: 'escape', cmd: 'nav.toPrism' },
    { key: 'm', cmd: 'menu.openMenu' },
  ]) {
    keymap.bind('menu', b);
  }
  // Orbit/pan/reset bindings are shared by the chess turntables, the logos wisp
  // orbit, and the chess backdrop behind the UI playground (the commands resolve
  // the active scene via activeOrbit()). In 'ui', a focused component consumes
  // arrows first (Screen.handleKey runs before the keymap), so these pan only when
  // the scene — not a widget — has focus.
  for (const layer of ['chess', 'logos', 'ui', 'cards', 'poker']) {
    for (const b of [
      { key: 'r', cmd: 'camera.resetView' },
      { key: 'left', cmd: 'camera.panLeft' },
      { key: 'right', cmd: 'camera.panRight' },
      { key: 'up', cmd: 'camera.panUp' },
      { key: 'down', cmd: 'camera.panDown' },
    ]) {
      keymap.bind(layer, b);
    }
  }
  // Escape = back one level on every non-menu screen. Games (chess-game / poker) open the
  // "return home?" confirm via escBack; other screens go straight to the menu. The menu's
  // own escape (→ prism) and each modal's escape (→ close) live in layers above these and
  // take precedence. (Prism's escape falls through to the global esc → quit.)
  for (const layer of ['chess', 'cards', 'logos', 'ui', 'poker', 'audio']) keymap.bind(layer, { key: 'escape', cmd: 'nav.escBack' });

  // Audio screen: type-to-talk owns letters (handled before the keymap), so only the
  // non-text keys are bound here — Escape returns to the menu and the arrows pan the
  // wisp camera. ('r'/reset stays on the bar button so it can still be typed.)
  for (const b of [
    { key: 'left', cmd: 'camera.panLeft' },
    { key: 'right', cmd: 'camera.panRight' },
    { key: 'up', cmd: 'camera.panUp' },
    { key: 'down', cmd: 'camera.panDown' },
  ]) {
    keymap.bind('audio', b);
  }
  // Promotion picker is modal: Escape cancels; the modal layer (pushed in syncBar)
  // swallows every other stray key so 'q' can't quit mid-choice.
  keymap.bind('promoting', { key: 'escape', cmd: 'chess.cancelPromotion' });
  // Game-over popup is modal too: Escape closes it (and the layer shadows 'q' etc.).
  keymap.bind('gameover', { key: 'escape', cmd: 'chess.closeGameOver' });
  // Match-setup panel: Escape cancels, and the arrow keys pan / 'r' resets the board behind
  // it — so you can frame the board while picking models, like the poker setup. It stays
  // modal for chess ACTION keys ('m'/'p'/'i'/'e'/'q'/…) so they can't fire over the setup;
  // only the camera controls are bound through. (up/down still scroll a focused dropdown
  // first — Screen.handleKey runs before the keymap — and pan only when nothing's focused.)
  keymap.bind('setup', { key: 'escape', cmd: 'chess.cancelSetup' });
  keymap.bind('setup', { key: 'left', cmd: 'camera.panLeft' });
  keymap.bind('setup', { key: 'right', cmd: 'camera.panRight' });
  keymap.bind('setup', { key: 'up', cmd: 'camera.panUp' });
  keymap.bind('setup', { key: 'down', cmd: 'camera.panDown' });
  keymap.bind('setup', { key: 'r', cmd: 'camera.resetView' });
  // In-match model-swap popup: Escape cancels (same modal treatment as setup).
  keymap.bind('swap', { key: 'escape', cmd: 'chess.cancelSwap' });
  // Menu team-switch modal: Escape closes it; the modal layer shadows stray keys.
  // Cover Flow home menu: Escape or m closes it; other keys stay modal.
  keymap.bind('home-menu', { key: 'escape', cmd: 'menu.closeMenu' });
  keymap.bind('home-menu', { key: 'm', cmd: 'menu.closeMenu' });
  keymap.bind('teamswitch', { key: 'escape', cmd: 'menu.closeTeamSwitch' });
  // Poker new-match panel (non-modal): Escape closes it; every other key falls
  // through to the poker layer (camera pans, 'p' to start, 'b' back).
  keymap.bind('poker-setup', { key: 'escape', cmd: 'poker.cancelSetup' });
  // Poker in-game menu popup: Escape closes it; the layer shadows stray keys.
  keymap.bind('poker-menu', { key: 'escape', cmd: 'poker.closeMenu' });
  keymap.bind('poker-menu', { key: 'm', cmd: 'poker.closeMenu' }); // 'm' toggles the menu shut
  keymap.bind('poker-notes', { key: 'escape', cmd: 'poker.closeNotes' });
  // Chess in-game menu popup: Escape closes it; the layer shadows stray keys.
  keymap.bind('chess-menu', { key: 'escape', cmd: 'chess.closeMenu' });
  keymap.bind('chess-menu', { key: 'm', cmd: 'chess.closeMenu' }); // 'm' toggles the menu shut
  // Return-to-home confirm popup (esc in a game): Escape cancels (stay in the game); the
  // modal layer shadows stray keys. Enter on the default-focused "Return home" confirms.
  keymap.bind('confirm-home', { key: 'escape', cmd: 'nav.confirmHomeCancel' });
  // Shortcuts overlay: Escape or '?' closes it (so '?' toggles); the modal layer shadows
  // stray keys. Its content is generated from keymap.activeBindings() for the screen beneath.
  keymap.bind('shortcuts', { key: 'escape', cmd: 'app.closeShortcuts' });
  keymap.bind('shortcuts', { key: '?', cmd: 'app.closeShortcuts' });
  // Quit-confirm popup (the 'q' key): Escape cancels (keep playing); the modal layer shadows
  // stray keys. Enter on the default-focused "quit" button quits; ctrl+c still hard-quits.
  keymap.bind('confirm-quit', { key: 'escape', cmd: 'app.closeConfirmQuit' });
  // Startup update popup: Escape dismisses ("not now"); the modal layer shadows stray keys.
  // Enter on the default-focused "quit to update" button quits so the user can upgrade.
  keymap.bind('update', { key: 'escape', cmd: 'app.closeUpdateModal' });
  // Display style is presentation-only, so it remains safe and useful while a popup is open —
  // including the controls popup where the binding is documented. Focused text components still
  // receive printable input before the keymap, preserving normal typing behavior.
  for (const layer of [
    'promoting',
    'gameover',
    'setup',
    'swap',
    'home-menu',
    'teamswitch',
    'poker-menu',
    'poker-notes',
    'chess-menu',
    'confirm-home',
    'shortcuts',
    'confirm-quit',
    'update',
  ]) {
    keymap.bind(layer, { key: 'd', cmd: 'view.cycleRenderMode' });
  }
  return keymap;
}
