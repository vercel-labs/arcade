import { mulberry32 } from '../../../engine/index.ts';
import { buildDevelopmentDeck } from '../../../rules/islanders/development.ts';
import {
  maritimePortTradeRates,
  maritimeTradeRates,
  type MaritimePortTradeRate,
  type MaritimePortTradeRates,
  type MaritimeTradeRates,
} from '../../../rules/islanders/maritime-trade.ts';
import { COSTS, DEV_CARD_TYPES, DISCARD_LIMIT, type DevCardType, type PlayerColor, type Resource, resourceIndex, TERRAIN_RESOURCE, type Terrain } from '../../../rules/islanders/types.ts';
import type { IslandersActionHistoryView, IslandersCardsPlayerView, IslandersCardsView, IslandersDevelopmentPlayView } from './card-types.ts';
import { CITY_ICON, DEV_CARD_ICON, type IslandersRgb as Rgb, RESOURCE_LOOK, RESOURCE_ORDER, ROAD_ICON, SETTLEMENT_ICON } from './palette.ts';

export const ISLANDERS_LOCAL_COLOR: PlayerColor = 'red';
export const ISLANDERS_BANK_TRADE_RATE = 4;
const DEFAULT_MARITIME_RATES = maritimeTradeRates([]);
const DEFAULT_MARITIME_PORT_RATES = maritimePortTradeRates([]);

const liveHand: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
const liveDevHand: Record<DevCardType, number> = { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
const WORKBENCH_BANK_START: Record<Resource, number> = { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 };
const liveBank: Record<Resource, number> = { ...WORKBENCH_BANK_START };
const WORKBENCH_OPPONENT_HAND_START: readonly Record<Resource, number>[] = [
  { lumber: 2, brick: 1, wool: 3, grain: 1, ore: 0 },
  { lumber: 0, brick: 2, wool: 1, grain: 3, ore: 2 },
  { lumber: 3, brick: 0, wool: 2, grain: 2, ore: 3 },
];
const liveOpponentHands = WORKBENCH_OPPONENT_HAND_START.map((hand) => ({ ...hand }));
const WORKBENCH_DEV_SEED = 0xc47a_2026;
let liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
// Purchases reserve cards in deck order immediately, while the visible pile is decremented only
// when each flight launches. This lets another purchase be queued before the first card lands
// without drawing the same top card twice.
const reservedDevelopmentCards: DevCardType[] = [];
let developmentPlay: IslandersDevelopmentPlayView | null = null;
let developmentPlayHistoryIndex = -1;
let livePlayedKnights = 0;
let tradeOpen = false;
let discardRequired = 0;
let nextPlayerTradeId = 1;

export type IslandersPlayerTradeReactionStatus = 'pending' | 'accepted' | 'countered' | 'rejected';

export interface IslandersPlayerTradeReaction {
  player: IslandersCardsPlayerView;
  status: IslandersPlayerTradeReactionStatus;
  counterGive?: Record<Resource, number>;
  counterGet?: Record<Resource, number>;
}

export interface IslandersPlayerTradeOffer {
  id: number;
  offerer: IslandersCardsPlayerView;
  give: Record<Resource, number>;
  get: Record<Resource, number>;
  reactions: IslandersPlayerTradeReaction[];
}

function emptyResourceCounts(): Record<Resource, number> {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export const workbenchTradeGive = emptyResourceCounts();
export const workbenchTradeGet = emptyResourceCounts();
export const workbenchDiscardSelection = emptyResourceCounts();
const liveHistory: IslandersActionHistoryView[] = [];
const livePlayerTradeOffers: IslandersPlayerTradeOffer[] = [];
const playerTradeTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTradeStaging(): void {
  for (const resource of RESOURCE_ORDER) {
    workbenchTradeGive[resource] = 0;
    workbenchTradeGet[resource] = 0;
  }
}

function clearDiscardStaging(): void {
  for (const resource of RESOURCE_ORDER) workbenchDiscardSelection[resource] = 0;
}

export function beginIslandersWorkbenchDiscard(): boolean {
  const total = RESOURCE_ORDER.reduce((sum, resource) => sum + liveHand[resource], 0);
  if (total <= DISCARD_LIMIT) return false;
  discardRequired = Math.floor(total / 2);
  clearDiscardStaging();
  setIslandersTradeEditorOpen(false);
  return true;
}

export function islandersWorkbenchDiscardRequired(): number {
  return discardRequired;
}

export function islandersWorkbenchDiscardOpen(): boolean {
  return discardRequired > 0;
}

export function adjustIslandersWorkbenchDiscard(resource: Resource, delta: -1 | 1): boolean {
  if (!islandersWorkbenchDiscardOpen()) return false;
  const next = workbenchDiscardSelection[resource] + delta;
  if (next < 0 || next > liveHand[resource]) return false;
  const selected = RESOURCE_ORDER.reduce((sum, item) => sum + workbenchDiscardSelection[item], 0);
  if (delta > 0 && selected >= discardRequired) return false;
  workbenchDiscardSelection[resource] = next;
  return true;
}

export function canSubmitIslandersWorkbenchDiscard(): boolean {
  return islandersWorkbenchDiscardOpen()
    && RESOURCE_ORDER.reduce((sum, resource) => sum + workbenchDiscardSelection[resource], 0) === discardRequired;
}

export function submitIslandersWorkbenchDiscard(): boolean {
  if (!canSubmitIslandersWorkbenchDiscard()) return false;
  const total = discardRequired;
  for (const resource of RESOURCE_ORDER) {
    const count = workbenchDiscardSelection[resource];
    liveHand[resource] -= count;
    liveBank[resource] += count;
  }
  discardRequired = 0;
  clearDiscardStaging();
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `discarded ${total} cards` });
  return true;
}

