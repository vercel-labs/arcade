import { PublicConversation } from '../../ai/communication/conversation.ts';
import { CommunicationPolicy } from '../../ai/communication/policy.ts';
import type { Communication, CommunicationDecision, CommunicationMode, PublicConversationMessage } from '../../ai/communication/types.ts';
import type { CatanAction } from '../../rules/catan/types.ts';

const CATAN_COMMUNICATION_GUIDE =
  'Public speech should sound like a human tabletop player, not an action log. Useful speech includes answering another player, negotiating a domestic trade, briefly explaining visible strategic pressure, table politics, a genuine reaction, concise banter, or a very rare monologue. Do not announce routine rolls, resource distributions, bank or port trades, or end turns when the UI already shows them. Never reveal exact private resources, development-card identities, hidden victory points, or detailed calculations. Use one or two natural sentences normally. Use public board labels verbatim when supplied. A monologue is comedic color only at a genuinely dramatic moment and must stay under five short sentences.';

export function catanActionSalience(action: CatanAction): number {
  switch (action.type) {
    case 'offerTrade':
    case 'counterTrade':
    case 'confirmTrade':
      return 0.78;
    case 'playMonopoly':
    case 'playKnight':
    case 'moveRobber':
      return 0.72;
    case 'buildSettlement':
    case 'buildCity':
    case 'playRoadBuilding':
      return 0.58;
    case 'initialSettlement':
    case 'buildRoad':
    case 'playYearOfPlenty':
    case 'buyDevCard':
      return 0.42;
    case 'acceptTrade':
    case 'rejectTrade':
    case 'cancelTrade':
      return 0.5;
    case 'roll':
    case 'endTurn':
    case 'discard':
    case 'maritimeTrade':
    case 'maritimeBulkTrade':
    case 'initialRoad':
      return 0.08;
    default:
      return 0.3;
  }
}

export class CatanCommunicationCoordinator {
  private readonly conversation = new PublicConversation();
  private readonly policy = new CommunicationPolicy();
  private decisions = 0;
  private spoken = 0;
  private required = 0;
  private requiredSpoken = 0;
  private routine = 0;
  private routineSpoken = 0;
  private trade = 0;
  private tradeSpoken = 0;
  private words = 0;

  constructor(
    private mode: CommunicationMode,
    private readonly labels: readonly string[],
  ) {}

  reset(): void {
    this.conversation.reset();
    this.policy.reset();
    this.decisions = this.spoken = this.required = this.requiredSpoken = 0;
    this.routine = this.routineSpoken = this.trade = this.tradeSpoken = this.words = 0;
  }

  setMode(mode: CommunicationMode): void {
    this.mode = mode;
  }

  currentMode(): CommunicationMode {
    return this.mode;
  }

  modelConfig(): { mode: () => CommunicationMode; guide: string } {
    return { mode: () => this.mode, guide: CATAN_COMMUNICATION_GUIDE };
  }

  contextFor(seat: number): string {
    return this.conversation.promptFor(seat);
  }

  messages(): readonly PublicConversationMessage[] {
    return this.conversation.all();
  }

  summary(): Record<string, number> {
    return {
      decisions: this.decisions,
      spoken: this.spoken,
      speechRate: this.decisions ? this.spoken / this.decisions : 0,
      directResponses: this.requiredSpoken,
      directResponseRate: this.required ? this.requiredSpoken / this.required : 1,
      domesticTradeSpeechRate: this.trade ? this.tradeSpoken / this.trade : 0,
      routineSpeechRate: this.routine ? this.routineSpoken / this.routine : 0,
      averageWords: this.spoken ? this.words / this.spoken : 0,
    };
  }

  addHuman(seat: number, text: string, addressedSeats: readonly number[] = []): PublicConversationMessage | null {
    return this.conversation.appendHuman(seat, this.labels[seat] ?? 'the human player', text, addressedSeats);
  }

  decide(seat: number, action: CatanAction, proposal: Communication | undefined, actionNumber: number): CommunicationDecision {
    const requiredResponse = this.conversation.requiredResponseFor(seat) !== undefined;
    const proposed = proposal ?? { mode: 'silent', intent: 'none', privateReason: 'no structured communication returned' };
    const decision = this.policy.decide({
      mode: this.mode,
      proposal: proposed,
      seat,
      actionNumber,
      actionSalience: catanActionSalience(action),
      requiredResponse,
    });
    this.decisions++;
    if (requiredResponse) this.required++;
    const routine = action.type === 'roll' || action.type === 'endTurn';
    const trade = action.type === 'offerTrade' || action.type === 'counterTrade' || action.type === 'acceptTrade' || action.type === 'rejectTrade' || action.type === 'confirmTrade' || action.type === 'cancelTrade';
    if (routine) this.routine++;
    if (trade) this.trade++;
    if (decision.communication.mode === 'speak') {
      this.spoken++;
      this.words += decision.communication.text.trim().split(/\s+/).filter(Boolean).length;
      if (requiredResponse) this.requiredSpoken++;
      if (routine) this.routineSpoken++;
      if (trade) this.tradeSpoken++;
      this.conversation.appendModel(seat, this.labels[seat] ?? `P${seat + 1}`, decision.communication.text, decision.communication.addressedSeats);
      if (requiredResponse) this.conversation.consumeResponseFor(seat);
    }
    return decision;
  }
}
