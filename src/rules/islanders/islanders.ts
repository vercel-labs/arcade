// Islanders (base 3–4 player game) as a harness state. One `IslandersState` = ONE full game, played
// to 10 victory points — like `ChessState` is one game (not one hand like poker's
// `HoldemState`). It implements the OpenSpiel-style `ImperfectInfoState`: dev cards, the
// dev-deck order, and opponents' exact hand breakdowns are hidden; `informationStateString`
// is the per-seat observation an AI is prompted on.
//
// The complete base-game rules run headlessly through the generic model harness. Rendering
// is a consumer of this state, never a prerequisite for legality or progression.
//
// Chance is resolved INTERNALLY (dice rolls, dev-card draws, robber steals) via an injected
// seeded RNG, so `isChanceNode()` is always false — this keeps Islanders compatible with the
// generic `runMatch` loop (ai/match.ts), which can't resolve chance nodes, exactly as poker
// deals internally. See docs/islanders.md §3.2.
//
// Players are seat indices 0..n-1.

import { type Game, type GameState, type ImperfectInfoState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { edgeNodes, HEX_COORDS, hexNodes, nodeEdges, nodeHexes, NUM_EDGES, NUM_HEXES, NUM_NODES } from './board-topology.ts';
import { canPlaceRoad, canPlaceSettlement, canUpgradeCity, type BoardOccupancy } from './placement.ts';
import { type BoardSetup, generateBoard, nodeProduction } from './setup.ts';
import { buildDevelopmentDeck } from './development.ts';
import {
  maritimePortTradeRates,
  maritimeTradeRates,
  portsAtNodes,
  type MaritimePortTradeRates,
  type MaritimeTradeRates,
} from './maritime-trade.ts';
import {
  type BuildingType,
  type IslandersAction,
  COSTS,
  DISCARD_LIMIT,
  DEV_CARD_TYPES,
  type DevCardType,
  emptyFreqDeck,
  type FreqDeck,
  freqTotal,
  fullBank,
  LARGEST_ARMY_MIN,
  LONGEST_ROAD_MIN,
  PIECE_LIMITS,
  type Port,
  type Prompt,
  RESOURCES,
  type Resource,
  resourceIndex,
  ROBBER_ROLL,
  TERRAIN_RESOURCE,
  type Terrain,
  TOKEN_DOTS,
  VP_TO_WIN,
} from './types.ts';

const PUBLIC_RESOURCE: Record<Resource, { name: string; emoji: string }> = {
  brick: { name: 'brick', emoji: '🧱' },
  grain: { name: 'wheat', emoji: '🌾' },
  lumber: { name: 'wood', emoji: '🪵' },
  ore: { name: 'ore', emoji: '🪨' },
  wool: { name: 'sheep', emoji: '🐑' },
};

const PUBLIC_RESOURCE_ORDER = 'brick / wheat (grain) / wood (lumber) / ore / sheep (wool)';

function publicResource(resource: Resource): string {
  return PUBLIC_RESOURCE[resource].name;
}

function compassDirection(x: number, y: number): string {
  const angle = Math.atan2(y, x);
  const sectors = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const;
  return sectors[Math.round(angle / (Math.PI / 4) + 8) % 8];
}

function hexPosition(hex: number): { x: number; y: number } {
  const { q, r } = HEX_COORDS[hex];
  return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r };
}

function nodePosition(node: number): { x: number; y: number } {
  const hex = nodeHexes[node][0];
  const corner = hexNodes[hex].indexOf(node);
  const center = hexPosition(hex);
  const angle = (-30 - corner * 60) * Math.PI / 180;
  return { x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) };
}

export interface IslandersOpts {
  numPlayers: number; // base game is 3–4; 2 is allowed for testing
  rng?: () => number; // injected for reproducible boards/deals (defaults to Math.random)
  /** Reuse an already-presented board instead of generating a second arrangement. */
  board?: BoardSetup;
  // Optional per-seat display names for the observation (e.g. a model slug); defaults to
  // "P0"/"P1"… so the engine stays generic, as poker does.
  seatNames?: readonly string[];
  /** Player-to-player offers are complete but opt-in for model experiments. */
  domesticTrade?: boolean;
  /** Optional controller policy used by AI-only tables to prevent unchanged offer loops. */
  domesticTradeOfferLimit?: number;
}

export interface IslandersActionOutcome {
  dice?: [number, number];
  developmentCard?: DevCardType;
  stolenResource?: Resource | null;
}

export interface IslandersActionRecord {
  player: number;
  action: IslandersAction;
  outcome?: IslandersActionOutcome;
}

export interface IslandersTranscript {
  numPlayers: number;
  seatNames?: string[];
  domesticTrade: boolean;
  domesticTradeOfferLimit?: number;
  board: BoardSetup;
  initialDevelopmentDeck: DevCardType[];
  /** Random values already sampled by setup and recorded chance actions. */
  randomTape: number[];
  initialRandomCursor: number;
  actions: IslandersActionRecord[];
}

interface TradeState {
  from: number;
  give: FreqDeck;
  receive: FreqDeck;
  responders: number[];
  accepted: number[];
  counters: { from: number; give: FreqDeck; receive: FreqDeck }[];
  responseIndex: number;
}

export interface IslandersPortfolio {
  production: Partial<Record<Resource, number>>;
  totalPips: number;
  resourceDiversity: number;
  numberCoverage: number[];
  ports: Port[];
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  longestRoadLength: number;
}

export type IslandersActionFamily =
  | { type: 'discard'; player: number; count: number; available: FreqDeck }
  | { type: 'offerTrade'; player: number; resourceOrder: readonly Resource[] }
  | { type: 'counterTrade'; player: number; resourceOrder: readonly Resource[] };

interface Building {
  player: number;
  type: BuildingType;
}

export interface SettlementSite {
  node: number;
  adjacentHexes: {
    hex: number;
    terrain: Terrain;
    resource: Resource | null;
    token: number | null;
    pips: number;
  }[];
  production: Partial<Record<Resource, number>>;
  totalPips: number;
  resourceDiversity: number;
  port: Port | null;
}

export interface InitialSettlementOption extends SettlementSite {
  action: Extract<IslandersAction, { type: 'initialSettlement' }>;
  /** Neutral facts for the player's complete setup portfolio after this choice. */
  portfolio: InitialSettlementPortfolio;
}

export interface InitialSettlementPortfolio {
  settlementNodes: number[];
  production: Partial<Record<Resource, number>>;
  totalPips: number;
  resourceDiversity: number;
  numberCoverage: number[];
  repeatedNumbers: number[];
  /** Resources this candidate adds that the player's existing settlement lacks. */
  newResources: Resource[];
  /** Cards granted immediately when this is the player's second settlement. */
  startingResources: Resource[];
  ports: {
    ratio: 2 | 3;
    resource: Resource | null;
    /** Production in the matching resource; null for a generic 3:1 port. */
    matchingProductionPips: number | null;
  }[];
}

export interface InitialRoadOption {
  action: Extract<IslandersAction, { type: 'initialRoad' }>;
  edge: number;
  fromNode: number;
  towardNode: number;
  // Legal settlement sites reachable after extending one more road from `towardNode`.
  // The immediate endpoint itself cannot host a settlement because of the distance rule.
  expansionSites: SettlementSite[];
}

export class IslandersState implements ImperfectInfoState<IslandersAction> {
  readonly n: number;
  private rng: () => number;
  private randomTape: number[] = [];
  private randomCursor = 0;
  private initialRandomCursor = 0;
  private seatNames?: readonly string[];

  // Static-ish board (terrain/tokens/harbors never change after setup; the robber moves).
  private board: BoardSetup;
  private productionByNode: Partial<Record<Resource, number>>[];
  private robberHex: number;

  // Resources: the bank plus each seat's hand, both order-free count vectors (freqdecks).
  private bank: FreqDeck;
  private hands: FreqDeck[];

  // Development cards: an ordered draw deck (order is hidden information) and per-seat counts
  // by type; `playedKnights` are face-up (public, feed Largest Army).
  private devDeck: DevCardType[];
  private initialDevDeck: DevCardType[];
  private devHand: number[][]; // [seat][DEV_CARD_TYPES index]
  private boughtDevThisTurn: number[][];
  private playedKnights: number[];

  // Placed pieces, keyed by topology id.
  private buildings = new Map<number, Building>(); // node → building
  private roads = new Map<number, number>(); // edge → seat

  // Initial placement: number of settlements placed by each seat plus the node whose
  // immediately-adjacent road is currently awaited. Counts drive the 0..n-1,n-1..0 snake.
  private initialSettlements: number[];
  private pendingInitialRoadNode: number | null = null;

  // Special cards (holder seat, or -1 for none).
  private longestRoadHolder = -1;
  private largestArmyHolder = -1;
  private longestRoadLengths: number[];

  // Turn / phase machine. `prompt.player` (who must act now) is decoupled from `turnOwner`
  // (whose turn it is): a rolled 7 enqueues one `discard` prompt per over-limit player
  // before the turn owner moves the robber. `pending` is the interrupt queue.
  private turnOwner = 0;
  private prompt: Prompt;
  private pending: Prompt[] = [];
  private playedDevCardThisTurn = false;
  private discardRemaining: number[];
  private trade: TradeState | null = null;
  private domesticTradeEnabled: boolean;
  private domesticTradeOfferLimit: number;
  private domesticOffersThisTurn = 0;
  private lastDice: [number, number] | null = null;
  private records: IslandersActionRecord[] = [];
  private winnerSeat = -1;

  private finished = false;

  constructor(opts: IslandersOpts) {
    if (!Number.isInteger(opts.numPlayers) || opts.numPlayers < 2 || opts.numPlayers > 4) {
      throw new RangeError(`Islanders supports 2–4 players; received ${opts.numPlayers}`);
    }
    this.n = opts.numPlayers;
    this.rng = opts.rng ?? Math.random;
    this.seatNames = opts.seatNames;
    this.domesticTradeEnabled = opts.domesticTrade ?? false;
    this.domesticTradeOfferLimit = opts.domesticTradeOfferLimit ?? Number.POSITIVE_INFINITY;
    if (this.domesticTradeOfferLimit < 0 || (!Number.isInteger(this.domesticTradeOfferLimit) && this.domesticTradeOfferLimit !== Number.POSITIVE_INFINITY)) {
      throw new RangeError(`domesticTradeOfferLimit must be a nonnegative integer; received ${this.domesticTradeOfferLimit}`);
    }

    this.board = opts.board ?? generateBoard(() => this.random());
    this.productionByNode = nodeProduction(this.board);
    this.robberHex = this.board.robberHex;

    this.bank = fullBank();
    this.hands = Array.from({ length: this.n }, () => emptyFreqDeck());
    this.devDeck = buildDevelopmentDeck(() => this.random());
    this.initialDevDeck = this.devDeck.slice();
    this.initialRandomCursor = this.randomCursor;
    this.devHand = Array.from({ length: this.n }, () => new Array(DEV_CARD_TYPES.length).fill(0));
    this.boughtDevThisTurn = Array.from({ length: this.n }, () => new Array(DEV_CARD_TYPES.length).fill(0));
    this.playedKnights = new Array(this.n).fill(0);
    this.longestRoadLengths = new Array(this.n).fill(0);
    this.initialSettlements = new Array(this.n).fill(0);
    this.discardRemaining = new Array(this.n).fill(0);

    // First-player determination is fixed at seat 0 for now; callers randomize seat/model
    // assignments if desired. The progression itself is the standard two-round snake.
    this.prompt = { kind: 'initialSettlement', player: 0 };
  }

