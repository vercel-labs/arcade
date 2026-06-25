import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import type { GameState } from '../games/game.ts';
import type { Player, TurnContext } from './player.ts';

// Forced structured output: the model returns a move + a one-line rationale, so
// we never scrape prose. The move is still validated against the harness's legal
// list (the model can hallucinate a legal-looking-but-illegal move) before play.
const moveSchema = z.object({
  move: z.string().describe('Your chosen move in standard algebraic notation, e.g. "Nf3", "e4", "O-O", "exd5".'),
  rationale: z.string().describe('One short sentence explaining the move, for spectators.'),
});

export interface ModelPlayerOpts {
  /**
   * The model: an AI Gateway slug string (e.g. "anthropic/claude-opus-4.8",
   * routed via the gateway) or a LanguageModel instance (e.g. a mock in tests).
   */
  model: LanguageModel;
  /** HUD/log label; defaults to the slug when `model` is a string. */
  name?: string;
  /**
   * Illegal/failed-response re-prompts before falling back to a legal move
   * (default 3 → 4 total attempts, matching the Kaggle Game Arena harness).
   */
  maxRetries?: number;
  /** Game name woven into the prompt ("chess"). */
  gameName?: string;
  /**
   * Optional persona, sent as the system prompt — gives the player an identity
   * and speaking style (e.g. "You are an aggressive attacker who trash-talks").
   * Lays the groundwork for distinct voices when real-time speech is added.
   */
  persona?: string;
  /**
   * When true, the opponent's last line (`TurnContext.opponentSaid`) is woven
   * into the prompt so this player can react to it. Off by default to keep the
   * move-decision prompt clean — banter shouldn't sway the chess reasoning.
   */
  banter?: boolean;
}

// A `Player` backed by an LLM through the Vercel AI Gateway. Observation =
// FEN + `state.toString()` (ASCII board) + the PGN move history, each included
// only when the state exposes it. No legal-move list — the model must find legal
// moves itself, as in the Kaggle Game Arena tournament setup; illegal answers are
// re-prompted, then fall back to a legal move so a match never deadlocks. Generic
// over the action type; chess specifics come only from what `GameState` renders.
export class ModelPlayer<A> implements Player<A> {
  readonly name: string;
  private model: LanguageModel;
  private maxRetries: number;
  private gameName: string;
  private persona?: string;
  private banter: boolean;

  constructor(opts: ModelPlayerOpts) {
    this.model = opts.model;
    this.name = opts.name ?? (typeof opts.model === 'string' ? opts.model : 'model');
    this.maxRetries = opts.maxRetries ?? 3;
    this.gameName = opts.gameName ?? 'a turn-based game';
    this.persona = opts.persona;
    this.banter = opts.banter ?? false;
  }

  async chooseAction(state: GameState<A>, ctx?: TurnContext): Promise<{ action: A; rationale?: string }> {
    const signal = ctx?.signal;
    const legal = state.legalActions();
    // Banter (when enabled) reacts to the opponent; the move-decision prompt is
    // otherwise kept clean so chatter can't distort the chess reasoning.
    const opponentSaid = this.banter ? ctx?.opponentSaid : undefined;
    let feedback = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let move: string;
      let rationale: string | undefined;
      try {
        const { output } = await generateText({
          model: this.model,
          system: this.persona,
          abortSignal: signal,
          output: Output.object({ schema: moveSchema }),
          prompt: this.buildPrompt(state, feedback, opponentSaid),
        });
        move = output.move;
        rationale = output.rationale;
      } catch (err) {
        if (signal?.aborted) throw err; // cancellation — let it propagate
        feedback = `\nYour previous attempt failed (${(err as Error).message}). Answer again, carefully.`;
        continue;
      }
      const action = state.actionFromString(move);
      if (action !== null) return { action, rationale };
      feedback =
        `\nYour previous answer "${move}" was not a legal move I could read here. ` +
        `Reply with exactly one legal move in standard algebraic notation — ` +
        `e.g. "Nf3", "exd5", "O-O", "e8=Q".`;
    }
    // Exhausted retries — play a legal move so a match never deadlocks on a model
    // that keeps answering illegally.
    const fallback = legal[Math.floor(Math.random() * legal.length)];
    return { action: fallback, rationale: '(no valid reply — fell back to a legal move)' };
  }

  private buildPrompt(state: GameState<A>, feedback: string, opponentSaid?: string): string {
    const withExtras = state as { fen?: () => string; moveHistory?: () => string };
    const fen = typeof withExtras.fen === 'function' ? withExtras.fen() : null;
    const history = typeof withExtras.moveHistory === 'function' ? withExtras.moveHistory() : '';
    return [
      `You are a strong ${this.gameName} player. It is your turn to move.`,
      fen ? `\n\nPosition (FEN): ${fen}` : '',
      `\n\nBoard (uppercase = White, lowercase = Black):\n${state.toString()}`,
      history ? `\n\nThe moves played so far are: ${history}` : '',
      opponentSaid
        ? `\n\nYour opponent just said: "${opponentSaid}". You may react to it in your rationale, but choose your move on the merits of the position.`
        : '',
      `\n\nChoose the strongest legal move. Reply with the move in standard algebraic notation (e.g. "Nf3", "e4", "O-O"), plus a one-sentence rationale.`,
      feedback,
    ].join('');
  }
}
