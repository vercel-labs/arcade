// Core Catan primitives — no rendering, no board geometry, no game logic. Just the
// vocabulary the rest of the engine is written in: resources, terrain, pieces, ports,
// the resource "freqdeck" (an order-free count vector, the bank's and each hand's shape),
// costs, and the action / prompt unions. Base 3–4 player game. See docs/catan.md.

// ── Resources ──────────────────────────────────────────────────────────────────
// A fixed order so a hand or the bank is a 5-slot count vector (a "freqdeck") indexed
// by resource. Resources are fungible, so a hand IS just its counts — the only hidden
// thing about an opponent's hand is the breakdown, not the total.
export const RESOURCES = ['brick', 'grain', 'lumber', 'ore', 'wool'] as const;
export type Resource = (typeof RESOURCES)[number];
export const NUM_RESOURCES = RESOURCES.length;
export const resourceIndex = (r: Resource): number => RESOURCES.indexOf(r);

// ── Terrain ──────────────────────────────────────────────────────────────────────
export const TERRAINS = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert'] as const;
export type Terrain = (typeof TERRAINS)[number];

// What each terrain yields when its number is rolled (desert yields nothing).
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  forest: 'lumber',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
};

// The 19-hex terrain multiset for the base game: 4 forest, 4 pasture, 4 fields, 3 hills,
// 3 mountains, 1 desert.
export const TERRAIN_COUNTS: Record<Terrain, number> = {
  forest: 4,
  pasture: 4,
  fields: 4,
  hills: 3,
  mountains: 3,
  desert: 1,
};

// The 18 number tokens (one 2, one 12; two each of 3–6 and 8–11; no 7). Placed on the 18
// non-desert hexes. NUMBER_TOKENS is the order-free component multiset used by invariants;
// OFFICIAL_NUMBER_SEQUENCE is the A–R order printed on the backs of the discs and used by
// the current rulebook's counterclockwise outside-in spiral setup.
export const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12] as const;
export const OFFICIAL_NUMBER_SEQUENCE = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11] as const;
export const RED_NUMBERS: readonly number[] = [6, 8];

// Dots (probability pips) under a token — how many of 36 rolls produce it. Also the
// value-function weight for a spot's yield. 7 is absent (robber).
export const TOKEN_DOTS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

// ── Players & pieces ───────────────────────────────────────────────────────────
// Seats are indices 0..n-1 (the harness contract). Colors are purely presentational.
// `purple` stands where the physical game has white: as ink on a dark rail, white is the same
// color as ordinary body copy, so a white seat could not be told from unstyled text.
export const PLAYER_COLORS = ['red', 'blue', 'purple', 'orange'] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export type BuildingType = 'settlement' | 'city';

// Per-player piece pools (hard caps): 5 settlements, 4 cities, 15 roads.
export const PIECE_LIMITS = { settlement: 5, city: 4, road: 15 } as const;

// ── Ports / harbors ──────────────────────────────────────────────────────────────
// A generic port (resource: null) trades any 3 identical cards for 1; a specific port
// trades 2 of its resource for 1. Base game: 4 generic (3:1) + 5 specific (2:1), one per
// resource.
export interface Port {
  ratio: 2 | 3;
  resource: Resource | null; // null = generic 3:1
}

export const PORTS: readonly Port[] = [
  { ratio: 3, resource: null },
  { ratio: 3, resource: null },
  { ratio: 3, resource: null },
  { ratio: 3, resource: null },
  { ratio: 2, resource: 'brick' },
  { ratio: 2, resource: 'grain' },
  { ratio: 2, resource: 'lumber' },
  { ratio: 2, resource: 'ore' },
  { ratio: 2, resource: 'wool' },
];

// ── Development cards ─────────────────────────────────────────────────────────────
export const DEV_CARD_TYPES = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const;
export type DevCardType = (typeof DEV_CARD_TYPES)[number];

// Deck composition (25): 14 knights, 5 victory-point, 2 each of the 3 progress cards.
export const DEV_CARD_COUNTS: Record<DevCardType, number> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};