/** Close a valid discard editor and reserve its cards for animated transfer. */
export function reserveIslandersWorkbenchDiscard(): Resource[] | null {
  if (!canSubmitIslandersWorkbenchDiscard()) return null;
  const resources = RESOURCE_ORDER.flatMap((resource) =>
    Array.from({ length: workbenchDiscardSelection[resource] }, () => resource));
  discardRequired = 0;
  clearDiscardStaging();
  return resources;
}

export function logIslandersWorkbenchDiscard(total: number): void {
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `discarded ${total} cards` });
}

export function adjustIslandersWorkbenchHand(resource: Resource, delta: number): boolean {
  const next = liveHand[resource] + delta;
  if (next < 0) return false;
  liveHand[resource] = next;
  return true;
}

export function adjustIslandersWorkbenchDev(type: DevCardType, delta: number): boolean {
  const next = liveDevHand[type] + delta;
  if (next < 0) return false;
  liveDevHand[type] = next;
  return true;
}

export type IslandersWorkbenchBuild = 'road' | 'settlement' | 'city';

export function canAffordIslandersWorkbenchBuild(type: IslandersWorkbenchBuild): boolean {
  return RESOURCE_ORDER.every((resource) => liveHand[resource] >= COSTS[type][resourceIndex(resource)]);
}

export function payIslandersWorkbenchBuild(type: IslandersWorkbenchBuild): boolean {
  if (!canAffordIslandersWorkbenchBuild(type)) return false;
  for (const resource of RESOURCE_ORDER) {
    const amount = COSTS[type][resourceIndex(resource)];
    liveHand[resource] -= amount;
    liveBank[resource] += amount;
  }
  liveHistory.push({
    actor: 'You',
    color: ISLANDERS_LOCAL_COLOR,
    message: type === 'road' ? `built a road ${ROAD_ICON}` : type === 'settlement' ? `built a settlement ${SETTLEMENT_ICON}` : `upgraded to a city ${CITY_ICON}`,
  });
  return true;
}

export interface IslandersWorkbenchOpponentTransfer {
  resource: Resource;
  victims: Array<{ index: number; name: string; count: number }>;
  total: number;
}

export function reserveIslandersWorkbenchMonopoly(resource: Resource): IslandersWorkbenchOpponentTransfer | null {
  if (developmentPlay?.type !== 'monopoly') return null;
  const victims = liveOpponentHands.flatMap((hand, index) => {
    const count = hand[resource];
    if (!count) return [];
    hand[resource] = 0;
    return [{ index, name: ISLANDERS_CARD_WORKBENCH_VIEW.opponents[index].name, count }];
  });
  const total = victims.reduce((sum, victim) => sum + victim.count, 0);
  developmentPlay = null;
  developmentPlayHistoryIndex = -1;
  return { resource, victims, total };
}

export function reserveIslandersWorkbenchRobberSteal(): IslandersWorkbenchOpponentTransfer | null {
  for (let index = 0; index < liveOpponentHands.length; index++) {
    const hand = liveOpponentHands[index];
    const resource = RESOURCE_ORDER.find((candidate) => hand[candidate] > 0);
    if (!resource) continue;
    hand[resource]--;
    return {
      resource,
      victims: [{ index, name: ISLANDERS_CARD_WORKBENCH_VIEW.opponents[index].name, count: 1 }],
      total: 1,
    };
  }
  return null;
}

