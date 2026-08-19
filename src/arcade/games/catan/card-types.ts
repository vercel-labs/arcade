import type { DevCardType, PlayerColor, Resource } from '../../../rules/catan/types.ts';
import type { MaritimePortTradeRates, MaritimeTradeRates } from '../../../rules/catan/maritime-trade.ts';

// Viewer-safe card HUD data. Keeping this contract separate from the workbench state and
// presentation lets the eventual live-game adapter feed the same HUD without importing test
// controls or terminal layout code.
export interface CatanCardsPlayerView {
  name: string;
  color: PlayerColor;
  publicVp: number;
  resourceCards: number;
  developmentCards: number;
  knights: number;
  longestRoad: number;
  active?: boolean;
  hasLargestArmy?: boolean;
  hasLongestRoad?: boolean;
}

export interface CatanActionHistoryView {
  actor: string;
  color: PlayerColor;
  message: string;
  resources?: Resource[];
  chat?: boolean;
}

export interface CatanCardsView {
  localPlayer: CatanCardsPlayerView;
  hand: Record<Resource, number>;
  devHand: Record<DevCardType, number>;
  bank: Record<Resource, number>;
  maritimeRates: MaritimeTradeRates;
  maritimePortRates: MaritimePortTradeRates;
  developmentDeck: number;
  opponents: CatanCardsPlayerView[];
  history: CatanActionHistoryView[];
  // A maritime exchange is between acceptance and its final animated arrival. The workbench
  // keeps another trade from opening while those bank cards are reserved in flight.
  maritimeTradeBusy?: boolean;
  developmentPurchaseBusy?: boolean;
  pendingDevelopmentCard?: DevCardType;
  // Test-bed views opt into direct card manipulation; live-game adapters leave this unset.
  editable?: boolean;
}
