// The Islanders session driver: turns the setup panel's seat choices into `Player`s and runs
// them through the rules engine, mirroring how poker-driver wraps its match loop. main
// owns the surrounding UI (setup panel, HUD, status line); this owns the session.
//
// The driver owns the whole match lifecycle: snake placement, rolls, robber/discards, builds,
// trades, development cards, and the terminal victory state. The rules state remains the only
// authority; this layer merely connects seats to it and records presentation-friendly history.

import { HumanPlayer } from '../../harness/human-player.ts';
import { PolicyPlayer } from '../../harness/policy-player.ts';
import type { CommunicationDecision, CommunicationMode, PublicConversationMessage } from '../../harness/communication/types.ts';
import type { Player } from '../../harness/player.ts';
import type { RecordEndReason } from '../../harness/records.ts';
import {
  IslandersGameRecorder,
  type RecorderController,
} from '../../harness/recording/game-recorders.ts';
import { IslandersState } from '../../rules/islanders/islanders.ts';
import { NUM_NODES, nodeHexes } from '../../rules/islanders/board-topology.ts';
import type { BoardSetup } from '../../rules/islanders/setup.ts';
import { RESOURCES, resourceIndex, type IslandersAction, type PlayerColor, type Resource } from '../../rules/islanders/types.ts';
import { CITY_ICON, DEV_CARD_ICON, KNIGHT_ICON, RESOURCE_LOOK, ROAD_ICON, SETTLEMENT_ICON } from '../games/islanders/palette.ts';
import { createIslandersModelPlayer, ISLANDERS_RULES_PRIMER, runIslandersMatch } from '../../harness/games/islanders/islanders-setup.ts';
import { disambiguateLabels } from '../../harness/labels.ts';
import { shortModel } from '../../harness/model-label.ts';
import { normalizerModel } from './models.ts';
import { IslandersCommunicationCoordinator } from '../../harness/games/islanders/islanders-communication.ts';
import { DirectedReplies } from './directed-replies.ts';
import { IslandersMemory } from './islanders-memory.ts';
import type { LanguageModel } from 'ai';
import { detectIslandersMoments } from '../../harness/games/islanders/islanders-moments.ts';
import { primaryMoment, reactionOpportunities } from '../../harness/communication/moments.ts';
import type { ModelFailureNotice } from '../../harness/model-failure-notice.ts';
import {
  isTelemetryEnabled,
  localPlayerKey,
  trackMatchEnded,
  trackMatchRecord,
  trackMatchStarted,
  trackModelFallback,
} from '../../telemetry/index.ts';

// Domestic offers a model seat may post per turn. Three is where repeating oneself stops
// reading as negotiation (MIRAGE-Bench's trial-and-error bound); the human seat is uncapped.
const MODEL_OFFERS_PER_TURN = 3;

// One seat in the session: you, an AI model (a Gateway slug), or a local practice bot (a
// PolicyPlayer that plays a random constructive legal action — no model, no network). The
// color is the seat's piece color — picked in setup and distinct per seat. A table with any
// bot seat is a practice table and is never recorded or tracked.
export type IslandersSeatSpec =
  | { kind: 'human'; color: PlayerColor }
  | { kind: 'bot'; color: PlayerColor }
  | { kind: 'ai'; model: string; color: PlayerColor };

// What the board scene must offer the driver: the live state, an animated apply, and the
// human seam. Deliberately the same shape as `MatchScene` plus `requestHumanMove`, so the
// scene stays swappable and the driver never reaches into rendering.
export interface IslandersBoardScene {
  beginSession(state: IslandersState, colors: PlayerColor[], viewerSeat: number, humanSeat?: number): void | Promise<void>;
  endSession(): void;
  state(): IslandersState;
  playMove(action: IslandersAction): Promise<void>;
  requestHumanMove(signal?: AbortSignal): Promise<IslandersAction>;
}

