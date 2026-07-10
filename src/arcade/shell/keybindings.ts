// The arcade's command catalog + layered keymap, extracted from main.ts. Each
// action is registered once with a stable id; keys are bound to ids per context
// (mode). The id catalog (`keymap.commands()`) is also the surface an AI agent
// will drive the app through — a human key and an agent command id hit the same
// `run`. main.ts owns the handlers and the live keymap (it still drives setBase /
// handle / push-pop modal contexts); this module just builds it once at startup.
import { Keymap } from '../../tui/index.ts';
import type { RenderMode } from './bars.ts';

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
  accountSwitchTeam(): void;
  accountSignOut(): void;
  openTeamSwitch(): void;
  closeTeamSwitch(): void;
  cycleMode(): void;
  setRenderMode(m: RenderMode): void;
  toggleJitter(): void;
  enterMenu(): void;
  toPrism(): void;
  menuNav(step: number): void;
  launchSelected(): void;
  enterAudio(): void;
  audioCycleModel(): void;
  enterChess(): void;
  enterChessGame(): void;
  enterUi(): void;
  activeOrbit(): OrbitLike | null;
  cancelPromotion(): void;
  aiButton(): void;
  toggleHistory(): void;
  toggleChat(): void;
  resetGame(): void;
  toggleIllegal(): void;
  toggleEvalBar(): void;
  closeGameOver(): void;
  closeMatchSetup(): void;
  cancelWispSwap(): void;
  pokerButton(): void;
  closePokerSetup(): void;
  closePokerMenu(): void;
  closePokerNotes(): void;
  closeChessMenu(): void;
}

// Cells-equivalent the arrow keys pan the chess camera per press (held keys
// repeat). Tuned to feel like a firm nudge; pan() scales it by distance.
const PAN_STEP = 10;

