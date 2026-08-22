import { mulberry32 } from '../../../engine/index.ts';
import { buildDevelopmentDeck } from '../../../rules/catan/development.ts';
import {
  maritimePortTradeRates,
  maritimeTradeRates,
  type MaritimePortTradeRate,
  type MaritimePortTradeRates,
  type MaritimeTradeRates,
} from '../../../rules/catan/maritime-trade.ts';
import { COSTS, DEV_CARD_TYPES, type DevCardType, type PlayerColor, type Resource, resourceIndex, type Terrain } from '../../../rules/catan/types.ts';
import type { CatanActionHistoryView, CatanCardsPlayerView, CatanCardsView, CatanDevelopmentPlayView } from './card-types.ts';
import { type CatanRgb as Rgb, RESOURCE_LOOK, RESOURCE_ORDER, ROAD_ICON, SETTLEMENT_ICON } from './palette.ts';

export const CATAN_LOCAL_COLOR: PlayerColor = 'red';
export const CATAN_BANK_TRADE_RATE = 4;
const DEFAULT_MARITIME_RATES = maritimeTradeRates([]);
const DEFAULT_MARITIME_PORT_RATES = maritimePortTradeRates([]);

const liveHand: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
const liveDevHand: Record<DevCardType, number> = { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
const WORKBENCH_BANK_START: Record<Resource, number> = { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 };
const liveBank: Record<Resource, number> = { ...WORKBENCH_BANK_START };
const WORKBENCH_DEV_SEED = 0xc47a_2026;
let liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
// Purchases reserve cards in deck order immediately, while the visible pile is decremented only
// when each flight launches. This lets another purchase be queued before the first card lands
// without drawing the same top card twice.
const reservedDevelopmentCards: DevCardType[] = [];
let developmentPlay: CatanDevelopmentPlayView | null = null;
let livePlayedKnights = 0;
let tradeOpen = false;
let nextPlayerTradeId = 1;

export type CatanPlayerTradeReactionStatus = 'pending' | 'accepted' | 'rejected';

export interface CatanPlayerTradeReaction {
  player: CatanCardsPlayerView;
  status: CatanPlayerTradeReactionStatus;
}

export interface CatanPlayerTradeOffer {
  id: number;
  offerer: CatanCardsPlayerView;
  give: Record<Resource, number>;
  get: Record<Resource, number>;
  reactions: CatanPlayerTradeReaction[];
}

function emptyResourceCounts(): Record<Resource, number> {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export const workbenchTradeGive = emptyResourceCounts();
export const workbenchTradeGet = emptyResourceCounts();
const liveHistory: CatanActionHistoryView[] = [];
const livePlayerTradeOffers: CatanPlayerTradeOffer[] = [];
const playerTradeTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTradeStaging(): void {
  for (const resource of RESOURCE_ORDER) {
    workbenchTradeGive[resource] = 0;
    workbenchTradeGet[resource] = 0;
  }
}

export function adjustCatanWorkbenchHand(resource: Resource, delta: number): boolean {
  const next = liveHand[resource] + delta;
  if (next < 0) return false;
  liveHand[resource] = next;
  return true;
}

export function adjustCatanWorkbenchDev(type: DevCardType, delta: number): boolean {
  const next = liveDevHand[type] + delta;
  if (next < 0) return false;
  liveDevHand[type] = next;
  return true;
}

function developmentPlaySteps(type: Exclude<DevCardType, 'victoryPoint'>): number {
  if (type === 'roadBuilding' || type === 'yearOfPlenty') return 2;
  return 1;
}

export function beginCatanWorkbenchDevelopmentPlay(type: DevCardType): boolean {
  if (type === 'victoryPoint' || developmentPlay || liveDevHand[type] <= 0) return false;
  if (type === 'yearOfPlenty' && RESOURCE_ORDER.every((resource) => liveBank[resource] === 0)) return false;
  liveDevHand[type]--;
  developmentPlay = { type, remaining: developmentPlaySteps(type), resources: [] };
  liveHistory.push({
    actor: 'You',
    color: CATAN_LOCAL_COLOR,
    message: type === 'knight'
      ? 'played a knight'
      : type === 'roadBuilding'
        ? 'played road building'
        : type === 'yearOfPlenty'
          ? 'played year of plenty'
          : 'played monopoly',
  });
  if (type === 'knight') livePlayedKnights++;
  return true;
}

export function catanWorkbenchDevelopmentPlay(): CatanDevelopmentPlayView | null {
  return developmentPlay ? { ...developmentPlay, resources: [...developmentPlay.resources] } : null;
}

export function completeCatanWorkbenchDevelopmentStep(type: 'knight' | 'roadBuilding'): boolean {
  if (developmentPlay?.type !== type) return false;
  developmentPlay.remaining--;
  if (developmentPlay.remaining <= 0) developmentPlay = null;
  return true;
}

export function finishCatanWorkbenchDevelopmentPlay(type: Exclude<DevCardType, 'victoryPoint'>): boolean {
  if (developmentPlay?.type !== type) return false;
  developmentPlay = null;
  return true;
}

export function chooseCatanWorkbenchDevelopmentResource(resource: Resource): boolean {
  const play = developmentPlay;
  if (!play || (play.type !== 'yearOfPlenty' && play.type !== 'monopoly')) return false;
  if (play.type === 'monopoly') {
    liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `named ${RESOURCE_LOOK[resource].name} for monopoly` });
    developmentPlay = null;
    return true;
  }
  if (liveBank[resource] <= 0) return false;
  liveBank[resource]--;
  liveHand[resource]++;
  play.resources.push(resource);
  play.remaining--;
  if (play.remaining <= 0 || RESOURCE_ORDER.every((candidate) => liveBank[candidate] === 0)) {
    const received = [...play.resources];
    developmentPlay = null;
    logCatanReceived(received);
  }
  return true;
}