  // ── Harness contract ─────────────────────────────────────────────────────────
  currentPlayer(): number {
    return this.finished ? TERMINAL : this.prompt.player;
  }

  isChanceNode(): boolean {
    return false; // dice/draws/steals resolve internally — see the file header
  }
  chanceOutcomes(): { action: IslandersAction; prob: number }[] {
    return [];
  }

  isTerminal(): boolean {
    return this.finished;
  }

  // Per-seat utility once terminal: +1 for the winner, -1 for everyone else (Islanders has no
  // draws). All zero before the game ends.
  returns(): number[] {
    const w = this.winner();
    if (w < 0) return new Array(this.n).fill(0);
    return Array.from({ length: this.n }, (_, s) => (s === w ? 1 : -1));
  }

  clone(): IslandersState {
    const s = Object.create(IslandersState.prototype) as IslandersState;
    (s as { n: number }).n = this.n;
    s.rng = this.rng;
    // Clones have independent cursors over a shared append-only random tape. Whichever
    // branch samples first fills the next slot; sibling/original states then read that same
    // value, so search rollouts cannot advance one another's future chance stream.
    s.randomTape = this.randomTape;
    s.randomCursor = this.randomCursor;
    s.initialRandomCursor = this.initialRandomCursor;
    s.seatNames = this.seatNames;
    s.board = this.board; // immutable after setup — share by ref
    s.productionByNode = this.productionByNode; // derived from immutable board setup
    s.robberHex = this.robberHex;
    s.bank = this.bank.slice();
    s.hands = this.hands.map((h) => h.slice());
    s.devDeck = this.devDeck.slice();
    s.initialDevDeck = this.initialDevDeck.slice();
    s.devHand = this.devHand.map((d) => d.slice());
    s.boughtDevThisTurn = this.boughtDevThisTurn.map((d) => d.slice());
    s.playedKnights = this.playedKnights.slice();
    s.buildings = new Map(this.buildings);
    s.roads = new Map(this.roads);
    s.initialSettlements = this.initialSettlements.slice();
    s.pendingInitialRoadNode = this.pendingInitialRoadNode;
    s.longestRoadHolder = this.longestRoadHolder;
    s.largestArmyHolder = this.largestArmyHolder;
    s.longestRoadLengths = this.longestRoadLengths.slice();
    s.turnOwner = this.turnOwner;
    s.prompt = { ...this.prompt };
    s.pending = this.pending.map((p) => ({ ...p }));
    s.playedDevCardThisTurn = this.playedDevCardThisTurn;
    s.discardRemaining = this.discardRemaining.slice();
    s.trade = this.trade
      ? {
          ...this.trade,
          give: this.trade.give.slice(),
          receive: this.trade.receive.slice(),
          responders: this.trade.responders.slice(),
          accepted: this.trade.accepted.slice(),
          counters: this.trade.counters.map((counter) => ({
            from: counter.from,
            give: counter.give.slice(),
            receive: counter.receive.slice(),
          })),
        }
      : null;
    s.domesticTradeEnabled = this.domesticTradeEnabled;
    s.domesticTradeOfferLimit = this.domesticTradeOfferLimit;
    s.domesticOffersThisTurn = this.domesticOffersThisTurn;
    s.lastDice = this.lastDice ? [...this.lastDice] : null;
    s.records = this.records.map((record) => ({
      player: record.player,
      action: cloneAction(record.action),
      outcome: record.outcome ? { ...record.outcome, dice: record.outcome.dice ? [...record.outcome.dice] : undefined } : undefined,
    }));
    s.winnerSeat = this.winnerSeat;
    s.finished = this.finished;
    return s;
  }

  // ── Legal actions and authoritative transitions ────────────────────────────────
  legalActions(): IslandersAction[] {
    if (this.finished) return [];
    const player = this.prompt.player;
    switch (this.prompt.kind) {
      case 'initialSettlement':
        return this.initialSettlementOptions().map((option) => option.action);
      case 'initialRoad':
        return this.initialRoadOptions().map((option) => option.action);
      case 'roll':
        return [{ type: 'roll' }, ...this.devCardActions(player)];
      case 'playTurn':
        return [
          { type: 'endTurn' },
          ...this.buildActions(player),
          ...this.maritimeTradeActions(player),
          ...this.devCardActions(player),
        ];
      case 'discard':
        return enumerateDiscards(this.hands[player], this.discardRemaining[player], 256);
      case 'moveRobber':
        return this.robberActions(player, 'moveRobber');
      case 'respondTrade': {
        const actions: IslandersAction[] = [{ type: 'rejectTrade' }];
        if (this.trade && hasCards(this.hands[player], this.trade.receive)) actions.unshift({ type: 'acceptTrade' });
        return actions;
      }
      case 'decideAcceptees': {
        const actions: IslandersAction[] = [{ type: 'cancelTrade' }];
        if (!this.trade) return actions;
        for (const seat of this.trade.accepted) {
          if (hasCards(this.hands[this.trade.from], this.trade.give) && hasCards(this.hands[seat], this.trade.receive)) {
            actions.unshift({ type: 'confirmTrade', with: seat });
          }
        }
        for (const counter of this.trade.counters) {
          if (hasCards(this.hands[counter.from], counter.give) && hasCards(this.hands[this.trade.from], counter.receive)) {
            actions.unshift({ type: 'confirmTrade', with: counter.from });
          }
        }
        return actions;
      }
    }
  }

  applyAction(action: IslandersAction, forcedOutcome?: IslandersActionOutcome): void {
    if (this.finished) throw new Error('Cannot act in a finished Islanders game');
    const actor = this.prompt.player;
    if (!this.isLegalAction(action)) {
      throw new Error(`Illegal Islanders action for ${this.prompt.kind}: ${this.actionToString(action)}`);
    }

    if (action.type === 'withdrawCounterTrade') {
      const index = this.trade?.counters.findIndex((counter) => counter.from === action.player) ?? -1;
      if (index < 0) throw new Error('Missing counteroffer to withdraw');
      this.trade!.counters.splice(index, 1);
      this.record(action.player, action);
      return;
    }

    if (action.type === 'initialSettlement' && this.prompt.kind === 'initialSettlement') {
      this.buildings.set(action.node, { player: actor, type: 'settlement' });
      this.initialSettlements[actor]++;
      this.pendingInitialRoadNode = action.node;
      if (this.initialSettlements[actor] === 2) this.grantStartingResources(actor, action.node);
      this.prompt = { kind: 'initialRoad', player: actor };
      this.record(actor, action);
      return;
    }

    if (action.type === 'initialRoad' && this.prompt.kind === 'initialRoad') {
      this.roads.set(action.edge, actor);
      this.pendingInitialRoadNode = null;
      this.recomputeLongestRoad();
      this.advanceInitialPlacement(actor);
      this.record(actor, action);
      return;
    }

    if (action.type === 'roll' && this.prompt.kind === 'roll') {
      const dice = forcedOutcome?.dice ?? [this.rollDie(), this.rollDie()];
      if (!validDice(dice)) throw new Error(`Invalid recorded dice outcome: ${dice.join(',')}`);
      if (forcedOutcome?.dice) {
        this.random();
        this.random();
      }
      this.lastDice = [dice[0], dice[1]];
      const total = dice[0] + dice[1];
      if (total === ROBBER_ROLL) this.beginRobberSequence(actor);
      else {
        this.distributeProduction(total);
        this.prompt = { kind: 'playTurn', player: actor };
      }
      this.record(actor, action, { dice: [dice[0], dice[1]] });
      return;
    }

    if (action.type === 'discard' && this.prompt.kind === 'discard') {
      for (const resource of action.resources) this.transferResource(actor, -1, resource, 1);
      this.discardRemaining[actor] = 0;
      this.advancePendingPrompt();
      this.record(actor, action);
      return;
    }

    if (action.type === 'moveRobber' && this.prompt.kind === 'moveRobber') {
      const outcome = this.moveRobberAndSteal(actor, action.hex, action.victim, forcedOutcome?.stolenResource);
      this.prompt = { kind: 'playTurn', player: this.turnOwner };
      this.record(actor, action, { stolenResource: outcome });
      return;
    }

    if (action.type === 'buildRoad' && this.prompt.kind === 'playTurn') {
      this.pay(actor, COSTS.road);
      this.roads.set(action.edge, actor);
      this.recomputeLongestRoad();
      this.record(actor, action);
      this.maybeFinish(actor);
      return;
    }
    if (action.type === 'buildSettlement' && this.prompt.kind === 'playTurn') {
      this.pay(actor, COSTS.settlement);
      this.buildings.set(action.node, { player: actor, type: 'settlement' });
      this.recomputeLongestRoad();
      this.record(actor, action);
      this.maybeFinish(actor);
      return;
    }
    if (action.type === 'buildCity' && this.prompt.kind === 'playTurn') {
      this.pay(actor, COSTS.city);
      this.buildings.set(action.node, { player: actor, type: 'city' });
      this.record(actor, action);
      this.maybeFinish(actor);
      return;
    }
    if (action.type === 'buyDevCard' && this.prompt.kind === 'playTurn') {
      const card = forcedOutcome?.developmentCard ?? this.devDeck[this.devDeck.length - 1];
      const deckIndex = this.devDeck.lastIndexOf(card);
      if (deckIndex < 0) throw new Error(`Recorded development card ${card} is not in the deck`);
      this.pay(actor, COSTS.devCard);
      this.devDeck.splice(deckIndex, 1);
      const cardIndex = DEV_CARD_TYPES.indexOf(card);
      this.devHand[actor][cardIndex]++;
      this.boughtDevThisTurn[actor][cardIndex]++;
      this.record(actor, action, { developmentCard: card });
      this.maybeFinish(actor);
      return;
    }

    if (action.type === 'playKnight') {
      this.consumeDevCard(actor, 'knight');
      this.playedKnights[actor]++;
      this.updateLargestArmy();
      const stolenResource = this.moveRobberAndSteal(actor, action.hex, action.victim, forcedOutcome?.stolenResource);
      this.record(actor, action, { stolenResource });
      this.maybeFinish(actor);
      return;
    }
    if (action.type === 'playRoadBuilding') {
      this.consumeDevCard(actor, 'roadBuilding');
      for (const edge of action.edges) this.roads.set(edge, actor);
      this.recomputeLongestRoad();
      this.record(actor, action);
      this.maybeFinish(actor);
      return;
    }
    if (action.type === 'playYearOfPlenty') {
      this.consumeDevCard(actor, 'yearOfPlenty');
      for (const resource of action.resources) this.transferResource(-1, actor, resource, 1);
      this.record(actor, action);
      return;
    }
    if (action.type === 'playMonopoly') {
      this.consumeDevCard(actor, 'monopoly');
      const index = resourceIndex(action.resource);
      for (let seat = 0; seat < this.n; seat++) {
        if (seat === actor) continue;
        const count = this.hands[seat][index];
        this.hands[seat][index] = 0;
        this.hands[actor][index] += count;
      }
      this.record(actor, action);
      return;
    }

    if (action.type === 'maritimeTrade' && this.prompt.kind === 'playTurn') {
      const rate = action.via === 'bank' ? 4 : action.rate;
      this.transferResource(actor, -1, action.give, rate);
      this.transferResource(-1, actor, action.get, 1);
      this.record(actor, action);
      return;
    }
    if (action.type === 'maritimeBulkTrade' && this.prompt.kind === 'playTurn') {
      const rate = action.via === 'bank' ? 4 : action.rate;
      this.transferResource(actor, -1, action.give, rate * action.gets.length);
      for (const resource of action.gets) this.transferResource(-1, actor, resource, 1);
      this.record(actor, action);
      return;
    }

    if (action.type === 'offerTrade' && this.prompt.kind === 'playTurn') {
      const responders = Array.from({ length: this.n - 1 }, (_, i) => (actor + i + 1) % this.n);
      this.trade = {
        from: actor,
        give: action.give.slice(),
        receive: action.receive.slice(),
        responders,
        accepted: [],
        counters: [],
        responseIndex: 0,
      };
      this.domesticOffersThisTurn++;
      this.prompt = { kind: 'respondTrade', player: responders[0] };
      this.record(actor, action);
      return;
    }
    if ((action.type === 'acceptTrade' || action.type === 'counterTrade' || action.type === 'rejectTrade') && this.prompt.kind === 'respondTrade') {
      if (!this.trade) throw new Error('Missing active trade');
      if (action.type === 'acceptTrade') this.trade.accepted.push(actor);
      if (action.type === 'counterTrade') {
        this.trade.counters.push({ from: actor, give: action.give.slice(), receive: action.receive.slice() });
      }
      this.trade.responseIndex++;
      if (this.trade.responseIndex < this.trade.responders.length) {
        this.prompt = { kind: 'respondTrade', player: this.trade.responders[this.trade.responseIndex] };
      } else {
        this.prompt = { kind: 'decideAcceptees', player: this.trade.from };
      }
      this.record(actor, action);
      return;
    }
    if (action.type === 'confirmTrade' && this.prompt.kind === 'decideAcceptees') {
      if (!this.trade) throw new Error('Missing active trade');
      const counter = this.trade.counters.find((candidate) => candidate.from === action.with);
      if (counter) {
        transferDeck(this.hands[counter.from], this.hands[this.trade.from], counter.give);
        transferDeck(this.hands[this.trade.from], this.hands[counter.from], counter.receive);
      } else {
        transferDeck(this.hands[this.trade.from], this.hands[action.with], this.trade.give);
        transferDeck(this.hands[action.with], this.hands[this.trade.from], this.trade.receive);
      }
      this.trade = null;
      this.prompt = { kind: 'playTurn', player: this.turnOwner };
      this.record(actor, action);
      return;
    }
    if (action.type === 'cancelTrade' && this.prompt.kind === 'decideAcceptees') {
      this.trade = null;
      this.prompt = { kind: 'playTurn', player: this.turnOwner };
      this.record(actor, action);
      return;
    }

    if (action.type === 'endTurn' && this.prompt.kind === 'playTurn') {
      this.record(actor, action);
      this.turnOwner = (this.turnOwner + 1) % this.n;
      this.playedDevCardThisTurn = false;
      this.domesticOffersThisTurn = 0;
      this.boughtDevThisTurn[actor].fill(0);
      this.prompt = { kind: 'roll', player: this.turnOwner };
      this.maybeFinish(this.turnOwner);
      return;
    }

    throw new Error(`Unhandled Islanders action ${this.actionToString(action)} for ${this.prompt.kind}`);
  }

