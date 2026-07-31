// Catan (base 3–4 player game) as a harness state. One `CatanState` = ONE full game, played
// to 10 victory points — like `ChessState` is one game (not one hand like poker's
// `HoldemState`). It implements the OpenSpiel-style `ImperfectInfoState`: dev cards, the
// dev-deck order, and opponents' exact hand breakdowns are hidden; `informationStateString`
// is the per-seat observation an AI is prompted on.
//
// STATUS — initial placement is playable through the generic model harness: legal settlement
// and road actions, snake-order progression, and starting-resource grants are implemented.
// Regular turns are still staged and throw when their prompt reaches `legalActions()` or
// `applyAction()`. See docs/catan.md (Part III design, Part IV phasing).
//
// Chance is resolved INTERNALLY (dice rolls, dev-card draws, robber steals) via an injected
// seeded RNG, so `isChanceNode()` is always false — this keeps Catan compatible with the
// generic `runMatch` loop (ai/match.ts), which can't resolve chance nodes, exactly as poker
// deals internally. See docs/catan.md §3.2.
//
// Players are seat indices 0..n-1.

import { type Game, type GameState, type ImperfectInfoState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { edgeNodes, nodeEdges, nodeHexes, NUM_NODES } from './board-topology.ts';
import { canPlaceSettlement, type BoardOccupancy } from './placement.ts';
import { type BoardSetup, generateBoard, nodeProduction } from './setup.ts';
import {
  type BuildingType,
  type CatanAction,
  DEV_CARD_COUNTS,
  DEV_CARD_TYPES,
  type DevCardType,
  emptyFreqDeck,
  type FreqDeck,
  freqTotal,
  fullBank,
  type Port,
  type Prompt,
  RESOURCES,
  type Resource,
  resourceIndex,
  TERRAIN_RESOURCE,
  type Terrain,
  TOKEN_DOTS,
  VP_TO_WIN,
} from './types.ts';

export interface CatanOpts {
  numPlayers: number; // base game is 3–4; 2 is allowed for testing
  rng?: () => number; // injected for reproducible boards/deals (defaults to Math.random)
  // Optional per-seat display names for the observation (e.g. a model slug); defaults to
  // "P0"/"P1"… so the engine stays generic, as poker does.
  seatNames?: readonly string[];
}

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
  action: Extract<CatanAction, { type: 'initialSettlement' }>;
}

export interface InitialRoadOption {
  action: Extract<CatanAction, { type: 'initialRoad' }>;
  edge: number;
  fromNode: number;
  towardNode: number;
  // Legal settlement sites reachable after extending one more road from `towardNode`.
  // The immediate endpoint itself cannot host a settlement because of the distance rule.
  expansionSites: SettlementSite[];
}

const NOT_IMPLEMENTED =
  'CatanState: regular turns are not implemented yet — initial placement is playable; see docs/catan.md Part IV (Phase 1).';

export class CatanState implements ImperfectInfoState<CatanAction> {
  readonly n: number;
  private rng: () => number;
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
  private devHand: number[][]; // [seat][DEV_CARD_TYPES index]
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

  // Turn / phase machine. `prompt.player` (who must act now) is decoupled from `turnOwner`
  // (whose turn it is): a rolled 7 enqueues one `discard` prompt per over-limit player
  // before the turn owner moves the robber. `pending` is the interrupt queue.
  private turnOwner = 0;
  private prompt: Prompt;
  private pending: Prompt[] = [];
  private hasRolled = false;
  private playedDevCardThisTurn = false;
  private freeRoadsLeft = 0;

  private finished = false;