export function logIslandersWorkbenchOpponentTransfer(transfer: IslandersWorkbenchOpponentTransfer, kind: 'monopoly' | 'robber'): void {
  const names = transfer.victims.map((victim) => victim.name).join(', ');
  liveHistory.push({
    actor: 'You',
    color: ISLANDERS_LOCAL_COLOR,
    message: kind === 'monopoly'
      ? `took ${RESOURCE_LOOK[transfer.resource].emoji} x${transfer.total} with monopoly`
      : `stole ${RESOURCE_LOOK[transfer.resource].emoji} x1 from ${names}`,
  });
}

function developmentPlaySteps(type: Exclude<DevCardType, 'victoryPoint'>): number {
  if (type === 'yearOfPlenty') {
    return Math.min(2, RESOURCE_ORDER.reduce((total, resource) => total + liveBank[resource], 0));
  }
  if (type === 'roadBuilding') return 2;
  return 1;
}

export function beginIslandersWorkbenchDevelopmentPlay(type: DevCardType): boolean {
  if (type === 'victoryPoint' || developmentPlay || liveDevHand[type] <= 0) return false;
  if (type === 'yearOfPlenty' && RESOURCE_ORDER.every((resource) => liveBank[resource] === 0)) return false;
  liveDevHand[type]--;
  developmentPlay = { type, remaining: developmentPlaySteps(type), resources: [] };
  liveHistory.push({
    actor: 'You',
    color: ISLANDERS_LOCAL_COLOR,
    message: type === 'knight'
      ? 'played a knight'
      : type === 'roadBuilding'
        ? 'played road building'
        : type === 'yearOfPlenty'
          ? 'played year of plenty'
          : 'played monopoly',
  });
  developmentPlayHistoryIndex = liveHistory.length - 1;
  if (type === 'knight') livePlayedKnights++;
  return true;
}

export function islandersWorkbenchDevelopmentPlay(): IslandersDevelopmentPlayView | null {
  return developmentPlay ? { ...developmentPlay, resources: [...developmentPlay.resources] } : null;
}

export function stageIslandersWorkbenchDevelopmentResource(resource: Resource): boolean {
  const play = developmentPlay;
  if (!play || (play.type !== 'yearOfPlenty' && play.type !== 'monopoly')) return false;
  if (play.type === 'monopoly') {
    if (play.resources[0] === resource) {
      play.resources = [];
      play.remaining = 1;
    } else {
      play.resources = [resource];
      play.remaining = 0;
    }
    return true;
  }
  const required = developmentPlaySteps('yearOfPlenty');
  if (play.resources.length >= required) return false;
  const staged = play.resources.filter((candidate) => candidate === resource).length;
  if (staged >= liveBank[resource]) return false;
  play.resources.push(resource);
  play.remaining = required - play.resources.length;
  return true;
}

export function unstageIslandersWorkbenchDevelopmentResource(resource: Resource): boolean {
  const play = developmentPlay;
  if (!play || (play.type !== 'yearOfPlenty' && play.type !== 'monopoly')) return false;
  const index = play.resources.lastIndexOf(resource);
  if (index < 0) return false;
  play.resources.splice(index, 1);
  play.remaining = play.type === 'yearOfPlenty' ? developmentPlaySteps('yearOfPlenty') - play.resources.length : 1;
  return true;
}

export function canConfirmIslandersWorkbenchDevelopmentSelection(): boolean {
  const play = developmentPlay;
  if (!play) return false;
  if (play.type === 'monopoly') return play.resources.length === 1;
  if (play.type !== 'yearOfPlenty' || play.resources.length !== developmentPlaySteps('yearOfPlenty')) return false;
  return RESOURCE_ORDER.every((resource) =>
    play.resources.filter((candidate) => candidate === resource).length <= liveBank[resource]);
}

export function receiveIslandersWorkbenchYearOfPlenty(): Resource[] | null {
  const play = developmentPlay;
  if (play?.type !== 'yearOfPlenty' || !canConfirmIslandersWorkbenchDevelopmentSelection()) return null;
  const received = [...play.resources];
  for (const resource of received) {
    liveBank[resource]--;
    liveHand[resource]++;
  }
  developmentPlay = null;
  developmentPlayHistoryIndex = -1;
  logIslandersReceived(received);
  return received;
}