  applyRecordedAction(record: IslandersActionRecord): void {
    if (record.action.type !== 'withdrawCounterTrade' && record.player !== this.currentPlayer()) {
      throw new Error(`Replay actor mismatch: expected P${this.currentPlayer()}, got P${record.player}`);
    }
    this.applyAction(cloneAction(record.action), record.outcome);
  }

  transcript(): IslandersTranscript {
    return {
      numPlayers: this.n,
      seatNames: this.seatNames ? [...this.seatNames] : undefined,
      domesticTrade: this.domesticTradeEnabled,
      ...(Number.isFinite(this.domesticTradeOfferLimit) ? { domesticTradeOfferLimit: this.domesticTradeOfferLimit } : {}),
      board: cloneBoard(this.board),
      initialDevelopmentDeck: this.initialDevDeck.slice(),
      randomTape: this.randomTape.slice(),
      initialRandomCursor: this.initialRandomCursor,
      actions: this.actionRecords().map((record) => ({ ...record })),
    };
  }

  static replay(transcript: IslandersTranscript, rng: () => number = Math.random): IslandersState {
    const state = new IslandersState({
      numPlayers: transcript.numPlayers,
      seatNames: transcript.seatNames,
      domesticTrade: transcript.domesticTrade,
      domesticTradeOfferLimit: transcript.domesticTradeOfferLimit,
      rng,
    });
    state.board = cloneBoard(transcript.board);
    state.productionByNode = nodeProduction(state.board);
    state.robberHex = state.board.robberHex;
    state.initialDevDeck = transcript.initialDevelopmentDeck.slice();
    state.devDeck = transcript.initialDevelopmentDeck.slice();
    state.randomTape = transcript.randomTape.slice();
    state.initialRandomCursor = transcript.initialRandomCursor;
    state.randomCursor = transcript.initialRandomCursor;
    state.records = [];
    for (const record of transcript.actions) state.applyRecordedAction(record);
    return state;
  }

  /**
   * Authoritative validator. Most actions are enumerable through `legalActions`; domestic
   * offers and pathological discard spaces are parameterized families validated here.
   */
  isLegalAction(action: IslandersAction): boolean {
    if (this.finished) return false;
    if (action.type === 'withdrawCounterTrade') {
      return Boolean(this.trade && action.player !== this.trade.from && this.trade.counters.some((counter) => counter.from === action.player));
    }
    if (this.prompt.kind === 'playTurn' && action.type === 'maritimeBulkTrade') {
      return this.validMaritimeBulkTrade(this.prompt.player, action);
    }
    if (
      this.prompt.kind === 'playTurn' &&
      action.type === 'offerTrade' &&
      this.domesticTradeEnabled &&
      this.domesticOffersThisTurn < this.domesticTradeOfferLimit
    ) return this.validTradeOffer(this.prompt.player, action.give, action.receive);
    if (this.prompt.kind === 'respondTrade' && action.type === 'counterTrade' && this.trade) {
      return this.validTradeOffer(this.prompt.player, action.give, action.receive)
        && hasCards(this.hands[this.trade.from], action.receive);
    }
    if (this.prompt.kind === 'discard' && action.type === 'discard') {
      return action.resources.length === this.discardRemaining[this.prompt.player] &&
        action.resources.every((resource) => RESOURCES.includes(resource)) &&
        hasCards(this.hands[this.prompt.player], resourcesToDeck(action.resources));
    }
    return this.legalActions().some((candidate) => sameAction(candidate, action));
  }

  /** Discoverable schemas for legal families too large or open-ended to flatten safely. */
  legalActionFamilies(): IslandersActionFamily[] {
    if (this.finished) return [];
    if (this.prompt.kind === 'discard') {
      return [{
        type: 'discard',
        player: this.prompt.player,
        count: this.discardRemaining[this.prompt.player],
        available: this.hands[this.prompt.player].slice(),
      }];
    }
    if (this.prompt.kind === 'playTurn' && this.domesticTradeEnabled && this.domesticOffersThisTurn < this.domesticTradeOfferLimit) {
      return [{ type: 'offerTrade', player: this.prompt.player, resourceOrder: RESOURCES }];
    }
    if (this.prompt.kind === 'respondTrade' && this.trade) {
      return [{ type: 'counterTrade', player: this.prompt.player, resourceOrder: RESOURCES }];
    }
    return [];
  }

  parameterizedActionExamples(): IslandersAction[] {
    if (this.prompt.kind === 'respondTrade' && this.trade) {
      const action: IslandersAction = {
        type: 'counterTrade',
        give: this.trade.receive.slice(),
        receive: this.trade.give.slice(),
      };
      return this.isLegalAction(action) ? [action] : [];
    }
    if (this.prompt.kind !== 'playTurn' || !this.domesticTradeEnabled || this.domesticOffersThisTurn >= this.domesticTradeOfferLimit) return [];
    const giveIndex = this.hands[this.prompt.player].findIndex((count) => count > 0);
    if (giveIndex < 0) return [];
    const receiveIndex = RESOURCES.findIndex((_, index) => index !== giveIndex);
    return [{
      type: 'offerTrade',
      give: RESOURCES.map((_, index) => (index === giveIndex ? 1 : 0)),
      receive: RESOURCES.map((_, index) => (index === receiveIndex ? 1 : 0)),
    }];
  }

  // ── Notation ───────────────────────────────────────────────────────────────────
  actionToString(a: IslandersAction): string {
    switch (a.type) {
      case 'roll':
        return 'roll';
      case 'endTurn':
        return 'end';
      case 'initialSettlement':
        return `init-settlement ${a.node}`;
      case 'initialRoad':
        return `init-road ${a.edge}`;
      case 'buildRoad':
        return `road ${a.edge}`;
      case 'buildSettlement':
        return `settlement ${a.node}`;
      case 'buildCity':
        return `city ${a.node}`;
      case 'buyDevCard':
        return 'buy-dev';
      case 'playKnight':
        return `knight ${a.hex}${a.victim === null ? '' : ` steal ${this.seatName(a.victim)}`}`;
      case 'playRoadBuilding':
        return `road-building ${a.edges.join(',')}`;
      case 'playYearOfPlenty':
        return `year-of-plenty ${a.resources.join(',')}`;
      case 'playMonopoly':
        return `monopoly ${a.resource}`;
      case 'discard':
        return `discard ${a.resources.join(',')}`;
      case 'moveRobber':
        return `robber ${a.hex}${a.victim === null ? '' : ` steal ${this.seatName(a.victim)}`}`;
      case 'maritimeTrade':
        return a.via === 'bank'
          ? `bank-trade ${a.give}->${a.get}`
          : `port-trade ${a.rate}:1 ${a.give}->${a.get}`;
      case 'maritimeBulkTrade':
        return a.via === 'bank'
          ? `bank-trade ${a.give}->${a.gets.join(',')}`
          : `port-trade ${a.rate}:1 ${a.give}->${a.gets.join(',')}`;
      case 'offerTrade':
        return `offer ${a.give.join('/')} for ${a.receive.join('/')}`;
      case 'acceptTrade':
        return 'accept';
      case 'counterTrade':
        return `counter ${a.give.join('/')} for ${a.receive.join('/')}`;
      case 'withdrawCounterTrade':
        return `withdraw-counter ${this.seatName(a.player)}`;
      case 'rejectTrade':
        return 'reject';
      case 'confirmTrade':
        return `confirm ${this.seatName(a.with)}`;
      case 'cancelTrade':
        return 'cancel';
    }
  }

