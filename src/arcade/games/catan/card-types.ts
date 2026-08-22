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

export interface CatanDevelopmentPlayView {
  type: Exclude<DevCardType, 'victoryPoint'>;
  remaining: number;
  resources: Resource[];
}

export interface CatanCardsView {
  // The shared HUD renders both the real game and the experimental Catan-Test cover. Keep the
  // source explicit so test-only controls and dummy data cannot leak into a live game view.
  source: 'live' | 'workbench';
  localPlayer: CatanCardsPlayerView;
  hand: Record<Resource, number>;
  devHand: Record<DevCardType, number>;
  bank: Record<Resource, number>;
  maritimeRates: MaritimeTradeRates;
  maritimePortRates: MaritimePortTradeRates;
  developmentDeck: number;
  // May be lower than the visible pile while cards are reserved for flights that have not yet
  // departed. Action gating uses this without making the displayed pile count jump early.
  developmentDeckAvailable?: number;
  opponents: CatanCardsPlayerView[];
  history: CatanActionHistoryView[];
  // A maritime exchange is between acceptance and its final animated arrival. The workbench
  // keeps another trade from opening while those bank cards are reserved in flight.
  maritimeTradeBusy?: boolean;
  // Purchase flights may overlap. Pending types reserve disabled landing slots without exposing
  // the card in the held count before its own flight arrives.
  developmentPurchaseBusy?: boolean;
  pendingDevelopmentCards?: DevCardType[];
  /** Playable now for the local live seat; purchased-this-turn and post-play cards are absent. */
  playableDevelopmentCards?: Exclude<DevCardType, 'victoryPoint'>[];
  // A workbench card has been committed and is waiting for its board/resource choices.
  // The live rules engine represents the same state through legal actions instead.
  developmentPlay?: CatanDevelopmentPlayView;
}