export function reserveIslandersWorkbenchSelectedMonopoly(): IslandersWorkbenchOpponentTransfer | null {
  const resource = developmentPlay?.type === 'monopoly' ? developmentPlay.resources[0] : undefined;
  return resource ? reserveIslandersWorkbenchMonopoly(resource) : null;
}

export function completeIslandersWorkbenchSelectedMonopoly(): boolean {
  const transfer = reserveIslandersWorkbenchSelectedMonopoly();
  if (!transfer) return false;
  liveHand[transfer.resource] += transfer.total;
  logIslandersWorkbenchOpponentTransfer(transfer, 'monopoly');
  return true;
}

export function completeIslandersWorkbenchDevelopmentStep(type: 'knight' | 'roadBuilding'): boolean {
  if (developmentPlay?.type !== type) return false;
  developmentPlay.remaining--;
  if (developmentPlay.remaining <= 0) {
    developmentPlay = null;
    developmentPlayHistoryIndex = -1;
  }
  return true;
}

export function finishIslandersWorkbenchDevelopmentPlay(type: Exclude<DevCardType, 'victoryPoint'>): boolean {
  if (developmentPlay?.type !== type) return false;
  developmentPlay = null;
  developmentPlayHistoryIndex = -1;
  return true;
}

// Test-sandbox cancellation is transactional: activating a development card is reversible until
// its final choice commits. Scene-owned Road Building placements are rolled back by the controller;
// resource and public-card state can be restored here.
export function cancelIslandersWorkbenchDevelopmentPlay(): boolean {
  const play = developmentPlay;
  if (!play) return false;
  if (play.type === 'knight') livePlayedKnights = Math.max(0, livePlayedKnights - 1);
  liveDevHand[play.type]++;
  developmentPlay = null;
  if (developmentPlayHistoryIndex >= 0) liveHistory.splice(developmentPlayHistoryIndex, 1);
  developmentPlayHistoryIndex = -1;
  return true;
}

export function chooseIslandersWorkbenchDevelopmentResource(resource: Resource): boolean {
  const play = developmentPlay;
  if (!play || (play.type !== 'yearOfPlenty' && play.type !== 'monopoly')) return false;
  if (play.type === 'monopoly') {
    if (!stageIslandersWorkbenchDevelopmentResource(resource)) return false;
    const transfer = reserveIslandersWorkbenchSelectedMonopoly();
    if (!transfer) return false;
    liveHand[resource] += transfer.total;
    logIslandersWorkbenchOpponentTransfer(transfer, 'monopoly');
    return true;
  }
  if (!stageIslandersWorkbenchDevelopmentResource(resource)) return false;
  if (canConfirmIslandersWorkbenchDevelopmentSelection()) receiveIslandersWorkbenchYearOfPlenty();
  return true;
}

export function islandersTradeEditorOpen(): boolean {
  return tradeOpen;
}

export function setIslandersTradeEditorOpen(open: boolean): void {
  tradeOpen = open;
  if (!open) clearTradeStaging();
}

export function setIslandersWorkbenchTradeSelection(give: Resource | null, get: Resource | null, giveCount = ISLANDERS_BANK_TRADE_RATE): void {
  clearTradeStaging();
  if (give) workbenchTradeGive[give] = giveCount;
  if (get) workbenchTradeGet[get] = 1;
}

export function adjustIslandersWorkbenchTradeStaging(side: 'give' | 'receive', resource: Resource, delta: number): boolean {
  const staged = side === 'give' ? workbenchTradeGive : workbenchTradeGet;
  const available = side === 'give' ? liveHand[resource] : liveBank[resource];
  const next = staged[resource] + delta;
  if (next < 0 || next > available) return false;
  staged[resource] = next;
  return true;
}

export interface IslandersWorkbenchMaritimeTrade {
  give: Resource;
  gets: Resource[];
  rate: 2 | 3 | 4;
}

export type IslandersWorkbenchMaritimeTradeVia = 'bank' | 'port';

function stagedIslandersTrade(ratesFor: (resource: Resource) => readonly (2 | 3 | 4)[]): IslandersWorkbenchMaritimeTrade | null {
  const giveResources = RESOURCE_ORDER.filter((resource) => workbenchTradeGive[resource] > 0);
  if (giveResources.length !== 1) return null;
  const give = giveResources[0];
  if (workbenchTradeGive[give] > liveHand[give]) return null;

  const gets: Resource[] = [];
  for (const resource of RESOURCE_ORDER) {
    const count = workbenchTradeGet[resource];
    if (count > liveBank[resource] || (resource === give && count > 0)) return null;
    for (let i = 0; i < count; i++) gets.push(resource);
  }
  if (gets.length === 0) return null;
  const stagedRate = workbenchTradeGive[give] / gets.length;
  const rate = ratesFor(give).find((candidate) => candidate === stagedRate);
  if (rate === undefined) return null;
  return { give, gets, rate };
}