  // Lenient parse of a model/human answer into an action. Keywords + integer topology ids;
  // returns null on anything unrecognized OR currently illegal (the caller re-prompts).
  actionFromString(s: string): IslandersAction | null {
    const t = s.trim().toLowerCase();
    let legal: IslandersAction[];
    try {
      legal = this.legalActions();
    } catch {
      return null;
    }

    // Prefer an exact canonical action. Besides being unambiguous, this keeps the parser
    // aligned with the legal menu the model sees in decisionContextString.
    const exact = legal.find((action) => this.actionToString(action).toLowerCase() === t);
    if (exact) return exact;

    let parsed: IslandersAction | null = null;

    // During setup, accept the canonical form, a friendly "settlement/node" or
    // "road/edge" form, and a bare id. Bind the id to that keyword instead of taking
    // the first number in the whole reply (which may be a 3:1 port or production token).
    const settlementId = lastCapture(t, /\b(?:init(?:ial)?[-\s]*)?settlement(?:\s+node)?\s+(-?\d+)\b/g) ??
      lastCapture(t, /\bnode\s+(-?\d+)\b/g);
    const roadId = lastCapture(t, /\b(?:init(?:ial)?[-\s]*)?road(?:\s+edge)?\s+(-?\d+)\b/g) ??
      lastCapture(t, /\bedge\s+(-?\d+)\b/g);
    const regularRoadId = lastCapture(t, /\broad\s+(-?\d+)\b/g);
    const regularSettlementId = lastCapture(t, /\bsettlement\s+(-?\d+)\b/g);
    const cityId = lastCapture(t, /\bcity\s+(-?\d+)\b/g);
    const knight = lastMatch(t, /\bknight\s+(-?\d+)(?:\s+steal\s+p?(-?\d+))?/g);
    const robber = lastMatch(t, /\brobber\s+(-?\d+)(?:\s+steal\s+p?(-?\d+))?/g);
    const trade = lastMatch(t, /\b(?:(bank|port)[-\s]*)?trade(?:\s+([23]):1)?\s+(brick|grain|lumber|ore|wool)\s*->\s*(brick|grain|lumber|ore|wool)\b/g);
    const confirm = lastCapture(t, /\bconfirm\s+p?(-?\d+)\b/g);
    const roadBuildingTail = actionTail(t, /\b(?:road-building|road building)\b/g);
    const plentyTail = actionTail(t, /\b(?:year-of-plenty|year of plenty|plenty)\b/g);
    const monopolyTail = actionTail(t, /\bmonopoly\b/g);
    const discardTail = actionTail(t, /\bdiscard\b/g);
    if (this.prompt.kind === 'initialSettlement' && (settlementId !== undefined || /^-?\d+$/.test(t))) {
      parsed = { type: 'initialSettlement', node: Number(settlementId ?? t) };
    } else if (this.prompt.kind === 'initialRoad' && (roadId !== undefined || /^-?\d+$/.test(t))) {
      parsed = { type: 'initialRoad', edge: Number(roadId ?? t) };
    } else if (/^roll/.test(t)) parsed = { type: 'roll' };
    else if (/^end/.test(t)) parsed = { type: 'endTurn' };
    else if (roadBuildingTail !== null) parsed = { type: 'playRoadBuilding', edges: (roadBuildingTail.match(/-?\d+/g) ?? []).map(Number) };
    else if (regularRoadId !== undefined) parsed = { type: 'buildRoad', edge: Number(regularRoadId) };
    else if (regularSettlementId !== undefined) parsed = { type: 'buildSettlement', node: Number(regularSettlementId) };
    else if (cityId !== undefined) parsed = { type: 'buildCity', node: Number(cityId) };
    else if (/buy.*dev|dev.*card/.test(t)) parsed = { type: 'buyDevCard' };
    else if (knight) parsed = { type: 'playKnight', hex: Number(knight[1]), victim: knight[2] === undefined ? null : Number(knight[2]) };
    else if (plentyTail !== null) parsed = { type: 'playYearOfPlenty', resources: resourceOccurrences(plentyTail) };
    else if (monopolyTail !== null && resourceOccurrences(monopolyTail).length) parsed = { type: 'playMonopoly', resource: resourceOccurrences(monopolyTail)[0] };
    else if (discardTail !== null) parsed = { type: 'discard', resources: resourceOccurrences(discardTail) };
    else if (robber) parsed = { type: 'moveRobber', hex: Number(robber[1]), victim: robber[2] === undefined ? null : Number(robber[2]) };
    else if (/^offer/.test(t)) {
      const match = t.match(/^offer\s+([\d/]+)\s+for\s+([\d/]+)$/);
      if (match) parsed = { type: 'offerTrade', give: match[1].split('/').map(Number), receive: match[2].split('/').map(Number) };
    } else if (/^counter/.test(t)) {
      const match = t.match(/^counter\s+([\d/]+)\s+for\s+([\d/]+)$/);
      if (match) parsed = { type: 'counterTrade', give: match[1].split('/').map(Number), receive: match[2].split('/').map(Number) };
    } else if (trade) {
      const give = trade[3] as Resource;
      const get = trade[4] as Resource;
      const via = trade[1] as 'bank' | 'port' | undefined;
      const rate = trade[2] === undefined ? undefined : Number(trade[2]) as 2 | 3;
      parsed = via === 'bank'
        ? { type: 'maritimeTrade', via: 'bank', give, get }
        : via === 'port' && rate !== undefined
          ? { type: 'maritimeTrade', via: 'port', rate, give, get }
          : legal.find((action) => action.type === 'maritimeTrade' && action.via === via && action.give === give && action.get === get) ??
            legal.find((action) => action.type === 'maritimeTrade' && action.give === give && action.get === get) ?? null;
    }
    else if (/^accept/.test(t)) parsed = { type: 'acceptTrade' };
    else if (/^reject/.test(t)) parsed = { type: 'rejectTrade' };
    else if (confirm !== undefined) parsed = { type: 'confirmTrade', with: Number(confirm) };
    else if (/^cancel/.test(t)) parsed = { type: 'cancelTrade' };

    if (parsed === null) return null;
    return this.isLegalAction(parsed) ? parsed : null;
  }

  // ── Observation ───────────────────────────────────────────────────────────────
  private seatName(s: number): string {
    return this.seatNames?.[s] ?? `player ${s + 1}`;
  }

  // Full spectator view (all hands visible) — for debugging/rendering, NOT what an AI sees.
  toString(): string {
    const lines: string[] = [];
    lines.push(`Islanders (${this.n}p) — ${this.finished ? 'over' : `${this.prompt.kind}, ${this.seatName(this.prompt.player)} to act`}. Robber on hex ${this.robberHex}.`);
    lines.push(`Bank: ${this.deckStr(this.bank)}`);
    for (let s = 0; s < this.n; s++) {
      lines.push(`${this.seatName(s)}: ${this.victoryPoints(s, true)} VP, hand ${this.deckStr(this.hands[s])}, dev ${freqTotal(this.devHand[s])}, knights ${this.playedKnights[s]}`);
    }
    return lines.join('\n');
  }

  // Seat `player`'s private view: its own hand + all public info, never another seat's hand
  // breakdown or the dev-deck order. This is the observation `ModelPlayer` receives.
  informationStateString(player: number): string {
    const lines: string[] = [];
    const playerName = this.seatName(player);
    const opponentNames = Array.from({ length: this.n }, (_, seat) => seat).filter((seat) => seat !== player).map((seat) => this.seatName(seat));
    lines.push('AUTHORITATIVE IDENTITY AND TURN ROLES:');
    lines.push(`- YOU ARE: ${playerName}.`);
    lines.push(`- YOUR OPPONENTS ARE: ${opponentNames.join(', ')}.`);
    lines.push(`- PLAYER REQUIRED TO ACT NOW: ${this.seatName(this.prompt.player)}${this.prompt.player === player ? ' (YOU)' : ''}.`);
    lines.push(`- TURN OWNER: ${this.seatName(this.turnOwner)}${this.turnOwner === player ? ' (YOU)' : ''}.`);
    lines.push(`Islanders, ${this.n} players.`);
    lines.push(`Phase: ${this.prompt.kind}${this.prompt.player === player ? ' (you to act)' : ` (${this.seatName(this.prompt.player)} to act)`}.`);
    const ownDev = DEV_CARD_TYPES.map((type, i) => (this.devHand[player][i] ? `${this.devHand[player][i]} ${type}` : '')).filter(Boolean).join(', ') || '(none)';
    const portfolio = this.portfolio(player);
    lines.push(`Your hand: ${this.deckStr(this.hands[player])}. Your development cards: ${ownDev}. Your actual VP: ${this.victoryPoints(player, true)} (public ${this.victoryPoints(player, false)}).`);
    lines.push(`Turn owner: ${this.seatName(this.turnOwner)}. Previous resolved dice roll: ${this.lastDice ? `${this.lastDice.join('+')}=${this.lastDice[0] + this.lastDice[1]}` : 'none'}. Robber on H${this.robberHex} [public hex: ${this.publicHexLabel(this.robberHex)}]. Bank: ${this.deckStr(this.bank)}.`);
    if (this.prompt.kind === 'roll') lines.push('The dice have not been rolled for this turn yet; choosing roll will create a new result.');
    const others = [];
    for (let s = 0; s < this.n; s++) {
      if (s === player) continue;
      others.push(`${this.seatName(s)}: ${this.victoryPoints(s, false)} public VP, ${freqTotal(this.hands[s])} resource cards, ${freqTotal(this.devHand[s])} hidden dev cards, ${this.playedKnights[s]} played knights, road length ${this.longestRoadLengths[s]}`);
    }
    lines.push(`Opponents: ${others.join('; ')}.`);
    lines.push(`Setup settlements placed: ${this.initialSettlements.map((count, seat) => `${this.seatName(seat)}=${count}/2`).join(', ')}.`);
    lines.push(
      `Board hexes: ${this.board.hexes
        .map((hex, id) => `H${id} [public hex: ${this.publicHexLabel(id)}]=${hex.terrain}/${hex.token ?? 'none'}${id === this.robberHex ? '/robber' : ''}`)
        .join(', ')}.`,
    );
    lines.push(`Buildings: ${this.publicBuildings()}. Roads: ${this.publicRoads()}.`);
    lines.push(`Awards: Longest Road=${this.longestRoadHolder < 0 ? 'none' : this.seatName(this.longestRoadHolder)}; Largest Army=${this.largestArmyHolder < 0 ? 'none' : this.seatName(this.largestArmyHolder)}.`);
    const recentActions = this.records.slice(-8).map((record) => `${this.seatName(record.player)}: ${this.publicActionSummary(record.action)}`);
    lines.push(`Recent public actions: ${recentActions.length ? recentActions.join('; ') : '(none)'}.`);
    lines.push(`Your portfolio: production pips ${this.productionStr(portfolio.production)}; numbers [${portfolio.numberCoverage.join(',')}]; ports ${this.portsStr(portfolio.ports)}; pieces left roads=${portfolio.roadsLeft}, settlements=${portfolio.settlementsLeft}, cities=${portfolio.citiesLeft}.`);
    lines.push(`Private rules vocabulary maps to public table talk as follows: ${PUBLIC_RESOURCE_ORDER}. Keep canonical IDs and pip calculations in private thinking; public speech uses the supplied public labels and player names.`);
    if (this.trade) {
      const offerer = this.seatName(this.trade.from);
      lines.push('AUTHORITATIVE DOMESTIC TRADE ROLES:');
      lines.push(`- OFFERER: ${offerer}.`);
      lines.push(`- ORIGINAL OFFER: ${offerer} gives ${this.publicDeckPhrase(this.trade.give)} and receives ${this.publicDeckPhrase(this.trade.receive)}.`);
      if (player !== this.trade.from) {
        lines.push(`- YOUR ROLE: responder to ${offerer}.`);
        lines.push(`- IF YOU ACCEPT: YOU give ${this.publicDeckPhrase(this.trade.receive)} to ${offerer}; YOU receive ${this.publicDeckPhrase(this.trade.give)} from ${offerer}.`);
      } else {
        lines.push('- YOUR ROLE: offerer and final confirmer/canceller after opponents respond.');
      }
      if (this.trade.accepted.length) lines.push(`Accepted by: ${this.trade.accepted.map((seat) => this.seatName(seat)).join(', ')}.`);
      for (const counter of this.trade.counters) {
        lines.push(`- COUNTER FROM ${this.seatName(counter.from)}: ${this.seatName(counter.from)} gives ${this.publicDeckPhrase(counter.give)} and receives ${this.publicDeckPhrase(counter.receive)}.`);
      }
    }
    return lines.join('\n');
  }