export interface IslandersDriverDeps {
  scene: IslandersBoardScene;
  /** Repaint after any state the HUD reads has changed. */
  syncLive: () => void;
  /** Optional player factory for alternate controllers and deterministic tests. */
  createPlayer?: (spec: IslandersSeatSpec, seat: number, label: string) => Player<IslandersAction>;
  /**
   * The model a seat reflects with between turns (its notebook); defaults to the seat's own
   * model. Return null to disable reflection — tests with fake players, offline tables.
   */
  reflectionModel?: (spec: Extract<IslandersSeatSpec, { kind: 'ai' }>, seat: number) => LanguageModel | null;
  onFailureNotice?(notice: ModelFailureNotice, model: string): void;
  onBlocked?(): void;
}

// One entry in the public action/chat log the rail shows.
export interface IslandersLogEntry {
  seat: number;
  color: PlayerColor;
  actor: string;
  message: string;
  resourceCounts?: Partial<Record<Resource, number>>;
  chat?: boolean;
}

interface IslandersPreActionView {
  hands: number[][];
  trade: ReturnType<IslandersState['activeTrade']>;
  state: IslandersState;
  communicationDecision?: CommunicationDecision;
  communicationMessage?: PublicConversationMessage;
}

export class IslandersDriver {
  private seats: IslandersSeatSpec[] = [];
  private labels: string[] = [];
  private modelContextLabels: string[] = [];
  private players: Player<IslandersAction>[] = [];
  private live: IslandersState | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private complete = false;
  private log: IslandersLogEntry[] = [];
  private lastActionEntry: IslandersLogEntry | null = null;
  private failure: string | null = null;
  private preAction: IslandersPreActionView | null = null;
  private communication: IslandersCommunicationCoordinator | null = null;
  // Each model seat's private notebook (plan + reads), rewritten after its own turn while the
  // next player acts; injected into its decision prompt. See islanders-memory.ts.
  private readonly memory = new IslandersMemory();
  private reflecting = new Map<number, Promise<void>>();
  private talkSeenByObserver = new Map<number, number>();
  private lastCommunicationDecision: CommunicationDecision | null = null;
  private readonly directedReplies = new DirectedReplies();
  private recorder: IslandersGameRecorder | null = null;
  private restartAfterAbort = false;

  constructor(private readonly deps: IslandersDriverDeps) {}

  isRunning(): boolean {
    return this.running;
  }
  // A completed match has a rules-authoritative winner.
  isComplete(): boolean {
    return this.complete;
  }
  state(): IslandersState | null {
    return this.live;
  }
  seatSpecs(): readonly IslandersSeatSpec[] {
    return this.seats;
  }
  history(): readonly IslandersLogEntry[] {
    return this.log;
  }
  latestAction(): IslandersLogEntry | null {
    return this.lastActionEntry;
  }
  // Set when the session ended on an error rather than on completion, so the HUD can say so
  // instead of silently looking idle.
  error(): string | null {
    return this.failure;
  }
  labelOf(seat: number): string {
    return this.labels[seat] ?? `P${seat}`;
  }
  colorOf(seat: number): PlayerColor {
    return this.seats[seat]?.color ?? 'red';
  }
  seatCount(): number {
    return this.seats.length;
  }
  winner(): number {
    return this.live?.winner() ?? -1;
  }
  // Which seat you occupy, or -1 when spectating.
  humanSeat(): number {
    return this.seats.findIndex((s) => s.kind === 'human');
  }

  communicationMode(): CommunicationMode {
    return this.communication?.currentMode() ?? 'autoreply';
  }

  setCommunicationMode(mode: CommunicationMode): void {
    this.communication?.setMode(mode);
  }

  latestCommunicationDecision(): CommunicationDecision | null {
    return this.lastCommunicationDecision;
  }

  sendHumanChat(text: string, targetSeats: readonly number[] = []): boolean {
    const seat = this.humanSeat();
    if (seat < 0 || !this.communication) return false;
    const message = this.communication.addHuman(seat, text, targetSeats);
    if (!message) return false;
    this.log.push({
      seat,
      color: this.colorOf(seat),
      actor: this.labelOf(seat),
      message: message.text,
      chat: true,
    });
    this.deps.syncLive();
    if (this.communication.currentMode() === 'ambient' && message.addressedSeats.length) {
      void this.enqueueDirectedReplies(message, this.live?.actionRecords().length ?? 0);
    }
    return true;
  }