  constructor(opts: CatanOpts) {
    if (!Number.isInteger(opts.numPlayers) || opts.numPlayers < 2 || opts.numPlayers > 4) {
      throw new RangeError(`Catan supports 2–4 players; received ${opts.numPlayers}`);
    }
    this.n = opts.numPlayers;
    this.rng = opts.rng ?? Math.random;
    this.seatNames = opts.seatNames;

    this.board = generateBoard(this.rng);
    this.productionByNode = nodeProduction(this.board);
    this.robberHex = this.board.robberHex;

    this.bank = fullBank();
    this.hands = Array.from({ length: this.n }, () => emptyFreqDeck());
    this.devDeck = buildDevDeck(this.rng);
    this.devHand = Array.from({ length: this.n }, () => new Array(DEV_CARD_TYPES.length).fill(0));
    this.playedKnights = new Array(this.n).fill(0);
    this.initialSettlements = new Array(this.n).fill(0);

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
  chanceOutcomes(): { action: CatanAction; prob: number }[] {
    return [];
  }

  isTerminal(): boolean {
    return this.finished;
  }

  // Per-seat utility once terminal: +1 for the winner, -1 for everyone else (Catan has no
  // draws). All zero before the game ends.
  returns(): number[] {
    const w = this.winner();
    if (w < 0) return new Array(this.n).fill(0);
    return Array.from({ length: this.n }, (_, s) => (s === w ? 1 : -1));
  }

  clone(): CatanState {
    const s = Object.create(CatanState.prototype) as CatanState;
    (s as { n: number }).n = this.n;
    s.rng = this.rng; // same-class access reaches private fields
    s.seatNames = this.seatNames;
    s.board = this.board; // immutable after setup — share by ref
    s.productionByNode = this.productionByNode; // derived from immutable board setup
    s.robberHex = this.robberHex;
    s.bank = this.bank.slice();
    s.hands = this.hands.map((h) => h.slice());
    s.devDeck = this.devDeck.slice();
    s.devHand = this.devHand.map((d) => d.slice());
    s.playedKnights = this.playedKnights.slice();
    s.buildings = new Map(this.buildings);
    s.roads = new Map(this.roads);
    s.initialSettlements = this.initialSettlements.slice();
    s.pendingInitialRoadNode = this.pendingInitialRoadNode;
    s.longestRoadHolder = this.longestRoadHolder;
    s.largestArmyHolder = this.largestArmyHolder;
    s.turnOwner = this.turnOwner;
    s.prompt = { ...this.prompt };
    s.pending = this.pending.map((p) => ({ ...p }));
    s.hasRolled = this.hasRolled;
    s.playedDevCardThisTurn = this.playedDevCardThisTurn;
    s.freeRoadsLeft = this.freeRoadsLeft;
    s.finished = this.finished;
    return s;
  }

  // ── Playable seams (initial-placement slice of Phase 1) ─────────────────────────
  // The single source of truth for what the awaited player may do, and the validated
  // transition. Regular-turn prompts remain staged — see docs/catan.md Part IV.
  legalActions(): CatanAction[] {
    if (this.finished) return [];
    switch (this.prompt.kind) {
      case 'initialSettlement':
        return this.initialSettlementOptions().map((option) => option.action);
      case 'initialRoad':
        return this.initialRoadOptions().map((option) => option.action);
      default:
        throw new Error(NOT_IMPLEMENTED);
    }
  }

  applyAction(action: CatanAction): void {
    const legal = this.legalActions();
    if (!legal.some((candidate) => sameAction(candidate, action))) {
      throw new Error(`Illegal Catan action for ${this.prompt.kind}: ${this.actionToString(action)}`);
    }

    if (action.type === 'initialSettlement' && this.prompt.kind === 'initialSettlement') {
      const player = this.prompt.player;
      this.buildings.set(action.node, { player, type: 'settlement' });
      this.initialSettlements[player]++;
      this.pendingInitialRoadNode = action.node;
      if (this.initialSettlements[player] === 2) this.grantStartingResources(player, action.node);
      this.prompt = { kind: 'initialRoad', player };
      return;
    }

    if (action.type === 'initialRoad' && this.prompt.kind === 'initialRoad') {
      const player = this.prompt.player;
      this.roads.set(action.edge, player);
      this.pendingInitialRoadNode = null;
      this.advanceInitialPlacement(player);
      return;
    }

    // The legal-action check above currently prevents reaching this branch; keeping an
    // explicit guard makes a future action-union expansion fail loudly rather than no-op.
    throw new Error(NOT_IMPLEMENTED);
  }

  // ── Notation ───────────────────────────────────────────────────────────────────
  actionToString(a: CatanAction): string {
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
        return `knight ${a.hex}${a.victim === null ? '' : ` steal P${a.victim}`}`;
      case 'playRoadBuilding':
        return `road-building ${a.edges.join(',')}`;
      case 'playYearOfPlenty':
        return `year-of-plenty ${a.resources.join(',')}`;
      case 'playMonopoly':
        return `monopoly ${a.resource}`;
      case 'discard':
        return `discard ${a.resources.join(',')}`;
      case 'moveRobber':
        return `robber ${a.hex}${a.victim === null ? '' : ` steal P${a.victim}`}`;
      case 'maritimeTrade':
        return `trade ${a.give}->${a.get}`;
      case 'offerTrade':
        return `offer ${a.give.join('/')} for ${a.receive.join('/')}`;
      case 'acceptTrade':
        return 'accept';
      case 'rejectTrade':
        return 'reject';
      case 'confirmTrade':
        return `confirm P${a.with}`;
      case 'cancelTrade':
        return 'cancel';
    }
  }

