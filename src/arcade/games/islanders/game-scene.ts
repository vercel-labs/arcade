// The Islanders GAME board — the played surface, as distinct from the islanders-test editor. It wraps
// the same `TileScene` renderer rather than a copy of it: the island, harbors, tokens, pieces,
// and their animations are all the test bed's, and this adds only the three things a real game
// needs on top.
//
//   1. The rules engine owns the board once play starts. It accepts the arrangement the setup
//      scene already presented, so the hexes the models reason about and the hexes you see are
//      the same hexes without rebuilding the scene or resetting its camera.
//   2. Legality comes from the state, not from geometry. Every turn the scene is handed the
//      exact legal node/edge set for the current prompt, so a click can only ever be a legal
//      move and no cost or distance rule is re-implemented here.
//   3. A human seam. `requestHumanMove` is the promise `HumanPlayer` awaits; a click on a
//      gated target resolves it.
//
// Every rules action passes through `playMove`. Spatial actions additionally update the shared
// TileScene, while non-spatial actions still benefit from the same resource-delta animation and
// HUD synchronization path.

import { type RenderTarget } from '../../../engine/index.ts';
import { IslandersState } from '../../../rules/islanders/islanders.ts';
import type { BoardSetup } from '../../../rules/islanders/setup.ts';
import { DEV_CARD_TYPES, RESOURCES, resourceIndex, type IslandersAction, type DevCardType, type PlayerColor, type Resource } from '../../../rules/islanders/types.ts';
import type { LayoutBox } from '../../../tui/index.ts';
import { ISLANDERS_RAIL_W, islandersBankDepartureCell, islandersDevDeckDepartureCell, islandersDevHandLandingCellForTypes, islandersDiscardDepartureCell, islandersHandLandingCell } from './card-hud.ts';
import { ResourceFlights, type FlyingResource } from './scene/resource-flight.ts';
import { TileScene } from './tile-scene.ts';

export interface IslandersResourceViewAdjustments {
  // Resources already committed by the rules engine but not yet landed on the visible hand.
  handPending: Record<Resource, number>;
  // Bank resources still represented on their pile until their staggered flight departs.
  bankPendingDeparture: Record<Resource, number>;
  handPendingDeparture?: Record<Resource, number>;
  bankPendingArrival?: Record<Resource, number>;
  developmentHandPending?: Record<DevCardType, number>;
  developmentDeckPendingDeparture?: number;
  pendingDevelopmentCards?: DevCardType[];
}

export interface IslandersActionPreview {
  seat: number;
  action: IslandersAction;
  phase: 'opening' | 'editing' | 'ready' | 'pressing';
  trade?: {
    mode: 'standard' | 'counter';
    give: number[];
    receive: number[];
    via?: 'bank' | 'port' | 'player' | 'counter';
  };
}

function copyTradePreview(trade: NonNullable<IslandersActionPreview['trade']>): NonNullable<IslandersActionPreview['trade']> {
  return { ...trade, give: [...trade.give], receive: [...trade.receive] };
}

function completeTradePreview(action: IslandersAction): NonNullable<IslandersActionPreview['trade']> | null {
  if (action.type === 'offerTrade' || action.type === 'counterTrade') return {
    mode: action.type === 'counterTrade' ? 'counter' : 'standard',
    give: [...action.give],
    receive: [...action.receive],
    via: action.type === 'counterTrade' ? 'counter' : 'player',
  };
  if (action.type !== 'maritimeTrade' && action.type !== 'maritimeBulkTrade') return null;
  const gets = action.type === 'maritimeTrade' ? [action.get] : action.gets;
  const give = RESOURCES.map(() => 0);
  const receive = RESOURCES.map(() => 0);
  give[resourceIndex(action.give)] = (action.via === 'bank' ? 4 : action.rate) * gets.length;
  for (const resource of gets) receive[resourceIndex(resource)]++;
  return { mode: 'standard', give, receive, via: action.via };
}

// Models still choose one complete rules action. These frames are only a readable UI rendition
// of that intent: open the editor, add cards one at a time, let the result settle, then press.
export function islandersActionPlaybackFrames(seat: number, action: IslandersAction): IslandersActionPreview[] {
  const complete = completeTradePreview(action);
  if (!complete) return [{ seat, action, phase: 'pressing' }];
  const staged: NonNullable<IslandersActionPreview['trade']> = {
    mode: complete.mode,
    give: RESOURCES.map(() => 0),
    receive: RESOURCES.map(() => 0),
  };
  const frames: IslandersActionPreview[] = [{ seat, action, phase: 'opening', trade: copyTradePreview(staged) }];
  for (const side of ['give', 'receive'] as const) {
    for (let index = 0; index < RESOURCES.length; index++) {
      for (let count = 0; count < complete[side][index]; count++) {
        staged[side][index]++;
        frames.push({ seat, action, phase: 'editing', trade: copyTradePreview(staged) });
      }
    }
  }
  frames.push({ seat, action, phase: 'ready', trade: copyTradePreview(staged) });
  staged.via = complete.via;
  frames.push({ seat, action, phase: 'pressing', trade: copyTradePreview(staged) });
  return frames;
}

interface PendingResourceGain {
  resource: Resource;
  count: number;
  origin: ResourceGainOrigin;
  // Held until the dice settle (a roll's production), not merely until the layout is known.
  deferred: boolean;
  resolve: () => void;
}

interface PendingResourceLoss {
  resource: Resource;
  count: number;
  toBank: boolean;
  origin: 'hand' | 'discard';
  resolve: () => void;
}

type BoardChoiceType = 'buildRoad' | 'buildSettlement' | 'buildCity' | 'playKnight' | 'playRoadBuilding';
export type IslandersHumanMenuKind = 'discard' | 'yearOfPlenty' | 'monopoly' | 'bankTrade' | 'portTrade' | 'playerTrade' | 'tradeEditor' | 'tradeCounter';

interface BoardChoice {
  type: BoardChoiceType;
  candidates: IslandersAction[];
  firstEdge?: number;
}

