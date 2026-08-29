// The Catan session driver: turns the setup panel's seat choices into `Player`s and runs
// them through the rules engine, mirroring how poker-driver wraps its match loop. main
// owns the surrounding UI (setup panel, HUD, status line); this owns the session.
//
// The driver owns the whole match lifecycle: snake placement, rolls, robber/discards, builds,
// trades, development cards, and the terminal victory state. The rules state remains the only
// authority; this layer merely connects seats to it and records presentation-friendly history.

import { HumanPlayer } from '../../harness/human-player.ts';
import type { CommunicationDecision, CommunicationMode, PublicConversationMessage } from '../../harness/communication/types.ts';
import type { Player } from '../../harness/player.ts';
import { CatanState } from '../../rules/catan/catan.ts';
import { RESOURCES, resourceIndex, type CatanAction, type PlayerColor, type Resource } from '../../rules/catan/types.ts';
import { DEV_CARD_ICON, KNIGHT_ICON, RESOURCE_LOOK, ROAD_ICON, SETTLEMENT_ICON } from '../games/catan/palette.ts';
import { createCatanModelPlayer, runCatanMatch } from '../../harness/games/catan/catan-setup.ts';
import { disambiguateLabels } from '../../harness/labels.ts';
import { shortModel } from '../../harness/model-label.ts';
import { normalizerModel } from './models.ts';
import { CatanCommunicationCoordinator } from '../../harness/games/catan/catan-communication.ts';
import { detectCatanMoments } from '../../harness/games/catan/catan-moments.ts';
import { directedReplyOpportunities, primaryMoment, reactionOpportunities } from '../../harness/communication/moments.ts';

// One seat in the session: you, or an AI model (a Gateway slug). The color is the seat's
// piece color — picked in setup and distinct per seat.
export type CatanSeatSpec = { kind: 'human'; color: PlayerColor } | { kind: 'ai'; model: string; color: PlayerColor };

// What the board scene must offer the driver: the live state, an animated apply, and the
// human seam. Deliberately the same shape as `MatchScene` plus `requestHumanMove`, so the
// scene stays swappable and the driver never reaches into rendering.
export interface CatanBoardScene {
  beginSession(state: CatanState, colors: PlayerColor[], viewerSeat: number, humanSeat?: number): void;
  endSession(): void;
  state(): CatanState;
  playMove(action: CatanAction): Promise<void>;
  requestHumanMove(signal?: AbortSignal): Promise<CatanAction>;
}

export interface CatanDriverDeps {
  scene: CatanBoardScene;
  /** Repaint after any state the HUD reads has changed. */
  syncLive: () => void;
  /** Optional player factory for alternate controllers and deterministic tests. */
  createPlayer?: (spec: CatanSeatSpec, seat: number, label: string) => Player<CatanAction>;
}

// One entry in the public action/chat log the rail shows.
export interface CatanLogEntry {
  seat: number;
  color: PlayerColor;
  actor: string;
  message: string;
  resourceCounts?: Partial<Record<Resource, number>>;
  chat?: boolean;
}

interface CatanPreActionView {
  hands: number[][];
  trade: ReturnType<CatanState['activeTrade']>;
  state: CatanState;
  communicationDecision?: CommunicationDecision;
  communicationMessage?: PublicConversationMessage;
}