// Build the command surface + per-mode key bindings and return the keymap.
export function installKeymap(h: KeyHandlers): Keymap {
  const keymap = new Keymap();
  for (const c of [
    { id: 'app.quit', title: 'Quit', run: h.quit },
    { id: 'app.switchTeam', title: 'Switch Vercel team', run: h.accountSwitchTeam },
    { id: 'app.signOut', title: 'Sign out of Vercel', run: h.accountSignOut },
    { id: 'menu.teamSwitch', title: 'Switch Vercel team', run: h.openTeamSwitch },
    { id: 'menu.closeTeamSwitch', title: 'Close team switcher', run: h.closeTeamSwitch },
    { id: 'view.cycleRenderMode', title: 'Cycle render style', run: h.cycleMode },
    { id: 'view.setColor', title: 'Render: color', run: () => h.setRenderMode('color') },
    { id: 'view.setLuminance', title: 'Render: luminance', run: () => h.setRenderMode('luminance') },
    { id: 'view.setAscii', title: 'Render: ascii', run: () => h.setRenderMode('ascii') },
    { id: 'view.toggleJitter', title: 'Toggle glyph jitter', run: h.toggleJitter },
    { id: 'nav.back', title: 'Back to menu', run: h.enterMenu },
    { id: 'nav.toPrism', title: 'Back to prism', run: h.toPrism },
    { id: 'nav.menu', title: 'Open menu', run: h.enterMenu },
    { id: 'menu.left', title: 'Menu: previous', run: () => h.menuNav(-1) },
    { id: 'menu.right', title: 'Menu: next', run: () => h.menuNav(1) },
    { id: 'menu.select', title: 'Menu: launch selected', run: h.launchSelected },
    { id: 'nav.audio', title: 'Open audio', run: h.enterAudio },
    { id: 'audio.nextModel', title: 'Audio: next model', run: h.audioCycleModel },
    { id: 'nav.chess', title: 'Open chess showcase', run: h.enterChess },
    { id: 'nav.chessGame', title: 'Open chess game', run: h.enterChessGame },
    { id: 'nav.ui', title: 'Open UI playground', run: h.enterUi },
    { id: 'chess.resetView', title: 'Reset camera', run: () => h.activeOrbit()?.resetView() },
    { id: 'chess.panLeft', title: 'Pan left', run: () => h.activeOrbit()?.pan(PAN_STEP, 0) },
    { id: 'chess.panRight', title: 'Pan right', run: () => h.activeOrbit()?.pan(-PAN_STEP, 0) },
    { id: 'chess.panUp', title: 'Pan up', run: () => h.activeOrbit()?.pan(0, PAN_STEP) },
    { id: 'chess.panDown', title: 'Pan down', run: () => h.activeOrbit()?.pan(0, -PAN_STEP) },
    { id: 'chess.cancelPromotion', title: 'Cancel promotion', run: h.cancelPromotion },
    { id: 'chess.toggleAI', title: 'Play / pause AI', run: h.aiButton },
    { id: 'chess.toggleHistory', title: 'Toggle move history', run: h.toggleHistory },
    { id: 'chess.toggleChat', title: 'Toggle chat', run: h.toggleChat },
    { id: 'chess.resetGame', title: 'Reset game', run: h.resetGame },
    { id: 'chess.toggleIllegal', title: 'Toggle illegal moves', run: h.toggleIllegal },
    { id: 'chess.toggleEvalBar', title: 'Toggle eval bar', run: h.toggleEvalBar },
    { id: 'chess.closeGameOver', title: 'Close result', run: h.closeGameOver },
    { id: 'chess.cancelSetup', title: 'Cancel match setup', run: h.closeMatchSetup },
    { id: 'chess.cancelSwap', title: 'Cancel model swap', run: h.cancelWispSwap },
    { id: 'poker.toggleAI', title: 'Poker: play / pause', run: h.pokerButton },
    { id: 'poker.cancelSetup', title: 'Cancel poker setup', run: h.closePokerSetup },
    { id: 'poker.closeMenu', title: 'Close poker menu', run: h.closePokerMenu },
    { id: 'poker.closeNotes', title: 'Close poker notes', run: h.closePokerNotes },
    { id: 'chess.closeMenu', title: 'Close chess menu', run: h.closeChessMenu },
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
    { key: 's', cmd: 'app.switchTeam' }, // sign in / switch billing team
  ]) {
    keymap.bind('global', b);
  }
  keymap.bind('chess', { key: 'p', cmd: 'chess.toggleAI' });
  keymap.bind('chess', { key: 'h', cmd: 'chess.toggleHistory' });
  keymap.bind('chess', { key: 't', cmd: 'chess.toggleChat' });
  keymap.bind('chess', { key: 'n', cmd: 'chess.resetGame' });
  keymap.bind('chess', { key: 'i', cmd: 'chess.toggleIllegal' });
  keymap.bind('chess', { key: 'e', cmd: 'chess.toggleEvalBar' });
  // Poker: play/pause. Betting is via the on-screen controls (Tab to a Fold/Call/Raise
  // button or the bet slider, then Enter/←→), so no letter keys are bound for it (they'd
  // clash with the global render-mode letters). Home/restart/mode/quit live in the ☰ menu.
  keymap.bind('poker', { key: 'p', cmd: 'poker.toggleAI' });
  // Menu hub: arrows move, Enter/Space launch, Escape returns to the prism loading
  // screen. Escape here shadows the global Escape→quit because the 'menu' base layer
  // is searched before 'global'.
  for (const b of [
    { key: 'left', cmd: 'menu.left' },
    { key: 'right', cmd: 'menu.right' },
    { key: 'enter', cmd: 'menu.select' },
    { key: 'space', cmd: 'menu.select' },
    { key: 'escape', cmd: 'nav.toPrism' },
    { key: 's', cmd: 'menu.teamSwitch' }, // shadow global 's': open the in-screen modal team picker
    { key: 'o', cmd: 'app.signOut' }, // account home: sign out (switch-team is global 's')
  ]) {
    keymap.bind('menu', b);
  }
  for (const layer of ['logos', 'chess', 'ui', 'cards', 'poker']) keymap.bind(layer, { key: 'b', cmd: 'nav.back' });
  // Orbit/pan/reset bindings are shared by the chess turntables, the logos wisp
  // orbit, and the chess backdrop behind the UI playground (the commands resolve
  // the active scene via activeOrbit()). In 'ui', a focused component consumes
  // arrows first (Screen.handleKey runs before the keymap), so these pan only when
  // the scene — not a widget — has focus.
  for (const layer of ['chess', 'logos', 'ui', 'cards', 'poker']) {
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
  // Audio screen: type-to-talk owns letters (handled before the keymap), so only the
  // non-text keys are bound here — Escape returns to the menu and the arrows pan the
  // wisp camera. ('r'/reset stays on the bar button so it can still be typed.)
  keymap.bind('audio', { key: 'escape', cmd: 'nav.back' });
  for (const b of [
    { key: 'left', cmd: 'chess.panLeft' },
    { key: 'right', cmd: 'chess.panRight' },
    { key: 'up', cmd: 'chess.panUp' },
    { key: 'down', cmd: 'chess.panDown' },
  ]) {
    keymap.bind('audio', b);
  }
  // Promotion picker is modal: Escape cancels; the modal layer (pushed in syncBar)
  // swallows every other stray key so 'q' can't quit mid-choice.
  keymap.bind('promoting', { key: 'escape', cmd: 'chess.cancelPromotion' });
  // Game-over popup is modal too: Escape closes it (and the layer shadows 'q' etc.).
  keymap.bind('gameover', { key: 'escape', cmd: 'chess.closeGameOver' });
  // Match-setup modal: Escape cancels; the layer shadows stray keys.
  keymap.bind('setup', { key: 'escape', cmd: 'chess.cancelSetup' });
  // In-match model-swap popup: Escape cancels (same modal treatment as setup).
  keymap.bind('swap', { key: 'escape', cmd: 'chess.cancelSwap' });
  // Menu team-switch modal: Escape closes it; the modal layer shadows stray keys.
  keymap.bind('teamswitch', { key: 'escape', cmd: 'menu.closeTeamSwitch' });
  // Poker new-match panel (non-modal): Escape closes it; every other key falls
  // through to the poker layer (camera pans, 'p' to start, 'b' back).
  keymap.bind('poker-setup', { key: 'escape', cmd: 'poker.cancelSetup' });
  // Poker in-game menu popup: Escape closes it; the layer shadows stray keys.
  keymap.bind('poker-menu', { key: 'escape', cmd: 'poker.closeMenu' });
  keymap.bind('poker-notes', { key: 'escape', cmd: 'poker.closeNotes' });
  // Chess in-game menu popup: Escape closes it; the layer shadows stray keys.
  keymap.bind('chess-menu', { key: 'escape', cmd: 'chess.closeMenu' });
  return keymap;
}