export function catanTradeEditorOpen(): boolean {
  return tradeOpen;
}

export function setCatanTradeEditorOpen(open: boolean): void {
  tradeOpen = open;
  if (!open) clearTradeStaging();
}

export function setCatanWorkbenchTradeSelection(give: Resource | null, get: Resource | null, giveCount = CATAN_BANK_TRADE_RATE): void {
  clearTradeStaging();
  if (give) workbenchTradeGive[give] = giveCount;
  if (get) workbenchTradeGet[get] = 1;
}

export function adjustCatanWorkbenchTradeStaging(side: 'give' | 'receive', resource: Resource, delta: number): boolean {
  const staged = side === 'give' ? workbenchTradeGive : workbenchTradeGet;
  const available = side === 'give' ? liveHand[resource] : liveBank[resource];
  const next = staged[resource] + delta;
  if (next < 0 || next > available) return false;
  staged[resource] = next;
  return true;
}

export interface CatanWorkbenchMaritimeTrade {
  give: Resource;
  gets: Resource[];
  rate: 2 | 3 | 4;
}

export type CatanWorkbenchMaritimeTradeVia = 'bank' | 'port';

function stagedCatanTrade(ratesFor: (resource: Resource) => readonly (2 | 3 | 4)[]): CatanWorkbenchMaritimeTrade | null {
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

export function stagedCatanBankTrade(): CatanWorkbenchMaritimeTrade | null {
  return stagedCatanTrade(() => [CATAN_BANK_TRADE_RATE]);
}

export function stagedCatanPortTrade(rates: MaritimePortTradeRates): CatanWorkbenchMaritimeTrade | null {
  return stagedCatanTrade((resource) => rates[resource]);
}

export function stagedCatanPlayerTradeValid(): boolean {
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

export function createCatanWorkbenchPlayerTrade(
  offerer: CatanCardsPlayerView,
  opponents: CatanCardsPlayerView[],
  onResolve: () => void,
): number | null {
  if (!stagedCatanPlayerTradeValid() || opponents.length === 0) return null;
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

export function resolveCatanWorkbenchPlayerTradeOffer(id: number): boolean {
  return finishDummyPlayerTradeReactions(id);
}

export function catanWorkbenchPlayerTradeOffers(): CatanPlayerTradeOffer[] {
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

export function cancelCatanWorkbenchPlayerTrade(id: number): boolean {
  const index = livePlayerTradeOffers.findIndex((offer) => offer.id === id);
  if (index < 0) return false;
  const timer = playerTradeTimers.get(id);
  if (timer) clearTimeout(timer);
  playerTradeTimers.delete(id);
  livePlayerTradeOffers.splice(index, 1);
  return true;
}

export function completeCatanWorkbenchPlayerTrade(id: number, playerName: string): boolean {
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
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `completed a trade with ${playerName}` });
  return cancelCatanWorkbenchPlayerTrade(id);
}

function canCommitCatanWorkbenchMaritimeTrade(trade: CatanWorkbenchMaritimeTrade): boolean {
  const giveCount = trade.rate * trade.gets.length;
  if (trade.gets.length === 0 || liveHand[trade.give] < giveCount || trade.gets.some((get) => get === trade.give)) return false;
  const received = emptyResourceCounts();
  for (const get of trade.gets) received[get]++;
  if (RESOURCE_ORDER.some((resource) => received[resource] > liveBank[resource])) return false;
  return true;
}

function commitCatanWorkbenchMaritimePayment(trade: CatanWorkbenchMaritimeTrade): boolean {
  if (!canCommitCatanWorkbenchMaritimeTrade(trade)) return false;
  const giveCount = trade.rate * trade.gets.length;
  liveHand[trade.give] -= giveCount;
  liveBank[trade.give] += giveCount;
  return true;
}

export function departCatanWorkbenchHandResource(resource: Resource): boolean {
  if (liveHand[resource] <= 0) return false;
  liveHand[resource] -= 1;
  return true;
}

export function landCatanWorkbenchBankResource(resource: Resource): void {
  liveBank[resource] += 1;
}

export function departCatanWorkbenchBankResource(resource: Resource): boolean {
  if (liveBank[resource] <= 0) return false;
  liveBank[resource] -= 1;
  return true;
}

export function logCatanWorkbenchMaritimeTrade(
  trade: CatanWorkbenchMaritimeTrade,
  via: CatanWorkbenchMaritimeTradeVia,
): void {
  const giveCount = trade.rate * trade.gets.length;
  const received = emptyResourceCounts();
  for (const resource of trade.gets) received[resource]++;
  const summary = RESOURCE_ORDER
    .filter((resource) => received[resource] > 0)
    .map((resource) => `${received[resource]} ${RESOURCE_LOOK[resource].name}`)
    .join(' + ');
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `traded ${giveCount} ${RESOURCE_LOOK[trade.give].name} for ${summary} via ${via}` });
}