export function stagedIslandersBankTrade(): IslandersWorkbenchMaritimeTrade | null {
  return stagedIslandersTrade(() => [ISLANDERS_BANK_TRADE_RATE]);
}

export function stagedIslandersPortTrade(rates: MaritimePortTradeRates): IslandersWorkbenchMaritimeTrade | null {
  return stagedIslandersTrade((resource) => rates[resource]);
}

export function stagedIslandersPlayerTradeValid(): boolean {
  let giveTotal = 0;
  let getTotal = 0;
  for (const resource of RESOURCE_ORDER) {
    const give = workbenchTradeGive[resource];
    const get = workbenchTradeGet[resource];
    if (give > liveHand[resource] || (give > 0 && get > 0)) return false;
    giveTotal += give;
    getTotal += get;
  }
  return giveTotal > 0 && getTotal > 0;
}

function finishDummyPlayerTradeReactions(id: number): boolean {
  const offer = livePlayerTradeOffers.find((candidate) => candidate.id === id);
  if (!offer || offer.reactions.every((reaction) => reaction.status !== 'pending')) return false;
  const acceptingIndex = (id - 1) % Math.max(1, offer.reactions.length);
  for (let i = 0; i < offer.reactions.length; i++) {
    offer.reactions[i].status = i === acceptingIndex ? 'accepted' : 'rejected';
  }
  const timer = playerTradeTimers.get(id);
  if (timer) clearTimeout(timer);
  playerTradeTimers.delete(id);
  return true;
}

export function createIslandersWorkbenchPlayerTrade(
  offerer: IslandersCardsPlayerView,
  opponents: IslandersCardsPlayerView[],
  onResolve: () => void,
): number | null {
  if (!stagedIslandersPlayerTradeValid() || opponents.length === 0) return null;
  const id = nextPlayerTradeId++;
  livePlayerTradeOffers.push({
    id,
    offerer: { ...offerer },
    give: { ...workbenchTradeGive },
    get: { ...workbenchTradeGet },
    reactions: opponents.map((player) => ({ player: { ...player }, status: 'pending' })),
  });
  clearTradeStaging();
  tradeOpen = false;
  const timer = setTimeout(() => {
    if (finishDummyPlayerTradeReactions(id)) onResolve();
  }, 500);
  playerTradeTimers.set(id, timer);
  return id;
}

export function resolveIslandersWorkbenchPlayerTradeOffer(id: number): boolean {
  return finishDummyPlayerTradeReactions(id);
}

export function islandersWorkbenchPlayerTradeOffers(): IslandersPlayerTradeOffer[] {
  return livePlayerTradeOffers.map((offer) => ({
    ...offer,
    offerer: { ...offer.offerer },
    give: { ...offer.give },
    get: { ...offer.get },
    reactions: offer.reactions.map((reaction) => ({
      player: { ...reaction.player },
      status: reaction.status,
    })),
  }));
}

export function cancelIslandersWorkbenchPlayerTrade(id: number): boolean {
  const index = livePlayerTradeOffers.findIndex((offer) => offer.id === id);
  if (index < 0) return false;
  const timer = playerTradeTimers.get(id);
  if (timer) clearTimeout(timer);
  playerTradeTimers.delete(id);
  livePlayerTradeOffers.splice(index, 1);
  return true;
}

export function completeIslandersWorkbenchPlayerTrade(id: number, playerName: string): boolean {
  const offer = livePlayerTradeOffers.find((candidate) => candidate.id === id);
  const reaction = offer?.reactions.find((candidate) => candidate.player.name === playerName);
  if (!offer || reaction?.status !== 'accepted') return false;
  for (const resource of RESOURCE_ORDER) {
    if (liveHand[resource] < offer.give[resource]) return false;
  }
  for (const resource of RESOURCE_ORDER) {
    liveHand[resource] -= offer.give[resource];
    liveHand[resource] += offer.get[resource];
  }
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `completed a trade with ${playerName}` });
  return cancelIslandersWorkbenchPlayerTrade(id);
}