  // Lenient parse of a model/human answer into an action. Keywords + integer topology ids;
  // returns null on anything unrecognized OR currently illegal (the caller re-prompts).
  actionFromString(s: string): CatanAction | null {
    const t = s.trim().toLowerCase();
    const nums = (t.match(/-?\d+/g) ?? []).map(Number);
    const res = RESOURCES.filter((r) => t.includes(r));
    let parsed: CatanAction | null = null;

    // During setup, accept the canonical form, a friendly "settlement/node" or
    // "road/edge" form, and a bare id. The phase disambiguates node ids from edge ids.
    if (this.prompt.kind === 'initialSettlement' && nums.length && (/sett|node/.test(t) || /^-?\d+$/.test(t))) {
      parsed = { type: 'initialSettlement', node: nums[0] };
    } else if (this.prompt.kind === 'initialRoad' && nums.length && (/road|edge/.test(t) || /^-?\d+$/.test(t))) {
      parsed = { type: 'initialRoad', edge: nums[0] };
    } else if (/^roll/.test(t)) parsed = { type: 'roll' };
    else if (/^end/.test(t)) parsed = { type: 'endTurn' };
    else if (/init.*sett/.test(t) && nums.length) parsed = { type: 'initialSettlement', node: nums[0] };
    else if (/init.*road/.test(t) && nums.length) parsed = { type: 'initialRoad', edge: nums[0] };
    else if (/^road-b|road building/.test(t)) parsed = { type: 'playRoadBuilding', edges: nums };
    else if (/^road/.test(t) && nums.length) parsed = { type: 'buildRoad', edge: nums[0] };
    else if (/^sett/.test(t) && nums.length) parsed = { type: 'buildSettlement', node: nums[0] };
    else if (/^city/.test(t) && nums.length) parsed = { type: 'buildCity', node: nums[0] };
    else if (/buy.*dev|dev.*card/.test(t)) parsed = { type: 'buyDevCard' };
    else if (/knight/.test(t) && nums.length) parsed = { type: 'playKnight', hex: nums[0], victim: nums[1] ?? null };
    else if (/year.*plenty|plenty/.test(t)) parsed = { type: 'playYearOfPlenty', resources: res };
    else if (/monopoly/.test(t) && res.length) parsed = { type: 'playMonopoly', resource: res[0] };
    else if (/discard/.test(t)) parsed = { type: 'discard', resources: res };
    else if (/robber/.test(t) && nums.length) parsed = { type: 'moveRobber', hex: nums[0], victim: nums[1] ?? null };
    else if (/trade/.test(t) && res.length >= 2) parsed = { type: 'maritimeTrade', give: res[0], get: res[1] };

    if (parsed === null) return null;
    try {
      return this.legalActions().some((candidate) => sameAction(candidate, parsed)) ? parsed : null;
    } catch {
      return null; // the parsed action belongs to a regular-turn slice not implemented yet
    }
  }