// ── The bank & the freqdeck ───────────────────────────────────────────────────────
// A resource count vector indexed by resourceIndex. The bank starts at 19 of each; every
// hand is one of these too. Kept as a plain number[] (length 5) so clone/compare/add/sub
// are trivial and it serializes cleanly.
export type FreqDeck = number[];
export const BANK_PER_RESOURCE = 19;

export const emptyFreqDeck = (): FreqDeck => new Array(NUM_RESOURCES).fill(0);
export const fullBank = (): FreqDeck => new Array(NUM_RESOURCES).fill(BANK_PER_RESOURCE);
export const freqTotal = (d: FreqDeck): number => d.reduce((a, b) => a + b, 0);

// Build a cost freqdeck from a partial resource→count map (undefined = 0).
function cost(spec: Partial<Record<Resource, number>>): FreqDeck {
  const d = emptyFreqDeck();
  for (const r of RESOURCES) if (spec[r]) d[resourceIndex(r)] = spec[r] as number;
  return d;
}

// Building / purchase costs (paid back to the bank).
export const COSTS = {
  road: cost({ brick: 1, lumber: 1 }),
  settlement: cost({ brick: 1, lumber: 1, wool: 1, grain: 1 }),
  city: cost({ ore: 3, grain: 2 }),
  devCard: cost({ ore: 1, wool: 1, grain: 1 }),
} as const;

// ── Game constants ────────────────────────────────────────────────────────────────
export const VP_TO_WIN = 10;
export const DISCARD_LIMIT = 7; // players holding MORE than this discard on a rolled 7
export const LONGEST_ROAD_MIN = 5; // segments needed to claim Longest Road
export const LARGEST_ARMY_MIN = 3; // played knights needed to claim Largest Army
export const ROBBER_ROLL = 7;

// ── Actions ─────────────────────────────────────────────────────────────────────
// The full action union — the single source of truth `legalActions()` draws from and
// `applyAction()` consumes. Nodes/edges/hexes are integer topology IDs (board-topology.ts).
// Domestic trade (offer/accept/reject/confirm/cancel) is first-class here but gated off by
// default for AI in the rules layer — see docs/catan.md §3.6.
export type CatanAction =
  // Initial placement (snake phase).
  | { type: 'initialSettlement'; node: number }
  | { type: 'initialRoad'; edge: number }
  // Turn spine.
  | { type: 'roll' }
  | { type: 'endTurn' }
  // Build / buy.
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildSettlement'; node: number }
  | { type: 'buildCity'; node: number }
  | { type: 'buyDevCard' }
  // Development cards.
  | { type: 'playKnight'; hex: number; victim: number | null }
  | { type: 'playRoadBuilding'; edges: number[] }
  | { type: 'playYearOfPlenty'; resources: Resource[] }
  | { type: 'playMonopoly'; resource: Resource }
  // Robber sub-machine (triggered by a rolled 7 or a knight).
  | { type: 'discard'; resources: Resource[] }
  | { type: 'moveRobber'; hex: number; victim: number | null }
  // Trade.
  | { type: 'maritimeTrade'; via: 'bank'; give: Resource; get: Resource }
  | { type: 'maritimeTrade'; via: 'port'; rate: 2 | 3; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: FreqDeck; receive: FreqDeck }
  | { type: 'acceptTrade' }
  | { type: 'rejectTrade' }
  | { type: 'confirmTrade'; with: number }
  | { type: 'cancelTrade' };

// ── Prompts (the turn/phase state machine) ───────────────────────────────────────
// What the awaited player is being asked to do. `player` (who must act NOW) is decoupled
// from the turn owner — a rolled 7 enqueues one `discard` prompt per over-limit player
// (in seating order), each of which may be a different, non-turn player, before the turn
// owner is asked to move the robber. `currentPlayer()` returns `prompt.player`.
export type Prompt =
  | { kind: 'initialSettlement'; player: number }
  | { kind: 'initialRoad'; player: number }
  | { kind: 'roll'; player: number }
  | { kind: 'discard'; player: number }
  | { kind: 'moveRobber'; player: number }
  | { kind: 'playTurn'; player: number } // trade / build / play dev card / end turn
  | { kind: 'respondTrade'; player: number }
  | { kind: 'decideAcceptees'; player: number };