function canCommitIslandersWorkbenchMaritimeTrade(trade: IslandersWorkbenchMaritimeTrade): boolean {
  const giveCount = trade.rate * trade.gets.length;
  if (trade.gets.length === 0 || liveHand[trade.give] < giveCount || trade.gets.some((get) => get === trade.give)) return false;
  const received = emptyResourceCounts();
  for (const get of trade.gets) received[get]++;
  if (RESOURCE_ORDER.some((resource) => received[resource] > liveBank[resource])) return false;
  return true;
}

function commitIslandersWorkbenchMaritimePayment(trade: IslandersWorkbenchMaritimeTrade): boolean {
  if (!canCommitIslandersWorkbenchMaritimeTrade(trade)) return false;
  const giveCount = trade.rate * trade.gets.length;
  liveHand[trade.give] -= giveCount;
  liveBank[trade.give] += giveCount;
  return true;
}

export function departIslandersWorkbenchHandResource(resource: Resource): boolean {
  if (liveHand[resource] <= 0) return false;
  liveHand[resource] -= 1;
  return true;
}

export function landIslandersWorkbenchBankResource(resource: Resource): void {
  liveBank[resource] += 1;
}

export function departIslandersWorkbenchBankResource(resource: Resource): boolean {
  if (liveBank[resource] <= 0) return false;
  liveBank[resource] -= 1;
  return true;
}

export function logIslandersWorkbenchMaritimeTrade(
  trade: IslandersWorkbenchMaritimeTrade,
  via: IslandersWorkbenchMaritimeTradeVia,
): void {
  const giveCount = trade.rate * trade.gets.length;
  const received = emptyResourceCounts();
  for (const resource of trade.gets) received[resource]++;
  const summary = RESOURCE_ORDER
    .filter((resource) => received[resource] > 0)
    .map((resource) => `${received[resource]} ${RESOURCE_LOOK[resource].name}`)
    .join(' + ');
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `traded ${giveCount} ${RESOURCE_LOOK[trade.give].name} for ${summary} via ${via}` });
}

function beginStagedIslandersWorkbenchMaritimeTrade(trade: IslandersWorkbenchMaritimeTrade | null): IslandersWorkbenchMaritimeTrade | null {
  // Animated trades settle both sides card by card. Validate and close the editor here, but leave
  // the counts untouched until each offered card departs the hand and lands in the bank.
  if (!trade || !canCommitIslandersWorkbenchMaritimeTrade(trade)) return null;
  setIslandersTradeEditorOpen(false);
  return trade;
}

export function beginStagedIslandersWorkbenchBankTrade(): IslandersWorkbenchMaritimeTrade | null {
  return beginStagedIslandersWorkbenchMaritimeTrade(stagedIslandersBankTrade());
}

export function beginStagedIslandersWorkbenchPortTrade(rates: MaritimePortTradeRates): IslandersWorkbenchMaritimeTrade | null {
  return beginStagedIslandersWorkbenchMaritimeTrade(stagedIslandersPortTrade(rates));
}

function performIslandersWorkbenchMaritimeTrade(
  give: Resource,
  gets: Resource[],
  rate: 2 | 3 | 4,
  via: IslandersWorkbenchMaritimeTradeVia,
): boolean {
  const trade = { give, gets, rate };
  if (!commitIslandersWorkbenchMaritimePayment(trade)) return false;
  for (const resource of gets) {
    if (!departIslandersWorkbenchBankResource(resource)) return false;
    bankIslandersResource(resource);
  }
  logIslandersWorkbenchMaritimeTrade(trade, via);
  return true;
}

export function performIslandersWorkbenchBankTrade(give: Resource, get: Resource): boolean {
  return performIslandersWorkbenchMaritimeTrade(give, [get], ISLANDERS_BANK_TRADE_RATE, 'bank');
}

export function performIslandersWorkbenchPortTrade(
  give: Resource,
  get: Resource,
  rates: MaritimePortTradeRates,
  rate: MaritimePortTradeRate = rates[give][0],
): boolean {
  return rates[give].includes(rate) && performIslandersWorkbenchMaritimeTrade(give, [get], rate, 'port');
}

export function performStagedIslandersWorkbenchBankTrade(): boolean {
  const trade = stagedIslandersBankTrade();
  if (!trade || !performIslandersWorkbenchMaritimeTrade(trade.give, trade.gets, trade.rate, 'bank')) return false;
  clearTradeStaging();
  return true;
}

