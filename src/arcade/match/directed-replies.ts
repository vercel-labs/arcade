// What happens after the human addresses a seat from the chat composer: each named model
// gets one bounded chance to reply, in order, through its `chooseCommunication`. Replies
// run on one queue per table so two quick addresses cannot interleave, and a reply never
// races the same model's move: the queue awaits each reply before starting the next, and
// the caller can skip seats already answering through their next action.
import type { Player } from '../../harness/player.ts';
import { directedReplyOpportunities, type CommunicationDecision, type CommunicationOpportunity, type PublicConversationMessage } from '../../harness/communication/index.ts';
import type { Communication } from '../../harness/communication/types.ts';

export interface DirectedReplyTable {
  game: string;
  seatCount: number;
  // Only model seats can be prompted; humans and scripted bots are skipped.
  isModelSeat(seat: number): boolean;
  player(seat: number): Pick<Player<unknown>, 'chooseCommunication'> | undefined;
  gameView(seat: number): string;
  coordinator: {
    contextFor(seat: number): string;
    decideDirectedReply(opportunity: CommunicationOpportunity, proposal: Communication | undefined, actionNumber: number): CommunicationDecision;
  };
  // The reply the policy let through, ready for the chat rail.
  onSpeak(seat: number, text: string, decision: CommunicationDecision): void;
}

export class DirectedReplies {
  private queue: Promise<void> = Promise.resolve();

  reset(): void {
    this.queue = Promise.resolve();
  }

  enqueue(
    table: DirectedReplyTable,
    message: PublicConversationMessage,
    actionNumber: number,
    signal?: AbortSignal,
    skipSeats: ReadonlySet<number> = new Set(),
  ): Promise<void> {
    const run = async (): Promise<void> => {
      for (const opportunity of directedReplyOpportunities(message, table.game, table.seatCount)) {
        if (signal?.aborted) break;
        if (!table.isModelSeat(opportunity.seat) || skipSeats.has(opportunity.seat)) continue;
        const proposal = await table.player(opportunity.seat)?.chooseCommunication?.({
          opportunity,
          gameView: table.gameView(opportunity.seat),
          conversation: table.coordinator.contextFor(opportunity.seat),
          signal,
        });
        if (signal?.aborted) break;
        const decision = table.coordinator.decideDirectedReply(opportunity, proposal, actionNumber);
        if (decision.communication.mode === 'speak') table.onSpeak(opportunity.seat, decision.communication.text, decision);
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}
