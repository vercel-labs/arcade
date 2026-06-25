import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import type { GameState } from '../games/game.ts';
import type { Player } from './player.ts';

// Forced structured output: the model returns a move + a one-line rationale, so
// we never scrape prose. The move is still validated against the harness's legal
// list (the model can hallucinate a legal-looking-but-illegal move) before play.
const moveSchema = z.object({
  move: z.string().describe('The chosen move, copied EXACTLY from the legal moves list (e.g. "Nf3", "e4", "O-O").'),
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
  /** Illegal/failed-response re-prompts before falling back to a legal move (default 2). */
  maxRetries?: number;
  /** Game name woven into the prompt ("chess"). */
  gameName?: string;
}

// A `Player` backed by an LLM through the Vercel AI Gateway. Observation =
// `state.toString()` (ASCII board) + the legal-move list (canonical notation) +
// FEN when the state exposes one. Generic over the action type, so it drives any
// harness game; chess specifics come only from what `GameState` already renders.
export class ModelPlayer<A> implements Player<A> {
  readonly name: string;
  private model: LanguageModel;
  private maxRetries: number;
  private gameName: string;

  constructor(opts: ModelPlayerOpts) {
    this.model = opts.model;
    this.name = opts.name ?? (typeof opts.model === 'string' ? opts.model : 'model');
    this.maxRetries = opts.maxRetries ?? 2;
    this.gameName = opts.gameName ?? 'a turn-based game';
  }

  async chooseAction(state: GameState<A>, signal?: AbortSignal): Promise<{ action: A; rationale?: string }> {
    const legal = state.legalActions();
    const legalSan = legal.map((a) => state.actionToString(a));
    let feedback = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let move: string;
      let rationale: string | undefined;
      try {
        const { output } = await generateText({
          model: this.model,
          abortSignal: signal,
          output: Output.object({ schema: moveSchema }),
          prompt: this.buildPrompt(state, legalSan, feedback),
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
        `\nYour previous answer "${move}" is NOT a legal move here. ` +
        `Pick EXACTLY one move from the legal list, copied verbatim.`;
    }
    // Exhausted retries — play a legal move so a match never deadlocks on a model
    // that keeps answering illegally.
    const fallback = legal[Math.floor(Math.random() * legal.length)];
    return { action: fallback, rationale: '(no valid reply — fell back to a legal move)' };
  }

  private buildPrompt(state: GameState<A>, legalSan: string[], feedback: string): string {
    const withFen = state as { fen?: () => string };
    const fen = typeof withFen.fen === 'function' ? withFen.fen() : null;
    return [
      `You are a strong ${this.gameName} player. It is your turn to move.`,
      fen ? `\n\nPosition (FEN): ${fen}` : '',
      `\n\nBoard (uppercase = White, lowercase = Black):\n${state.toString()}`,
      `\n\nLegal moves: ${legalSan.join(', ')}`,
      `\n\nChoose the strongest move. Reply with the move copied exactly from the legal list, plus a one-sentence rationale.`,
      feedback,
    ].join('');
  }
}