export function performStagedIslandersWorkbenchPortTrade(rates: MaritimePortTradeRates): boolean {
  const trade = stagedIslandersPortTrade(rates);
  if (!trade || !performIslandersWorkbenchMaritimeTrade(trade.give, trade.gets, trade.rate, 'port')) return false;
  clearTradeStaging();
  return true;
}

export function beginIslandersWorkbenchDevPurchase(): DevCardType | null {
  const drawn = liveDevelopmentDeck.at(-1 - reservedDevelopmentCards.length);
  if (!drawn) return null;
  for (const resource of RESOURCE_ORDER) {
    if (liveHand[resource] < COSTS.devCard[resourceIndex(resource)]) return null;
  }
  for (const resource of RESOURCE_ORDER) {
    const amount = COSTS.devCard[resourceIndex(resource)];
    liveHand[resource] -= amount;
    liveBank[resource] += amount;
  }
  reservedDevelopmentCards.push(drawn);
  return drawn;
}

export function departIslandersWorkbenchDevCard(expected: DevCardType): boolean {
  if (reservedDevelopmentCards[0] !== expected || liveDevelopmentDeck.at(-1) !== expected) return false;
  reservedDevelopmentCards.shift();
  liveDevelopmentDeck.pop();
  return true;
}

export function landIslandersWorkbenchDevCard(type: DevCardType): void {
  liveDevHand[type] += 1;
}

export function logIslandersWorkbenchDevPurchase(): void {
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `bought a development card ${DEV_CARD_ICON}` });
}

export function buyIslandersWorkbenchDevCard(): boolean {
  const drawn = beginIslandersWorkbenchDevPurchase();
  if (!drawn || !departIslandersWorkbenchDevCard(drawn)) return false;
  landIslandersWorkbenchDevCard(drawn);
  logIslandersWorkbenchDevPurchase();
  return true;
}

export function resetIslandersWorkbenchCards(): void {
  for (const resource of RESOURCE_ORDER) {
    liveHand[resource] = 0;
    liveBank[resource] = WORKBENCH_BANK_START[resource];
  }
  for (const type of DEV_CARD_TYPES) liveDevHand[type] = 0;
  for (let index = 0; index < liveOpponentHands.length; index++) {
    Object.assign(liveOpponentHands[index], WORKBENCH_OPPONENT_HAND_START[index]);
  }
  liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
  reservedDevelopmentCards.length = 0;
  developmentPlay = null;
  developmentPlayHistoryIndex = -1;
  livePlayedKnights = 0;
  liveHistory.length = 0;
  for (const timer of playerTradeTimers.values()) clearTimeout(timer);
  playerTradeTimers.clear();
  livePlayerTradeOffers.length = 0;
  nextPlayerTradeId = 1;
  discardRequired = 0;
  clearDiscardStaging();
  setIslandersTradeEditorOpen(false);
}

export function bankIslandersResource(resource: Resource): void {
  liveHand[resource] += 1;
}

export function logIslandersReceived(drawn: Resource[]): void {
  if (drawn.length) liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: 'received', resources: drawn });
}

export function logIslandersRoll(sum: number): void {
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `rolled a ${sum}` });
}

export function logIslandersRobberMove(terrain: Terrain, token: number | null): void {
  const resource = TERRAIN_RESOURCE[terrain];
  const tile = resource === null || token === null ? 'desert' : `${token}${RESOURCE_LOOK[resource].emoji}`;
  liveHistory.push({ actor: 'You', color: ISLANDERS_LOCAL_COLOR, message: `moved the robber to the ${tile} tile` });
}

export function islandersResourceFace(resource: Resource): { emoji: string; fill: Rgb } {
  const look = RESOURCE_LOOK[resource];
  return { emoji: look.emoji, fill: look.fill };
}

function inferredPortRates(rates: MaritimeTradeRates): MaritimePortTradeRates {
  const generic = Object.values(rates).some((rate) => rate === 3);
  return Object.fromEntries(RESOURCE_ORDER.map((resource) => {
    const options: MaritimePortTradeRate[] = [];
    if (rates[resource] === 2) options.push(2);
    if (generic) options.push(3);
    return [resource, options];
  })) as MaritimePortTradeRates;
}