interface HumanMenu {
  kind: IslandersHumanMenuKind;
  resources: Resource[];
  give: number[];
  receive: number[];
  maritimeGive?: Resource;
  maritimeRate?: 2 | 3;
}

function emptyResourceCounts(): Record<Resource, number> {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, 0])) as Record<Resource, number>;
}

// Where a gained card is seen to come from. The bank pays for trades, year of plenty, and the
// setup grant, so those leave the bank pile (and the pile's count waits for the departure). A
// roll's production leaves the hexes that produced it. Cards taken from other players
// (monopoly, a robber steal) enter from the bank's spot on the rail without touching its count.
type ResourceGainOrigin = 'bank' | 'players' | { hex: number };

function resourceGainComesFromBank(action: IslandersAction): boolean {
  return action.type === 'initialSettlement'
    || action.type === 'maritimeTrade'
    || action.type === 'maritimeBulkTrade'
    || action.type === 'playYearOfPlenty';
}

function resourceLossGoesToBank(action: IslandersAction): boolean {
  return action.type === 'buildRoad'
    || action.type === 'buildSettlement'
    || action.type === 'buildCity'
    || action.type === 'buyDevCard'
    || action.type === 'discard'
    || action.type === 'maritimeTrade'
    || action.type === 'maritimeBulkTrade';
}

export class IslandersGameScene {
  readonly scene = new TileScene();
  private live: IslandersState | null = null;
  // The board is up from the moment the screen opens, so the setup panel sits over an island
  // rather than the tile bed's default single hex — poker's idle felt, in Islanders's terms. The
  // arrangement is a throwaway: starting a game adopts the rules engine's board over it.
  private colors: PlayerColor[] = [];
  private viewerSeat = 0;
  private readonly bankResourceFlights = new ResourceFlights<Resource>();
  private readonly externalResourceFlights = new ResourceFlights<Resource>();
  private readonly bankBoundResourceFlights = new ResourceFlights<Resource>();
  private readonly externalBoundResourceFlights = new ResourceFlights<Resource>();
  private readonly developmentFlights = new ResourceFlights<DevCardType>();
  private readonly handPending = emptyResourceCounts();
  private readonly bankPendingDeparture = emptyResourceCounts();
  private readonly handPendingDeparture = emptyResourceCounts();
  private readonly bankPendingArrival = emptyResourceCounts();
  private pendingResourceGains: PendingResourceGain[] = [];
  private pendingResourceLosses: PendingResourceLoss[] = [];
  private readonly developmentHandPending = Object.fromEntries(DEV_CARD_TYPES.map((type) => [type, 0])) as Record<DevCardType, number>;
  private developmentDeckPendingDeparture = 0;
  private pendingDevelopmentCards: DevCardType[] = [];
  private pendingDevelopmentSpawns: DevCardType[] = [];
  private resourceFlightLayout: { region: LayoutBox; playerCount: number; railVisible: boolean; composerRows: number } | null = null;
  // The in-flight human turn: resolved by a board click, rejected when the match is aborted.
  private pending: {
    resolve: (action: IslandersAction) => void;
    reject: (err: Error) => void;
    detach: () => void;
  } | null = null;
  private boardChoice: BoardChoice | null = null;
  private robberVictims: Extract<IslandersAction, { type: 'moveRobber' | 'playKnight' }>[] = [];
  private humanMenu: HumanMenu | null = null;
  private preview: IslandersActionPreview | null = null;
  private previewDurationMs = 0;
  private synchronizeActionAnimations = false;
  private humanSeat = -1;
  private setupComplete = false;
  private onChange: () => void = () => {};

  constructor() {
    this.scene.setMode('boardCards');
    this.scene.deferNumberReveal();
    // This is the live-game adapter, not the free-form test board. Keep the
    // preview inert while the setup panel owns the screen.
    this.scene.setPlacementGate({ nodes: [], edges: [] });
  }

  preparedBoard(): BoardSetup | null {
    return this.scene.boardSetup();
  }

  prepareBoard(): void {
    this.scene.generateBoardPreview();
  }

  // Repaint hook — fired whenever a click or an applied move changes what the HUD reads.
  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  // Take over the board for a new session: adopt the engine's arrangement, drop any pieces
  // from a previous game, and remember each seat's color.
  beginSession(state: IslandersState, colors: PlayerColor[], viewerSeat = 0, humanSeat = -1): Promise<void> {
    this.cancelPending('A new game started');
    this.scene.cancelActionAnimations();
    this.clearResourceFlights();
    this.live = state;
    this.colors = colors.slice();
    this.viewerSeat = viewerSeat;
    this.humanSeat = humanSeat;
    this.scene.setActiveColor(colors[humanSeat >= 0 ? humanSeat : viewerSeat] ?? 'red');
    this.setupComplete = false;
    this.clearHumanChoice();
    this.scene.setMode('boardCards');
    this.scene.clearPieces();
    // The rules state owns the exact board already being presented. Claim it without rebuilding
    // the scene or touching its camera, then reveal its number chips before play is released.
    this.scene.adoptBoard(state.boardSetup(), false);
    this.refreshGate();
    return this.scene.revealNumbers().then(() => {
      if (this.live !== state) return;
      this.setupComplete = true;
      this.onChange();
    });
  }

  // Ending a live session returns to the setup panel, where the board is visual
  // only. The separate Islanders test controller owns free-form editor hover.
  endSession(): void {
    this.cancelPending('The game ended');
    this.scene.cancelActionAnimations();
    this.clearResourceFlights();
    this.live = null;
    this.colors = [];
    this.humanSeat = -1;
    this.setupComplete = false;
    this.clearHumanChoice();
    this.scene.setPlacementGate({ nodes: [], edges: [] });
  }