  // ── Observation ───────────────────────────────────────────────────────────────
  private seatName(s: number): string {
    return this.seatNames?.[s] ?? `P${s}`;
  }

  // Full spectator view (all hands visible) — for debugging/rendering, NOT what an AI sees.
  toString(): string {
    const lines: string[] = [];
    lines.push(`Catan (${this.n}p) — ${this.finished ? 'over' : `${this.prompt.kind}, ${this.seatName(this.prompt.player)} to act`}. Robber on hex ${this.robberHex}.`);
    lines.push(`Bank: ${this.deckStr(this.bank)}`);
    for (let s = 0; s < this.n; s++) {
      lines.push(`${this.seatName(s)}: ${this.victoryPoints(s, true)} VP, hand ${this.deckStr(this.hands[s])}, dev ${freqTotal(this.devHand[s])}, knights ${this.playedKnights[s]}`);
    }
    return lines.join('\n');
  }

  // Seat `player`'s private view: its own hand + all public info, never another seat's hand
  // breakdown or the dev-deck order. The observation `ModelPlayer` is prompted on (Phase 4).
  informationStateString(player: number): string {
    const lines: string[] = [];
    lines.push(`Catan, ${this.n} players. You are ${this.seatName(player)}.`);
    lines.push(`Phase: ${this.prompt.kind}${this.prompt.player === player ? ' (you to act)' : ` (${this.seatName(this.prompt.player)} to act)`}.`);
    lines.push(`Your hand: ${this.deckStr(this.hands[player])}. Your VP: ${this.victoryPoints(player, true)}.`);
    lines.push(`Robber on hex ${this.robberHex}. Bank: ${this.deckStr(this.bank)}.`);
    const others = [];
    for (let s = 0; s < this.n; s++) {
      if (s === player) continue;
      others.push(`${this.seatName(s)}: ${this.victoryPoints(s, false)} VP, ${freqTotal(this.hands[s])} cards, ${freqTotal(this.devHand[s])} dev, ${this.playedKnights[s]} knights`);
    }
    lines.push(`Opponents: ${others.join('; ')}.`);
    lines.push(`Setup settlements placed: ${this.initialSettlements.map((count, seat) => `${this.seatName(seat)}=${count}/2`).join(', ')}.`);
    lines.push(
      `Board hexes: ${this.board.hexes
        .map((hex, id) => `H${id}=${hex.terrain}/${hex.token ?? 'none'}${id === this.robberHex ? '/robber' : ''}`)
        .join(', ')}.`,
    );
    lines.push(`Buildings: ${this.publicBuildings()}. Roads: ${this.publicRoads()}.`);
    if (this.prompt.kind === 'initialSettlement' && this.prompt.player === player) {
      lines.push('Choose one legal setup settlement using "init-settlement NODE":');
      for (const option of this.initialSettlementOptions()) lines.push(`- ${this.settlementOptionString(option)}`);
    } else if (this.prompt.kind === 'initialRoad' && this.prompt.player === player) {
      lines.push('Choose one road adjacent to the settlement you just placed using "init-road EDGE":');
      for (const option of this.initialRoadOptions()) {
        const expansion = option.expansionSites.length
          ? option.expansionSites.map((site) => `N${site.node} (${this.siteYieldString(site)})`).join(' | ')
          : '(no currently legal frontier settlement)';
        lines.push(`- init-road ${option.edge}: N${option.fromNode} → N${option.towardNode}; future settlement frontiers: ${expansion}`);
      }
    }
    return lines.join('\n');
  }

