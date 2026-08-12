import { mulberry32 } from '../../../engine/index.ts';
import { buildDevelopmentDeck } from '../../../rules/catan/development.ts';
import { COSTS, DEV_CARD_TYPES, type DevCardType, type PlayerColor, type Resource, resourceIndex, type Terrain } from '../../../rules/catan/types.ts';
import type { CatanActionHistoryView, CatanCardsView } from './card-types.ts';
import { type CatanRgb as Rgb, RESOURCE_LOOK, RESOURCE_ORDER, ROAD_ICON, SETTLEMENT_ICON } from './palette.ts';

export const CATAN_LOCAL_COLOR: PlayerColor = 'red';
export const CATAN_TRADE_RATIO = 4;

const liveHand: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
const liveDevHand: Record<DevCardType, number> = { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
const WORKBENCH_BANK_START: Record<Resource, number> = { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 };
const liveBank: Record<Resource, number> = { ...WORKBENCH_BANK_START };
const WORKBENCH_DEV_SEED = 0xc47a_2026;
let liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
let tradeOpen = false;

function emptyResourceCounts(): Record<Resource, number> {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export const workbenchTradeGive = emptyResourceCounts();
export const workbenchTradeGet = emptyResourceCounts();
const liveHistory: CatanActionHistoryView[] = [];

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

export function catanTradeEditorOpen(): boolean {
  return tradeOpen;
}

export function setCatanTradeEditorOpen(open: boolean): void {
  tradeOpen = open;
  if (!open) clearTradeStaging();
}

export function setCatanWorkbenchTradeSelection(give: Resource | null, get: Resource | null): void {
  clearTradeStaging();
  if (give) workbenchTradeGive[give] = CATAN_TRADE_RATIO;
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

export function stagedCatanBankTrade(): { give: Resource; get: Resource } | null {
  const giveResources = RESOURCE_ORDER.filter((resource) => workbenchTradeGive[resource] > 0);
  const getResources = RESOURCE_ORDER.filter((resource) => workbenchTradeGet[resource] > 0);
  if (giveResources.length !== 1 || getResources.length !== 1) return null;
  const give = giveResources[0];
  const get = getResources[0];
  if (give === get || workbenchTradeGive[give] !== CATAN_TRADE_RATIO || workbenchTradeGet[get] !== 1) return null;
  return { give, get };
}

export function performCatanWorkbenchBankTrade(give: Resource, get: Resource): boolean {
  if (give === get || liveHand[give] < CATAN_TRADE_RATIO || liveBank[get] < 1) return false;
  liveHand[give] -= CATAN_TRADE_RATIO;
  liveBank[give] += CATAN_TRADE_RATIO;
  liveBank[get] -= 1;
  liveHand[get] += 1;
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `traded ${CATAN_TRADE_RATIO} ${RESOURCE_LOOK[give].name} for 1 ${RESOURCE_LOOK[get].name}` });
  return true;
}

export function performStagedCatanWorkbenchBankTrade(): boolean {
  const trade = stagedCatanBankTrade();
  if (!trade || !performCatanWorkbenchBankTrade(trade.give, trade.get)) return false;
  clearTradeStaging();
  return true;
}

export function buyCatanWorkbenchDevCard(): boolean {
  if (liveDevelopmentDeck.length === 0) return false;
  for (const resource of RESOURCE_ORDER) {
    if (liveHand[resource] < COSTS.devCard[resourceIndex(resource)]) return false;
  }
  for (const resource of RESOURCE_ORDER) {
    const amount = COSTS.devCard[resourceIndex(resource)];
    liveHand[resource] -= amount;
    liveBank[resource] += amount;
  }
  const drawn = liveDevelopmentDeck.pop();
  if (!drawn) return false;
  liveDevHand[drawn] += 1;
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: 'bought a development card' });
  return true;
}

export function resetCatanWorkbenchCards(): void {
  for (const resource of RESOURCE_ORDER) {
    liveHand[resource] = 0;
    liveBank[resource] = WORKBENCH_BANK_START[resource];
  }
  for (const type of DEV_CARD_TYPES) liveDevHand[type] = 0;
  liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
  liveHistory.length = 0;
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

export function catanWorkbenchView(): CatanCardsView {
  const seeded = CATAN_CARD_WORKBENCH_VIEW;
  const held = RESOURCE_ORDER.reduce((sum, resource) => sum + liveHand[resource], 0);
  const dev = DEV_CARD_TYPES.reduce((sum, type) => sum + liveDevHand[type], 0);
  return {
    ...seeded,
    hand: { ...liveHand },
    devHand: { ...liveDevHand },
    bank: { ...liveBank },
    developmentDeck: liveDevelopmentDeck.length,
    editable: true,
    localPlayer: { ...seeded.localPlayer, resourceCards: held, developmentCards: dev },
    history: [...seeded.history, ...liveHistory],
  };
}

export const CATAN_CARD_WORKBENCH_VIEW: CatanCardsView = {
  localPlayer: { name: 'You', color: CATAN_LOCAL_COLOR, publicVp: 3, resourceCards: 0, developmentCards: 0, knights: 2, longestRoad: 5, active: true },
  hand: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
  devHand: { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
  bank: { ...WORKBENCH_BANK_START },
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