  state(): IslandersState {
    if (!this.live) throw new Error('No Islanders game is in progress');
    return this.live;
  }
  hasSession(): boolean {
    return this.live !== null;
  }
  setupPresentationComplete(): boolean {
    return this.setupComplete;
  }
  colorOf(seat: number): PlayerColor {
    return this.colors[seat] ?? 'red';
  }
  viewedSeat(): number {
    return this.viewerSeat;
  }
  setViewedSeat(seat: number): boolean {
    if (!this.live || !Number.isInteger(seat) || seat < 0 || seat >= this.live.n || seat === this.viewerSeat) return false;
    const layout = this.resourceFlightLayout;
    this.clearResourceFlights();
    this.resourceFlightLayout = layout;
    this.viewerSeat = seat;
    this.onChange();
    return true;
  }
  setActionPreviewDuration(ms: number): void {
    this.previewDurationMs = Math.max(0, Math.floor(ms));
  }
  setActionAnimationSynchronization(enabled: boolean): void {
    this.synchronizeActionAnimations = enabled;
  }
  actionPreview(): IslandersActionPreview | null {
    return this.preview
      ? { ...this.preview, ...(this.preview.trade ? { trade: copyTradePreview(this.preview.trade) } : {}) }
      : null;
  }
  withdrawHumanCounter(): boolean {
    return false;
  }

  private playbackFrameDuration(frame: IslandersActionPreview): number {
    if (!frame.trade) return this.previewDurationMs;
    const scale = frame.phase === 'opening' ? 0.55
      : frame.phase === 'editing' ? 0.35
        : frame.phase === 'ready' ? 1.1
          : 0.65;
    return Math.max(1, Math.round(this.previewDurationMs * scale));
  }

  // ── the match seam ────────────────────────────────────────────────────────────
  // Apply an action and show it. The state is authoritative: it validates and transitions,
  // and only then does the board place the piece, so an illegal action can never leave a
  // piece behind. Live Arcade sessions can opt into presentation synchronization; headless
  // match-lab scenes leave it disabled and therefore never depend on a render loop.
  async playMove(action: IslandersAction): Promise<void> {
    const state = this.state();
    const seat = state.currentPlayer();
    if (this.previewDurationMs > 0 && seat !== this.humanSeat) {
      for (const frame of islandersActionPlaybackFrames(seat, action)) {
        this.preview = frame;
        this.onChange();
        await new Promise<void>((resolve) => setTimeout(resolve, this.playbackFrameDuration(frame)));
        // Reset/new-game can happen while a presentation beat is showing. The old action must
        // never leak into the replacement session.
        if (this.live !== state) return;
      }
    }
    const handBefore = state.handOf(this.viewerSeat).slice();
    // An out-of-turn trade withdrawal can invalidate a confirmation while its visual
    // preview is running. The driver aborts/restarts that decision; do not apply it stale.
    if (!state.isLegalAction(action)) return;
    state.applyAction(action);
    const keepPreviewThroughAnimation = this.synchronizeActionAnimations && action.type !== 'buyDevCard';
    if (keepPreviewThroughAnimation && !this.preview) this.preview = { seat, action, phase: 'pressing' };
    else if (!keepPreviewThroughAnimation) this.preview = null;
    const handAfter = state.handOf(this.viewerSeat);
    const fromBank = resourceGainComesFromBank(action);
    const deferRollProduction = this.synchronizeActionAnimations && action.type === 'roll';
    const rolled = action.type === 'roll' ? state.actionRecords().at(-1)?.outcome?.dice?.reduce((sum, die) => sum + die, 0) : undefined;
    const resourceCompletions: Promise<void>[] = [];
    for (const resource of RESOURCES) {
      const gain = (handAfter[resourceIndex(resource)] ?? 0) - (handBefore[resourceIndex(resource)] ?? 0);
      if (gain > 0) {
        for (const { origin, count } of this.gainOrigins(resource, gain, fromBank, rolled)) {
          resourceCompletions.push(this.queueResourceGain(resource, count, origin, deferRollProduction));
        }
      } else if (gain < 0) {
        const origin = action.type === 'discard' && seat === this.humanSeat && seat === this.viewerSeat
          ? 'discard'
          : 'hand';
        resourceCompletions.push(this.queueResourceLoss(resource, -gain, resourceLossGoesToBank(action), origin));
      }
    }
    if (action.type === 'buyDevCard' && seat === this.viewerSeat) {
      const card = state.actionRecords().at(-1)?.outcome?.developmentCard;
      if (card) this.queueDevelopmentPurchase(card);
    }
    const presentationCompletions: Promise<void>[] = [];
    let rollCompletion: Promise<void> | null = null;
    if (action.type === 'initialSettlement' || action.type === 'buildSettlement') {
      presentationCompletions.push(this.scene.placePiece('building', action.node, this.colorOf(seat)));
    }
    else if (action.type === 'initialRoad' || action.type === 'buildRoad') {
      presentationCompletions.push(this.scene.placePiece('road', action.edge, this.colorOf(seat)));
    }
    else if (action.type === 'buildCity') presentationCompletions.push(this.scene.upgradeBuilding(action.node));
    else if (action.type === 'roll') {
      const dice = state.dice();
      if (dice) rollCompletion = this.scene.rollDice(dice);
    }
    else if (action.type === 'playRoadBuilding') {
      for (const edge of action.edges) presentationCompletions.push(this.scene.placePiece('road', edge, this.colorOf(seat)));
    }
    else if (action.type === 'moveRobber' || action.type === 'playKnight') presentationCompletions.push(this.scene.syncRobberHex(action.hex, this.synchronizeActionAnimations));
    const refreshAfterAnimation = this.synchronizeActionAnimations && action.type === 'roll';
    if (!refreshAfterAnimation) this.refreshGate();
    this.onChange();
    if (!this.synchronizeActionAnimations || action.type === 'buyDevCard') return;
    if (rollCompletion) {
      await rollCompletion;
      if (this.live !== state) return;
      this.flushPendingResourceGains(true);
      this.flushPendingResourceLosses();
      this.onChange();
    }
    await Promise.all([...presentationCompletions, ...resourceCompletions]);
    if (this.live !== state) return;
    this.preview = null;
    if (refreshAfterAnimation) this.refreshGate();
    this.onChange();
  }