  observationString(player: number): string {
    return this.informationStateString(player);
  }

  // ── Read accessors for the presentation layer (Phase 3) ─────────────────────────
  boardSetup(): BoardSetup {
    return this.board;
  }
  robber(): number {
    return this.robberHex;
  }
  bankDeck(): readonly number[] {
    return this.bank;
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
  longestRoad(): number {
    return this.longestRoadHolder;
  }
  largestArmy(): number {
    return this.largestArmyHolder;
  }

  initialPlacementComplete(): boolean {
    return this.initialSettlements.every((count) => count === 2) && this.prompt.kind === 'roll';
  }

  initialSettlementCount(seat: number): number {
    return this.initialSettlements[seat] ?? 0;
  }

  // Typed decision metadata for heuristic/search players. Models receive the same facts in
  // informationStateString, while code-native players can rank sites without parsing text.
  initialSettlementOptions(): InitialSettlementOption[] {
    if (this.prompt.kind !== 'initialSettlement') return [];
    const occ = this.occupancy();
    const options: InitialSettlementOption[] = [];
    for (let node = 0; node < NUM_NODES; node++) {
      if (!canPlaceSettlement(node, occ)) continue;
      options.push({ ...this.settlementSite(node), action: { type: 'initialSettlement', node } });
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

  // The winning seat (10+ VP including hidden cards), or -1. Victory is only claimed on the
  // holder's own turn — that gating lives in applyAction (Phase 1); this is the raw check.
  winner(): number {
    for (let s = 0; s < this.n; s++) if (this.victoryPoints(s, true) >= VP_TO_WIN) return s;
    return -1;
  }

  private deckStr(d: FreqDeck): string {
    const parts = RESOURCES.map((r, i) => (d[i] ? `${d[i]}${r[0]}` : '')).filter(Boolean);
    return parts.join(' ') || '(none)';
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
      .map(([node, building]) => `N${node}=${this.seatName(building.player)}-${building.type}`);
    return parts.join(', ') || '(none)';
  }

  private publicRoads(): string {
    const parts = [...this.roads.entries()]
      .sort(([a], [b]) => a - b)
      .map(([edge, player]) => `E${edge}=${this.seatName(player)}`);
    return parts.join(', ') || '(none)';
  }

  private settlementOptionString(option: InitialSettlementOption): string {
    return `init-settlement ${option.node}: ${this.siteYieldString(option)}`;
  }

  private siteYieldString(site: SettlementSite): string {
    const hexes = site.adjacentHexes
      .map((hex) => `H${hex.hex} ${hex.resource ?? 'desert'} ${hex.token ?? '-'} (${hex.pips} pips)`)
      .join(', ');
    const port = site.port ? `; port=${site.port.resource ?? 'any'} ${site.port.ratio}:1` : '';
    return `${hexes}; total=${site.totalPips} pips; diversity=${site.resourceDiversity}${port}`;
  }
}

function sameAction(a: CatanAction, b: CatanAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The shuffled 25-card development deck (order is hidden information).
function buildDevDeck(rng: () => number): DevCardType[] {
  const deck: DevCardType[] = [];
  for (const t of DEV_CARD_TYPES) for (let i = 0; i < DEV_CARD_COUNTS[t]; i++) deck.push(t);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// The harness Game wrapper. Defaults to a 4-player game; the arcade driver constructs states
// directly with the chosen player count / seat names.
export const catanGame: Game<CatanState, CatanAction> = {
  type: { shortName: 'catan', longName: 'Catan', numPlayers: 4 },
  newInitialState: () => new CatanState({ numPlayers: 4 }),
};

registerGame('catan', () => catanGame as unknown as Game<GameState<unknown>, unknown>);