  // Build the state + players and run the full match. Returns immediately; the loop
  // runs in the background and calls syncLive() as it progresses. `autoRun: false` sets the
  // session up without starting the loop — the snapshot tool drives placement itself so a
  // still needs no model call. `rng` makes the session reproducible — it seeds everything the
  // state draws from: the board layout, the dev-card deck, the dice, and the robber's steal.
  // Live sessions leave it unset and keep Math.random.
  start(seats: IslandersSeatSpec[], opts?: { autoRun?: boolean; rng?: () => number; board?: BoardSetup; maxActions?: number; communicationMode?: CommunicationMode }): IslandersState {
    this.stop('user_stopped');
    this.seats = seats.slice();
    this.labels = disambiguateLabels(
      seats.map((seat, index) =>
        seat.kind === 'human'
          ? { key: `human:${index}`, label: 'You' }
          : seat.kind === 'bot'
            ? { key: `bot:${index}`, label: `bot ${index}` }
            : { key: seat.model, label: shortModel(seat.model) },
        ),
    );
    this.modelContextLabels = disambiguateLabels(
      seats.map((seat, index) =>
        seat.kind === 'human'
          ? { key: 'human', label: 'the human player' }
          : seat.kind === 'bot'
            ? { key: `bot:${index}`, label: `bot ${index}` }
            : { key: seat.model, label: shortModel(seat.model) },
      ),
    );
    const practice = seats.some((seat) => seat.kind === 'bot');
    this.log = [];
    this.lastActionEntry = null;
    this.preAction = null;
    this.failure = null;
    this.complete = false;
    this.lastCommunicationDecision = null;
    this.directedReplies.reset();
    const state = new IslandersState({
      numPlayers: seats.length,
      // UI copy uses `this.labels` so the local seat remains "You". The rules state's
      // names are model-facing: calling another seat "You" inside a model prompt would
      // conflict with the prompt's own second-person instructions.
      seatNames: this.modelContextLabels,
      domesticTrade: true,
      // Model seats get a per-turn offer budget and may not re-post an offer the table already
      // refused that turn — the guard against small models looping on one trade. A human seat
      // carries no policy and negotiates freely.
      domesticTradePolicy: seats.map((seat) => (seat.kind === 'ai' ? { maxOffersPerTurn: MODEL_OFFERS_PER_TURN, noRepeatRefused: true } : undefined)),
      rng: opts?.rng,
      board: opts?.board,
    });
    this.live = state;
    this.memory.reset();
    this.reflecting.clear();
    this.talkSeenByObserver.clear();
    this.communication = new IslandersCommunicationCoordinator(opts?.communicationMode ?? 'autoreply', this.modelContextLabels);
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    const mode = islandersMatchMode(seats);
    const controller = (seat: IslandersSeatSpec): RecorderController =>
      seat.kind === 'ai' ? { kind: 'model', model: seat.model } : { kind: 'human' };
    this.recorder = isTelemetryEnabled() && !practice
      ? new IslandersGameRecorder(mode, seats.map(controller), seats.map((seat) => seat.color), localPlayerKey())
      : null;
    if (!practice) {
      trackMatchStarted({
        game: 'islanders',
        mode,
        models: seats.flatMap((seat) => seat.kind === 'ai' ? [seat.model] : []),
        humans: seats.filter((seat) => seat.kind === 'human').length,
      });
    }
    this.abort = new AbortController();
    // Install the authoritative state in the scene before the runner can synchronously read it.
    // Keeping this inside the driver makes session creation atomic for the app and tools alike.
    const humanSeat = seats.findIndex((seat) => seat.kind === 'human');
    const setupReady = this.deps.scene.beginSession(state, seats.map((seat) => seat.color), humanSeat >= 0 ? humanSeat : 0, humanSeat);
    this.running = opts?.autoRun !== false;
    if (this.running) void this.run(opts?.maxActions, setupReady);
    return state;
  }