  observationString(player: number): string {
    return this.informationStateString(player);
  }

  // Exact executable choices plus neutral decision support. Keeping this separate from
  // the information-state observation lets ModelPlayer provide Islanders's legal menu on the
  // first attempt without changing chess's deliberate no-list evaluation mode.
  decisionContextString(player: number): string {
    if (this.prompt.player !== player) return `No action requested from ${this.seatName(player)}.`;
    const lines = [
      'Legal actions (choose exactly one canonical action shown below).',
      'Facts are descriptive, not recommendations; decide how to value production, diversity, ports, expansion, and route competition.',
      `Canonical five-slot resource vectors are always brick/grain/lumber/ore/wool. In public speech these mean ${PUBLIC_RESOURCE_ORDER}. Domestic offers and counteroffers are player-to-player trades, never bank or port trades.`,
      'Your public communication must describe the exact canonical action you select. Treat its supplied public spot, route, trade, resource, and player facts as authoritative; never substitute a different action or exchange.',
      'For a listed legal action, the canonical move is only the text before any opening bracket [. Put only that canonical text in move; brackets contain explanatory public facts, never move syntax.',
    ];
    if (this.prompt.kind === 'roll') lines.push('The previous dice value is historical. This roll has no result yet, so do not describe what was rolled or produced.');
    if (this.prompt.kind === 'initialSettlement') {
      for (const option of this.initialSettlementOptions()) lines.push(`- ${this.settlementOptionString(option)}`);
      return lines.join('\n');
    }
    if (this.prompt.kind === 'initialRoad') {
      for (const option of this.initialRoadOptions()) {
        const expansion = option.expansionSites.length
          ? option.expansionSites.map((site) => `N${site.node} [public spot: ${this.publicNodeLabel(site.node)}] (${this.siteYieldString(site)})`).join(' | ')
          : '(no currently legal frontier settlement)';
        lines.push(`- init-road ${option.edge} [public route: ${this.publicRoadLabel(option.edge)}]: N${option.fromNode} → N${option.towardNode}; future settlement frontiers: ${expansion}`);
      }
      return lines.join('\n');
    }
    const legal = this.legalActions();
    if (this.prompt.kind === 'discard') {
      const combinations = countDiscardCombinations(this.hands[player], this.discardRemaining[player]);
      lines.push(`Discard exactly ${this.discardRemaining[player]} cards. Use: discard resource,resource,... (duplicates mean multiple cards).`);
      lines.push(`There are ${combinations} legal discard combinations; your available cards are ${this.deckStr(this.hands[player])}.`);
      if (combinations <= 80) for (const action of legal) lines.push(`- ${this.actionToString(action)}`);
      else lines.push(`The enumerable API exposes ${legal.length} representative combinations; any valid combination in the format above is accepted.`);
    } else {
      for (const action of legal) {
        const hint = this.publicActionHint(action, player);
        lines.push(`- ${this.actionToString(action)}${hint ? ` [${hint}]` : ''}`);
      }
    }
    if (this.prompt.kind === 'playTurn' && this.domesticTradeEnabled && this.domesticOffersThisTurn < this.domesticTradeOfferLimit) {
      lines.push('- Domestic offer (parameterized): offer b/g/l/o/w for b/g/l/o/w, using five nonnegative counts in brick/grain/lumber/ore/wool order.');
      lines.push('  Example: offer 1/0/0/0/0 for 0/1/0/0/0 means I give 1 brick and receive 1 wheat from another player. Offers are validated against your hand and cannot request the same resource they give.');
    }
    if (this.prompt.kind === 'respondTrade' && this.trade) {
      lines.push('- Counteroffer (parameterized): counter b/g/l/o/w for b/g/l/o/w, from your perspective: what you give, then what you receive.');
      lines.push(`  The posted offer reversed into your perspective is: counter ${this.trade.receive.join('/')} for ${this.trade.give.join('/')}. That means you give ${this.publicDeckPhrase(this.trade.receive)} and receive ${this.publicDeckPhrase(this.trade.give)}. You may revise either side.`);
    }
    return lines.join('\n');
  }

  // ── Read accessors for presentation, heuristic players, and recording ───────────
  boardSetup(): BoardSetup {
    return this.board;
  }
  robber(): number {
    return this.robberHex;
  }
  bankDeck(): readonly number[] {
    return this.bank;
  }
  // How many development cards remain undrawn. Public information — at the table the deck's
  // height is visible to everyone — so this is safe to show without leaking which cards.
  developmentDeckSize(): number {
    return this.devDeck.length;
  }
  handOf(seat: number): readonly number[] {
    return this.hands[seat];
  }
  buildingAt(node: number): Building | undefined {
    return this.buildings.get(node);
  }
  roadAt(edge: number): number | undefined {
    return this.roads.get(edge);
  }
  currentPrompt(): Prompt {
    return this.prompt;
  }
  discardingPlayerCount(): number {
    return (this.prompt.kind === 'discard' ? 1 : 0)
      + this.pending.filter((prompt) => prompt.kind === 'discard').length;
  }
  longestRoad(): number {
    return this.longestRoadHolder;
  }
  largestArmy(): number {
    return this.largestArmyHolder;
  }
  actionRecords(): readonly IslandersActionRecord[] {
    return this.records.map((record) => ({
      player: record.player,
      action: cloneAction(record.action),
      outcome: record.outcome ? { ...record.outcome, dice: record.outcome.dice ? [...record.outcome.dice] : undefined } : undefined,
    }));
  }
  dice(): readonly [number, number] | null {
    return this.lastDice;
  }
  activeTrade(): {
    from: number;
    give: readonly number[];
    receive: readonly number[];
    responders: readonly number[];
    responseIndex: number;
    accepted: readonly number[];
    counters: readonly { from: number; give: readonly number[]; receive: readonly number[] }[];
  } | null {
    return this.trade
      ? {
          from: this.trade.from,
          give: this.trade.give.slice(),
          receive: this.trade.receive.slice(),
          responders: this.trade.responders.slice(),
          responseIndex: this.trade.responseIndex,
          accepted: this.trade.accepted.slice(),
          counters: this.trade.counters.map((counter) => ({
            from: counter.from,
            give: counter.give.slice(),
            receive: counter.receive.slice(),
          })),
        }
      : null;
  }
  withdrawCounterOffer(player: number): boolean {
    const action: IslandersAction = { type: 'withdrawCounterTrade', player };
    if (!this.isLegalAction(action)) return false;
    this.applyAction(action);
    return true;
  }
  developmentCardCount(seat: number, type: DevCardType): number {
    return this.devHand[seat][DEV_CARD_TYPES.indexOf(type)] ?? 0;
  }
  playedKnightCount(seat: number): number {
    return this.playedKnights[seat] ?? 0;
  }
  roadLength(seat: number): number {
    return this.longestRoadLengths[seat] ?? 0;
  }
  portfolio(seat: number): IslandersPortfolio {
    const production: Partial<Record<Resource, number>> = {};
    const numbers = new Set<number>();
    const occupiedNodes: number[] = [];
    for (const [node, building] of this.buildings) {
      if (building.player !== seat) continue;
      occupiedNodes.push(node);
      const multiplier = building.type === 'city' ? 2 : 1;
      for (const resource of RESOURCES) {
        const pips = (this.productionByNode[node][resource] ?? 0) * multiplier;
        if (pips) production[resource] = (production[resource] ?? 0) + pips;
      }
      for (const hex of nodeHexes[node]) {
        const token = this.board.hexes[hex].token;
        if (token !== null) numbers.add(token);
      }
    }
    const ports = portsAtNodes(this.board.harbors, occupiedNodes);
    return {
      production,
      totalPips: Object.values(production).reduce((sum, pips) => sum + (pips ?? 0), 0),
      resourceDiversity: Object.keys(production).length,
      numberCoverage: [...numbers].sort((a, b) => a - b),
      ports,
      roadsLeft: PIECE_LIMITS.road - this.pieceCount(seat, 'road'),
      settlementsLeft: PIECE_LIMITS.settlement - this.pieceCount(seat, 'settlement'),
      citiesLeft: PIECE_LIMITS.city - this.pieceCount(seat, 'city'),
      longestRoadLength: this.longestRoadLengths[seat],
    };
  }

  maritimeTradeRates(seat: number): MaritimeTradeRates {
    return maritimeTradeRates(this.portfolio(seat).ports);
  }

  maritimePortTradeRates(seat: number): MaritimePortTradeRates {
    return maritimePortTradeRates(this.portfolio(seat).ports);
  }

  initialPlacementComplete(): boolean {
    return this.initialSettlements.every((count) => count === 2) && this.prompt.kind === 'roll';
  }

  initialSettlementCount(seat: number): number {
    return this.initialSettlements[seat] ?? 0;
  }

  // Typed decision metadata for heuristic/search players. Models receive the same facts in
  // decisionContextString, while code-native players can rank sites without parsing text.
  initialSettlementOptions(): InitialSettlementOption[] {
    if (this.prompt.kind !== 'initialSettlement') return [];
    const occ = this.occupancy();
    const options: InitialSettlementOption[] = [];
    for (let node = 0; node < NUM_NODES; node++) {
      if (!canPlaceSettlement(node, occ)) continue;
      const site = this.settlementSite(node);
      options.push({ ...site, action: { type: 'initialSettlement', node }, portfolio: this.initialPortfolio(this.prompt.player, site) });
    }
    return options;
  }

  initialRoadOptions(): InitialRoadOption[] {
    if (this.prompt.kind !== 'initialRoad' || this.pendingInitialRoadNode === null) return [];
    const fromNode = this.pendingInitialRoadNode;
    const occ = this.occupancy();
    return nodeEdges[fromNode]
      .filter((edge) => this.roads.get(edge) === undefined)
      .map((edge) => {
        const [a, b] = edgeNodes[edge];
        const towardNode = a === fromNode ? b : a;
        const expansionSites = nodeEdges[towardNode]
          .filter((nextEdge) => nextEdge !== edge && this.roads.get(nextEdge) === undefined)
          .map((nextEdge) => {
            const [x, y] = edgeNodes[nextEdge];
            return x === towardNode ? y : x;
          })
          .filter((node) => canPlaceSettlement(node, occ))
          .map((node) => this.settlementSite(node));
        return {
          action: { type: 'initialRoad' as const, edge },
          edge,
          fromNode,
          towardNode,
          expansionSites,
        };
      });
  }

