// Catan (base 3–4 player game) as a harness state. One `CatanState` = ONE full game, played
// to 10 victory points — like `ChessState` is one game (not one hand like poker's
// `HoldemState`). It implements the OpenSpiel-style `ImperfectInfoState`: dev cards, the
// dev-deck order, and opponents' exact hand breakdowns are hidden; `informationStateString`
// is the per-seat observation an AI is prompted on.
//
// STATUS — foundation skeleton. The state model, board setup, and turn/phase machine are in
// place, along with the trivial harness-contract methods (currentPlayer / isTerminal /
// returns / clone / observation / notation). The two seams that make the game *playable* —
// `legalActions()` and `applyAction()` — are staged: they throw until Phase 1 fills in each
// phase's rules. See docs/catan.md (Part III design, Part IV phasing).
//
// Chance is resolved INTERNALLY (dice rolls, dev-card draws, robber steals) via an injected
// seeded RNG, so `isChanceNode()` is always false — this keeps Catan compatible with the
// generic `runMatch` loop (ai/match.ts), which can't resolve chance nodes, exactly as poker
// deals internally. See docs/catan.md §3.2.
//
// Players are seat indices 0..n-1.

import { type Game, type GameState, type ImperfectInfoState, TERMINAL } from '../game.ts';
import { registerGame } from '../registry.ts';
import { type BoardSetup, generateBoard } from './setup.ts';
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
  type Prompt,
  RESOURCES,
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

const NOT_IMPLEMENTED = 'CatanState: not implemented in the foundation phase — see docs/catan.md Part IV (Phase 1: playable rules core).';

export class CatanState implements ImperfectInfoState<CatanAction> {
  readonly n: number;
  private rng: () => number;
  private seatNames?: readonly string[];

  // Static-ish board (terrain/tokens/harbors never change after setup; the robber moves).
  private board: BoardSetup;
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
    this.n = opts.numPlayers;
    this.rng = opts.rng ?? Math.random;
    this.seatNames = opts.seatNames;

    this.board = generateBoard(this.rng);
    this.robberHex = this.board.robberHex;

    this.bank = fullBank();
    this.hands = Array.from({ length: this.n }, () => emptyFreqDeck());
    this.devDeck = buildDevDeck(this.rng);
    this.devHand = Array.from({ length: this.n }, () => new Array(DEV_CARD_TYPES.length).fill(0));
    this.playedKnights = new Array(this.n).fill(0);

    // Open in the initial-placement (snake) phase. First-player determination and the full
    // snake progression are Phase 1; the skeleton opens the first prompt so currentPlayer()
    // and the observation are meaningful.
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
    s.robberHex = this.robberHex;
    s.bank = this.bank.slice();
    s.hands = this.hands.map((h) => h.slice());
    s.devDeck = this.devDeck.slice();
    s.devHand = this.devHand.map((d) => d.slice());
    s.playedKnights = this.playedKnights.slice();
    s.buildings = new Map(this.buildings);
    s.roads = new Map(this.roads);
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

  // ── Playable seams (Phase 1) ───────────────────────────────────────────────────
  // The single source of truth for what the awaited player may do, and the validated
  // transition. Staged until Phase 1 — see docs/catan.md Part IV.
  legalActions(): CatanAction[] {
    throw new Error(NOT_IMPLEMENTED);
  }
  applyAction(_action: CatanAction): void {
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
  // returns null on anything unrecognized (the caller re-prompts). Full validation happens
  // in applyAction (Phase 1).
  actionFromString(s: string): CatanAction | null {
    const t = s.trim().toLowerCase();
    const nums = (t.match(/-?\d+/g) ?? []).map(Number);
    const res = RESOURCES.filter((r) => t.includes(r));
    if (/^roll/.test(t)) return { type: 'roll' };
    if (/^end/.test(t)) return { type: 'endTurn' };
    if (/init.*sett/.test(t) && nums.length) return { type: 'initialSettlement', node: nums[0] };
    if (/init.*road/.test(t) && nums.length) return { type: 'initialRoad', edge: nums[0] };
    if (/^road-b|road building/.test(t)) return { type: 'playRoadBuilding', edges: nums };
    if (/^road/.test(t) && nums.length) return { type: 'buildRoad', edge: nums[0] };
    if (/^sett/.test(t) && nums.length) return { type: 'buildSettlement', node: nums[0] };
    if (/^city/.test(t) && nums.length) return { type: 'buildCity', node: nums[0] };
    if (/buy.*dev|dev.*card/.test(t)) return { type: 'buyDevCard' };
    if (/knight/.test(t) && nums.length) return { type: 'playKnight', hex: nums[0], victim: nums[1] ?? null };
    if (/year.*plenty|plenty/.test(t)) return { type: 'playYearOfPlenty', resources: res };
    if (/monopoly/.test(t) && res.length) return { type: 'playMonopoly', resource: res[0] };
    if (/discard/.test(t)) return { type: 'discard', resources: res };
    if (/robber/.test(t) && nums.length) return { type: 'moveRobber', hex: nums[0], victim: nums[1] ?? null };
    if (/trade/.test(t) && res.length >= 2) return { type: 'maritimeTrade', give: res[0], get: res[1] };
    return null;
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