function beginStagedCatanWorkbenchMaritimeTrade(trade: CatanWorkbenchMaritimeTrade | null): CatanWorkbenchMaritimeTrade | null {
  // Animated trades settle both sides card by card. Validate and close the editor here, but leave
  // the counts untouched until each offered card departs the hand and lands in the bank.
  if (!trade || !canCommitCatanWorkbenchMaritimeTrade(trade)) return null;
  setCatanTradeEditorOpen(false);
  return trade;
}

export function beginStagedCatanWorkbenchBankTrade(): CatanWorkbenchMaritimeTrade | null {
  return beginStagedCatanWorkbenchMaritimeTrade(stagedCatanBankTrade());
}

export function beginStagedCatanWorkbenchPortTrade(rates: MaritimePortTradeRates): CatanWorkbenchMaritimeTrade | null {
  return beginStagedCatanWorkbenchMaritimeTrade(stagedCatanPortTrade(rates));
}

function performCatanWorkbenchMaritimeTrade(
  give: Resource,
  gets: Resource[],
  rate: 2 | 3 | 4,
  via: CatanWorkbenchMaritimeTradeVia,
): boolean {
  const trade = { give, gets, rate };
  if (!commitCatanWorkbenchMaritimePayment(trade)) return false;
  for (const resource of gets) {
    if (!departCatanWorkbenchBankResource(resource)) return false;
    bankCatanResource(resource);
  }
  logCatanWorkbenchMaritimeTrade(trade, via);
  return true;
}