  // The `HumanPlayer` seam: resolve when the player clicks a legal target. Rejects when the
  // turn is aborted, mirroring ModelPlayer so `runMatch` unwinds cleanly.
  requestHumanMove(signal?: AbortSignal): Promise<IslandersAction> {
    this.cancelPending('A new turn started');
    this.clearHumanChoice();
    return new Promise<IslandersAction>((resolve, reject) => {
      const onAbort = (): void => this.cancelPending('The turn was aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending = {
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
      };
      if (signal?.aborted) this.cancelPending('The turn was aborted');
      else if (this.live?.currentPrompt().kind === 'discard') this.beginHumanMenu('discard');
      else this.refreshGate();
    });
  }

  private cancelPending(reason: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.clearHumanChoice();
    pending.detach();
    pending.reject(new Error(reason));
  }

  awaitingHuman(): boolean {
    return this.pending !== null;
  }

  boardChoiceType(): BoardChoiceType | null {
    return this.boardChoice?.type ?? null;
  }

  humanMenuKind(): IslandersHumanMenuKind | null {
    return this.humanMenu?.kind ?? null;
  }

  humanMenuResources(): readonly Resource[] {
    return this.humanMenu?.resources ?? [];
  }

  humanTradeDraft(): { give: readonly number[]; receive: readonly number[]; maritimeGive?: Resource; maritimeRate?: 2 | 3 } {
    return {
      give: this.humanMenu?.give ?? RESOURCES.map(() => 0),
      receive: this.humanMenu?.receive ?? RESOURCES.map(() => 0),
      ...(this.humanMenu?.maritimeGive ? { maritimeGive: this.humanMenu.maritimeGive } : {}),
      ...(this.humanMenu?.maritimeRate ? { maritimeRate: this.humanMenu.maritimeRate } : {}),
    };
  }

  robberVictimSeats(): readonly (number | null)[] {
    return this.robberVictims.map((action) => action.victim);
  }

  // Non-spatial HUD choices and the final step of staged choices all converge here. Re-checking
  // legality at submission time protects against stale UI nodes from a previous frame.
  submitHumanAction(action: IslandersAction): boolean {
    if (!this.pending || !this.live || !this.live.isLegalAction(action)) return false;
    const pending = this.pending;
    this.pending = null;
    pending.detach();
    this.clearHumanChoice();
    this.scene.setPlacementGate({ nodes: [], edges: [] });
    this.scene.cancelRobberMove();
    pending.resolve(action);
    this.onChange();
    return true;
  }

  beginBoardChoice(type: BoardChoiceType): boolean {
    if (!this.pending || !this.live) return false;
    const candidates = this.live.legalActions().filter((action) => action.type === type);
    if (!candidates.length) return false;
    this.boardChoice = { type, candidates };
    this.robberVictims = [];
    this.humanMenu = null;
    this.refreshGate();
    this.onChange();
    return true;
  }

  cancelHumanChoice(): void {
    if (!this.boardChoice && !this.robberVictims.length && !this.humanMenu) return;
    this.clearHumanChoice();
    this.refreshGate();
    this.onChange();
  }

  chooseRobberVictim(victim: number | null): boolean {
    const action = this.robberVictims.find((candidate) => candidate.victim === victim);
    return action ? this.submitHumanAction(action) : false;
  }

  beginHumanMenu(kind: IslandersHumanMenuKind): boolean {
    if (!this.pending || !this.live) return false;
    const legal = this.live.legalActions();
    const available = kind === 'discard'
      ? this.live.currentPrompt().kind === 'discard'
      : kind === 'yearOfPlenty'
        ? legal.some((action) => action.type === 'playYearOfPlenty')
        : kind === 'monopoly'
          ? legal.some((action) => action.type === 'playMonopoly')
          : kind === 'bankTrade'
            ? legal.some((action) => action.type === 'maritimeTrade' && action.via === 'bank')
            : kind === 'portTrade'
              ? legal.some((action) => action.type === 'maritimeTrade' && action.via === 'port')
              : kind === 'playerTrade'
                ? this.live.legalActionFamilies().some((family) => family.type === 'offerTrade')
                : kind === 'tradeEditor'
                  ? legal.some((action) => action.type === 'maritimeTrade')
                    || this.live.legalActionFamilies().some((family) => family.type === 'offerTrade')
                  : this.live.legalActionFamilies().some((family) => family.type === 'counterTrade');
    if (!available) return false;
    this.boardChoice = null;
    this.robberVictims = [];
    const trade = this.live.activeTrade();
    this.humanMenu = {
      kind,
      resources: [],
      give: kind === 'tradeCounter' && trade ? [...trade.receive] : RESOURCES.map(() => 0),
      receive: kind === 'tradeCounter' && trade ? [...trade.give] : RESOURCES.map(() => 0),
    };
    this.refreshGate();
    this.onChange();
    return true;
  }

  pickHumanMenuResource(resource: Resource, side: 'give' | 'receive' = 'receive'): boolean {
    const menu = this.humanMenu;
    const state = this.live;
    if (!menu || !state || !this.pending) return false;
    if (menu.kind === 'monopoly') return this.submitHumanAction({ type: 'playMonopoly', resource });
    if (menu.kind === 'bankTrade' || menu.kind === 'portTrade') {
      if (!menu.maritimeGive) {
        return this.pickHumanMaritimeGive(resource);
      }
      const gets = [...menu.resources, resource];
      const action: IslandersAction = menu.kind === 'bankTrade'
        ? { type: 'maritimeBulkTrade', via: 'bank', give: menu.maritimeGive, gets }
        : { type: 'maritimeBulkTrade', via: 'port', rate: menu.maritimeRate ?? 3, give: menu.maritimeGive, gets };
      if (!state.isLegalAction(action)) return false;
      menu.resources.push(resource);
      this.onChange();
      return true;
    }
    if (menu.kind === 'playerTrade' || menu.kind === 'tradeEditor' || menu.kind === 'tradeCounter') {
      return this.adjustHumanTradeResource(resource, side, 1);
    }
    const limit = menu.kind === 'discard'
      ? state.legalActionFamilies().find((family) => family.type === 'discard')?.count ?? 0
      : 2;
    if (menu.resources.length >= limit) return false;
    const candidate = [...menu.resources, resource];
    const candidateCounts = RESOURCES.map((r) => candidate.filter((held) => held === r).length);
    const possible = menu.kind === 'discard'
      ? candidateCounts.every((count, index) => count <= (state.handOf(state.currentPlayer())[index] ?? 0))
      : state.legalActions().some((action) => action.type === 'playYearOfPlenty'
          && candidateCounts.every((count, index) => count <= action.resources.filter((held) => held === RESOURCES[index]).length));
    if (!possible) return false;
    menu.resources.push(resource);
    this.onChange();
    return true;
  }

