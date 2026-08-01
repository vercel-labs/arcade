import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import type { GameState } from '../rules/game.ts';
import { classifyModelError } from './model-errors.ts';
import type {
  ActionChoice,
  DecisionAttempt,
  DecisionDiagnostics,
  DecisionResolution,
  Player,
  TurnContext,
} from './player.ts';

// The rationale we attach when no real move could be obtained and a random legal
// move is played instead — so a match never deadlocks. Distinct strings so the
// spectator line (and the model probe) can tell WHY it fell back apart, rather
// than reading every failure as "the model gave bad answers":
//   exhausted   — the model answered but never produced a usable/legal move.
//   unavailable — the model can't be reached on this team (restricted provider
//                 access); a text retry would hit the same wall, so we skip it.
export const FALLBACK_RATIONALE = {
  exhausted: '(no valid reply — fell back to a legal move)',
  unavailable: '(model unavailable on this team — fell back to a legal move)',
} as const;
const FALLBACK_RATIONALES: string[] = Object.values(FALLBACK_RATIONALE);
/** True for any rationale ModelPlayer attaches to a random-legal-move fallback. */
export function isFallbackRationale(r: string | undefined): boolean {
  return r !== undefined && FALLBACK_RATIONALES.includes(r);
}

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

// Forced structured output: the model returns a move plus a commentary field, so we never
// scrape prose. The move is still validated (parsed against the harness) before play; a
// legal-looking-but-illegal move is re-prompted.
//
// Two shapes:
//  - default (chess): { move, rationale } — the rationale IS the public line.
//  - split (poker, `speech` set): { thinking, move, say } — `thinking` is the model's
//    PRIVATE move reasoning (never surfaced), placed first so it reasons before deciding;
//    `say` is the only public line. Splitting them stops a model from leaking its hand
//    while "explaining" a move: the analysis has a private home, so the spoken `say` stays
//    a clean table-talk line. (Mirrors the reasoning/answer split in poker LLM harnesses.)
const buildSchema = (notation: MoveNotation, opts: { rationale?: string; speech?: string }) => {
  const move = z.string().describe(`Your chosen move in ${notation.description}, e.g. ${notation.examples}.`);
  if (opts.speech !== undefined) {
    return z.object({
      thinking: z.string().describe('Your private reasoning for the move. This is never shown to anyone — think freely here.'),
      move,
      say: z.string().describe(opts.speech),
    });
  }
  return z.object({ move, rationale: z.string().describe(opts.rationale ?? DEFAULT_RATIONALE) });
};

// AI SDK token counts are currently `{ total }`, but keeping this extractor
// structural also tolerates older providers that return a number directly.
function tokenTotal(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : value && typeof value === 'object' && typeof (value as { total?: unknown }).total === 'number'
        ? (value as { total: number }).total
        : undefined;
  return n !== undefined && Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
}