  // Victory points for a seat. Public VP (settlements 1, cities 2, Longest Road 2, Largest
  // Army 2) plus, when `includeHidden`, the seat's hidden VP development cards.
  victoryPoints(seat: number, includeHidden = false): number {
    let vp = 0;
    for (const b of this.buildings.values()) if (b.player === seat) vp += b.type === 'city' ? 2 : 1;
    if (this.longestRoadHolder === seat) vp += 2;
    if (this.largestArmyHolder === seat) vp += 2;
    if (includeHidden) vp += this.devHand[seat][DEV_CARD_TYPES.indexOf('victoryPoint')];
    return vp;
  }

  // The seat that claimed victory on its own turn, or -1.
  winner(): number {
    return this.winnerSeat;
  }

  private buildActions(player: number): IslandersAction[] {
    const actions: IslandersAction[] = [];
    const occ = this.occupancy();
    if (hasCards(this.hands[player], COSTS.road) && this.pieceCount(player, 'road') < PIECE_LIMITS.road) {
      for (let edge = 0; edge < NUM_EDGES; edge++) if (canPlaceRoad(edge, player, occ)) actions.push({ type: 'buildRoad', edge });
    }
    if (hasCards(this.hands[player], COSTS.settlement) && this.pieceCount(player, 'settlement') < PIECE_LIMITS.settlement) {
      for (let node = 0; node < NUM_NODES; node++) {
        if (canPlaceSettlement(node, occ) && nodeEdges[node].some((edge) => this.roads.get(edge) === player)) {
          actions.push({ type: 'buildSettlement', node });
        }
      }
    }
    if (hasCards(this.hands[player], COSTS.city) && this.pieceCount(player, 'city') < PIECE_LIMITS.city) {
      for (let node = 0; node < NUM_NODES; node++) if (canUpgradeCity(node, player, occ)) actions.push({ type: 'buildCity', node });
    }
    if (this.devDeck.length && hasCards(this.hands[player], COSTS.devCard)) actions.push({ type: 'buyDevCard' });
    return actions;
  }

  private devCardActions(player: number): IslandersAction[] {
    if (this.playedDevCardThisTurn) return [];
    const actions: IslandersAction[] = [];
    if (this.playableDevCount(player, 'knight') > 0) actions.push(...this.robberActions(player, 'playKnight'));
    if (this.playableDevCount(player, 'roadBuilding') > 0) actions.push(...this.roadBuildingActions(player));
    if (this.playableDevCount(player, 'yearOfPlenty') > 0) {
      const totalAvailable = freqTotal(this.bank);
      for (let i = 0; i < RESOURCES.length; i++) {
        if (this.bank[i] <= 0) continue;
        if (totalAvailable === 1) actions.push({ type: 'playYearOfPlenty', resources: [RESOURCES[i]] });
        for (let j = i; totalAvailable >= 2 && j < RESOURCES.length; j++) {
          if (this.bank[j] <= 0 || (i === j && this.bank[i] < 2)) continue;
          actions.push({ type: 'playYearOfPlenty', resources: [RESOURCES[i], RESOURCES[j]] });
        }
      }
    }
    if (this.playableDevCount(player, 'monopoly') > 0) {
      for (const resource of RESOURCES) actions.push({ type: 'playMonopoly', resource });
    }
    return actions;
  }

  private roadBuildingActions(player: number): IslandersAction[] {
    const available = PIECE_LIMITS.road - this.pieceCount(player, 'road');
    if (available <= 0) return [];
    const first = this.legalRoadEdges(player, this.roads);
    const actions: IslandersAction[] = [];
    for (const edge of first) {
      if (available === 1) {
        actions.push({ type: 'playRoadBuilding', edges: [edge] });
        continue;
      }
      const roads = new Map(this.roads);
      roads.set(edge, player);
      const second = this.legalRoadEdges(player, roads);
      if (!second.length) actions.push({ type: 'playRoadBuilding', edges: [edge] });
      else for (const next of second) actions.push({ type: 'playRoadBuilding', edges: [edge, next] });
    }
    return actions;
  }

  private legalRoadEdges(player: number, roads: ReadonlyMap<number, number>): number[] {
    const occ: BoardOccupancy<number> = {
      building: (node) => {
        const building = this.buildings.get(node);
        return building ? { owner: building.player, city: building.type === 'city' } : undefined;
      },
      road: (edge) => roads.get(edge),
    };
    const edges: number[] = [];
    for (let edge = 0; edge < NUM_EDGES; edge++) if (canPlaceRoad(edge, player, occ)) edges.push(edge);
    return edges;
  }

  private robberActions(player: number, type: 'moveRobber' | 'playKnight'): IslandersAction[] {
    const actions: IslandersAction[] = [];
    for (let hex = 0; hex < NUM_HEXES; hex++) {
      if (hex === this.robberHex) continue;
      const victims = this.robberVictims(player, hex);
      if (!victims.length) actions.push({ type, hex, victim: null } as IslandersAction);
      else for (const victim of victims) actions.push({ type, hex, victim } as IslandersAction);
    }
    return actions;
  }

  private robberVictims(player: number, hex: number): number[] {
    const victims = new Set<number>();
    for (let node = 0; node < NUM_NODES; node++) {
      if (!nodeHexes[node].includes(hex)) continue;
      const building = this.buildings.get(node);
      if (building && building.player !== player && freqTotal(this.hands[building.player]) > 0) victims.add(building.player);
    }
    return [...victims].sort((a, b) => a - b);
  }

  private maritimeTradeActions(player: number): IslandersAction[] {
    const actions: IslandersAction[] = [];
    const portRates = this.maritimePortTradeRates(player);
    for (const give of RESOURCES) {
      const held = this.hands[player][resourceIndex(give)];
      for (const get of RESOURCES) {
        if (give === get || this.bank[resourceIndex(get)] <= 0) continue;
        for (const rate of portRates[give]) {
          if (held >= rate) actions.push({ type: 'maritimeTrade', via: 'port', rate, give, get });
        }
        if (held >= 4) actions.push({ type: 'maritimeTrade', via: 'bank', give, get });
      }
    }
    return actions;
  }

  private validTradeOffer(player: number, give: FreqDeck, receive: FreqDeck): boolean {
    if (!validDeck(give) || !validDeck(receive) || !hasCards(this.hands[player], give)) return false;
    if (freqTotal(give) === 0 || freqTotal(receive) === 0) return false;
    return RESOURCES.every((_, i) => !(give[i] > 0 && receive[i] > 0));
  }

  private validMaritimeBulkTrade(
    player: number,
    action: Extract<IslandersAction, { type: 'maritimeBulkTrade' }>,
  ): boolean {
    if (!action.gets.length || action.gets.some((resource) => !RESOURCES.includes(resource) || resource === action.give)) return false;
    const rate = action.via === 'bank' ? 4 : action.rate;
    if (action.via === 'port' && !this.maritimePortTradeRates(player)[action.give].includes(action.rate)) return false;
    if (this.hands[player][resourceIndex(action.give)] < rate * action.gets.length) return false;
    return hasCards(this.bank, resourcesToDeck(action.gets));
  }

  private playableDevCount(player: number, type: DevCardType): number {
    const index = DEV_CARD_TYPES.indexOf(type);
    return this.devHand[player][index] - this.boughtDevThisTurn[player][index];
  }

  private consumeDevCard(player: number, type: Exclude<DevCardType, 'victoryPoint'>): void {
    const index = DEV_CARD_TYPES.indexOf(type);
    if (this.playableDevCount(player, type) <= 0 || this.playedDevCardThisTurn) throw new Error(`Cannot play ${type}`);
    this.devHand[player][index]--;
    this.playedDevCardThisTurn = true;
  }

  private pieceCount(player: number, type: BuildingType | 'road'): number {
    if (type === 'road') return [...this.roads.values()].filter((owner) => owner === player).length;
    return [...this.buildings.values()].filter((building) => building.player === player && building.type === type).length;
  }

  private pay(player: number, cost: readonly number[]): void {
    if (!hasCards(this.hands[player], cost)) throw new Error(`P${player} cannot afford cost`);
    transferDeck(this.hands[player], this.bank, cost);
  }

  private transferResource(from: number, to: number, resource: Resource, count: number): void {
    const index = resourceIndex(resource);
    const source = from < 0 ? this.bank : this.hands[from];
    const target = to < 0 ? this.bank : this.hands[to];
    if (source[index] < count) throw new Error(`Not enough ${resource} to transfer`);
    source[index] -= count;
    target[index] += count;
  }

  private rollDie(): number {
    return Math.floor(this.random() * 6) + 1;
  }

  private random(): number {
    if (this.randomCursor === this.randomTape.length) this.randomTape.push(this.rng());
    return this.randomTape[this.randomCursor++];
  }

  private beginRobberSequence(player: number): void {
    this.pending = [];
    for (let offset = 0; offset < this.n; offset++) {
      const seat = (player + offset) % this.n;
      const count = freqTotal(this.hands[seat]);
      this.discardRemaining[seat] = count > DISCARD_LIMIT ? Math.floor(count / 2) : 0;
      if (this.discardRemaining[seat]) this.pending.push({ kind: 'discard', player: seat });
    }
    this.pending.push({ kind: 'moveRobber', player });
    this.advancePendingPrompt();
  }

  private advancePendingPrompt(): void {
    const next = this.pending.shift();
    if (!next) throw new Error('Islanders prompt queue unexpectedly empty');
    this.prompt = next;
  }

  private distributeProduction(roll: number): void {
    const owed = Array.from({ length: RESOURCES.length }, () => new Array(this.n).fill(0));
    for (let hex = 0; hex < NUM_HEXES; hex++) {
      if (hex === this.robberHex || this.board.hexes[hex].token !== roll) continue;
      const resource = TERRAIN_RESOURCE[this.board.hexes[hex].terrain];
      if (resource === null) continue;
      const resourceId = resourceIndex(resource);
      for (let node = 0; node < NUM_NODES; node++) {
        if (!nodeHexes[node].includes(hex)) continue;
        const building = this.buildings.get(node);
        if (building) owed[resourceId][building.player] += building.type === 'city' ? 2 : 1;
      }
    }
    for (let resourceId = 0; resourceId < RESOURCES.length; resourceId++) {
      const claims = owed[resourceId];
      const claimants = claims.filter((count) => count > 0).length;
      const total = claims.reduce((sum, count) => sum + count, 0);
      if (total === 0) continue;
      if (this.bank[resourceId] < total && claimants > 1) continue;
      for (let player = 0; player < this.n; player++) {
        const amount = Math.min(claims[player], this.bank[resourceId]);
        this.bank[resourceId] -= amount;
        this.hands[player][resourceId] += amount;
      }
    }
  }

  private moveRobberAndSteal(player: number, hex: number, victim: number | null, forced?: Resource | null): Resource | null {
    if (victim === null && forced) throw new Error('Recorded a stolen resource without a victim');
    if (victim !== null && forced !== undefined && forced !== null && this.hands[victim][resourceIndex(forced)] <= 0) {
      throw new Error(`Victim P${victim} does not hold recorded ${forced}`);
    }
    this.robberHex = hex;
    if (victim === null) {
      return null;
    }
    const total = freqTotal(this.hands[victim]);
    if (total === 0) return null;
    let resource: Resource;
    if (forced !== undefined && forced !== null) {
      this.random();
      resource = forced;
    } else {
      let pick = Math.floor(this.random() * total);
      resource = RESOURCES[0];
      for (const candidate of RESOURCES) {
        pick -= this.hands[victim][resourceIndex(candidate)];
        if (pick < 0) {
          resource = candidate;
          break;
        }
      }
    }
    this.transferResource(victim, player, resource, 1);
    return resource;
  }