  private makePlayer(spec: IslandersSeatSpec, seat: number): Player<IslandersAction> {
    const custom = this.deps.createPlayer?.(spec, seat, this.labels[seat]);
    if (custom) return custom;
    if (spec.kind === 'human') {
      return new HumanPlayer<IslandersAction>({
        name: 'you',
        awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal),
      });
    }
    if (spec.kind === 'bot') return practiceIslandersBot(this.labels[seat], seat);
    return createIslandersModelPlayer({
      model: spec.model,
      name: this.modelContextLabels[seat],
      persona: ISLANDERS_RULES_PRIMER,
      normalizer: normalizerModel(),
      communication: this.communication?.modelConfig(),
      contextProvider: (player) => [
        this.memory.renderForPrompt(player, this.otherSeats(player), (s) => this.modelContextLabels[s]),
        this.communication?.contextFor(player) ?? '',
      ].filter(Boolean).join('\n\n'),
      onFailureNotice: (notice) => this.deps.onFailureNotice?.(notice, spec.model),
    });
  }

  private async run(maxActions = 8_000, setupReady?: void | Promise<void>): Promise<void> {
    const signal = this.abort?.signal;
    try {
      await setupReady;
      if (signal?.aborted) return;
      const result = await runIslandersMatch(this.deps.scene, this.players, {
        signal,
        maxActions,
        onCommentary: (text, _player, playerIndex) => {
          this.log.push({
            seat: playerIndex,
            color: this.colorOf(playerIndex),
            actor: this.labelOf(playerIndex),
            message: text,
            chat: true,
          });
          this.deps.syncLive();
        },
        onActionChosen: (info) => {
          const seatSpec = this.seats[info.playerIndex];
          if (seatSpec?.kind === 'ai' && info.choice.diagnostics?.resolution === 'random-fallback') {
            trackModelFallback({ game: 'islanders', model: seatSpec.model, reason: info.choice.diagnostics.fallbackReason ?? 'exhausted' });
          }
          this.recordTelemetry(() => this.recorder?.actionChosen(
            info.playerIndex,
            info.player,
            info.choice,
            info.state as IslandersState,
            seatSpec?.kind === 'human',
            seatSpec?.kind === 'ai' ? seatSpec.model : undefined,
          ));
          this.preAction = this.live ? {
            hands: Array.from({ length: this.live.n }, (_, seat) => this.live!.handOf(seat).slice()),
            trade: this.live.activeTrade(),
            state: this.live.clone(),
          } : null;
          if (this.seats[info.playerIndex]?.kind === 'ai' && this.communication) {
            const decision = this.communication.decide(
              info.playerIndex,
              info.choice.action,
              info.choice.communication,
              (this.live?.actionRecords().length ?? 0) + 1,
            );
            this.lastCommunicationDecision = decision;
            if (this.preAction) {
              this.preAction.communicationDecision = decision;
              if (decision.communication.mode === 'speak') this.preAction.communicationMessage = this.communication.latestMessage();
            }
            if (decision.communication.mode === 'speak') {
              this.log.push({
                seat: info.playerIndex,
                color: this.colorOf(info.playerIndex),
                actor: this.labelOf(info.playerIndex),
                message: decision.communication.text,
                chat: true,
              });
              this.deps.syncLive();
            }
          }
        },
        onActionApplied: async (info) => {
          this.recordTelemetry(() => {
            this.recorder?.actionApplied(info.state as IslandersState);
            const checkpoint = this.recorder?.checkpoint(info.state as IslandersState);
            if (checkpoint) trackMatchRecord(checkpoint);
          });
          this.record(info.playerIndex, info.choice.action, this.preAction);
          if (info.choice.action.type === 'endTurn') this.startReflection(info.playerIndex, signal);
          if (this.communication?.currentMode() === 'ambient' && this.preAction && this.live) {
            const actionNumber = this.live.actionRecords().length;
            if (
              this.preAction.communicationDecision?.communication.mode === 'speak'
              && this.preAction.communicationMessage?.addressedSeats.length
            ) {
              // If an addressed model now owns the required game action, that action's structured
              // communication is its one reply opportunity. Prompting a separate reply here and
              // then immediately asking for accept/reject or confirm/cancel produced two adjacent,
              // near-identical trade lines whenever the repetition heuristic did not catch them.
              const actionReplySeats = new Set([this.live.currentPlayer()]);
              const trade = this.live.activeTrade();
              if (trade) {
                actionReplySeats.add(trade.from);
                for (const responder of trade.responders.slice(trade.responseIndex)) actionReplySeats.add(responder);
              }
              await this.enqueueDirectedReplies(this.preAction.communicationMessage, actionNumber, actionReplySeats);
            }
            const moments = detectIslandersMoments(
              this.preAction.state,
              info.choice.action,
              this.live,
              info.playerIndex,
              actionNumber,
              this.modelContextLabels,
            );
            const moment = primaryMoment(moments);
            for (const opportunity of moment ? reactionOpportunities(moment, 1) : []) {
              if (this.seats[opportunity.seat]?.kind !== 'ai') continue;
              const reaction = await this.players[opportunity.seat]?.chooseCommunication?.({
                opportunity,
                gameView: this.live.informationStateString(opportunity.seat),
                conversation: this.communication.contextFor(opportunity.seat),
                signal,
              });
              if (signal?.aborted) break;
              const decision = this.communication.decideOpportunity(opportunity, reaction, actionNumber);
              this.lastCommunicationDecision = decision;
              if (decision.communication.mode === 'speak') {
                this.log.push({ seat: opportunity.seat, color: this.colorOf(opportunity.seat), actor: this.labelOf(opportunity.seat), message: decision.communication.text, chat: true });
                this.deps.syncLive();
              }
            }
          }
          this.preAction = null;
          this.deps.syncLive();
        },
      });
      if (!signal?.aborted && result.stopReason === 'action_limit' && this.live) {
        const record = this.recordTelemetry(() => this.recorder?.abandoned('action_limit', this.live!));
        if (record) trackMatchRecord(record);
        this.recorder = null;
      }
      // An aborted run unwinds through here too; only a terminal rules state counts as complete.
      if (!signal?.aborted) this.complete = this.live?.isTerminal() ?? false;
      if (!signal?.aborted && this.complete && this.live) {
        const winner = this.live.winner();
        this.log.push({
          seat: winner,
          color: this.colorOf(winner),
          actor: this.labelOf(winner),
          message: `${winner === this.humanSeat() ? 'win' : 'wins'} · ${this.live.victoryPoints(winner, true)} victory points`,
        });
        const record = this.recordTelemetry(() => this.recorder?.completed(this.live!));
        if (record) trackMatchRecord(record);
        if (!this.seats.some((seat) => seat.kind === 'bot')) {
          trackMatchEnded({
            game: 'islanders',
            mode: islandersMatchMode(this.seats),
            models: this.seats.flatMap((seat) => seat.kind === 'ai' ? [seat.model] : []),
            winner: winner >= 0 && this.seats[winner]?.kind === 'ai' ? this.seats[winner].model : 'human',
          });
        }
        this.recorder = null;
      }
    } catch (err) {
      // An abort is the expected way a session ends early (leaving the screen, a new game),
      // so it is not a failure worth surfacing.
      if (!signal?.aborted && (err as { name?: string })?.name === 'NotifiedModelFailure') {
        this.running = false;
        this.deps.onBlocked?.();
      } else if (!signal?.aborted) this.failure = err instanceof Error ? err.message : String(err);
    } finally {
      if (signal?.aborted && this.restartAfterAbort && this.live && !this.live.isTerminal()) {
        this.restartAfterAbort = false;
        this.abort = new AbortController();
        void this.run(maxActions);
        return;
      }
      if (!signal?.aborted) {
        this.running = false;
        this.deps.syncLive();
      }
    }
  }

  resumeAfterFailure(): void {
    if (this.running || !this.live || this.live.isTerminal() || this.players.length === 0) return;
    this.abort = new AbortController();
    this.running = true;
    void this.run();
  }

  withdrawHumanCounter(): boolean {
    if (!this.live) return false;
    const player = this.humanSeat();
    const action: IslandersAction = { type: 'withdrawCounterTrade', player };
    if (player < 0 || !this.live.isLegalAction(action)) return false;
    if (this.running) {
      this.restartAfterAbort = true;
      this.abort?.abort();
    }
    this.live.applyAction(action);
    const checkpoint = this.recordTelemetry(() => this.recorder?.externalActionApplied(this.live!));
    if (checkpoint) trackMatchRecord(checkpoint);
    this.deps.syncLive();
    return true;
  }

  private enqueueDirectedReplies(message: PublicConversationMessage, actionNumber: number, actionReplySeats: ReadonlySet<number> = new Set()): Promise<void> {
    const communication = this.communication;
    const live = this.live;
    if (!communication || !live) return Promise.resolve();
    return this.directedReplies.enqueue({
      game: 'islanders',
      seatCount: this.seats.length,
      isModelSeat: (seat) => this.seats[seat]?.kind === 'ai',
      player: (seat) => this.players[seat],
      gameView: (seat) => live.informationStateString(seat),
      coordinator: communication,
      onSpeak: (seat, text, decision) => {
        this.lastCommunicationDecision = decision;
        this.log.push({ seat, color: this.colorOf(seat), actor: this.labelOf(seat), message: text, chat: true });
        this.deps.syncLive();
      },
    }, message, actionNumber, this.abort?.signal, actionReplySeats);
  }

  // What a monopoly actually collected, from the hands as they stood before the card.
  private monopolyTotal(actor: number, resource: Resource, before: IslandersPreActionView | null): number {
    if (!before) return 0;
    const index = resourceIndex(resource);
    return before.hands.reduce((total, hand, seat) => total + (seat === actor ? 0 : hand[index] ?? 0), 0);
  }

  private record(seat: number, action: IslandersAction, before: IslandersPreActionView | null): void {
    const trade = before?.trade;
    const other = (target: number): string => this.labelOf(target);
    const object = (target: number): string => this.seats[target]?.kind === 'human' ? 'you' : other(target);
    const isNext = (target: number): string => this.seats[target]?.kind === 'human' ? 'you are next' : `${other(target)} is next`;
    const possessive = (target: number): string => {
      if (this.seats[target]?.kind === 'human') return 'your';
      const label = other(target);
      return `${label}${label.endsWith('s') ? "'" : "'s"}`;
    };
    const deck = (counts: readonly number[]): string => RESOURCES
      .flatMap((resource, index) => counts[index] > 0 ? [`${RESOURCE_LOOK[resource].emoji} x${counts[index]}`] : [])
      .join(' ');
    const victim = 'victim' in action && action.victim !== null ? object(action.victim) : null;
    const outcome = this.live?.actionRecords().at(-1)?.outcome;
    const humanSeat = this.humanSeat();
    const humanKnowsStolenResource = humanSeat === seat
      || ('victim' in action && action.victim === humanSeat);
    const tile = (hex: number): string => this.live ? `${this.live.displayHexLabel(hex)} tile` : `hex ${hex}`;
    // A robber move without a victim: say whether nobody was there or the neighbours had empty hands.
    const robbed = (hex: number): string => {
      if (victim && outcome?.stolenResource && humanKnowsStolenResource) return ` and stole ${RESOURCE_LOOK[outcome.stolenResource].emoji} x1 from ${victim}`;
      if (victim) return ` and stole a card from ${victim}`;
      const neighbours = new Set<number>();
      for (let node = 0; node < NUM_NODES; node++) {
        const building = nodeHexes[node].includes(hex) ? this.live?.buildingAt(node) : undefined;
        if (building && building.player !== seat) neighbours.add(building.player);
      }
      if (neighbours.size === 0) return ', with no one to rob';
      return `; ${[...neighbours].map(object).join(' and ')} had no cards to steal`;
    };
    const message = action.type === 'initialSettlement'
      ? `${SETTLEMENT_ICON} placed a settlement`
      : action.type === 'initialRoad'
        ? `${ROAD_ICON} placed a road`
        : action.type === 'buildRoad'
          ? `${ROAD_ICON} placed a road`
          : action.type === 'buildSettlement'
            ? `${SETTLEMENT_ICON} placed a settlement`
            : action.type === 'buildCity'
              ? `${CITY_ICON} placed a city`
              : action.type === 'roll'
                ? `rolled ${(outcome?.dice ?? this.live?.dice() ?? []).join(' + ')} = ${(outcome?.dice ?? this.live?.dice() ?? []).reduce((sum, die) => sum + die, 0)}`
                : action.type === 'endTurn'
                  ? `ended the turn; ${isNext(this.live?.currentPlayer() ?? seat)}`
                  : action.type === 'buyDevCard'
                    ? `bought a development card ${DEV_CARD_ICON}`
                    : action.type === 'playKnight'
                      ? `${KNIGHT_ICON} played a knight, moved the robber to the ${tile(action.hex)}${robbed(action.hex)}`
                      : action.type === 'moveRobber'
                        ? `${KNIGHT_ICON} moved the robber to the ${tile(action.hex)}${robbed(action.hex)}`
                        : action.type === 'playRoadBuilding'
                          ? `${ROAD_ICON} played road building on edges ${action.edges.join(' and ')}`
                          : action.type === 'playYearOfPlenty'
                            ? `${DEV_CARD_ICON} played year of plenty and took ${action.resources.map((resource) => RESOURCE_LOOK[resource].emoji).join(' ')}`
                            : action.type === 'playMonopoly'
                            ? `took ${RESOURCE_LOOK[action.resource].emoji} x${this.monopolyTotal(seat, action.resource, before)} with monopoly`
                              : action.type === 'discard'
                                ? `discarded ${action.resources.length} cards after a 7`
                                : action.type === 'maritimeTrade'
                                  ? `traded ${action.via === 'bank' ? '4:1 with the bank' : `${action.rate}:1 at a port`}: ${RESOURCE_LOOK[action.give].emoji} → ${RESOURCE_LOOK[action.get].emoji}`
                                  : action.type === 'maritimeBulkTrade'
                                    ? `traded ${action.via === 'bank' ? 'with the bank' : `at a ${action.rate}:1 port`}: ${RESOURCE_LOOK[action.give].emoji} x${(action.via === 'bank' ? 4 : action.rate) * action.gets.length} → ${action.gets.map((resource) => RESOURCE_LOOK[resource].emoji).join(' ')}`
                                    : action.type === 'offerTrade'
                                      ? `offered ${deck(action.give)} for ${deck(action.receive)}`
                                      : action.type === 'acceptTrade'
                                        ? `accepted ${trade ? `${possessive(trade.from)} trade offer` : 'the trade offer'}`
                                        : action.type === 'counterTrade'
                                          ? `countered ${trade ? object(trade.from) : 'the offerer'} with ${deck(action.give)} for ${deck(action.receive)}`
                                          : action.type === 'rejectTrade'
                                            ? `rejected ${trade ? `${possessive(trade.from)} trade offer` : 'the trade offer'}`
                                            : action.type === 'confirmTrade'
                                              ? `completed a trade with ${object(action.with)}`
                                              : action.type === 'cancelTrade'
                                                ? `cancelled the trade after no agreement`
                                                : 'performed an action';
    const entry = { seat, color: this.colorOf(seat), actor: this.labelOf(seat), message };
    this.log.push(entry);
    this.lastActionEntry = entry;
    if (!before || !this.live || (action.type !== 'roll' && action.type !== 'initialSettlement')) return;
    for (let player = 0; player < this.live.n; player++) {
      const resourceCounts: Partial<Record<Resource, number>> = {};
      let total = 0;
      for (const resource of RESOURCES) {
        const gain = (this.live.handOf(player)[resourceIndex(resource)] ?? 0) - (before.hands[player]?.[resourceIndex(resource)] ?? 0);
        if (gain <= 0) continue;
        resourceCounts[resource] = gain;
        total += gain;
      }
      if (total > 0) this.log.push({
        seat: player,
        color: this.colorOf(player),
        actor: this.labelOf(player),
        message: `received ${total} resource${total === 1 ? '' : 's'}`,
        resourceCounts,
      });
    }
  }

  // Abort the session loop. Safe to call when nothing is running.
  private otherSeats(seat: number): number[] {
    return this.seats.map((_, s) => s).filter((s) => s !== seat);
  }

  // Kick off a model seat's between-turn reflection: the round it just saw (the rules' turn
  // digest) plus the table talk since its previous notes. Runs alongside the next player's
  // decision; one in flight per seat, best-effort.
  private startReflection(seat: number, signal?: AbortSignal): void {
    const spec = this.seats[seat];
    const state = this.live;
    if (spec?.kind !== 'ai' || !state || this.reflecting.has(seat) || signal?.aborted) return;
    const model = this.deps.reflectionModel ? this.deps.reflectionModel(spec, seat) : spec.model;
    if (!model) return;
    const messages = this.communication?.messages() ?? [];
    const seen = this.talkSeenByObserver.get(seat) ?? 0;
    const talk = messages.slice(seen).map((message) => `${message.speakerLabel}: ${message.text}`);
    this.talkSeenByObserver.set(seat, messages.length);
    const job = this.memory.reflect({
      model,
      observer: seat,
      subjects: this.otherSeats(seat),
      digest: state.recentTurnsSummary(),
      talk,
      labelOf: (s) => this.modelContextLabels[s],
      signal,
    }).finally(() => {
      this.reflecting.delete(seat);
      this.deps.syncLive();
    });
    this.reflecting.set(seat, job);
  }

  // The model seats that keep notebooks, for a reads surface (label + creator for tinting).
  noteObservers(): { seat: number; label: string; creator: string }[] {
    return this.seats.flatMap((spec, seat) =>
      spec.kind === 'ai' ? [{ seat, label: this.labelOf(seat), creator: spec.model.split('/')[0] ?? spec.model }] : []);
  }

  // One observer's notebook: its plan and its reads on every other seat (UI labels).
  notesView(observer: number): { plan: string; reads: { label: string; notes: string[] }[] } {
    return {
      plan: this.memory.plan(observer),
      reads: this.memory.view(observer, this.otherSeats(observer)).map(({ subject, notes }) => ({ label: this.labelOf(subject), notes })),
    };
  }

  stop(reason: Exclude<RecordEndReason, 'natural'> = 'user_stopped'): void {
    this.restartAfterAbort = false;
    const record = this.live ? this.recordTelemetry(() => this.recorder?.abandoned(reason, this.live!)) : undefined;
    if (record) trackMatchRecord(record);
    this.recorder = null;
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    this.players = [];
    this.preAction = null;
    this.communication = null;
    this.lastCommunicationDecision = null;
  }

  // Leaving the screen entirely: stop and clear, so re-entering shows setup again.
  reset(reason: Exclude<RecordEndReason, 'natural'> = 'navigation'): void {
    this.stop(reason);
    this.deps.scene.endSession();
    this.live = null;
    this.seats = [];
    this.labels = [];
    this.modelContextLabels = [];
    this.log = [];
    this.lastActionEntry = null;
    this.complete = false;
    this.failure = null;
  }

  private recordTelemetry<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      this.recorder = null;
      return undefined;
    }
  }
}

function islandersMatchMode(seats: readonly IslandersSeatSpec[]): 'ai_table' | 'human_table' | 'mixed' {
  const humans = seats.filter((seat) => seat.kind === 'human').length;
  return humans === 0 ? 'ai_table' : humans === seats.length ? 'human_table' : 'mixed';
}

// The practice bot: a random constructive legal action — anything but ending the turn while
// something else is possible, and never a player-to-player offer (the human would have to
// answer it). Seeded per seat so a practice game replays identically.
function practiceIslandersBot(name: string, seat: number): Player<IslandersAction> {
  let state = (0x9e3779b9 ^ (seat * 0x85ebca6b)) >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return new PolicyPlayer<IslandersAction>(name, (legal) => {
    const quiet = legal.filter((a) => a.type !== 'offerTrade' && a.type !== 'counterTrade');
    const active = quiet.filter((a) => a.type !== 'endTurn');
    const pool = active.length ? active : quiet.length ? quiet : legal;
    return pool[Math.floor(random() * pool.length)];
  });
}