  removeHumanDiscardResource(resource: Resource): boolean {
    const menu = this.humanMenu;
    if (!menu || menu.kind !== 'discard' || !this.pending) return false;
    const index = menu.resources.lastIndexOf(resource);
    if (index < 0) return false;
    menu.resources.splice(index, 1);
    this.onChange();
    return true;
  }

  adjustHumanTradeResource(resource: Resource, side: 'give' | 'receive', delta: -1 | 1): boolean {
    const menu = this.humanMenu;
    const state = this.live;
    if (!menu || !state || !this.pending
      || (menu.kind !== 'playerTrade' && menu.kind !== 'tradeEditor' && menu.kind !== 'tradeCounter')) return false;
    const index = resourceIndex(resource);
    const target = side === 'give' ? menu.give : menu.receive;
    const other = side === 'give' ? menu.receive : menu.give;
    if (delta < 0) {
      if (target[index] <= 0) return false;
      target[index]--;
    } else {
      if (other[index] > 0) return false;
      if (side === 'give' && target[index] >= (state.handOf(state.currentPlayer())[index] ?? 0)) return false;
      if (side === 'receive' && target[index] >= (state.bankDeck()[index] ?? 0)) return false;
      target[index]++;
    }
    this.onChange();
    return true;
  }

  pickHumanMaritimeGive(resource: Resource, rate?: 2 | 3): boolean {
    const menu = this.humanMenu;
    const state = this.live;
    if (!menu || !state || (menu.kind !== 'bankTrade' && menu.kind !== 'portTrade')) return false;
    const hasGive = state.legalActions().some((action) => action.type === 'maritimeTrade'
      && action.via === (menu.kind === 'bankTrade' ? 'bank' : 'port')
      && action.give === resource && (action.via === 'bank' || rate === undefined || action.rate === rate));
    if (!hasGive) return false;
    menu.maritimeGive = resource;
    if (menu.kind === 'portTrade') menu.maritimeRate = rate ?? state.maritimePortTradeRates(state.currentPlayer())[resource][0];
    this.onChange();
    return true;
  }

  clearHumanMenuDraft(): void {
    if (!this.humanMenu) return;
    this.humanMenu.resources = [];
    this.humanMenu.give.fill(0);
    this.humanMenu.receive.fill(0);
    delete this.humanMenu.maritimeGive;
    delete this.humanMenu.maritimeRate;
    this.onChange();
  }

  submitHumanMenu(): boolean {
    const menu = this.humanMenu;
    if (!menu) return false;
    if (menu.kind === 'discard') return this.submitHumanAction({ type: 'discard', resources: [...menu.resources] });
    if (menu.kind === 'yearOfPlenty') return this.submitHumanAction({ type: 'playYearOfPlenty', resources: [...menu.resources] });
    if (menu.kind === 'playerTrade') return this.submitHumanAction({ type: 'offerTrade', give: [...menu.give], receive: [...menu.receive] });
    if (menu.kind === 'tradeEditor') return this.submitHumanTrade('player');
    if (menu.kind === 'tradeCounter') return this.submitHumanAction({ type: 'counterTrade', give: [...menu.give], receive: [...menu.receive] });
    if ((menu.kind === 'bankTrade' || menu.kind === 'portTrade') && menu.maritimeGive) {
      return this.submitHumanAction(menu.kind === 'bankTrade'
        ? { type: 'maritimeBulkTrade', via: 'bank', give: menu.maritimeGive, gets: [...menu.resources] }
        : { type: 'maritimeBulkTrade', via: 'port', rate: menu.maritimeRate ?? 3, give: menu.maritimeGive, gets: [...menu.resources] });
    }
    return false;
  }

  humanMenuCanSubmit(): boolean {
    const menu = this.humanMenu;
    if (!menu || !this.live) return false;
    if (menu.kind === 'discard') return this.live.isLegalAction({ type: 'discard', resources: [...menu.resources] });
    if (menu.kind === 'yearOfPlenty') return this.live.isLegalAction({ type: 'playYearOfPlenty', resources: [...menu.resources] });
    if (menu.kind === 'playerTrade') return this.live.isLegalAction({ type: 'offerTrade', give: [...menu.give], receive: [...menu.receive] });
    if (menu.kind === 'tradeEditor') {
      return this.humanTradeCanSubmit('bank') || this.humanTradeCanSubmit('port') || this.humanTradeCanSubmit('player');
    }
    if (menu.kind === 'tradeCounter') return this.live.isLegalAction({ type: 'counterTrade', give: [...menu.give], receive: [...menu.receive] });
    if ((menu.kind === 'bankTrade' || menu.kind === 'portTrade') && menu.maritimeGive) {
      return this.live.isLegalAction(menu.kind === 'bankTrade'
        ? { type: 'maritimeBulkTrade', via: 'bank', give: menu.maritimeGive, gets: [...menu.resources] }
        : { type: 'maritimeBulkTrade', via: 'port', rate: menu.maritimeRate ?? 3, give: menu.maritimeGive, gets: [...menu.resources] });
    }
    return false;
  }

  humanTradeCanSubmit(via: 'bank' | 'port' | 'player' | 'counter'): boolean {
    return this.humanTradeAction(via) !== null;
  }