export class CatanDriver {
  private seats: CatanSeatSpec[] = [];
  private labels: string[] = [];
  private players: Player<CatanAction>[] = [];
  private live: CatanState | null = null;
  private abort: AbortController | null = null;
  private running = false;
  private complete = false;
  private log: CatanLogEntry[] = [];
  private lastActionEntry: CatanLogEntry | null = null;
  private failure: string | null = null;
  private preAction: CatanPreActionView | null = null;
  private communication: CatanCommunicationCoordinator | null = null;
  private lastCommunicationDecision: CommunicationDecision | null = null;
  private directedReplyQueue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CatanDriverDeps) {}

  isRunning(): boolean {
    return this.running;
  }
  // A completed match has a rules-authoritative winner.
  isComplete(): boolean {
    return this.complete;
  }
  state(): CatanState | null {
    return this.live;
  }
  seatSpecs(): readonly CatanSeatSpec[] {
    return this.seats;
  }
  history(): readonly CatanLogEntry[] {
    return this.log;
  }
  latestAction(): CatanLogEntry | null {
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
  start(seats: CatanSeatSpec[], opts?: { autoRun?: boolean; rng?: () => number; maxActions?: number; communicationMode?: CommunicationMode }): CatanState {
    this.stop();
    this.seats = seats.slice();
    this.labels = disambiguateLabels(
      seats.map((seat, index) =>
        seat.kind === 'human'
          ? { key: `human:${index}`, label: 'You' }
          : { key: seat.model, label: shortModel(seat.model) },
        ),
    );
    const modelContextLabels = disambiguateLabels(
      seats.map((seat) =>
        seat.kind === 'human'
          ? { key: 'human', label: 'the human player' }
          : { key: seat.model, label: shortModel(seat.model) },
      ),
    );
    this.log = [];
    this.lastActionEntry = null;
    this.preAction = null;
    this.failure = null;
    this.complete = false;
    this.lastCommunicationDecision = null;
    this.directedReplyQueue = Promise.resolve();
    const state = new CatanState({
      numPlayers: seats.length,
      // UI copy uses `this.labels` so the local seat remains "You". The rules state's
      // names are model-facing: calling another seat "You" inside a model prompt would
      // conflict with the prompt's own second-person instructions.
      seatNames: modelContextLabels,
      domesticTrade: true,
      ...(seats.every((seat) => seat.kind === 'ai') ? { domesticTradeOfferLimit: 3 } : {}),
      rng: opts?.rng,
    });
    this.live = state;
    this.communication = new CatanCommunicationCoordinator(opts?.communicationMode ?? 'autoreply', modelContextLabels);
    this.players = seats.map((s, i) => this.makePlayer(s, i));
    this.abort = new AbortController();
    // Install the authoritative state in the scene before the runner can synchronously read it.
    // Keeping this inside the driver makes session creation atomic for the app and tools alike.
    const humanSeat = seats.findIndex((seat) => seat.kind === 'human');
    this.deps.scene.beginSession(state, seats.map((seat) => seat.color), humanSeat >= 0 ? humanSeat : 0, humanSeat);
    this.running = opts?.autoRun !== false;
    if (this.running) void this.run(opts?.maxActions);
    return state;
  }

  private makePlayer(spec: CatanSeatSpec, seat: number): Player<CatanAction> {
    const custom = this.deps.createPlayer?.(spec, seat, this.labels[seat]);
    if (custom) return custom;
    if (spec.kind === 'human') {
      return new HumanPlayer<CatanAction>({
        name: 'you',
        awaitMove: (_s, ctx) => this.deps.scene.requestHumanMove(ctx?.signal),
      });
    }
    return createCatanModelPlayer({
      model: spec.model,
      name: this.labels[seat],
      normalizer: normalizerModel(),
      communication: this.communication?.modelConfig(),
      contextProvider: (player) => this.communication?.contextFor(player) ?? '',
    });
  }

  private async run(maxActions = 10_000): Promise<void> {
    const signal = this.abort?.signal;
    try {
      await runCatanMatch(this.deps.scene, this.players, {
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
          this.record(info.playerIndex, info.choice.action, this.preAction);
          if (this.communication?.currentMode() === 'ambient' && this.preAction && this.live) {
            const actionNumber = this.live.actionRecords().length;
            if (
              this.preAction.communicationDecision?.communication.mode === 'speak'
              && this.preAction.communicationMessage?.addressedSeats.length
            ) {
              await this.enqueueDirectedReplies(this.preAction.communicationMessage, actionNumber);
            }
            const moments = detectCatanMoments(this.preAction.state, info.choice.action, this.live, info.playerIndex, actionNumber, this.labels);
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
      // An aborted run unwinds through here too; only a terminal rules state counts as complete.
      if (!signal?.aborted) this.complete = this.live?.isTerminal() ?? false;
    } catch (err) {
      // An abort is the expected way a session ends early (leaving the screen, a new game),
      // so it is not a failure worth surfacing.
      if (!signal?.aborted) this.failure = err instanceof Error ? err.message : String(err);
    } finally {
      if (!signal?.aborted) {
        this.running = false;
        this.deps.syncLive();
      }
    }
  }

  private enqueueDirectedReplies(message: PublicConversationMessage, actionNumber: number): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.communication || !this.live) return;
      const signal = this.abort?.signal;
      for (const opportunity of directedReplyOpportunities(message, 'catan', this.seats.length)) {
        if (signal?.aborted) break;
        if (this.seats[opportunity.seat]?.kind !== 'ai') continue;
        const proposal = await this.players[opportunity.seat]?.chooseCommunication?.({
          opportunity,
          gameView: this.live.informationStateString(opportunity.seat),
          conversation: this.communication.contextFor(opportunity.seat),
          signal,
        });
        if (signal?.aborted) break;
        const decision = this.communication.decideDirectedReply(opportunity, proposal, actionNumber);
        this.lastCommunicationDecision = decision;
        if (decision.communication.mode === 'speak') {
          this.log.push({
            seat: opportunity.seat,
            color: this.colorOf(opportunity.seat),
            actor: this.labelOf(opportunity.seat),
            message: decision.communication.text,
            chat: true,
          });
          this.deps.syncLive();
        }
      }
    };
    this.directedReplyQueue = this.directedReplyQueue.then(run, run);
    return this.directedReplyQueue;
  }

  private record(seat: number, action: CatanAction, before: CatanPreActionView | null): void {
    const trade = before?.trade;
    const other = (target: number): string => this.labelOf(target);
    const object = (target: number): string => this.seats[target]?.kind === 'human' ? 'you' : other(target);
    const possessive = (target: number): string => {
      if (this.seats[target]?.kind === 'human') return 'your';
      const label = other(target);
      return `${label}${label.endsWith('s') ? "'" : "'s"}`;
    };
    const deck = (counts: readonly number[]): string => RESOURCES
      .flatMap((resource, index) => counts[index] > 0 ? [`${RESOURCE_LOOK[resource].emoji} x${counts[index]}`] : [])
      .join(' ');
    const victim = 'victim' in action && action.victim !== null ? other(action.victim) : null;
    const outcome = this.live?.actionRecords().at(-1)?.outcome;
    const message = action.type === 'initialSettlement'
      ? `${SETTLEMENT_ICON} placed a settlement on node ${action.node}`
      : action.type === 'initialRoad'
        ? `${ROAD_ICON} placed a road on edge ${action.edge}`
        : action.type === 'buildRoad'
          ? `${ROAD_ICON} placed a road on edge ${action.edge}`
          : action.type === 'buildSettlement'
            ? `${SETTLEMENT_ICON} placed a settlement on node ${action.node}`
            : action.type === 'buildCity'
              ? `${SETTLEMENT_ICON} upgraded the settlement on node ${action.node} to a city`
              : action.type === 'roll'
                ? `rolled ${(outcome?.dice ?? this.live?.dice() ?? []).join(' + ')} = ${(outcome?.dice ?? this.live?.dice() ?? []).reduce((sum, die) => sum + die, 0)}`
                : action.type === 'endTurn'
                  ? `ended the turn; ${other(this.live?.currentPlayer() ?? seat)} is next`
                  : action.type === 'buyDevCard'
                    ? `${DEV_CARD_ICON} bought a development card`
                    : action.type === 'playKnight'
                      ? `${KNIGHT_ICON} played a knight, moved the robber to hex ${action.hex}${victim ? `, and stole 1 card from ${victim}` : ''}`
                      : action.type === 'moveRobber'
                        ? `${KNIGHT_ICON} moved the robber to hex ${action.hex}${victim ? ` and stole 1 card from ${victim}` : ''}`
                        : action.type === 'playRoadBuilding'
                          ? `${ROAD_ICON} played road building on edges ${action.edges.join(' and ')}`
                          : action.type === 'playYearOfPlenty'
                            ? `${DEV_CARD_ICON} played year of plenty and took ${action.resources.map((resource) => RESOURCE_LOOK[resource].emoji).join(' ')}`
                            : action.type === 'playMonopoly'
                              ? `${DEV_CARD_ICON} played monopoly on ${RESOURCE_LOOK[action.resource].emoji} ${action.resource}`
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
  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    this.players = [];
    this.preAction = null;
    this.communication = null;
    this.lastCommunicationDecision = null;
  }

  // Leaving the screen entirely: stop and clear, so re-entering shows setup again.
  reset(): void {
    this.stop();
    this.deps.scene.endSession();
    this.live = null;
    this.seats = [];
    this.labels = [];
    this.log = [];
    this.lastActionEntry = null;
    this.complete = false;
    this.failure = null;
  }
}
