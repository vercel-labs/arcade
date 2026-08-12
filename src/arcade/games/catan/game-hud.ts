// The Catan GAME hud. Two faces over the same board:
//
//   • before a game — the setup panel (mode / players / your color / a model per AI seat) with
//     a "start game" button in the bottom-left, the way poker opens.
//   • during one — the status line saying whose turn it is and what is being asked, plus the
//     card overlay. The overlay is `card-hud`'s, unchanged: it takes a `CatanCardsView`, so the
//     game feeds it a live adapter over `CatanState` where catan-test feeds it the workbench
//     seed. That is the whole difference between the two screens' card UI.
//
// SCOPE: initial placement. The status copy covers the two placement prompts and the
// phase-complete state; later phases get their own lines when they are wired.

import { Box, Button, type LayoutBox, type Node, type Screen, Text } from '../../../tui/index.ts';
import { UI_CHROME_BG, UI_CHROME_PILL } from '../../theme.ts';
import { buildCatanSetupPanel, catanSetupReady, mountCatanSetup } from '../../match/catan-setup-panel.ts';
import type { CatanDriver } from '../../match/catan-driver.ts';
import { CATAN_RAIL_W, buildCatanCardsOverlay, type CatanActionHistoryView, type CatanCardsPlayerView, type CatanCardsView, catanRailVisible, mountCatanCardsHud, toggleCatanSidebar } from './card-hud.ts';
import { CatanState } from '../../../rules/catan/catan.ts';
import { DEV_CARD_TYPES, type DevCardType, RESOURCES, type Resource, resourceIndex } from '../../../rules/catan/types.ts';
import { CATAN_STATUS, PLAYER_LOOK } from './palette.ts';
import { hudBottomRight, hudTopCenter, hudTopRight } from '../../shell/hud-chrome.ts';

const STATUS_FG = CATAN_STATUS.foreground;
const STATUS_MUTED = CATAN_STATUS.muted;

export function mountCatanGameHud(ui: Screen): void {
  mountCatanSetup(ui);
  mountCatanCardsHud(ui);
}

// ── CatanState → the card overlay's view ────────────────────────────────────────────────────
// A pure projection. `viewer` is the seat whose hand is shown — your seat when you are playing,
// seat 0 when spectating. Opponent rows carry only public information (hand SIZE, not contents),
// which is what CatanCardsPlayerView is shaped for.
function freq(state: CatanState, seat: number): Record<Resource, number> {
  const hand = state.handOf(seat);
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) out[r] = hand[resourceIndex(r)] ?? 0;
  return out;
}

function devTotal(state: CatanState, seat: number): number {
  return DEV_CARD_TYPES.reduce((sum, type) => sum + state.developmentCardCount(seat, type), 0);
}

function playerView(state: CatanState, driver: CatanDriver, seat: number): CatanCardsPlayerView {
  return {
    name: driver.labelOf(seat),
    color: driver.colorOf(seat),
    publicVp: state.victoryPoints(seat, false),
    resourceCards: RESOURCES.reduce((sum, r) => sum + (state.handOf(seat)[resourceIndex(r)] ?? 0), 0),
    developmentCards: devTotal(state, seat),
    knights: state.playedKnightCount(seat),
    longestRoad: state.roadLength(seat),
    active: state.currentPlayer() === seat,
  };
}

export function catanLiveView(state: CatanState, driver: CatanDriver): CatanCardsView {
  const viewer = driver.humanSeat() >= 0 ? driver.humanSeat() : 0;
  const bank = {} as Record<Resource, number>;
  for (const r of RESOURCES) bank[r] = state.bankDeck()[resourceIndex(r)] ?? 0;
  const opponents: CatanCardsPlayerView[] = [];
  for (let seat = 0; seat < driver.seatCount(); seat++) {
    if (seat !== viewer) opponents.push(playerView(state, driver, seat));
  }
  const history: CatanActionHistoryView[] = driver.history().map((entry) => ({
    actor: entry.actor,
    color: entry.color,
    message: entry.message,
  }));
  // Only the viewer's own dev cards are broken out by type; every other seat contributes a
  // count through playerView, which is all an opponent may legitimately see.
  const devHand = {} as Record<DevCardType, number>;
  for (const type of DEV_CARD_TYPES) devHand[type] = state.developmentCardCount(viewer, type);
  return {
    localPlayer: playerView(state, driver, viewer),
    hand: freq(state, viewer),
    devHand,
    bank,
    developmentDeck: state.developmentDeckSize(),
    opponents,
    history,
  };
}

