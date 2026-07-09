import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import type { GameState } from '../rules/game.ts';
import type { Player, TurnContext } from './player.ts';

// How a game's moves are written, woven into the prompt + schema so the SAME
// ModelPlayer serves any harness game. Chess is the default (SAN); poker passes its
// own ("fold / call / raise <n> / …").
export interface MoveNotation {
  /** A short name for the move format, e.g. "standard algebraic notation". */
  description: string;
  /** A few example moves, e.g. `"Nf3", "e4", "O-O"`. */
  examples: string;
}
const CHESS_NOTATION: MoveNotation = { description: 'standard algebraic notation', examples: '"Nf3", "e4", "O-O", "exd5"' };

// The default rationale: a spectator-facing explanation (chess). Poker overrides this
// via `rationaleGuide` to get in-character table talk that never reveals hole cards.
const DEFAULT_RATIONALE = 'One short sentence explaining the move, for spectators.';

// Forced structured output: the model returns a move + a one-line rationale, so
// we never scrape prose. The move is still validated (parsed against the harness)
// before play; a legal-looking-but-illegal move is re-prompted.
const buildSchema = (notation: MoveNotation, rationale: string = DEFAULT_RATIONALE) =>
  z.object({
    move: z.string().describe(`Your chosen move in ${notation.description}, e.g. ${notation.examples}.`),
    rationale: z.string().describe(rationale),
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
   * How this game's moves are written (schema + prompt). Defaults to chess SAN, so
   * chess callers are unchanged; poker passes its own action vocabulary.
   */
  moveNotation?: MoveNotation;
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
  /**
   * Redefines what the `rationale` field is (its schema description + a prompt
   * note), replacing the default "explain the move for spectators". Poker uses this
   * for in-character TABLE TALK: casual chatter about the action / one's read that
   * must never reveal the speaker's own hole cards. A full instruction sentence.
   */
  rationaleGuide?: string;
  /**
   * Optional extra context woven into the move prompt for the seat to act, read
   * live per turn (a thunk, so it reflects the latest state). Poker uses it to inject
   * chip standings + the seat's private opponent notes; games that don't set it are
   * unaffected. Returns '' when there is nothing to add.
   */
  contextProvider?: (player: number) => string;
  /**
   * Observability hook fired once per generation attempt — for diagnostics
   * (src/tools/self-play.ts), not used in the app. `raw` is the model's move
   * string / reply / error message; `result` is how it resolved.
   */
  onAttempt?: (info: { phase: 'structured' | 'text'; raw: string; result: 'legal' | 'illegal' | 'error' }) => void;
  /**
   * When this returns true, illegal moves are ALLOWED: the model's move is parsed
   * loosely (piece + destination, no rules) via the state's `actionFromStringLoose`
   * and applied as-is — no legality check, no legal-move list, no illegal retries.
   * A thunk so the in-game toggle takes effect on the next move. Off → the normal
   * reject/retry path (and the retry prompt lists the legal moves).
   */
  allowIllegal?: () => boolean;
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
  private rationaleGuide?: string;
  private contextProvider?: (player: number) => string;
  private onAttempt?: ModelPlayerOpts['onAttempt'];
  private allowIllegal?: () => boolean;
  private notation: MoveNotation;
  private schema: ReturnType<typeof buildSchema>;

  constructor(opts: ModelPlayerOpts) {
    this.model = opts.model;
    this.name = opts.name ?? (typeof opts.model === 'string' ? opts.model : 'model');
    this.maxRetries = opts.maxRetries ?? 3;
    this.gameName = opts.gameName ?? 'a turn-based game';
    this.persona = opts.persona;
    this.banter = opts.banter ?? false;
    this.rationaleGuide = opts.rationaleGuide;
    this.contextProvider = opts.contextProvider;
    this.onAttempt = opts.onAttempt;
    this.allowIllegal = opts.allowIllegal;
    this.notation = opts.moveNotation ?? CHESS_NOTATION;
    this.schema = buildSchema(this.notation, opts.rationaleGuide);
  }

  async chooseAction(state: GameState<A>, ctx?: TurnContext): Promise<{ action: A; rationale?: string }> {
    const signal = ctx?.signal;
    const legal = state.legalActions();
    // Banter (when enabled) reacts to the opponent; the move-decision prompt is
    // otherwise kept clean so chatter can't distort the chess reasoning.
    const opponentSaid = this.banter ? ctx?.opponentSaid : undefined;

    // Illegal-moves mode: parse the model's move loosely (piece + destination, no
    // rules) and accept it as-is. Otherwise parse strictly against the legal list.
    const looseFn = (state as { actionFromStringLoose?: (s: string) => A | null }).actionFromStringLoose;
    const useLoose = (this.allowIllegal?.() ?? false) && typeof looseFn === 'function';
    const parse = (s: string): A | null => (useLoose ? looseFn!.call(state, s) : state.actionFromString(s));
    const legalSan = legal.map((a) => state.actionToString(a));

    // Phase 1 — structured output (clean move + rationale). Re-prompt a rejected
    // move (legal mode: illegal; illegal mode: unparseable); but if the call ERRORS
    // (the provider can't do JSON-mode output: "json_object not supported",
    // "response did not match schema", etc.), stop retrying the schema and fall
    // through to the plain-text path.
    let feedback = '';
    let structuredErrored = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let move: string;
      let rationale: string | undefined;
      try {
        const { output } = await generateText({
          model: this.model,
          system: this.persona,
          abortSignal: signal,
          output: Output.object({ schema: this.schema }),
          prompt: this.buildPrompt(state, 'json', feedback, opponentSaid),
        });
        move = output.move;
        rationale = output.rationale;
      } catch (err) {
        if (signal?.aborted) throw err; // cancellation — let it propagate
        this.onAttempt?.({ phase: 'structured', raw: (err as Error).message ?? String(err), result: 'error' });
        structuredErrored = true;
        break; // schema unsupported → try the text fallback instead of re-trying
      }
      const action = parse(move);
      this.onAttempt?.({ phase: 'structured', raw: move, result: action ? 'legal' : 'illegal' });
      if (action !== null) return { action, rationale };
      feedback = this.retryNote(move, useLoose, legalSan);
    }

    // Phase 2 — plain-text fallback with lenient parsing (the Kaggle Game Arena
    // "soft parse"): the model answers in prose ending with a `MOVE:` line, and we
    // scan for a move. Only worth trying when structured output failed outright —
    // a model that DOES emit JSON but keeps picking rejected moves won't do better
    // in prose.
    if (structuredErrored) {
      feedback = '';
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        let text: string;
        try {
          const r = await generateText({
            model: this.model,
            system: this.persona,
            abortSignal: signal,
            prompt: this.buildPrompt(state, 'text', feedback, opponentSaid),
          });
          text = r.text;
        } catch (err) {
          if (signal?.aborted) throw err;
          this.onAttempt?.({ phase: 'text', raw: (err as Error).message ?? String(err), result: 'error' });
          break; // text generation also failing → give up on this model
        }
        const parsed = this.parseText(state, text, parse);
        this.onAttempt?.({ phase: 'text', raw: text.replace(/\s+/g, ' ').trim().slice(0, 120), result: parsed ? 'legal' : 'illegal' });
        if (parsed) return parsed;
        feedback = this.retryNote(text.replace(/\s+/g, ' ').trim().slice(0, 60), useLoose, legalSan);
      }
    }

    // Exhausted everything — play a legal move so a match never deadlocks.
    const fallback = legal[Math.floor(Math.random() * legal.length)];
    return { action: fallback, rationale: '(no valid reply — fell back to a legal move)' };
  }

  // Re-prompt text. Illegal mode: only "I couldn't parse a move" (any move is
  // accepted, so failure means unparseable — no legal list). Legal mode: list the
  // legal moves so a confused model can pick a valid one instead of guessing.
  private retryNote(answer: string, useLoose: boolean, legalSan: string[]): string {
    if (useLoose) {
      return `\nI couldn't read a move from "${answer}". Reply with one move, e.g. ${this.notation.examples}.`;
    }
    return (
      `\nYour previous answer "${answer}" was not a legal move here. ` +
      `The legal moves are: ${legalSan.join(', ')}. ` +
      `Reply with exactly one of them, in ${this.notation.description}.`
    );
  }

  // Extract a move from free text: prefer an explicit `MOVE: <san>` line, then the
  // whole reply, then the first move-like token. `parse` only matches valid moves
  // (legal, or any parseable move in illegal mode), so prose words don't match.
  private parseText(state: GameState<A>, text: string, parse: (s: string) => A | null): { action: A; rationale?: string } | null {
    const candidates: string[] = [];
    const marked = text.match(/MOVE:\s*([^\n]+)/i);
    if (marked) candidates.push(marked[1].trim());
    candidates.push(text.trim());
    for (const tok of text.split(/[\s,.;:!?"'`()[\]{}*]+/)) if (tok) candidates.push(tok);
    for (const c of candidates) {
      const action = parse(c);
      if (action !== null) return { action, rationale: this.rationaleFrom(text) };
    }
    return null;
  }

  // A short rationale from a free-text reply: the prose before the `MOVE:` line.
  private rationaleFrom(text: string): string | undefined {
    const before = text.split(/MOVE:/i)[0].replace(/\s+/g, ' ').trim();
    return before ? before.slice(0, 140) : undefined;
  }

  private buildPrompt(state: GameState<A>, mode: 'json' | 'text', feedback: string, opponentSaid?: string): string {
    const withExtras = state as {
      fen?: () => string;
      moveHistory?: () => string;
      informationStateString?: (player: number) => string;
    };
    // Imperfect-information games (poker) expose a PER-PLAYER view; use it so the
    // model only ever sees its own hidden information (its hole cards + the public
    // history). Perfect-information games (chess) don't implement it, so we fall
    // back to the full-board `toString()` + FEN exactly as before.
    const player = state.currentPlayer();
    const view = typeof withExtras.informationStateString === 'function' && player >= 0 ? withExtras.informationStateString(player) : null;
    const fen = view ? null : typeof withExtras.fen === 'function' ? withExtras.fen() : null;
    const history = typeof withExtras.moveHistory === 'function' ? withExtras.moveHistory() : '';
    // Optional per-turn extra context for the seat to act (poker: chip standings + notes).
    const extra = player >= 0 ? (this.contextProvider?.(player) ?? '') : '';
    // The format instruction differs by path: JSON keeps providers that need the
    // literal word "json" happy (some json_object modes require it); text asks for
    // a parseable trailing MOVE: line.
    const format =
      mode === 'json'
        ? `\n\nReply as JSON with a "move" field (${this.notation.description}, e.g. ${this.notation.examples}) and a one-sentence "rationale" field.`
        : `\n\nThink briefly if you wish, then end your reply with a line in exactly this form:\nMOVE: <your move in ${this.notation.description}, e.g. ${this.notation.examples}>`;
    return [
      `You are a strong ${this.gameName} player. It is your turn to move.`,
      fen ? `\n\nPosition (FEN): ${fen}` : '',
      view ? `\n\nYour view of the game:\n${view}` : `\n\nBoard (uppercase = White, lowercase = Black):\n${state.toString()}`,
      history ? `\n\nThe moves played so far are: ${history}` : '',
      extra ? `\n\n${extra}` : '',
      opponentSaid
        ? `\n\nYour opponent just said: "${opponentSaid}". You may react to it in your rationale, but choose your move on the merits of the position.`
        : '',
      `\n\nChoose the strongest legal move.`,
      format,
      // Reinforce a custom rationale meaning (e.g. poker table talk) beyond the schema
      // field description, since models often weight prose instructions more heavily.
      this.rationaleGuide ? `\n\nYour "rationale" is not analysis. It is ${this.rationaleGuide}` : '',
      feedback,
    ].join('');
  }
}