  private recomputeLongestRoad(): void {
    for (let player = 0; player < this.n; player++) this.longestRoadLengths[player] = this.computeLongestRoad(player);
    const max = Math.max(...this.longestRoadLengths);
    if (max < LONGEST_ROAD_MIN) {
      this.longestRoadHolder = -1;
      return;
    }
    if (this.longestRoadHolder >= 0 && this.longestRoadLengths[this.longestRoadHolder] === max) return;
    const leaders = this.longestRoadLengths.flatMap((length, player) => (length === max ? [player] : []));
    this.longestRoadHolder = leaders.length === 1 ? leaders[0] : -1;
  }

  private computeLongestRoad(player: number): number {
    const walk = (node: number, used: Set<number>): number => {
      const blocker = this.buildings.get(node);
      if (used.size > 0 && blocker && blocker.player !== player) return 0;
      let best = 0;
      for (const edge of nodeEdges[node]) {
        if (used.has(edge) || this.roads.get(edge) !== player) continue;
        used.add(edge);
        const [a, b] = edgeNodes[edge];
        best = Math.max(best, 1 + walk(a === node ? b : a, used));
        used.delete(edge);
      }
      return best;
    };
    let best = 0;
    for (let node = 0; node < NUM_NODES; node++) best = Math.max(best, walk(node, new Set()));
    return best;
  }

  private updateLargestArmy(): void {
    const max = Math.max(...this.playedKnights);
    if (max < LARGEST_ARMY_MIN) return;
    if (this.largestArmyHolder >= 0 && this.playedKnights[this.largestArmyHolder] === max) return;
    const leaders = this.playedKnights.flatMap((count, player) => (count === max ? [player] : []));
    if (leaders.length === 1) this.largestArmyHolder = leaders[0];
  }

  private maybeFinish(player: number): void {
    if (player !== this.turnOwner || this.victoryPoints(player, true) < VP_TO_WIN) return;
    this.winnerSeat = player;
    this.finished = true;
  }

  private record(player: number, action: IslandersAction, outcome?: IslandersActionOutcome): void {
    this.records.push({ player, action: cloneAction(action), outcome: outcome ? { ...outcome } : undefined });
  }

  private deckStr(d: FreqDeck): string {
    const parts = RESOURCES.map((r, i) => (d[i] ? `${d[i]}${r[0]}` : '')).filter(Boolean);
    return parts.join(' ') || '(none)';
  }

  private deckPhrase(d: FreqDeck): string {
    const parts = RESOURCES.map((resource, index) => {
      const count = d[index] ?? 0;
      return count > 0 ? `${count} ${resource}` : '';
    }).filter(Boolean);
    return parts.join(', ') || 'nothing';
  }

  private publicDeckPhrase(d: FreqDeck): string {
    const parts = RESOURCES.map((resource, index) => {
      const count = d[index] ?? 0;
      return count > 0 ? `${count} ${publicResource(resource)}` : '';
    }).filter(Boolean);
    return parts.join(', ') || 'nothing';
  }

  private productionStr(production: Partial<Record<Resource, number>>): string {
    return RESOURCES.filter((resource) => (production[resource] ?? 0) > 0)
      .map((resource) => `${resource}=${production[resource]}`)
      .join(', ') || '(none)';
  }

  private portsStr(ports: readonly Port[]): string {
    return ports.map((port) => `${port.resource ?? 'any'} ${port.ratio}:1`).join(', ') || '(none)';
  }

  private occupancy(): BoardOccupancy<number> {
    return {
      building: (node) => {
        const building = this.buildings.get(node);
        return building ? { owner: building.player, city: building.type === 'city' } : undefined;
      },
      road: (edge) => this.roads.get(edge),
    };
  }

  private settlementSite(node: number): SettlementSite {
    const production = this.productionByNode[node];
    const adjacentHexes = nodeHexes[node].map((hex) => {
      const setup = this.board.hexes[hex];
      return {
        hex,
        terrain: setup.terrain,
        resource: TERRAIN_RESOURCE[setup.terrain],
        token: setup.token,
        pips: setup.token === null ? 0 : (TOKEN_DOTS[setup.token] ?? 0),
      };
    });
    return {
      node,
      adjacentHexes,
      production: { ...production },
      totalPips: Object.values(production).reduce((sum, pips) => sum + (pips ?? 0), 0),
      resourceDiversity: Object.keys(production).length,
      port: this.board.harbors.find((harbor) => harbor.nodes.includes(node))?.port ?? null,
    };
  }

  private initialPortfolio(player: number, candidate: SettlementSite): InitialSettlementPortfolio {
    const existingSites = [...this.buildings.entries()]
      .filter(([, building]) => building.player === player && building.type === 'settlement')
      .map(([node]) => this.settlementSite(node));
    const sites = [...existingSites, candidate];
    const production: Partial<Record<Resource, number>> = {};
    for (const site of sites) {
      for (const resource of RESOURCES) {
        const pips = site.production[resource] ?? 0;
        if (pips > 0) production[resource] = (production[resource] ?? 0) + pips;
      }
    }

    const numberCounts = new Map<number, number>();
    for (const site of sites) {
      for (const hex of site.adjacentHexes) {
        if (hex.token !== null) numberCounts.set(hex.token, (numberCounts.get(hex.token) ?? 0) + 1);
      }
    }
    const existingResources = new Set(existingSites.flatMap((site) => Object.keys(site.production) as Resource[]));
    const newResources = RESOURCES.filter((resource) => (candidate.production[resource] ?? 0) > 0 && !existingResources.has(resource));
    const startingResources =
      existingSites.length === 1
        ? candidate.adjacentHexes.flatMap((hex) => (hex.resource === null ? [] : [hex.resource]))
        : [];
    const ports = sites.flatMap((site) => {
      if (!site.port) return [];
      return [{
        ratio: site.port.ratio,
        resource: site.port.resource,
        matchingProductionPips: site.port.resource === null ? null : (production[site.port.resource] ?? 0),
      }];
    });

    return {
      settlementNodes: sites.map((site) => site.node),
      production,
      totalPips: Object.values(production).reduce((sum, pips) => sum + (pips ?? 0), 0),
      resourceDiversity: Object.keys(production).length,
      numberCoverage: [...numberCounts.keys()].sort((a, b) => a - b),
      repeatedNumbers: [...numberCounts.entries()].filter(([, count]) => count > 1).map(([number]) => number).sort((a, b) => a - b),
      newResources,
      startingResources,
      ports,
    };
  }

  private grantStartingResources(player: number, node: number): void {
    for (const hex of nodeHexes[node]) {
      const resource = TERRAIN_RESOURCE[this.board.hexes[hex].terrain];
      if (resource === null) continue;
      const index = resourceIndex(resource);
      if (this.bank[index] === 0) continue;
      this.bank[index]--;
      this.hands[player][index]++;
    }
  }

  private advanceInitialPlacement(player: number): void {
    if (this.initialSettlements[player] === 1) {
      // Forward round. The last seat immediately starts the reverse round, hence its
      // back-to-back settlement+road pairs in the middle of the snake.
      const next = player === this.n - 1 ? player : player + 1;
      this.prompt = { kind: 'initialSettlement', player: next };
      return;
    }
    if (player > 0) {
      this.prompt = { kind: 'initialSettlement', player: player - 1 };
      return;
    }
    this.turnOwner = 0;
    this.prompt = { kind: 'roll', player: this.turnOwner };
  }

  private publicBuildings(): string {
    const parts = [...this.buildings.entries()]
      .sort(([a], [b]) => a - b)
      .map(([node, building]) => `N${node} [public spot: ${this.publicNodeLabel(node)}]=${this.seatName(building.player)}-${building.type}`);
    return parts.join(', ') || '(none)';
  }

  private publicRoads(): string {
    const parts = [...this.roads.entries()]
      .sort(([a], [b]) => a - b)
      .map(([edge, player]) => `E${edge} [public route: ${this.publicRoadLabel(edge)}]=${this.seatName(player)}`);
    return parts.join(', ') || '(none)';
  }

  /** Human table-talk label; canonical node IDs remain the action/parser contract. */
  publicNodeLabel(node: number): string {
    if (!Number.isInteger(node) || node < 0 || node >= NUM_NODES) throw new RangeError(`invalid Islanders node ${node}`);
    const base = this.publicNodeLabelBase(node);
    const duplicates = Array.from({ length: NUM_NODES }, (_, candidate) => candidate)
      .filter((candidate) => this.publicNodeLabelBase(candidate) === base);
    if (duplicates.length === 1) return base;
    return this.disambiguatedLabel(base, node, duplicates, nodePosition);
  }

  /** Human table-talk label; canonical hex IDs remain the robber/parser contract. */
  publicHexLabel(hex: number): string {
    if (!Number.isInteger(hex) || hex < 0 || hex >= NUM_HEXES) throw new RangeError(`invalid Islanders hex ${hex}`);
    const base = this.publicHexLabelBase(hex);
    const duplicates = Array.from({ length: NUM_HEXES }, (_, candidate) => candidate)
      .filter((candidate) => this.publicHexLabelBase(candidate) === base);
    if (duplicates.length === 1) return base;
    return this.disambiguatedLabel(base, hex, duplicates, hexPosition);
  }

  private publicNodeLabelBase(node: number): string {
    return nodeHexes[node]
      .map((hex) => this.publicHexLabelBase(hex))
      .join('–');
  }

  private publicHexLabelBase(hex: number): string {
    const tile = this.board.hexes[hex];
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (resource === null || tile.token === null) return 'desert';
    return `${tile.token}${PUBLIC_RESOURCE[resource].emoji}`;
  }

  private publicRoadLabel(edge: number): string {
    const [a, b] = edgeNodes[edge];
    return `${this.publicNodeLabel(a)} toward ${this.publicNodeLabel(b)}`;
  }

  private disambiguatedLabel(
    base: string,
    id: number,
    duplicates: readonly number[],
    position: (candidate: number) => { x: number; y: number },
  ): string {
    const direction = compassDirection(position(id).x, position(id).y);
    const sameDirection = duplicates
      .filter((candidate) => {
        const point = position(candidate);
        return compassDirection(point.x, point.y) === direction;
      })
      .sort((a, b) => {
        const pa = position(a);
        const pb = position(b);
        return pa.y - pb.y || pa.x - pb.x;
      });
    const qualifier = sameDirection.length > 1 ? `${direction} ${sameDirection.indexOf(id) + 1}` : direction;
    return `${base} ${qualifier}`;
  }