  submitHumanTrade(via: 'bank' | 'port' | 'player' | 'counter'): boolean {
    const action = this.humanTradeAction(via);
    return action ? this.submitHumanAction(action) : false;
  }

  private humanTradeAction(via: 'bank' | 'port' | 'player' | 'counter'): IslandersAction | null {
    const menu = this.humanMenu;
    const state = this.live;
    if (!menu || !state) return null;
    if (via === 'player') {
      if (menu.kind !== 'tradeEditor' && menu.kind !== 'playerTrade') return null;
      const action: IslandersAction = { type: 'offerTrade', give: [...menu.give], receive: [...menu.receive] };
      return state.isLegalAction(action) ? action : null;
    }
    if (via === 'counter') {
      if (menu.kind !== 'tradeCounter') return null;
      const action: IslandersAction = { type: 'counterTrade', give: [...menu.give], receive: [...menu.receive] };
      return state.isLegalAction(action) ? action : null;
    }
    if (menu.kind !== 'tradeEditor' && menu.kind !== 'bankTrade' && menu.kind !== 'portTrade') return null;
    const giveIndexes = menu.give.flatMap((count, index) => count > 0 ? [index] : []);
    if (giveIndexes.length !== 1) return null;
    const giveIndex = giveIndexes[0];
    const give = RESOURCES[giveIndex];
    const gets = RESOURCES.flatMap((resource, index) => Array.from({ length: menu.receive[index] ?? 0 }, () => resource));
    if (gets.length === 0) return null;
    const rate = (menu.give[giveIndex] ?? 0) / gets.length;
    const action: IslandersAction | null = via === 'bank'
      ? rate === 4 ? { type: 'maritimeBulkTrade', via: 'bank', give, gets } : null
      : rate === 2 || rate === 3 ? { type: 'maritimeBulkTrade', via: 'port', rate, give, gets } : null;
    return action && state.isLegalAction(action) ? action : null;
  }

  private clearHumanChoice(): void {
    this.boardChoice = null;
    this.robberVictims = [];
    this.humanMenu = null;
    this.preview = null;
  }

  // ── legal-target gate ─────────────────────────────────────────────────────────
  // Offer the board exactly the current prompt's legal targets — but only while the human is
  // the one being asked. On a model's turn nothing is clickable, so a stray click can never
  // steal its move.
  private refreshGate(): void {
    this.scene.cancelRobberMove();
    if (!this.live || !this.pending) {
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      return;
    }
    const state = this.live;
    const prompt = state.currentPrompt();
    if (this.robberVictims.length) {
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      return;
    }
    if (prompt.kind === 'initialSettlement') {
      this.scene.setPlacementGate({ nodes: state.initialSettlementOptions().map((o) => o.action.node) });
    } else if (prompt.kind === 'initialRoad') {
      this.scene.setPlacementGate({ edges: state.initialRoadOptions().map((o) => o.action.edge) });
    } else if (prompt.kind === 'moveRobber' || this.boardChoice?.type === 'playKnight') {
      const candidates = prompt.kind === 'moveRobber' ? state.legalActions() : this.boardChoice?.candidates ?? [];
      const hexes = candidates
        .filter((action): action is Extract<IslandersAction, { type: 'moveRobber' | 'playKnight' }> => action.type === 'moveRobber' || action.type === 'playKnight')
        .map((action) => action.hex);
      this.scene.setPlacementGate({ nodes: [], edges: [] });
      this.scene.beginRobberMove(hexes);
    } else if (this.boardChoice?.type === 'buildRoad') {
      this.scene.setPlacementGate({ edges: this.boardChoice.candidates
        .filter((action): action is Extract<IslandersAction, { type: 'buildRoad' }> => action.type === 'buildRoad')
        .map((action) => action.edge) });
    } else if (this.boardChoice?.type === 'buildSettlement' || this.boardChoice?.type === 'buildCity') {
      this.scene.setPlacementGate({ nodes: this.boardChoice.candidates
        .filter((action): action is Extract<IslandersAction, { type: 'buildSettlement' | 'buildCity' }> => action.type === 'buildSettlement' || action.type === 'buildCity')
        .map((action) => action.node) });
    } else if (this.boardChoice?.type === 'playRoadBuilding') {
      const first = this.boardChoice.firstEdge;
      const edges = this.boardChoice.candidates
        .filter((action): action is Extract<IslandersAction, { type: 'playRoadBuilding' }> => action.type === 'playRoadBuilding')
        .flatMap((action) => first === undefined ? action.edges.slice(0, 1) : action.edges[0] === first ? action.edges.slice(1, 2) : []);
      this.scene.setPlacementGate({ edges });
    } else {
      // Non-spatial choices stay in the action palette; leave the board inert until the player
      // explicitly enters a build/development-card targeting mode.
      this.scene.setPlacementGate({ nodes: [], edges: [] });
    }
  }

  // ── pointer ───────────────────────────────────────────────────────────────────
  hoverAt(ndcX: number, ndcY: number): void {
    if (!this.live) return;
    this.scene.hoverBoard(ndcX, ndcY);
  }