// ── status ──────────────────────────────────────────────────────────────────────────────────
// One loud line: whose turn it is and what they are being asked for. The doc's Part II calls
// this out as the thing digital Catan gets wrong most often, so it is a first-class element
// rather than a note in a corner.
export function catanStatusLine(driver: CatanDriver): { text: string; color: [number, number, number]; hint: string } | null {
  const state = driver.state();
  if (!state) return null;
  if (driver.error()) return { text: 'the game stopped', color: STATUS_FG, hint: driver.error() ?? '' };
  if (driver.isComplete()) {
    return { text: 'setup complete', color: STATUS_FG, hint: 'every seat has both settlements and roads — the turn phase is not wired yet' };
  }
  const prompt = state.currentPrompt();
  const seat = prompt.player;
  const yours = seat === driver.humanSeat();
  const round = state.initialSettlementCount(seat) === 0 ? 'first' : 'second';
  const what =
    prompt.kind === 'initialSettlement'
      ? `place your ${round} settlement`
      : prompt.kind === 'initialRoad'
        ? 'place a road beside it'
        : prompt.kind === 'moveRobber'
          ? 'moving robber'
        : 'take a turn';
  return {
    text: yours ? (prompt.kind === 'moveRobber' ? what : `your turn — ${what}`) : prompt.kind === 'moveRobber' ? `${driver.labelOf(seat)} is moving the robber…` : `${driver.labelOf(seat)} is placing…`,
    color: PLAYER_LOOK[driver.colorOf(seat)],
    hint: yours ? (prompt.kind === 'moveRobber' ? 'choose a different tile' : 'click a highlighted spot on the board') : '',
  };
}

// The status pill, centred along the top of the board so it reads before the eye reaches the
// rail. Nothing is drawn before a game starts — the setup panel is the whole screen then.
function statusPanel(driver: CatanDriver, region: LayoutBox): Node[] {
  const status = catanStatusLine(driver);
  if (!status) return [];
  const rail = catanRailVisible(region.w, region.h) ? CATAN_RAIL_W : 0;
  return [
    hudTopCenter(
      Box({ flexDirection: 'column', alignItems: 'center', padding: [0, 2], background: UI_CHROME_BG }, [
        Text({ text: status.text, style: { color: status.color, bold: true } }),
        ...(status.hint ? [Text({ text: status.hint, style: { color: STATUS_MUTED } })] : []),
      ]), region.w, { railWidth: rail }),
  ];
}

export interface CatanGameHudDeps {
  driver: CatanDriver;
  onOpenMenu: () => void;
  onStart: () => void;
  onNewGame: () => void;
}

// The whole game overlay for one frame.
export function buildCatanGameRoot(region: LayoutBox, deps: CatanGameHudDeps): Node {
  const { driver } = deps;
  const state = driver.state();
  const playing = state !== null;
  const rail = catanRailVisible(region.w, region.h) ? CATAN_RAIL_W : 0;

  const chrome: Node[] = [
    hudTopRight([
      Button({ id: 'catan-game-menu', label: '☰ menu', onClick: deps.onOpenMenu, style: UI_CHROME_PILL }),
    ], { railWidth: rail }),
  ];

  if (!playing) {
    return Box({ width: region.w, height: region.h }, [
      Box({ position: 'absolute', top: 1, left: 2 }, [buildCatanSetupPanel()]),
      ...chrome,
      Box({ position: 'absolute', left: 2, bottom: 1 }, [
        Button({
          id: 'catan-start',
          label: catanSetupReady() ? 'start game' : 'pick a model…',
          onClick: catanSetupReady() ? deps.onStart : () => {},
          style: UI_CHROME_PILL,
        }),
      ]),
    ]);
  }

  return Box({ width: region.w, height: region.h }, [
    buildCatanCardsOverlay(region, toggleCatanSidebar, catanLiveView(state, deps.driver)),
    ...statusPanel(driver, region),
    ...chrome,
    hudBottomRight(Button({ id: 'catan-new-game', label: 'new game', onClick: deps.onNewGame, style: UI_CHROME_PILL }), { railWidth: rail }),
  ]);
}