  private publicActionHint(action: IslandersAction, player = this.prompt.player): string {
    switch (action.type) {
      case 'initialSettlement':
      case 'buildSettlement':
      case 'buildCity':
        return `public spot: ${this.publicNodeLabel(action.node)}`;
      case 'initialRoad':
        return `public route: ${this.publicRoadLabel(action.edge)}`;
      case 'buildRoad':
        return this.roadDecisionHint(action.edge, player);
      case 'playRoadBuilding':
        return `public routes: ${action.edges.map((edge) => this.publicRoadLabel(edge)).join(' | ')}`;
      case 'moveRobber':
      case 'playKnight':
        return `public target: ${this.publicHexLabel(action.hex)}${action.victim === null ? '' : `; player: ${this.seatName(action.victim)}`}`;
      case 'maritimeTrade':
        return `public trade: give ${publicResource(action.give)}, receive ${publicResource(action.get)}`;
      case 'maritimeBulkTrade':
        return `public trade: give ${publicResource(action.give)}, receive ${action.gets.map(publicResource).join(', ')}`;
      case 'playYearOfPlenty':
        return `resources: ${action.resources.map(publicResource).join(', ')}`;
      case 'playMonopoly':
        return `resource: ${publicResource(action.resource)}`;
      case 'confirmTrade':
        return this.confirmTradeHint(action.with);
      case 'acceptTrade':
        return this.trade && player !== this.trade.from
          ? `YOU give ${this.publicDeckPhrase(this.trade.receive)}; YOU receive ${this.publicDeckPhrase(this.trade.give)} from ${this.seatName(this.trade.from)}`
          : '';
      default:
        return '';
    }
  }

  private confirmTradeHint(withSeat: number): string {
    if (!this.trade) return `player: ${this.seatName(withSeat)}`;
    const counter = this.trade.counters.find((candidate) => candidate.from === withSeat);
    if (counter) {
      return `confirm counter with ${this.seatName(withSeat)}: YOU give ${this.publicDeckPhrase(counter.receive)}; YOU receive ${this.publicDeckPhrase(counter.give)}`;
    }
    return `confirm original offer with ${this.seatName(withSeat)}: YOU give ${this.publicDeckPhrase(this.trade.give)}; YOU receive ${this.publicDeckPhrase(this.trade.receive)}`;
  }

  private roadDecisionHint(edge: number, player: number): string {
    const roads = new Map(this.roads);
    roads.set(edge, player);
    const occ: BoardOccupancy<number> = {
      building: (node) => {
        const building = this.buildings.get(node);
        return building ? { owner: building.player, city: building.type === 'city' } : undefined;
      },
      road: (candidate) => roads.get(candidate),
    };
    const endpoints = edgeNodes[edge];
    const settleNow = endpoints.filter((node) =>
      canPlaceSettlement(node, occ) && nodeEdges[node].some((candidate) => roads.get(candidate) === player));
    const oneRoadAway = new Set<number>();
    const contested = new Set<number>();
    for (const endpoint of endpoints) {
      for (const nextEdge of nodeEdges[endpoint]) {
        const owner = this.roads.get(nextEdge);
        if (owner !== undefined && owner !== player) contested.add(owner);
        if (nextEdge === edge || owner !== undefined) continue;
        const [a, b] = edgeNodes[nextEdge];
        const frontier = a === endpoint ? b : a;
        if (canPlaceSettlement(frontier, occ)) oneRoadAway.add(frontier);
      }
    }
    const spots = (nodes: Iterable<number>): string => {
      const labels = [...nodes].map((node) => this.publicNodeLabel(node));
      return labels.length ? labels.join(' | ') : 'none';
    };
    const rivals = [...contested].map((seat) => this.seatName(seat));
    return [
      `public route: ${this.publicRoadLabel(edge)}`,
      `settlement expansion — settle now: ${spots(settleNow)}`,
      `future settlement one road away: ${spots(oneRoadAway)}`,
      `adjacent rival roads: ${rivals.length ? rivals.join(', ') : 'none'}`,
      'frontier sites are settlement opportunities, not city upgrades',
    ].join('; ');
  }

  private publicActionSummary(action: IslandersAction): string {
    switch (action.type) {
      case 'initialSettlement': return `placed a settlement at ${this.publicNodeLabel(action.node)}`;
      case 'initialRoad': return `placed an initial road along ${this.publicRoadLabel(action.edge)}`;
      case 'buildRoad': return `built a road along ${this.publicRoadLabel(action.edge)}`;
      case 'buildSettlement': return `built a settlement at ${this.publicNodeLabel(action.node)}`;
      case 'buildCity': return `upgraded a city at ${this.publicNodeLabel(action.node)}`;
      case 'roll': return 'rolled the dice';
      case 'discard': return `discarded ${action.resources.length} resource cards after a seven`;
      case 'moveRobber': return `moved the robber to ${this.publicHexLabel(action.hex)}${action.victim === null ? '' : ` and targeted ${this.seatName(action.victim)}`}`;
      case 'buyDevCard': return 'bought a development card';
      case 'playKnight': return `played a knight and moved the robber to ${this.publicHexLabel(action.hex)}${action.victim === null ? '' : `, targeting ${this.seatName(action.victim)}`}`;
      case 'playRoadBuilding': return `played road building on ${action.edges.map((edge) => this.publicRoadLabel(edge)).join(' and ')}`;
      case 'playYearOfPlenty': return 'played year of plenty';
      case 'playMonopoly': return `played monopoly on ${publicResource(action.resource)}`;
      case 'maritimeTrade': return `traded ${publicResource(action.give)} for ${publicResource(action.get)} with the ${action.via === 'bank' ? 'bank' : 'port'}`;
      case 'maritimeBulkTrade': return `traded ${publicResource(action.give)} for ${action.gets.map(publicResource).join(', ')} with the ${action.via === 'bank' ? 'bank' : 'port'}`;
      case 'offerTrade': return 'made a domestic trade offer';
      case 'acceptTrade': return 'accepted the domestic trade offer';
      case 'counterTrade': return 'made a counteroffer';
      case 'withdrawCounterTrade': return 'withdrew a counteroffer';
      case 'rejectTrade': return 'rejected the domestic trade offer';
      case 'confirmTrade': return `completed a trade with ${this.seatName(action.with)}`;
      case 'cancelTrade': return 'cancelled the domestic trade';
      case 'endTurn': return 'ended the turn';
    }
  }

  private settlementOptionString(option: InitialSettlementOption): string {
    const local = this.siteYieldString(option);
    if (option.portfolio.settlementNodes.length === 1) return `init-settlement ${option.node} [public spot: ${this.publicNodeLabel(option.node)}]: ${local}`;
    const portfolio = option.portfolio;
    const production = RESOURCES
      .filter((resource) => (portfolio.production[resource] ?? 0) > 0)
      .map((resource) => `${resource}=${portfolio.production[resource]}`)
      .join(', ');
    const ports = portfolio.ports.length
      ? portfolio.ports
          .map((port) =>
            port.resource === null
              ? 'any 3:1'
              : `${port.resource} 2:1 (matching production ${port.matchingProductionPips} pips)`,
          )
          .join(', ')
      : 'none';
    return (
      `init-settlement ${option.node} [public spot: ${this.publicNodeLabel(option.node)}]: ${local}; ` +
      `two-settlement portfolio: production={${production}}, total=${portfolio.totalPips} pips, ` +
      `resources=${portfolio.resourceDiversity}, numbers=[${portfolio.numberCoverage.join(',')}], ` +
      `repeated-numbers=[${portfolio.repeatedNumbers.join(',') || 'none'}], ` +
      `new-resources=[${portfolio.newResources.join(',') || 'none'}], ` +
      `starting-cards=[${portfolio.startingResources.join(',') || 'none'}], ports=[${ports}]`
    );
  }

  private siteYieldString(site: SettlementSite): string {
    const hexes = site.adjacentHexes
      .map((hex) => `H${hex.hex} [public hex: ${this.publicHexLabel(hex.hex)}] ${hex.resource ?? 'desert'} ${hex.token ?? '-'} (${hex.pips} pips)`)
      .join(', ');
    const port = site.port ? `; port=${site.port.resource ?? 'any'} ${site.port.ratio}:1` : '';
    return `${hexes}; total=${site.totalPips} pips; diversity=${site.resourceDiversity}${port}`;
  }
}

function sameAction(a: IslandersAction, b: IslandersAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneAction(action: IslandersAction): IslandersAction {
  return JSON.parse(JSON.stringify(action)) as IslandersAction;
}

function cloneBoard(board: BoardSetup): BoardSetup {
  return {
    hexes: board.hexes.map((hex) => ({ ...hex })),
    robberHex: board.robberHex,
    harbors: board.harbors.map((harbor) => ({
      port: { ...harbor.port },
      edge: harbor.edge,
      nodes: [...harbor.nodes],
    })),
  };
}

function validDeck(deck: readonly number[]): deck is FreqDeck {
  return deck.length === RESOURCES.length && deck.every((count) => Number.isInteger(count) && count >= 0);
}

function hasCards(hand: readonly number[], cost: readonly number[]): boolean {
  return cost.length === RESOURCES.length && cost.every((count, index) => hand[index] >= count);
}

function transferDeck(from: FreqDeck, to: FreqDeck, deck: readonly number[]): void {
  if (!hasCards(from, deck)) throw new Error('Insufficient cards for transfer');
  for (let i = 0; i < RESOURCES.length; i++) {
    from[i] -= deck[i];
    to[i] += deck[i];
  }
}

function enumerateDiscards(hand: readonly number[], count: number, limit = Number.POSITIVE_INFINITY): IslandersAction[] {
  if (count <= 0) return [];
  const actions: IslandersAction[] = [];
  const chosen = new Array(RESOURCES.length).fill(0);
  const visit = (index: number, remaining: number): void => {
    if (actions.length >= limit) return;
    if (index === RESOURCES.length - 1) {
      if (remaining > hand[index]) return;
      chosen[index] = remaining;
      const resources = RESOURCES.flatMap((resource, resourceIndex) => new Array(chosen[resourceIndex]).fill(resource)) as Resource[];
      actions.push({ type: 'discard', resources });
      return;
    }
    for (let amount = 0; amount <= Math.min(hand[index], remaining); amount++) {
      if (actions.length >= limit) break;
      chosen[index] = amount;
      visit(index + 1, remaining - amount);
    }
  };
  visit(0, count);
  return actions;
}

function countDiscardCombinations(hand: readonly number[], count: number): number {
  let ways = new Array(count + 1).fill(0);
  ways[0] = 1;
  for (const available of hand) {
    const next = new Array(count + 1).fill(0);
    for (let used = 0; used <= count; used++) {
      for (let amount = 0; amount <= Math.min(available, count - used); amount++) next[used + amount] += ways[used];
    }
    ways = next;
  }
  return ways[count];
}

function resourcesToDeck(resources: readonly Resource[]): FreqDeck {
  const deck = emptyFreqDeck();
  for (const resource of resources) deck[resourceIndex(resource)]++;
  return deck;
}

function resourceOccurrences(text: string): Resource[] {
  const matches = text.match(/\b(?:brick|grain|lumber|ore|wool)\b/g) ?? [];
  return matches as Resource[];
}

function lastMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  const matches = [...text.matchAll(pattern)];
  return matches.at(-1) ?? null;
}

function lastCapture(text: string, pattern: RegExp): string | undefined {
  return lastMatch(text, pattern)?.[1];
}

function actionTail(text: string, pattern: RegExp): string | null {
  const match = lastMatch(text, pattern);
  return match ? text.slice((match.index ?? 0) + match[0].length) : null;
}

function validDice(dice: readonly number[]): boolean {
  return dice.length === 2 && dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6);
}

// The harness Game wrapper. Defaults to a 4-player game; the arcade driver constructs states
// directly with the chosen player count / seat names.
export const islandersGame: Game<IslandersState, IslandersAction> = {
  type: { shortName: 'islanders', longName: 'Islanders', numPlayers: 4 },
  newInitialState: () => new IslandersState({ numPlayers: 4 }),
};

registerGame('islanders', () => islandersGame as unknown as Game<GameState<unknown>, unknown>);