  // A board click during your turn: turn the picked target into the prompt's action and hand
  // it to the awaiting HumanPlayer. Anything else is ignored — the gate has already excluded
  // illegal targets, so there is nothing to validate here.
  clickAt(ndcX: number, ndcY: number): void {
    const pending = this.pending;
    if (!pending || !this.live) return;
    const prompt = this.live.currentPrompt();
    let action: IslandersAction | null = null;
    if (prompt.kind === 'moveRobber' || this.boardChoice?.type === 'playKnight') {
      const hex = this.scene.pickRobberHexAt(ndcX, ndcY);
      if (hex === null) return;
      const type = prompt.kind === 'moveRobber' ? 'moveRobber' : 'playKnight';
      const candidates = (type === 'moveRobber' ? this.live.legalActions() : this.boardChoice?.candidates ?? [])
        .filter((candidate): candidate is Extract<IslandersAction, { type: 'moveRobber' | 'playKnight' }> => candidate.type === type && candidate.hex === hex);
      if (candidates.length > 1) {
        this.robberVictims = candidates;
        this.scene.setPlacementGate({ nodes: [], edges: [] });
        this.scene.cancelRobberMove();
        this.onChange();
        return;
      }
      action = candidates[0] ?? null;
    } else {
      const target = this.scene.pickBoardAt(ndcX, ndcY);
      if (!target) return;
      action =
        prompt.kind === 'initialSettlement' && target.kind === 'node'
          ? { type: 'initialSettlement', node: target.id }
          : prompt.kind === 'initialRoad' && target.kind === 'edge'
            ? { type: 'initialRoad', edge: target.id }
            : this.boardChoice?.type === 'buildRoad' && target.kind === 'edge'
              ? this.boardChoice.candidates.find((candidate) => candidate.type === 'buildRoad' && candidate.edge === target.id) ?? null
              : this.boardChoice?.type === 'buildSettlement' && target.kind === 'node'
                ? this.boardChoice.candidates.find((candidate) => candidate.type === 'buildSettlement' && candidate.node === target.id) ?? null
                : this.boardChoice?.type === 'buildCity' && target.kind === 'node'
                  ? this.boardChoice.candidates.find((candidate) => candidate.type === 'buildCity' && candidate.node === target.id) ?? null
                  : null;
      if (!action && this.boardChoice?.type === 'playRoadBuilding' && target.kind === 'edge') {
        if (this.boardChoice.firstEdge === undefined) {
          const candidates = this.boardChoice.candidates.filter((candidate) => candidate.type === 'playRoadBuilding' && candidate.edges[0] === target.id);
          const single = candidates.find((candidate) => candidate.type === 'playRoadBuilding' && candidate.edges.length === 1);
          if (single) action = single;
          else if (candidates.length) {
            this.boardChoice = { ...this.boardChoice, candidates, firstEdge: target.id };
            this.refreshGate();
            this.onChange();
            return;
          }
        } else {
          action = this.boardChoice.candidates.find((candidate) => candidate.type === 'playRoadBuilding'
            && candidate.edges[0] === this.boardChoice?.firstEdge && candidate.edges[1] === target.id) ?? null;
        }
      }
    }
    if (!action) return;
    this.submitHumanAction(action);
  }

  // ── render ────────────────────────────────────────────────────────────────────
  needsRender(): boolean {
    return this.scene.needsRender() || this.bankResourceFlights.busy() || this.externalResourceFlights.busy()
      || this.bankBoundResourceFlights.busy() || this.externalBoundResourceFlights.busy() || this.developmentFlights.busy();
  }
  renderScene(target: RenderTarget, t: number): void {
    this.scene.renderScene(target, t);
    const bank = this.bankResourceFlights.advanceWithDepartures(t);
    const external = this.externalResourceFlights.advanceWithDepartures(t);
    const bankBound = this.bankBoundResourceFlights.advanceWithDepartures(t);
    const externalBound = this.externalBoundResourceFlights.advanceWithDepartures(t);
    const development = this.developmentFlights.advanceWithDepartures(t);
    for (const resource of bank.departed) this.bankPendingDeparture[resource]--;
    for (const resource of [...bank.landed, ...external.landed]) this.handPending[resource]--;
    for (const resource of [...bankBound.departed, ...externalBound.departed]) this.handPendingDeparture[resource]--;
    for (const resource of bankBound.landed) this.bankPendingArrival[resource]--;
    for (const type of development.departed) this.developmentDeckPendingDeparture--;
    for (const type of development.landed) {
      this.developmentHandPending[type]--;
      const pending = this.pendingDevelopmentCards.indexOf(type);
      if (pending >= 0) this.pendingDevelopmentCards.splice(pending, 1);
    }
    if (bank.departed.length || bank.landed.length || external.departed.length || external.landed.length
      || bankBound.departed.length || bankBound.landed.length || externalBound.departed.length || externalBound.landed.length
      || development.departed.length || development.landed.length) {
      this.onChange();
    }
  }
  requestAnimationFrame(): void {
    this.scene.requestAnimationFrame();
  }

  // The flight starts at the bank card while the sidebar is visible, otherwise one cell beyond
  // the right edge at the same height. Layout can arrive after a very fast model decision; gains
  // are retained until this is called rather than skipping their animation.
  setResourceFlightLayout(region: LayoutBox, playerCount: number, railVisible: boolean, composerRows = 0): void {
    this.resourceFlightLayout = { region: { ...region }, playerCount, railVisible, composerRows };
    this.flushPendingResourceGains();
    this.flushPendingResourceLosses();
    this.flushPendingDevelopmentPurchases();
  }

  activeResourceFlights(): FlyingResource<Resource | DevCardType>[] {
    return [
      ...this.bankResourceFlights.active(),
      ...this.externalResourceFlights.active(),
      ...this.bankBoundResourceFlights.active(),
      ...this.externalBoundResourceFlights.active(),
      ...this.developmentFlights.active(),
    ];
  }

  resourceViewAdjustments(): IslandersResourceViewAdjustments {
    return {
      handPending: { ...this.handPending },
      bankPendingDeparture: { ...this.bankPendingDeparture },
      handPendingDeparture: { ...this.handPendingDeparture },
      bankPendingArrival: { ...this.bankPendingArrival },
      developmentHandPending: { ...this.developmentHandPending },
      developmentDeckPendingDeparture: this.developmentDeckPendingDeparture,
      pendingDevelopmentCards: [...this.pendingDevelopmentCards],
    };
  }

  // Split one resource's gain into flights by origin. A roll's cards are attributed to the
  // hexes that paid the viewer, in board order, capped at what actually arrived (the bank can
  // run short, in which case the rules pay nobody that resource); anything unattributable, and
  // every non-roll gain, keeps a single origin.
  private gainOrigins(resource: Resource, gain: number, fromBank: boolean, rolled: number | undefined): { origin: ResourceGainOrigin; count: number }[] {
    if (rolled !== undefined) {
      const out: { origin: ResourceGainOrigin; count: number }[] = [];
      let left = gain;
      for (const payout of this.scene.rollPayoutsFor(this.colorOf(this.viewerSeat), rolled)) {
        if (payout.resource !== resource || left <= 0) continue;
        const count = Math.min(payout.count, left);
        out.push({ origin: { hex: payout.hex }, count });
        left -= count;
      }
      if (left > 0) out.push({ origin: 'bank', count: left });
      return out;
    }
    return [{ origin: fromBank ? 'bank' : 'players', count: gain }];
  }

