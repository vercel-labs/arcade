// The Islanders GAME hud. Two faces over the same board:
//
//   • before a game — the setup panel (mode / players / your color / a model per AI seat) with
//     a rounded "new match" button in the bottom-left, matching poker and chess.
//   • during one — the status line saying whose turn it is and what is being asked, plus the
//     card overlay. The overlay is `card-hud`'s, unchanged: it takes a `IslandersCardsView`, so the
//     game feeds it a live adapter over `IslandersState` where islanders-test feeds it the workbench
//     seed. That is the whole difference between the two screens' card UI.
//
// The live action palette is derived from legal actions and covers setup, turns, interrupts,
// trades, development cards, and the terminal winner state.

import { Box, Button, type LayoutBox, type Node, type Screen, Text } from '../../../tui/index.ts';
import { MENU_BUTTON_LABEL, UI_CHROME_BG, UI_CHROME_PILL } from '../../theme.ts';
import { buildIslandersSetupPanel, islandersSetupReady, mountIslandersSetup } from '../../match/islanders-setup-panel.ts';
import type { IslandersDriver } from '../../match/islanders-driver.ts';
import {
  ISLANDERS_RAIL_W,
  buildIslandersCardsOverlay,
  type IslandersActionHistoryView,
  type IslandersCardsPlayerView,
  type IslandersCardsView,
  type IslandersDiscardEditorController,
  type IslandersHandActionController,
  type IslandersPlayerTradeOffersController,
  type IslandersTradeEditorController,
  islandersCardsLayout,
  islandersRailVisible,
  mountIslandersCardsHud,
  toggleIslandersSidebar,
} from './card-hud.ts';
import { IslandersState } from '../../../rules/islanders/islanders.ts';
import { DEV_CARD_TYPES, type IslandersAction, type DevCardType, RESOURCES, type Resource, resourceIndex } from '../../../rules/islanders/types.ts';
import { ISLANDERS_CARD, ISLANDERS_STATUS, PLAYER_LOOK, RESOURCE_LOOK } from './palette.ts';
import { hudTopCenter, hudTopRight } from '../../shell/hud-chrome.ts';
import type { BoardToken, SailLabel } from './tile-scene.ts';
import { islandersFlyingCardNodes, islandersProjectedBoardLabels } from './tile-hud.ts';
import type { FlyingResource } from './scene/resource-flight.ts';
import type { IslandersActionPreview, IslandersGameScene, IslandersResourceViewAdjustments } from './game-scene.ts';
import { buildIslandersChatComposer, configureIslandersChatComposer, mountIslandersChatComposer } from './chat-composer.ts';
import { matchSetupLayout, newMatchButton } from '../../match/match-setup-chrome.ts';

const STATUS_FG = ISLANDERS_STATUS.foreground;
const STATUS_MUTED = ISLANDERS_STATUS.muted;
const PLAYER_LEGEND_W = 30;

export function mountIslandersGameHud(ui: Screen): void {
  mountIslandersSetup(ui);
  mountIslandersCardsHud(ui);
  mountIslandersChatComposer(ui);
}

// ── IslandersState → the card overlay's view ────────────────────────────────────────────────────
// A pure projection. `viewer` is the seat whose hand is shown — your seat when you are playing,
// seat 0 when spectating. Opponent rows carry only public information (hand SIZE, not contents),
// which is what IslandersCardsPlayerView is shaped for.
function freq(state: IslandersState, seat: number): Record<Resource, number> {
  const hand = state.handOf(seat);
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) out[r] = hand[resourceIndex(r)] ?? 0;
  return out;
}

function devTotal(state: IslandersState, seat: number): number {
  return DEV_CARD_TYPES.reduce((sum, type) => sum + state.developmentCardCount(seat, type), 0);
}

function playerView(state: IslandersState, driver: IslandersDriver, seat: number, viewer?: number): IslandersCardsPlayerView {
  return {
    seat,
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
    viewing: viewer === seat,
  };
}