export function islandersWorkbenchView(
  rates: MaritimeTradeRates = DEFAULT_MARITIME_RATES,
  portRates: MaritimePortTradeRates = inferredPortRates(rates),
): IslandersCardsView {
  const seeded = ISLANDERS_CARD_WORKBENCH_VIEW;
  const held = RESOURCE_ORDER.reduce((sum, resource) => sum + liveHand[resource], 0);
  const dev = DEV_CARD_TYPES.reduce((sum, type) => sum + liveDevHand[type], 0);
  const knights = seeded.localPlayer.knights + livePlayedKnights;
  const opposingArmy = Math.max(...seeded.opponents.map((player) => player.knights));
  const hasLargestArmy = knights >= 3 && knights > opposingArmy;
  return {
    ...seeded,
    hand: { ...liveHand },
    devHand: { ...liveDevHand },
    bank: { ...liveBank },
    maritimeRates: { ...rates },
    maritimePortRates: Object.fromEntries(RESOURCE_ORDER.map((resource) => [resource, [...portRates[resource]]])) as MaritimePortTradeRates,
    developmentDeck: liveDevelopmentDeck.length,
    developmentDeckAvailable: liveDevelopmentDeck.length - reservedDevelopmentCards.length,
    ...(developmentPlay ? { developmentPlay: { ...developmentPlay, resources: [...developmentPlay.resources] } } : {}),
    source: 'workbench',
    localPlayer: {
      ...seeded.localPlayer,
      resourceCards: held,
      developmentCards: dev,
      knights,
      publicVp: seeded.localPlayer.publicVp + (hasLargestArmy ? 2 : 0),
      ...(hasLargestArmy ? { hasLargestArmy: true } : {}),
    },
    opponents: seeded.opponents.map((player, index) => ({
      ...(hasLargestArmy && player.hasLargestArmy ? { ...player, hasLargestArmy: false } : player),
      resourceCards: RESOURCE_ORDER.reduce((sum, resource) => sum + liveOpponentHands[index][resource], 0),
    })),
    history: [...seeded.history, ...liveHistory],
  };
}

export const ISLANDERS_CARD_WORKBENCH_VIEW: IslandersCardsView = {
  source: 'workbench',
  localPlayer: { name: 'You', color: ISLANDERS_LOCAL_COLOR, publicVp: 3, resourceCards: 0, developmentCards: 0, knights: 2, longestRoad: 5, active: true },
  hand: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
  devHand: { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
  bank: { ...WORKBENCH_BANK_START },
  maritimeRates: { ...DEFAULT_MARITIME_RATES },
  maritimePortRates: { ...DEFAULT_MARITIME_PORT_RATES },
  developmentDeck: 25,
  opponents: [
    { name: 'claude-haiku-4.5', color: 'blue', publicVp: 2, resourceCards: 3, developmentCards: 0, knights: 1, longestRoad: 4 },
    { name: 'gpt-5-nano', color: 'orange', publicVp: 2, resourceCards: 2, developmentCards: 1, knights: 0, longestRoad: 10, hasLongestRoad: true },
    { name: 'gemini-3-flash', color: 'purple', publicVp: 4, resourceCards: 6, developmentCards: 2, knights: 3, longestRoad: 6, hasLargestArmy: true },
  ],
  history: [
    { actor: 'You', color: 'red', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'You', color: 'red', message: `placed a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'good luck all', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gemini-3-flash', color: 'purple', message: `placed a road ${ROAD_ICON}` },
    { actor: 'You', color: 'red', message: 'rolled a 9' },
    { actor: 'You', color: 'red', message: 'received', resources: ['grain', 'lumber'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'received', resources: ['ore'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled a 4' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['brick', 'brick'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `built a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 7' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'moved the robber to the ore hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'stole a card from gemini-3-flash' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rude', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rolled an 11' },
    { actor: 'You', color: 'red', message: 'received', resources: ['wool'] },
    { actor: 'You', color: 'red', message: 'rolled a 6' },
    { actor: 'You', color: 'red', message: 'received', resources: ['brick', 'grain'] },
    { actor: 'You', color: 'red', message: `bought a development card ${DEV_CARD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled an 8' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['lumber', 'wool', 'wool'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'anyone need sheep? I have plenty', chat: true },
    { actor: 'gpt-5-nano', color: 'orange', message: 'traded 2 wheat for 1 ore' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'saving for a city', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rolled a 5' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'received', resources: ['ore', 'ore'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'upgraded to a city' },
    { actor: 'You', color: 'red', message: 'rolled a 10' },
    { actor: 'You', color: 'red', message: `built a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'played a knight' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'moved the robber to the wheat hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 3' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'received', resources: ['brick'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'claimed the longest road' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'anyone trading wheat?', chat: true },
    { actor: 'You', color: 'red', message: 'your turn — roll to begin' },
  ],
};
