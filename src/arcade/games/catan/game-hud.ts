// The Catan GAME hud. Two faces over the same board:
//
//   • before a game — the setup panel (mode / players / your color / a model per AI seat) with
//     a "start game" button in the bottom-left, the way poker opens.
//   • during one — the status line saying whose turn it is and what is being asked, plus the
//     card overlay. The overlay is `card-hud`'s, unchanged: it takes a `CatanCardsView`, so the
//     game feeds it a live adapter over `CatanState` where catan-test feeds it the workbench
//     seed. That is the whole difference between the two screens' card UI.
//
// The live action palette is derived from legal actions and covers setup, turns, interrupts,
// trades, development cards, and the terminal winner state.

import { Box, Button, type LayoutBox, type Node, type Screen, Text } from '../../../tui/index.ts';
import { UI_CHROME_BG, UI_CHROME_PILL } from '../../theme.ts';
import { buildCatanSetupPanel, catanSetupReady, mountCatanSetup } from '../../match/catan-setup-panel.ts';
import type { CatanDriver } from '../../match/catan-driver.ts';
import {
  CATAN_RAIL_W,
  buildCatanCardsOverlay,
  type CatanActionHistoryView,
  type CatanCardsPlayerView,
  type CatanCardsView,
  catanCardsLayout,
  catanRailVisible,
  mountCatanCardsHud,
  toggleCatanSidebar,
} from './card-hud.ts';
import { CatanState } from '../../../rules/catan/catan.ts';
import { DEV_CARD_TYPES, type CatanAction, type DevCardType, RESOURCES, type Resource, resourceIndex } from '../../../rules/catan/types.ts';
import { CATAN_STATUS, PLAYER_LOOK, RESOURCE_LOOK } from './palette.ts';
import { hudBottomRight, hudTopCenter, hudTopRight } from '../../shell/hud-chrome.ts';
import type { BoardToken, SailLabel } from './tile-scene.ts';
import { catanFlyingCardNodes, catanProjectedBoardLabels } from './tile-hud.ts';
import type { FlyingResource } from './scene/resource-flight.ts';
import type { CatanGameScene, CatanResourceViewAdjustments } from './game-scene.ts';

const STATUS_FG = CATAN_STATUS.foreground;
const STATUS_MUTED = CATAN_STATUS.muted;
const PLAYER_LEGEND_W = 30;

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
    hasLargestArmy: state.largestArmy() === seat,
    hasLongestRoad: state.longestRoad() === seat,
  };
}