export function islandersLiveView(
  state: IslandersState,
  driver: IslandersDriver,
  adjustments?: IslandersResourceViewAdjustments,
  viewerSeat?: number,
): IslandersCardsView {
  const viewer = driver.humanSeat() >= 0 ? driver.humanSeat() : viewerSeat ?? 0;
  const bank = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    bank[r] = (state.bankDeck()[resourceIndex(r)] ?? 0)
      + (adjustments?.bankPendingDeparture[r] ?? 0)
      - (adjustments?.bankPendingArrival?.[r] ?? 0);
  }
  const opponents: IslandersCardsPlayerView[] = [];
  for (let seat = 0; seat < driver.seatCount(); seat++) {
    if (seat !== viewer) opponents.push(playerView(state, driver, seat, viewer));
  }
  const history: IslandersActionHistoryView[] = driver.history().map((entry) => ({
    actor: entry.actor,
    color: entry.color,
    message: entry.message,
    resourceCounts: entry.resourceCounts,
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
  const localPlayer = playerView(state, driver, viewer, viewer);
  localPlayer.resourceCards = RESOURCES.reduce((sum, resource) => sum + hand[resource], 0);
  localPlayer.developmentCards = DEV_CARD_TYPES.reduce((sum, type) => sum + devHand[type], 0);
  const legalTypes = driver.humanSeat() === viewer && state.currentPlayer() === viewer
    ? new Set(state.legalActions().map((action) => action.type))
    : new Set<IslandersAction['type']>();
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
// this out as the thing digital Islanders gets wrong most often, so it is a first-class element
// rather than a note in a corner.
function previewActionText(driver: IslandersDriver, preview: IslandersActionPreview): string {
  const action = preview.action;
  const human = preview.seat === driver.humanSeat();
  const ongoing = (phrase: string): string => `${human ? 'are' : 'is'} ${phrase}`;
  const deck = (counts: readonly number[]): string => RESOURCES
    .flatMap((resource, index) => counts[index] > 0 ? [`${RESOURCE_LOOK[resource].emoji} x${counts[index]}`] : [])
    .join(' ');
  if (preview.trade) {
    if (preview.phase === 'opening' || preview.phase === 'editing') return ongoing('preparing a trade');
    const offer = `${deck(preview.trade.give)} for ${deck(preview.trade.receive)}`;
    if (preview.phase === 'ready') return ongoing(`offering ${offer}`);
    if (action.type === 'counterTrade') return `countered with ${offer}`;
    if (action.type === 'maritimeTrade' || action.type === 'maritimeBulkTrade') {
      return `traded with the ${action.via}: ${offer}`;
    }
    return `offered ${offer}`;
  }
  if (action.type === 'roll') {
    const latest = driver.state()?.actionRecords().at(-1);
    const dice = latest?.action.type === 'roll' ? latest.outcome?.dice : undefined;
    const total = dice?.reduce((sum, die) => sum + die, 0);
    const discarding = driver.state()?.discardingPlayerCount() ?? 0;
    if (total === 7 && discarding > 0) return `rolled 7 · ${discarding} player${discarding === 1 ? '' : 's'} discarding`;
    return ongoing('rolling dice');
  }
  return action.type === 'initialSettlement' || action.type === 'buildSettlement' ? ongoing('placing a settlement')
    : action.type === 'initialRoad' || action.type === 'buildRoad' ? ongoing('placing a road')
      : action.type === 'buildCity' ? ongoing('upgrading a city')
        : action.type === 'buyDevCard' ? ongoing('buying a development card')
          : action.type === 'playKnight' ? ongoing('playing a knight')
            : action.type === 'playRoadBuilding' ? ongoing('playing road building')
              : action.type === 'playYearOfPlenty' ? ongoing('choosing year-of-plenty resources')
                : action.type === 'playMonopoly' ? ongoing('declaring a monopoly')
                  : action.type === 'moveRobber' ? ongoing('moving the robber')
                    : action.type === 'discard' ? ongoing(`discarding ${action.resources.length} cards`)
                      : action.type === 'acceptTrade' ? ongoing('accepting the trade')
                        : action.type === 'rejectTrade' ? ongoing('rejecting the trade')
                          : action.type === 'confirmTrade' ? ongoing('completing the trade')
                            : action.type === 'cancelTrade' ? ongoing('cancelling the trade')
                              : action.type === 'endTurn' ? ongoing('ending the turn')
                                : ongoing('taking an action');
}

function pendingInstruction(state: IslandersState, human: boolean): string {
  const prompt = state.currentPrompt();
  if (prompt.kind === 'initialSettlement') {
    const round = state.initialSettlementCount(prompt.player) === 0 ? 'first' : 'second';
    return human ? `place your ${round} settlement` : 'choosing a settlement';
  }
  if (prompt.kind === 'initialRoad') return human ? 'place a road beside it' : 'choosing a road';
  if (prompt.kind === 'roll') return human ? 'roll or play a development card' : 'preparing to roll';
  if (prompt.kind === 'playTurn') return human ? 'build, trade, or end turn' : 'considering the next move';
  if (prompt.kind === 'discard') {
    const count = state.legalActionFamilies().find((family) => family.type === 'discard')?.count ?? 0;
    return human ? `discard ${count} cards` : `discarding ${count} cards`;
  }
  if (prompt.kind === 'moveRobber') return human ? 'move the robber' : 'choosing where to move the robber';
  if (prompt.kind === 'respondTrade') return human ? 'respond to the trade' : 'considering the trade';
  return human ? 'choose a trade partner' : 'choosing a trade partner';
}

export interface IslandersStatusLine {
  actor: string;
  narration: string;
  color: [number, number, number];
}

export function islandersStatusLine(
  driver: IslandersDriver,
  preview?: IslandersActionPreview | null,
  setupComplete = true,
): IslandersStatusLine | null {
  const state = driver.state();
  if (!state) return null;
  if (!setupComplete) return null;
  if (driver.error()) return { actor: 'Game stopped', narration: driver.error() ?? '', color: STATUS_FG };
  if (driver.isComplete()) {
    const winner = driver.winner();
    return {
      actor: driver.labelOf(winner),
      narration: 'wins · 10 victory points',
      color: PLAYER_LOOK[driver.colorOf(winner)],
    };
  }
  if (preview) return {
    actor: driver.labelOf(preview.seat),
    narration: previewActionText(driver, preview),
    color: PLAYER_LOOK[driver.colorOf(preview.seat)],
  };
  const prompt = state.currentPrompt();
  const seat = prompt.player;
  const human = seat === driver.humanSeat();
  return {
    actor: human ? 'Your turn' : driver.labelOf(seat),
    narration: `· ${pendingInstruction(state, human)}`,
    color: PLAYER_LOOK[driver.colorOf(seat)],
  };
}

// One borderless narration line, centred along the top of the board like Chess's matchup label.
// rail. Nothing is drawn before a game starts — the setup panel is the whole screen then.
function statusPanel(driver: IslandersDriver, scene: IslandersGameScene, region: LayoutBox, preview?: IslandersActionPreview | null): Node[] {
  const status = islandersStatusLine(driver, preview, scene.setupPresentationComplete());
  if (!status) return [];
  const rail = islandersRailVisible(region.w, region.h) ? ISLANDERS_RAIL_W : 0;
  const content = { ...Box({ flexDirection: 'row', alignItems: 'center', padding: [0, 2] }, [
    Text({ text: status.actor, style: { color: status.color, bold: true } }),
    Text({ text: `${status.narration.startsWith('·') ? ' ' : '  '}${status.narration}`, style: { color: STATUS_MUTED } }),
  ]), id: 'islanders-status-banner' };
  if (region.w < 120) {
    const left = Math.min(region.w, PLAYER_LEGEND_W + 3);
    const right = 11 + rail;
    return [Box({ position: 'absolute', top: 1, left, width: Math.max(0, region.w - left - right), flexDirection: 'row', justifyContent: 'center' }, [content])];
  }
  return [
    hudTopCenter(content, region.w, { railWidth: rail }),
  ];
}

// The sidebar carries full public player state, but color identity has to remain readable when it
// is closed. Keep this deliberately minimal: one fixed Islanders-color square and the seat's name in
// that same color. Model branding belongs nowhere in this compact mapping.
export function islandersPlayerLegend(
  driver: IslandersDriver,
  region: LayoutBox,
  viewerSeat = driver.humanSeat() >= 0 ? driver.humanSeat() : 0,
  onSelect?: (seat: number) => void,
): Node {
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
    ...Array.from({ length: driver.seatCount() }, (_, seat) => Button({
      id: `islanders-view-seat-${seat}`,
      label: `${seat === viewerSeat ? '▸ ' : '  '}■ ${driver.labelOf(seat)}`,
      disabled: onSelect === undefined,
      onClick: () => onSelect?.(seat),
      style: {
        width: textWidth,
        padding: 0,
        color: PLAYER_LOOK[driver.colorOf(seat)],
        bold: seat === viewerSeat,
        textOverflow: 'ellipsis',
        disabled: {
          color: PLAYER_LOOK[driver.colorOf(seat)],
          bold: seat === viewerSeat,
        },
      },
    })),
  ]);
}

export interface IslandersGameHudDeps {
  driver: IslandersDriver;
  scene: IslandersGameScene;
  tokens?: readonly BoardToken[];
  sails?: readonly SailLabel[];
  resourceFlights?: readonly FlyingResource<Resource | DevCardType>[];
  resourceAdjustments?: IslandersResourceViewAdjustments;
  onOpenMenu: () => void;
  onStart: () => void;
  healthStatus?: { lines: string[]; failed: boolean };
  notice?: string;
}

function liveActionButton(id: string, label: string, onClick: () => void, disabled = false, active = false): Node {
  return Button({
    id: `islanders-live-${id}`,
    label,
    onClick,
    disabled,
    style: {
      ...UI_CHROME_PILL,
      padding: [0, 1],
      ...(active ? { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk, bold: true } : {}),
      disabled: active
        ? { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk, bold: true }
        : UI_CHROME_PILL.disabled,
    },
  });
}

function actionTypes(actions: readonly IslandersAction[]): Set<IslandersAction['type']> {
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

function humanMenuPanel(scene: IslandersGameScene, state: IslandersState): Node[] | null {
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
      const options = legal.filter((action): action is Extract<IslandersAction, { type: 'maritimeTrade' }> => action.type === 'maritimeTrade' && action.via === via);
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
        const action: IslandersAction = via === 'bank'
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

function humanActionPanel(deps: IslandersGameHudDeps, region: LayoutBox): Node | null {
  const { driver, scene } = deps;
  const state = driver.state();
  if (!state || !scene.awaitingHuman() || state.currentPlayer() !== driver.humanSeat()) return null;
  if (scene.humanMenuKind() === 'discard' || scene.humanMenuKind() === 'tradeEditor' || scene.humanMenuKind() === 'tradeCounter') return null;
  if (state.currentPrompt().kind === 'respondTrade' || state.currentPrompt().kind === 'decideAcceptees') return null;
  const layout = islandersCardsLayout(region);
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
    maxWidth: Math.max(1, region.w - (islandersRailVisible(region.w, region.h) ? ISLANDERS_RAIL_W : 0) - 4),
    minHeight: 1,
    gap: 1,
    padding: [0, 1],
    background: UI_CHROME_BG,
  }, children);
}

function liveDiscardController(scene: IslandersGameScene, state: IslandersState): IslandersDiscardEditorController | undefined {
  if (scene.humanMenuKind() !== 'discard') return undefined;
  const required = state.legalActionFamilies().find((family) => family.type === 'discard')?.count ?? 0;
  const selected = tradeCounts(RESOURCES.map((resource) =>
    scene.humanMenuResources().filter((item) => item === resource).length));
  return {
    required,
    selected,
    canSubmit: scene.humanMenuCanSubmit(),
    onAdjust: (resource, delta) => delta > 0
      ? scene.pickHumanMenuResource(resource)
      : scene.removeHumanDiscardResource(resource),
    onSubmit: () => scene.submitHumanMenu(),
  };
}

function liveHandActionController(deps: IslandersGameHudDeps, state: IslandersState): IslandersHandActionController | undefined {
  const { driver, scene } = deps;
  const humanSeat = driver.humanSeat();
  const presentation = scene.actionPreview();
  const preview = presentation?.action;
  const pressing = presentation?.phase === 'pressing';
  if (humanSeat < 0) return {
    canTrade: false,
    canBuyDevelopmentCard: false,
    activeAction: pressing && preview?.type === 'buyDevCard'
      ? 'buyDev'
      : pressing && (preview?.type === 'offerTrade' || preview?.type === 'maritimeTrade' || preview?.type === 'maritimeBulkTrade')
        ? 'trade'
        : undefined,
    onTrade: () => false,
    onBuyDevelopmentCard: () => false,
  };
  const activePlayTurn = scene.awaitingHuman()
    && state.currentPlayer() === humanSeat
    && state.currentPrompt().kind === 'playTurn'
    && scene.humanMenuKind() === null
    && scene.boardChoiceType() === null;
  const legalTypes = activePlayTurn
    ? new Set(state.legalActions().map((action) => action.type))
    : new Set<IslandersAction['type']>();
  const canTrade = activePlayTurn && (
    state.legalActions().some((action) => action.type === 'maritimeTrade')
      || state.parameterizedActionExamples().some((action) => action.type === 'offerTrade')
  );
  return {
    canTrade,
    canBuyDevelopmentCard: activePlayTurn && legalTypes.has('buyDevCard'),
    onTrade: () => canTrade && scene.beginHumanMenu('tradeEditor'),
    onBuyDevelopmentCard: () => activePlayTurn
      && legalTypes.has('buyDevCard')
      && scene.submitHumanAction({ type: 'buyDevCard' }),
  };
}

function tradeCounts(values: readonly number[]): Record<Resource, number> {
  return Object.fromEntries(RESOURCES.map((resource, index) => [resource, values[index] ?? 0])) as Record<Resource, number>;
}

function liveTradeController(scene: IslandersGameScene, state: IslandersState): IslandersTradeEditorController | undefined {
  const kind = scene.humanMenuKind();
  if (kind !== 'tradeEditor' && kind !== 'tradeCounter') return undefined;
  const draft = scene.humanTradeDraft();
  const portRates = state.maritimePortTradeRates(state.currentPlayer());
  return {
    mode: kind === 'tradeCounter' ? 'counter' : 'standard',
    give: tradeCounts(draft.give),
    receive: tradeCounts(draft.receive),
    hasPort: Object.values(portRates).some((rates) => rates.length > 0),
    canBank: kind === 'tradeEditor' && scene.humanTradeCanSubmit('bank'),
    canPort: kind === 'tradeEditor' && scene.humanTradeCanSubmit('port'),
    canPlayer: kind === 'tradeEditor' && scene.humanTradeCanSubmit('player'),
    canCounter: kind === 'tradeCounter' && scene.humanTradeCanSubmit('counter'),
    onAdjust: (side, resource, delta) => scene.adjustHumanTradeResource(resource, side, delta),
    onBank: () => scene.submitHumanTrade('bank'),
    onPort: () => scene.submitHumanTrade('port'),
    onPlayer: () => scene.submitHumanTrade('player'),
    onCounter: () => scene.submitHumanTrade('counter'),
    onClose: () => { scene.cancelHumanChoice(); },
  };
}

function previewTradeController(scene: IslandersGameScene): IslandersTradeEditorController | undefined {
  const preview = scene.actionPreview();
  const action = preview?.action;
  const trade = preview?.trade;
  if (!action || !trade) return undefined;
  const give = tradeCounts(RESOURCES.map(() => 0));
  const receive = tradeCounts(RESOURCES.map(() => 0));
  let activeAction: IslandersTradeEditorController['activeAction'];
  for (const resource of RESOURCES) {
    give[resource] = trade.give[resourceIndex(resource)] ?? 0;
    receive[resource] = trade.receive[resourceIndex(resource)] ?? 0;
  }
  if (preview.phase === 'pressing') activeAction = trade.via;
  return {
    mode: trade.mode,
    give,
    receive,
    hasPort: trade.via === 'port' || action.type === 'maritimeTrade' && action.via === 'port'
      || action.type === 'maritimeBulkTrade' && action.via === 'port',
    canBank: false,
    canPort: false,
    canPlayer: false,
    canCounter: false,
    activeAction,
    readOnly: true,
    onAdjust: () => false,
    onBank: () => false,
    onPort: () => false,
    onPlayer: () => false,
    onCounter: () => false,
    onClose: () => {},
  };
}

function livePlayerTradeController(
  scene: IslandersGameScene,
  state: IslandersState,
  driver: IslandersDriver,
): IslandersPlayerTradeOffersController | undefined {
  const trade = state.activeTrade();
  if (!trade) return undefined;
  const humanSeat = driver.humanSeat();
  const prompt = state.currentPrompt();
  const preview = scene.actionPreview();
  const observedSeat = preview?.seat;
  const canMirrorPreview = humanSeat < 0 || observedSeat === humanSeat;
  const controller: IslandersPlayerTradeOffersController = {
    offers: [{
      id: state.actionRecords().length,
      offerer: playerView(state, driver, trade.from),
      give: tradeCounts(trade.give),
      get: tradeCounts(trade.receive),
      reactions: trade.responders.map((seat, index) => {
        const counter = trade.counters.find((candidate) => candidate.from === seat);
        return {
          player: playerView(state, driver, seat),
          status: counter
            ? 'countered' as const
            : trade.accepted.includes(seat)
              ? 'accepted' as const
              : index < trade.responseIndex
                ? 'rejected' as const
                : 'pending' as const,
          ...(counter ? { counterGive: tradeCounts(counter.give), counterGet: tradeCounts(counter.receive) } : {}),
        };
      }),
    }],
  };
  if (preview?.phase === 'pressing' && observedSeat !== undefined && canMirrorPreview) {
    controller.responsePlayer = playerView(state, driver, observedSeat, humanSeat >= 0 ? humanSeat : undefined);
    if (preview.action.type === 'acceptTrade') controller.activeResponse = 'accept';
    else if (preview.action.type === 'counterTrade') controller.activeResponse = 'counter';
    else if (preview.action.type === 'rejectTrade') controller.activeResponse = 'reject';
    else if (preview.action.type === 'confirmTrade') controller.activeCompletePlayer = driver.labelOf(preview.action.with);
    else if (preview.action.type === 'cancelTrade') controller.activeCancel = true;
  }
  const humanCounter = trade.counters.find((counter) => counter.from === humanSeat);
  if (humanCounter) controller.onWithdrawCounter = () => driver.withdrawHumanCounter();
  // Spectator mode intentionally stops here: it renders the exact same popup, but the model
  // decisions arrive through action previews rather than granting the viewer authority to act.
  if (humanSeat < 0 || prompt.player !== humanSeat || !scene.awaitingHuman()) return controller;
  if (prompt.kind === 'respondTrade') {
    controller.responsePlayer = playerView(state, driver, humanSeat, humanSeat);
    if (state.isLegalAction({ type: 'acceptTrade' })) {
      controller.onAccept = () => scene.submitHumanAction({ type: 'acceptTrade' });
    }
    if (state.legalActionFamilies().some((family) => family.type === 'counterTrade')) {
      controller.onCounter = () => scene.beginHumanMenu('tradeCounter');
    }
    controller.onReject = () => scene.submitHumanAction({ type: 'rejectTrade' });
  } else if (prompt.kind === 'decideAcceptees') {
    controller.onComplete = (_offerId, playerName) => {
      const seat = Array.from({ length: driver.seatCount() }, (_, candidate) => candidate)
        .find((candidate) => driver.labelOf(candidate) === playerName);
      return seat !== undefined && scene.submitHumanAction({ type: 'confirmTrade', with: seat });
    };
    controller.onCancel = () => scene.submitHumanAction({ type: 'cancelTrade' });
  }
  return controller;
}

function beginLiveDevelopmentCard(scene: IslandersGameScene, type: DevCardType): boolean {
  if (type === 'knight') return scene.beginBoardChoice('playKnight');
  if (type === 'roadBuilding') return scene.beginBoardChoice('playRoadBuilding');
  if (type === 'yearOfPlenty') return scene.beginHumanMenu('yearOfPlenty');
  if (type === 'monopoly') return scene.beginHumanMenu('monopoly');
  return false; // Victory-point cards are passive and never enter the playable set.
}

// The whole game overlay for one frame.
export function buildIslandersGameRoot(region: LayoutBox, deps: IslandersGameHudDeps): Node {
  const { driver } = deps;
  const state = driver.state();
  const playing = state !== null;
  const railVisible = islandersRailVisible(region.w, region.h);
  const rail = railVisible ? ISLANDERS_RAIL_W : 0;
  const canShowRail = islandersCardsLayout(region).showPublicRail;

  const chrome: Node[] = [
    hudTopRight([
      Button({ id: 'islanders-game-menu', label: MENU_BUTTON_LABEL, onClick: deps.onOpenMenu, style: UI_CHROME_PILL }),
      ...(playing && canShowRail && !railVisible
        ? [Button({ id: 'islanders-game-sidebar-open', label: 'sidebar', onClick: toggleIslandersSidebar, style: UI_CHROME_PILL })]
        : []),
    ], { railWidth: rail }),
  ];

  if (!playing) {
    const setup = matchSetupLayout(region, buildIslandersSetupPanel(deps.healthStatus), [
      newMatchButton('islanders-start', deps.onStart, !islandersSetupReady() || deps.healthStatus?.failed === false),
    ]);
    return Box({ width: region.w, height: region.h }, [setup, ...chrome]);
  }

  const viewerSeat = driver.humanSeat() >= 0 ? driver.humanSeat() : deps.scene.viewedSeat();
  const adjustments = deps.resourceAdjustments;
  const cardsView = islandersLiveView(state, deps.driver, adjustments, viewerSeat);
  const previewSeat = deps.scene.actionPreview()?.seat;
  const visibleTradePreview = driver.humanSeat() < 0 || previewSeat === driver.humanSeat()
    ? previewTradeController(deps.scene)
    : undefined;
  const humanSeat = driver.humanSeat();
  const chatComposer = humanSeat >= 0 && railVisible
    ? (() => {
        configureIslandersChatComposer({
          targets: Array.from({ length: driver.seatCount() }, (_, seat) => seat)
            .filter((seat) => seat !== humanSeat)
            .map((seat) => ({ seat, label: driver.labelOf(seat) })),
          onSubmit: (text, targetSeats) => driver.sendHumanChat(text, targetSeats),
        });
        return buildIslandersChatComposer();
      })()
    : undefined;
  return Box({ width: region.w, height: region.h }, [
    ...islandersProjectedBoardLabels(deps.tokens ?? [], deps.sails ?? []),
    buildIslandersCardsOverlay(
      region,
      toggleIslandersSidebar,
      cardsView,
      () => {},
      undefined,
      undefined,
      (type) => beginLiveDevelopmentCard(deps.scene, type),
      undefined,
      liveTradeController(deps.scene, state) ?? visibleTradePreview,
      liveHandActionController(deps, state),
      undefined,
      liveDiscardController(deps.scene, state),
      livePlayerTradeController(deps.scene, state, driver),
      chatComposer,
    ),
    ...([humanActionPanel(deps, region)].filter((node): node is Node => node !== null)),
    ...islandersFlyingCardNodes(deps.resourceFlights ?? []),
    ...statusPanel(driver, deps.scene, region, deps.scene.actionPreview()),
    islandersPlayerLegend(
      driver,
      region,
      viewerSeat,
      driver.humanSeat() < 0 ? (seat) => { deps.scene.setViewedSeat(seat); } : undefined,
    ),
    ...(deps.notice ? [Box({ position: 'absolute', left: 0, bottom: 1, width: region.w, justifyContent: 'center' }, [
      Text({ text: deps.notice, style: { color: 'warning', bold: true } }),
    ])] : []),
    ...chrome,
  ]);
}