  private queueResourceGain(resource: Resource, count: number, origin: ResourceGainOrigin, defer = false): Promise<void> {
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    this.handPending[resource] += count;
    if (origin === 'bank') this.bankPendingDeparture[resource] += count;
    this.pendingResourceGains.push({ resource, count, origin, deferred: defer, resolve: resolveCompletion });
    if (!defer) this.flushPendingResourceGains();
    return completion;
  }

  // Launch the queued gains that have a layout to fly in. Deferred (roll) gains stay queued
  // unless `releaseDeferred` — the HUD refreshes the layout every frame, and that must not
  // let production leave the bank while the dice are still tumbling.
  private flushPendingResourceGains(releaseDeferred = false): void {
    const layout = this.resourceFlightLayout;
    if (!layout || !this.pendingResourceGains.length) return;
    const held = releaseDeferred ? [] : this.pendingResourceGains.filter((gain) => gain.deferred);
    const ready = releaseDeferred ? this.pendingResourceGains : this.pendingResourceGains.filter((gain) => !gain.deferred);
    const sceneCols = layout.region.w - (layout.railVisible ? ISLANDERS_RAIL_W : 0);
    let order = 0;
    for (const gain of ready) {
      // A hex behind the camera has no cell; that card comes from the bank's spot instead.
      const hexCell = typeof gain.origin === 'object'
        ? this.scene.hexCell(gain.origin.hex, sceneCols, layout.region.h)
        : null;
      const from = hexCell
        ? { col: layout.region.x + hexCell.col, row: layout.region.y + hexCell.row }
        : islandersBankDepartureCell(layout.region, gain.resource, layout.playerCount, layout.railVisible, layout.composerRows);
      const to = islandersHandLandingCell(layout.region, gain.resource);
      const flights = gain.origin === 'bank' ? this.bankResourceFlights : this.externalResourceFlights;
      void flights.spawn(gain.resource, gain.count, from, to, order).then(gain.resolve);
      order += gain.count;
    }
    this.pendingResourceGains = held;
  }

  private queueResourceLoss(
    resource: Resource,
    count: number,
    toBank: boolean,
    origin: PendingResourceLoss['origin'],
  ): Promise<void> {
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    this.handPendingDeparture[resource] += count;
    if (toBank) this.bankPendingArrival[resource] += count;
    this.pendingResourceLosses.push({ resource, count, toBank, origin, resolve: resolveCompletion });
    this.flushPendingResourceLosses();
    return completion;
  }

  private flushPendingResourceLosses(): void {
    const layout = this.resourceFlightLayout;
    if (!layout || !this.pendingResourceLosses.length) return;
    let order = 0;
    for (const loss of this.pendingResourceLosses) {
      const from = loss.origin === 'discard'
        ? islandersDiscardDepartureCell(layout.region, loss.resource)
        : islandersHandLandingCell(layout.region, loss.resource);
      const to = islandersBankDepartureCell(layout.region, loss.resource, layout.playerCount, loss.toBank && layout.railVisible, layout.composerRows);
      const flights = loss.toBank ? this.bankBoundResourceFlights : this.externalBoundResourceFlights;
      // Outgoing cards rise toward the bank rather than sinking behind the hand. Keep the full
      // chip visible for that path; target clipping is only for cards landing in the hand.
      void flights.spawn(loss.resource, loss.count, from, to, order, undefined, false).then(loss.resolve);
      order += loss.count;
    }
    this.pendingResourceLosses = [];
  }

  private queueDevelopmentPurchase(type: DevCardType): void {
    this.developmentHandPending[type]++;
    this.developmentDeckPendingDeparture++;
    this.pendingDevelopmentCards.push(type);
    this.pendingDevelopmentSpawns.push(type);
    this.flushPendingDevelopmentPurchases();
  }

  private flushPendingDevelopmentPurchases(): void {
    const layout = this.resourceFlightLayout;
    if (!layout || !this.live || !this.pendingDevelopmentSpawns.length) return;
    const visibleTypes = DEV_CARD_TYPES.filter((type) => this.live!.developmentCardCount(this.viewerSeat, type) > 0
      || this.pendingDevelopmentCards.includes(type));
    let order = this.developmentFlights.active().length;
    for (const type of this.pendingDevelopmentSpawns) {
      this.developmentFlights.spawn(
        type,
        1,
        islandersDevDeckDepartureCell(layout.region, layout.playerCount, layout.railVisible, layout.composerRows),
        islandersDevHandLandingCellForTypes(layout.region, type, visibleTypes),
        order++,
      );
    }
    this.pendingDevelopmentSpawns = [];
  }

  private clearResourceFlights(): void {
    this.bankResourceFlights.drain();
    this.externalResourceFlights.drain();
    this.bankBoundResourceFlights.drain();
    this.externalBoundResourceFlights.drain();
    this.developmentFlights.drain();
    for (const pending of this.pendingResourceGains) pending.resolve();
    for (const pending of this.pendingResourceLosses) pending.resolve();
    this.pendingResourceGains = [];
    this.pendingResourceLosses = [];
    this.pendingDevelopmentSpawns = [];
    this.pendingDevelopmentCards = [];
    this.developmentDeckPendingDeparture = 0;
    this.resourceFlightLayout = null;
    for (const resource of RESOURCES) {
      this.handPending[resource] = 0;
      this.bankPendingDeparture[resource] = 0;
      this.handPendingDeparture[resource] = 0;
      this.bankPendingArrival[resource] = 0;
    }
    for (const type of DEV_CARD_TYPES) this.developmentHandPending[type] = 0;
  }
}