export function catanLiveView(
  state: CatanState,
  driver: CatanDriver,
  adjustments?: CatanResourceViewAdjustments,
): CatanCardsView {
  const viewer = driver.humanSeat() >= 0 ? driver.humanSeat() : 0;
  const bank = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    bank[r] = (state.bankDeck()[resourceIndex(r)] ?? 0)
      + (adjustments?.bankPendingDeparture[r] ?? 0)
      - (adjustments?.bankPendingArrival?.[r] ?? 0);
  }
  const opponents: CatanCardsPlayerView[] = [];
  for (let seat = 0; seat < driver.seatCount(); seat++) {
    if (seat !== viewer) opponents.push(playerView(state, driver, seat));
  }
  const history: CatanActionHistoryView[] = driver.history().map((entry) => ({
    actor: entry.actor,
    color: entry.color,
    message: entry.message,
    chat: entry.chat,
  }));
  // Only the viewer's own dev cards are broken out by type; every other seat contributes a
  // count through playerView, which is all an opponent may legitimately see.
  const devHand = {} as Record<DevCardType, number>;
  for (const type of DEV_CARD_TYPES) {
    devHand[type] = Math.max(0, state.developmentCardCount(viewer, type) - (adjustments?.developmentHandPending?.[type] ?? 0));
  }
  const hand = freq(state, viewer);
  for (const resource of RESOURCES) {
    hand[resource] = Math.max(0, hand[resource]
      - (adjustments?.handPending[resource] ?? 0)
      + (adjustments?.handPendingDeparture?.[resource] ?? 0));
  }
  const localPlayer = playerView(state, driver, viewer);
  localPlayer.resourceCards = RESOURCES.reduce((sum, resource) => sum + hand[resource], 0);
  localPlayer.developmentCards = DEV_CARD_TYPES.reduce((sum, type) => sum + devHand[type], 0);
  const legalTypes = driver.humanSeat() === viewer && state.currentPlayer() === viewer
    ? new Set(state.legalActions().map((action) => action.type))
    : new Set<CatanAction['type']>();
  const playableDevelopmentCards = [
    ...(legalTypes.has('playKnight') ? ['knight' as const] : []),
    ...(legalTypes.has('playRoadBuilding') ? ['roadBuilding' as const] : []),
    ...(legalTypes.has('playYearOfPlenty') ? ['yearOfPlenty' as const] : []),
    ...(legalTypes.has('playMonopoly') ? ['monopoly' as const] : []),
  ];
  return {
    source: 'live',
    localPlayer,
    hand,
    devHand,
    bank,
    maritimeRates: state.maritimeTradeRates(viewer),
    maritimePortRates: state.maritimePortTradeRates(viewer),
    developmentDeck: state.developmentDeckSize() + (adjustments?.developmentDeckPendingDeparture ?? 0),
    pendingDevelopmentCards: adjustments?.pendingDevelopmentCards,
    playableDevelopmentCards,
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
    const winner = driver.winner();
    return { text: `${driver.labelOf(winner)} wins`, color: PLAYER_LOOK[driver.colorOf(winner)], hint: '10 victory points' };
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
        : prompt.kind === 'roll'
          ? 'roll or play a development card'
        : prompt.kind === 'discard'
          ? 'discard half your hand'
        : prompt.kind === 'moveRobber'
          ? 'move the robber'
        : prompt.kind === 'respondTrade'
          ? 'respond to a trade'
        : prompt.kind === 'decideAcceptees'
          ? 'choose a trade partner'
        : 'build, trade, play a card, or end';
  return {
    text: yours ? `your turn — ${what}` : `${driver.labelOf(seat)} — ${what}…`,
    color: PLAYER_LOOK[driver.colorOf(seat)],
    hint: yours
      ? prompt.kind === 'initialSettlement' || prompt.kind === 'initialRoad' || prompt.kind === 'moveRobber'
        ? 'click a highlighted spot on the board'
        : 'choose an action below'
      : '',
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

// The sidebar carries full public player state, but color identity has to remain readable when it
// is closed. Keep this deliberately minimal: one fixed Catan-color square and the seat's name in
// that same color. Model branding belongs nowhere in this compact mapping.
export function catanPlayerLegend(driver: CatanDriver, region: LayoutBox): Node {
  const width = Math.min(PLAYER_LEGEND_W, Math.max(1, region.w - 4));
  const textWidth = width;
  return Box({
    position: 'absolute',
    top: 1,
    left: 2,
    width,
    flexDirection: 'column',
    gap: 0,
  }, [
    Text({ text: 'players', style: { width: textWidth, color: STATUS_MUTED, bold: true } }),
    ...Array.from({ length: driver.seatCount() }, (_, seat) => Text({
      text: `■ ${driver.labelOf(seat)}`,
      style: {
        width: textWidth,
        color: PLAYER_LOOK[driver.colorOf(seat)],
        textOverflow: 'ellipsis',
      },
    })),
  ]);
}

export interface CatanGameHudDeps {
  driver: CatanDriver;
  scene: CatanGameScene;
  tokens?: readonly BoardToken[];
  sails?: readonly SailLabel[];
  resourceFlights?: readonly FlyingResource<Resource | DevCardType>[];
  resourceAdjustments?: CatanResourceViewAdjustments;
  onOpenMenu: () => void;
  onStart: () => void;
  onNewGame: () => void;
}

function liveActionButton(id: string, label: string, onClick: () => void, disabled = false): Node {
  return Button({
    id: `catan-live-${id}`,
    label,
    onClick,
    disabled,
    style: { ...UI_CHROME_PILL, padding: [0, 1] },
  });
}

function actionTypes(actions: readonly CatanAction[]): Set<CatanAction['type']> {
  return new Set(actions.map((action) => action.type));
}

function resourceButton(
  id: string,
  resource: Resource,
  suffix: string,
  onClick: () => void,
  disabled = false,
): Node {
  return liveActionButton(id, `${RESOURCE_LOOK[resource].emoji}${suffix}`, onClick, disabled);
}

function tradeDeckLabel(deck: readonly number[]): string {
  return RESOURCES
    .map((resource, index) => deck[index] ? `${deck[index]} ${RESOURCE_LOOK[resource].name}` : '')
    .filter(Boolean)
    .join(' + ');
}

function humanMenuPanel(scene: CatanGameScene, state: CatanState): Node[] | null {
  const kind = scene.humanMenuKind();
  if (!kind) return null;
  const legal = state.legalActions();
  const chosen = scene.humanMenuResources();
  const draft = scene.humanTradeDraft();
  const buttons: Node[] = [];
  if (kind === 'bankTrade' || kind === 'portTrade') {
    const via = kind === 'bankTrade' ? 'bank' : 'port';
    const give = draft.maritimeGive;
    if (!give) {
      const options = legal.filter((action): action is Extract<CatanAction, { type: 'maritimeTrade' }> => action.type === 'maritimeTrade' && action.via === via);
      const seen = new Set<string>();
      for (const option of options) {
        const rate = option.via === 'bank' ? 4 : option.rate;
        const key = `${option.give}:${rate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        buttons.push(resourceButton(`${via}-give-${option.give}-${rate}`, option.give, ` ${rate}:1`, () => scene.pickHumanMaritimeGive(option.give, option.via === 'port' ? option.rate : undefined)));
      }
    } else {
      for (const resource of RESOURCES) {
        const gets = [...chosen, resource];
        const action: CatanAction = via === 'bank'
          ? { type: 'maritimeBulkTrade', via: 'bank', give, gets }
          : { type: 'maritimeBulkTrade', via: 'port', rate: draft.maritimeRate ?? 3, give, gets };
        if (state.isLegalAction(action)) {
          const picked = chosen.filter((item) => item === resource).length;
          buttons.push(resourceButton(`${via}-get-${resource}`, resource, ` receive${picked ? ` ${picked}` : ''}`, () => scene.pickHumanMenuResource(resource)));
        }
      }
    }
  } else if (kind === 'monopoly') {
    for (const resource of RESOURCES) {
      buttons.push(resourceButton(`monopoly-${resource}`, resource, '', () => scene.pickHumanMenuResource(resource)));
    }
  } else if (kind === 'playerTrade' || kind === 'tradeCounter') {
    const hand = state.handOf(state.currentPlayer());
    buttons.push(Text({ text: 'offer', style: { color: STATUS_MUTED, bold: true } }));
    for (const resource of RESOURCES) {
      const count = draft.give[resourceIndex(resource)] ?? 0;
      buttons.push(resourceButton(`offer-${resource}`, resource, ` ${count}`, () => scene.pickHumanMenuResource(resource, 'give'), count >= (hand[resourceIndex(resource)] ?? 0)));
      if (count > 0) buttons.push(liveActionButton(`offer-${resource}-less`, '−', () => scene.adjustHumanTradeResource(resource, 'give', -1)));
    }
    buttons.push(Text({ text: 'ask', style: { color: STATUS_MUTED, bold: true } }));
    for (const resource of RESOURCES) {
      const count = draft.receive[resourceIndex(resource)] ?? 0;
      buttons.push(resourceButton(`ask-${resource}`, resource, ` ${count}`, () => scene.pickHumanMenuResource(resource, 'receive')));
      if (count > 0) buttons.push(liveActionButton(`ask-${resource}-less`, '−', () => scene.adjustHumanTradeResource(resource, 'receive', -1)));
    }
  } else {
    const hand = state.handOf(state.currentPlayer());
    for (const resource of RESOURCES) {
      const picked = chosen.filter((item) => item === resource).length;
      const unavailable = kind === 'discard' && picked >= (hand[resourceIndex(resource)] ?? 0);
      buttons.push(resourceButton(`${kind}-${resource}`, resource, picked ? ` ${picked}` : '', () => scene.pickHumanMenuResource(resource), unavailable));
    }
  }
  const controls: Node[] = [];
  if (kind === 'discard' || kind === 'yearOfPlenty' || kind === 'playerTrade' || kind === 'tradeCounter' || kind === 'bankTrade' || kind === 'portTrade') {
    const label = kind === 'playerTrade' ? 'offer trade' : kind === 'tradeCounter' ? 'counter' : 'confirm';
    controls.push(liveActionButton(`${kind}-confirm`, label, () => scene.submitHumanMenu(), !scene.humanMenuCanSubmit()));
  }
  if (kind !== 'tradeCounter') controls.push(liveActionButton(`${kind}-clear`, 'clear', () => scene.clearHumanMenuDraft()));
  if (kind !== 'discard') controls.push(liveActionButton(`${kind}-cancel`, kind === 'tradeCounter' ? 'close' : 'cancel', () => scene.cancelHumanChoice()));
  return [
    Text({
      text: kind === 'yearOfPlenty' ? 'year of plenty'
        : kind === 'playerTrade' ? 'player trade'
          : kind === 'tradeCounter' ? 'counter offer'
          : kind === 'bankTrade' ? 'bank 4:1'
            : kind === 'portTrade' ? 'port trade'
              : kind,
      style: { color: STATUS_FG, bold: true },
    }),
    ...buttons,
    ...controls,
  ];
}

function humanActionPanel(deps: CatanGameHudDeps, region: LayoutBox): Node | null {
  const { driver, scene } = deps;
  const state = driver.state();
  if (!state || !scene.awaitingHuman() || state.currentPlayer() !== driver.humanSeat()) return null;
  const layout = catanCardsLayout(region);
  const menu = humanMenuPanel(scene, state);
  const children: Node[] = menu ?? [];
  if (!menu) {
    const victimSeats = scene.robberVictimSeats();
    if (victimSeats.length) {
      children.push(Text({ text: 'steal from', style: { color: STATUS_FG, bold: true } }));
      for (const victim of victimSeats) {
        children.push(liveActionButton(`victim-${victim ?? 'none'}`, victim === null ? 'nobody' : driver.labelOf(victim), () => scene.chooseRobberVictim(victim)));
      }
    } else if (scene.boardChoiceType()) {
      const choice = scene.boardChoiceType();
      children.push(Text({
        text: choice === 'playRoadBuilding' ? 'place free road(s)' : choice === 'playKnight' ? 'choose robber tile' : `choose ${choice?.replace('build', '').toLowerCase()}`,
        style: { color: STATUS_FG, bold: true },
      }));
      children.push(liveActionButton('board-cancel', 'cancel', () => scene.cancelHumanChoice()));
    } else {
      const prompt = state.currentPrompt();
      const types = actionTypes(state.legalActions());
      const activeTrade = state.activeTrade();
      if (prompt.kind === 'roll') children.push(liveActionButton('roll', '⚄ roll', () => scene.submitHumanAction({ type: 'roll' })));
      if (prompt.kind === 'discard') children.push(liveActionButton('discard', 'choose discards', () => scene.beginHumanMenu('discard')));
      if (prompt.kind === 'moveRobber') children.push(Text({ text: 'choose a robber tile', style: { color: STATUS_FG, bold: true } }));
      if (prompt.kind === 'respondTrade') {
        if (activeTrade) children.push(Text({
          text: `${driver.labelOf(activeTrade.from)} offers ${tradeDeckLabel(activeTrade.give)} for ${tradeDeckLabel(activeTrade.receive)}`,
          style: { color: STATUS_FG },
        }));
        if (types.has('acceptTrade')) children.push(liveActionButton('accept-trade', 'accept', () => scene.submitHumanAction({ type: 'acceptTrade' })));
        if (state.legalActionFamilies().some((family) => family.type === 'counterTrade')) {
          children.push(liveActionButton('counter-trade', 'counter', () => scene.beginHumanMenu('tradeCounter')));
        }
        children.push(liveActionButton('reject-trade', 'reject', () => scene.submitHumanAction({ type: 'rejectTrade' })));
      }
      if (prompt.kind === 'decideAcceptees') {
        if (activeTrade) children.push(Text({
          text: `your offer: ${tradeDeckLabel(activeTrade.give)} for ${tradeDeckLabel(activeTrade.receive)}`,
          style: { color: STATUS_FG },
        }));
        for (const action of state.legalActions()) {
          if (action.type !== 'confirmTrade') continue;
          const counter = activeTrade?.counters.find((candidate) => candidate.from === action.with);
          if (counter) children.push(Text({
            text: `${driver.labelOf(action.with)} counters: ${tradeDeckLabel(counter.give)} for ${tradeDeckLabel(counter.receive)}`,
            style: { color: STATUS_FG },
          }));
          children.push(liveActionButton(
            `confirm-${action.with}`,
            counter ? `accept ${driver.labelOf(action.with)} counter` : `trade with ${driver.labelOf(action.with)}`,
            () => scene.submitHumanAction(action),
          ));
        }
        children.push(liveActionButton('cancel-trade', 'cancel trade', () => scene.submitHumanAction({ type: 'cancelTrade' })));
      }
      if (prompt.kind === 'playTurn') {
        if (types.has('buildRoad')) children.push(liveActionButton('road', 'road', () => scene.beginBoardChoice('buildRoad')));
        if (types.has('buildSettlement')) children.push(liveActionButton('settlement', 'settlement', () => scene.beginBoardChoice('buildSettlement')));
        if (types.has('buildCity')) children.push(liveActionButton('city', 'city', () => scene.beginBoardChoice('buildCity')));
        if (types.has('buyDevCard')) children.push(liveActionButton('buy-dev', '🃏 buy dev', () => scene.submitHumanAction({ type: 'buyDevCard' })));
        if (state.legalActions().some((action) => action.type === 'maritimeTrade' && action.via === 'port')) children.push(liveActionButton('port', '⛵ port', () => scene.beginHumanMenu('portTrade')));
        if (state.legalActions().some((action) => action.type === 'maritimeTrade' && action.via === 'bank')) children.push(liveActionButton('bank', '🏦 bank', () => scene.beginHumanMenu('bankTrade')));
        if (state.parameterizedActionExamples().some((action) => action.type === 'offerTrade')) children.push(liveActionButton('player-trade', '👥 trade', () => scene.beginHumanMenu('playerTrade')));
        children.push(liveActionButton('end', 'end turn', () => scene.submitHumanAction({ type: 'endTurn' })));
      }
      if (types.has('playKnight')) children.push(liveActionButton('knight', '♞ knight', () => scene.beginBoardChoice('playKnight')));
      if (types.has('playRoadBuilding')) children.push(liveActionButton('road-building', '🛣 road building', () => scene.beginBoardChoice('playRoadBuilding')));
      if (types.has('playYearOfPlenty')) children.push(liveActionButton('plenty', '🌾 year of plenty', () => scene.beginHumanMenu('yearOfPlenty')));
      if (types.has('playMonopoly')) children.push(liveActionButton('monopoly', 'monopoly', () => scene.beginHumanMenu('monopoly')));
    }
  }
  if (!children.length) return null;
  return Box({
    position: 'absolute',
    left: 2,
    bottom: layout.handHeight + 2,
    maxWidth: Math.max(1, region.w - (catanRailVisible(region.w, region.h) ? CATAN_RAIL_W : 0) - 4),
    minHeight: 1,
    gap: 1,
    padding: [0, 1],
    background: UI_CHROME_BG,
  }, children);
}

function beginLiveDevelopmentCard(scene: CatanGameScene, type: DevCardType): boolean {
  if (type === 'knight') return scene.beginBoardChoice('playKnight');
  if (type === 'roadBuilding') return scene.beginBoardChoice('playRoadBuilding');
  if (type === 'yearOfPlenty') return scene.beginHumanMenu('yearOfPlenty');
  if (type === 'monopoly') return scene.beginHumanMenu('monopoly');
  return false; // Victory-point cards are passive and never enter the playable set.
}

// The whole game overlay for one frame.
export function buildCatanGameRoot(region: LayoutBox, deps: CatanGameHudDeps): Node {
  const { driver } = deps;
  const state = driver.state();
  const playing = state !== null;
  const railVisible = catanRailVisible(region.w, region.h);
  const rail = railVisible ? CATAN_RAIL_W : 0;
  const canShowRail = catanCardsLayout(region).showPublicRail;

  const chrome: Node[] = [
    hudTopRight([
      Button({ id: 'catan-game-menu', label: '☰ menu', onClick: deps.onOpenMenu, style: UI_CHROME_PILL }),
      ...(playing && canShowRail && !railVisible
        ? [Button({ id: 'catan-game-sidebar-open', label: 'sidebar', onClick: toggleCatanSidebar, style: UI_CHROME_PILL })]
        : []),
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
    ...catanProjectedBoardLabels(deps.tokens ?? [], deps.sails ?? []),
    buildCatanCardsOverlay(
      region,
      toggleCatanSidebar,
      catanLiveView(state, deps.driver, deps.resourceAdjustments),
      () => {},
      undefined,
      undefined,
      (type) => beginLiveDevelopmentCard(deps.scene, type),
    ),
    ...([humanActionPanel(deps, region)].filter((node): node is Node => node !== null)),
    ...catanFlyingCardNodes(deps.resourceFlights ?? []),
    ...statusPanel(driver, region),
    catanPlayerLegend(driver, region),
    ...chrome,
    hudBottomRight(Button({ id: 'catan-new-game', label: 'new game', onClick: deps.onNewGame, style: UI_CHROME_PILL }), { railWidth: rail }),
  ]);
}