function tokenUsage(usage: unknown): Pick<DecisionAttempt, 'inputTokens' | 'outputTokens'> {
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as { inputTokens?: unknown; outputTokens?: unknown };
  const inputTokens = tokenTotal(u.inputTokens);
  const outputTokens = tokenTotal(u.outputTokens);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

const elapsedMs = (started: number): number => Math.max(0, Math.round(performance.now() - started));

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
   * note), replacing the default "explain the move for spectators". A single-field
   * repurpose for callers that still want the public line to double as the rationale.
   * Ignored when `speech` is set (which supersedes it with a private/public split).
   */
  rationaleGuide?: string;
  /**
   * Split the output into PRIVATE reasoning and a PUBLIC line. When set, the schema
   * becomes { thinking, move, say }: `thinking` holds the model's real move reasoning and
   * is never surfaced; `say` (described by this string) is the only line shown/returned as
   * the rationale. Poker uses this so hand analysis lands in `thinking` and the spoken
   * `say` can't leak cards while "explaining" the move. Omit for a single public field.
   */
  speech?: string;
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
  onAttempt?: (info: { phase: 'structured' | 'text' | 'normalize'; raw: string; result: 'legal' | 'illegal' | 'error' }) => void;
  /**
   * When this returns true, illegal moves are ALLOWED: the model's move is parsed
   * loosely (piece + destination, no rules) via the state's `actionFromStringLoose`
   * and applied as-is — no legality check, no legal-move list, no illegal retries.
   * A thunk so the in-game toggle takes effect on the next move. Off → the normal
   * reject/retry path (and the retry prompt lists the legal moves).
   */
  allowIllegal?: () => boolean;
  /**
   * Rung 4 of the fallback ladder (AIG-183): a SEPARATE, structured-output-capable
   * model used to normalize this model's answer into a legal move ONLY after the
   * native-structured and deterministic-soft-parse rungs have failed. It is given
   * the legal-action set + this model's raw answer and asked which legal action was
   * intended — it recovers the move, it does NOT choose a better one, so the play
   * stays attributed to THIS model. Off (random-legal fallback) unless set. The
   * surfaced rationale is never the normalizer's; in split/speech mode only the
   * public `say` line is ever surfaced, so a poker hand can't leak through it.
   */
  normalizer?: LanguageModel;
  /** Label for the normalizer in diagnostics/logs; defaults to its slug. */
  normalizerName?: string;
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
  private speech?: string;
  private contextProvider?: (player: number) => string;
  private onAttempt?: ModelPlayerOpts['onAttempt'];
  private allowIllegal?: () => boolean;
  private normalizer?: LanguageModel;
  private normalizerName?: string;
  private notation: MoveNotation;
  private schema: z.ZodTypeAny;

  constructor(opts: ModelPlayerOpts) {
    this.model = opts.model;
    this.name = opts.name ?? (typeof opts.model === 'string' ? opts.model : 'model');
    this.maxRetries = opts.maxRetries ?? 3;
    this.gameName = opts.gameName ?? 'a turn-based game';
    this.persona = opts.persona;
    this.banter = opts.banter ?? false;
    this.rationaleGuide = opts.rationaleGuide;
    this.speech = opts.speech;
    this.contextProvider = opts.contextProvider;
    this.onAttempt = opts.onAttempt;
    this.allowIllegal = opts.allowIllegal;
    this.normalizer = opts.normalizer;
    this.normalizerName = opts.normalizerName ?? (typeof opts.normalizer === 'string' ? opts.normalizer : undefined);
    this.notation = opts.moveNotation ?? CHESS_NOTATION;
    this.schema = buildSchema(this.notation, { rationale: opts.rationaleGuide, speech: opts.speech });
  }

  async chooseAction(state: GameState<A>, ctx?: TurnContext): Promise<ActionChoice<A>> {
    const decisionStarted = performance.now();
    const attempts: DecisionAttempt[] = [];
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
    const finish = (
      action: A,
      rationale: string | undefined,
      resolution: DecisionResolution,
      extra: Partial<Pick<DecisionDiagnostics, 'fallbackReason' | 'normalizerModel'>> = {},
    ): ActionChoice<A> => ({
      action,
      rationale,
      diagnostics: {
        resolution,
        durationMs: elapsedMs(decisionStarted),
        attempts,
        illegalMode: useLoose,
        ...extra,
      },
    });

    // Phase 1 — structured output (clean move + rationale). Re-prompt a rejected
    // move (legal mode: illegal; illegal mode: unparseable); but if the call ERRORS,
    // classify it: a SCHEMA/unknown error (the provider can't do JSON-mode output:
    // "responseFormat not supported", "No object generated", etc.) drops to the
    // plain-text path — a model that reasons fine in prose is still playable. An
    // ACCESS error (403 / no_providers_available — the team can't reach this
    // provider) would hit the same wall in text, so we stop and report it distinctly.
    let feedback = '';
    let structuredErrored = false;
    let unavailable = false;
    // The most recent answer the model actually produced (a rejected move string or
    // a prose reply) and the best PUBLIC rationale seen — fed to the normalizer rung
    // if every deterministic rung fails. In split mode `lastRationale` is only ever
    // the `say` line, so a normalized rescue can't surface private hand analysis.
    let lastRaw: string | undefined;
    let lastRationale: string | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const attemptStarted = performance.now();
      let move: string;
      let rationale: string | undefined;
      let usage: unknown;
      try {
        const generated = await generateText({
          model: this.model,
          system: this.persona,
          abortSignal: signal,
          output: Output.object({ schema: this.schema }),
          prompt: this.buildPrompt(state, 'json', feedback, opponentSaid),
        });
        usage = generated.usage;
        // Split schema (speech) surfaces only `say`; `thinking` is private and dropped.
        const out = generated.output as { move: string; rationale?: string; say?: string };
        move = out.move;
        rationale = this.speech !== undefined ? out.say : out.rationale;
      } catch (err) {
        if (signal?.aborted) throw err; // cancellation — let it propagate
        const failure = classifyModelError(err);
        attempts.push({
          phase: 'structured',
          sequence: attempts.length,
          result: 'error',
          failureKind: failure.kind,
          latencyMs: elapsedMs(attemptStarted),
        });
        this.onAttempt?.({ phase: 'structured', raw: (err as Error).message ?? String(err), result: 'error' });
        if (failure.kind === 'access') {
          unavailable = true;
          break; // provider unreachable on this team — the text path fails identically
        }
        structuredErrored = true;
        break; // schema unsupported → try the text fallback instead of re-trying
      }
      const action = parse(move);
      attempts.push({
        phase: 'structured',
        sequence: attempts.length,
        result: action ? 'accepted' : 'rejected',
        ...(action ? {} : { rejectionReason: useLoose ? 'unparseable' as const : 'illegal' as const }),
        latencyMs: elapsedMs(attemptStarted),
        ...tokenUsage(usage),
      });
      this.onAttempt?.({ phase: 'structured', raw: move, result: action ? 'legal' : 'illegal' });
      if (action !== null) return finish(action, rationale, 'structured');
      lastRaw = move;
      lastRationale = rationale;
      feedback = this.retryNote(move, useLoose, legalSan);
    }

    // Phase 2 — plain-text fallback with lenient parsing (the Kaggle Game Arena
    // "soft parse"): the model answers in prose ending with a `MOVE:` line, and we
    // scan for a move. Only worth trying when structured output failed outright —
    // a model that DOES emit JSON but keeps picking rejected moves won't do better
    // in prose, and an unreachable provider won't answer at all.
    if (structuredErrored) {
      feedback = '';
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const attemptStarted = performance.now();
        let text: string;
        let usage: unknown;
        try {
          const r = await generateText({
            model: this.model,
            system: this.persona,
            abortSignal: signal,
            prompt: this.buildPrompt(state, 'text', feedback, opponentSaid),
          });
          text = r.text;
          usage = r.usage;
        } catch (err) {
          if (signal?.aborted) throw err;
          attempts.push({
            phase: 'text',
            sequence: attempts.length,
            result: 'error',
            failureKind: classifyModelError(err).kind,
            latencyMs: elapsedMs(attemptStarted),
          });
          this.onAttempt?.({ phase: 'text', raw: (err as Error).message ?? String(err), result: 'error' });
          break; // text generation also failing → give up on this model
        }
        const parsed = this.parseText(state, text, parse);
        attempts.push({
          phase: 'text',
          sequence: attempts.length,
          result: parsed ? 'accepted' : 'rejected',
          ...(parsed ? {} : { rejectionReason: useLoose ? 'unparseable' as const : 'illegal' as const }),
          latencyMs: elapsedMs(attemptStarted),
          ...tokenUsage(usage),
        });
        this.onAttempt?.({ phase: 'text', raw: text.replace(/\s+/g, ' ').trim().slice(0, 120), result: parsed ? 'legal' : 'illegal' });
        if (parsed) return finish(parsed.action, parsed.rationale, 'text');
        lastRaw = text;
        lastRationale = this.speech !== undefined ? this.sayFrom(text) : this.rationaleFrom(text);
        feedback = this.retryNote(text.replace(/\s+/g, ' ').trim().slice(0, 60), useLoose, legalSan);
      }
    }

    // Rung 4 — normalization pass: hand this model's raw answer + the legal set to a
    // structured-capable normalizer to recover the intended LEGAL move. Skipped when
    // the provider was unreachable (nothing to normalize) or in illegal-moves mode
    // (which deliberately bypasses the legal set). The play stays attributed to THIS
    // model; only its own public rationale is surfaced (never the normalizer's).
    if (this.normalizer && lastRaw !== undefined && !unavailable && !useLoose) {
      const action = await this.normalize(state, lastRaw, legalSan, attempts, signal);
      if (action !== null) {
        return finish(action, lastRationale, 'normalized', {
          ...(this.normalizerName ? { normalizerModel: this.normalizerName } : {}),
        });
      }
    }

    // Exhausted everything — play a legal move so a match never deadlocks, tagged
    // with WHY so the fallback is visibly diagnosed rather than a silent random move.
    const fallback = legal[Math.floor(Math.random() * legal.length)];
    const fallbackReason = unavailable ? 'unavailable' : 'exhausted';
    return finish(fallback, FALLBACK_RATIONALE[fallbackReason], 'random-fallback', { fallbackReason });
  }

  // Rung 4 helper: ask the normalizer which single legal move the player intended,
  // given its raw answer + the legal-action set. Structured output on a KNOWN
  // structured-capable model (the whole point — the playing model may not be). It
  // recovers the move, never substitutes a stronger one, and its reply is validated
  // against the legal set (strict parse — normalization only runs in legal mode).
  private async normalize(
    state: GameState<A>,
    rawAnswer: string,
    legalSan: string[],
    attempts: DecisionAttempt[],
    signal?: AbortSignal,
  ): Promise<A | null> {
    if (!this.normalizer) return null;
    const attemptStarted = performance.now();
    const schema = z.object({ move: z.string().describe(`Exactly one move from the legal list, in ${this.notation.description}.`) });
    const prompt = [
      `A ${this.gameName} player was asked for a single move and replied:`,
      `"""\n${rawAnswer.slice(0, 2000)}\n"""`,
      `\nThe legal moves are: ${legalSan.join(', ')}.`,
      `\nWhich ONE of those legal moves did the player intend? Recover the move they meant —`,
      ` do NOT substitute a different or stronger move. Reply with exactly one move from the list.`,
    ].join('');
    try {
      const generated = await generateText({ model: this.normalizer, abortSignal: signal, output: Output.object({ schema }), prompt });
      const move = (generated.output as { move: string }).move;
      const action = state.actionFromString(move); // normalization always targets the legal set
      attempts.push({
        phase: 'normalize',
        sequence: attempts.length,
        result: action ? 'accepted' : 'rejected',
        ...(action ? {} : { rejectionReason: 'illegal' as const }),
        latencyMs: elapsedMs(attemptStarted),
        ...tokenUsage(generated.usage),
      });
      this.onAttempt?.({ phase: 'normalize', raw: `${this.normalizerName ?? 'normalizer'} → ${move}`, result: action ? 'legal' : 'illegal' });
      return action;
    } catch (err) {
      if (signal?.aborted) throw err; // cancellation — let it propagate
      attempts.push({
        phase: 'normalize',
        sequence: attempts.length,
        result: 'error',
        failureKind: classifyModelError(err).kind,
        latencyMs: elapsedMs(attemptStarted),
      });
      this.onAttempt?.({ phase: 'normalize', raw: (err as Error).message ?? String(err), result: 'error' });
      return null;
    }
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
      // Split mode: the broadcast line is ONLY the explicit SAY: line — never the free
      // prose, which is the model's (leaky) reasoning. No SAY: → no line, rather than leak.
      if (action !== null) return { action, rationale: this.speech !== undefined ? this.sayFrom(text) : this.rationaleFrom(text) };
    }
    return null;
  }

  // A short rationale from a free-text reply: the prose before the `MOVE:` line.
  private rationaleFrom(text: string): string | undefined {
    const before = text.split(/MOVE:/i)[0].replace(/\s+/g, ' ').trim();
    return before ? before.slice(0, 140) : undefined;
  }

  // The public line from a free-text reply in split mode: only the explicit `SAY:` line
  // (reasoning above it is discarded). Undefined when the model emitted no SAY: line.
  private sayFrom(text: string): string | undefined {
    const say = text
      .match(/SAY:\s*([^\n]+)/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();
    return say ? say.slice(0, 200) : undefined;
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
    // The format instruction depends on path AND on split mode. In split (speech) mode the
    // text fallback must ALSO separate reasoning from speech: reason freely, then a public
    // SAY: line and a MOVE: line — only SAY: is broadcast (parseText). Without this, the
    // fallback broadcasts the pre-MOVE prose, i.e. the reasoning, leaking the hand.
    const speechMode = this.speech !== undefined;
    let format: string;
    if (mode === 'json') {
      format = speechMode
        ? `\n\nReply as JSON with three fields, in order: "thinking" (your private reasoning about the best move, never shown to anyone), "move" (${this.notation.description}, e.g. ${this.notation.examples}), and "say" (${this.speech}).`
        : `\n\nReply as JSON with a "move" field (${this.notation.description}, e.g. ${this.notation.examples}) and a one-sentence "rationale" field.`;
    } else {
      format = speechMode
        ? `\n\nThink privately first if you like. That thinking is never shown to anyone. Then end your reply with exactly these two lines:\nSAY: <one line you say out loud to the table; never reveal your own cards or hand strength unless bluffing>\nMOVE: <your move in ${this.notation.description}, e.g. ${this.notation.examples}>`
        : `\n\nThink briefly if you wish, then end your reply with a line in exactly this form:\nMOVE: <your move in ${this.notation.description}, e.g. ${this.notation.examples}>`;
    }
    return [
      `You are a strong ${this.gameName} player. It is your turn to move.`,
      fen ? `\n\nPosition (FEN): ${fen}` : '',
      view ? `\n\nYour view of the game:\n${view}` : `\n\nBoard (uppercase = White, lowercase = Black):\n${state.toString()}`,
      history ? `\n\nThe moves played so far are: ${history}` : '',
      extra ? `\n\n${extra}` : '',
      opponentSaid
        ? `\n\nYour opponent just said: "${opponentSaid}". You may react to it in what you say, but choose your move on the merits of the position.`
        : '',
      `\n\nChoose the strongest legal move.`,
      format,
      // Split JSON mode: reinforce keeping analysis out of the spoken line. Single-field
      // mode: reinforce a custom rationale meaning. (Text mode bakes this into `format`.)
      speechMode && mode === 'json'
        ? `\n\nPut all move analysis in "thinking" (that field is private). "say" is spoken out loud to the whole table, so make it lively and in your own voice, not a flat announcement of your move. Never reveal your own cards or hand strength in "say" unless you are bluffing.`
        : !speechMode && this.rationaleGuide
          ? `\n\nYour "rationale" is not analysis. It is ${this.rationaleGuide}`
          : '',
      feedback,
    ].join('');
  }
}