export function performCatanWorkbenchBankTrade(give: Resource, get: Resource): boolean {
  return performCatanWorkbenchMaritimeTrade(give, [get], CATAN_BANK_TRADE_RATE, 'bank');
}

export function performCatanWorkbenchPortTrade(
  give: Resource,
  get: Resource,
  rates: MaritimePortTradeRates,
  rate: MaritimePortTradeRate = rates[give][0],
): boolean {
  return rates[give].includes(rate) && performCatanWorkbenchMaritimeTrade(give, [get], rate, 'port');
}

export function performStagedCatanWorkbenchBankTrade(): boolean {
  const trade = stagedCatanBankTrade();
  if (!trade || !performCatanWorkbenchMaritimeTrade(trade.give, trade.gets, trade.rate, 'bank')) return false;
  clearTradeStaging();
  return true;
}

export function performStagedCatanWorkbenchPortTrade(rates: MaritimePortTradeRates): boolean {
  const trade = stagedCatanPortTrade(rates);
  if (!trade || !performCatanWorkbenchMaritimeTrade(trade.give, trade.gets, trade.rate, 'port')) return false;
  clearTradeStaging();
  return true;
}

export function beginCatanWorkbenchDevPurchase(): DevCardType | null {
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

export function departCatanWorkbenchDevCard(expected: DevCardType): boolean {
  if (reservedDevelopmentCards[0] !== expected || liveDevelopmentDeck.at(-1) !== expected) return false;
  reservedDevelopmentCards.shift();
  liveDevelopmentDeck.pop();
  return true;
}

export function landCatanWorkbenchDevCard(type: DevCardType): void {
  liveDevHand[type] += 1;
}

export function logCatanWorkbenchDevPurchase(): void {
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: 'bought a development card' });
}

export function buyCatanWorkbenchDevCard(): boolean {
  const drawn = beginCatanWorkbenchDevPurchase();
  if (!drawn || !departCatanWorkbenchDevCard(drawn)) return false;
  landCatanWorkbenchDevCard(drawn);
  logCatanWorkbenchDevPurchase();
  return true;
}

export function resetCatanWorkbenchCards(): void {
  for (const resource of RESOURCE_ORDER) {
    liveHand[resource] = 0;
    liveBank[resource] = WORKBENCH_BANK_START[resource];
  }
  for (const type of DEV_CARD_TYPES) liveDevHand[type] = 0;
  liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
  reservedDevelopmentCards.length = 0;
  developmentPlay = null;
  livePlayedKnights = 0;
  liveHistory.length = 0;
  for (const timer of playerTradeTimers.values()) clearTimeout(timer);
  playerTradeTimers.clear();
  livePlayerTradeOffers.length = 0;
  nextPlayerTradeId = 1;
  setCatanTradeEditorOpen(false);
}

export function bankCatanResource(resource: Resource): void {
  liveHand[resource] += 1;
}

export function logCatanReceived(drawn: Resource[]): void {
  if (drawn.length) liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: 'received', resources: drawn });
}

export function logCatanRoll(sum: number): void {
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `rolled a ${sum}` });
}

export function logCatanRobberMove(terrain: Terrain): void {
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `moved the robber to the ${terrain} tile` });
}

export function catanResourceFace(resource: Resource): { emoji: string; fill: Rgb } {
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

export function catanWorkbenchView(
  rates: MaritimeTradeRates = DEFAULT_MARITIME_RATES,
  portRates: MaritimePortTradeRates = inferredPortRates(rates),
): CatanCardsView {
  const seeded = CATAN_CARD_WORKBENCH_VIEW;
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
    opponents: seeded.opponents.map((player) => hasLargestArmy && player.hasLargestArmy
      ? { ...player, hasLargestArmy: false }
      : player),
    history: [...seeded.history, ...liveHistory],
  };
}

export const CATAN_CARD_WORKBENCH_VIEW: CatanCardsView = {
  source: 'workbench',
  localPlayer: { name: 'You', color: CATAN_LOCAL_COLOR, publicVp: 3, resourceCards: 0, developmentCards: 0, knights: 2, longestRoad: 5, active: true },
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
    { actor: 'You', color: 'red', message: 'bought a development card' },
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
