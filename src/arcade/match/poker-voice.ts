// Real-time voice for the heads-up poker table (AIG-79, milestone 1): the AI opponent
// speaks and takes its actions through one speech-to-speech session, and the human
// talks back (and may act) by voice. Scoped to a 2-seat Play match — human vs one AI —
// where a live realtime session pays off and the multi-speaker problem can't occur
// (one bot voice + one human). It's enabled by choosing the realtime model type for the
// AI seat in poker setup, not by any env flag.
//
// This owns ONE RealtimeSession + the shared VoiceDuplex audio bus, and bridges to the
// turn loop via a RealtimeVoicePlayer (a Player<PokerAction>): on the bot's turn it
// pushes the bot's private view, asks for a spoken line + an `act` tool call, and
// resolves the move from that call (nudged + safe-fallback so the game never stalls).
// The human's own cards are NEVER sent to the bot's session (AIG-78). Talk feeds
// decisions for free — it's all one session's context.

import type { Player, TurnContext } from '../../ai/player.ts';
import type { HoldemState, PokerAction } from '../../rules/poker/holdem.ts';
import {
  AudioLog,
  openRealtime,
  pcm16Peak,
  type RealtimeHandlers,
  type RealtimeSession,
  type RealtimeSessionConfig,
  type RealtimeToolDefinition,
  VoiceDuplex,
  type VoiceDuplexHandlers,
  type VoiceMode,
} from '../../voice/index.ts';

// The audio-bus surface the controller drives — VoiceDuplex satisfies it. Injected via
// the constructor so tests can pass a no-op stub and never touch the real mic/speaker.
export interface AudioBus {
  probe(hasKey: boolean): { duplex: boolean; streaming: boolean; useAec: boolean };
  readonly useAec: boolean;
  setMode(m: VoiceMode): void;
  startMic(): void;
  play(pcm: Buffer): void;
  endReply(onDrained?: () => void): void;
  stopPlayback(): void;
  stop(): void;
}

// The selected realtime model both voices the opponent and makes its poker decisions.
const RATE = 24000;

// Turn safety: cap how many times we ask the bot to act in one turn (re-prompts fire on
// response-done, never overlapping), then auto-play a safe action. The hard timeout is a
// final backstop so a silent/hung session can't stall the hand.
const MAX_TURN_PROMPTS = 3;
const TIMEOUT_MS = 20000;

// Persona for the voice opponent: the card-secrecy rule (AIG-78) + how to act (the
// tool) + keep-it-moving brevity. Kept in `instructions` so it outranks per-turn state.
const VOICE_PERSONA =
  "You are playing live, heads-up no-limit Texas Hold'em against one human at a real table. " +
  'Talk like a person at a home game: short, casual, in the moment — react to the hand, banter, ' +
  'needle, size them up. Keep it to a sentence or two and let the game breathe; do not monologue. ' +
  'Everything you say is heard by the other player, so bluff and mislead freely but never ' +
  'honestly reveal the cards you are holding. ' +
  "Pay close attention to what the human says — their claims, tells, and trash talk — and let it " +
  'shape your read and your action: call a likely bluff, fold to convincing strength, and feel free ' +
  'to lie or bluff back. ' +
  'When it is your turn to act, call the `act` tool exactly once with your action; you may say a ' +
  'quick line first. Only act when told it is your turn.';

const TURN_INSTRUCTIONS =
  "It's your turn to act. Weigh what's been said at the table, say a short line out loud if you want, " +
  'then call the `act` tool with your move.';

// The one tool the opponent may call — its poker action for the turn.
const ACT_TOOL: RealtimeToolDefinition = {
  type: 'function',
  name: 'act',
  description: 'Take your poker action for this turn. Call exactly once when it is your turn.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['fold', 'check', 'call', 'bet', 'raise', 'allin'],
        description: 'The action to take.',
      },
      amount: {
        type: 'number',
        description: 'For bet/raise only: the TOTAL chips to have in this street. Omit for fold/check/call/allin.',
      },
    },
    required: ['action'],
  },
};

// The slice of the poker scene the voice controller needs — kept minimal (like
// MatchScene) so it's easy to drive in tests and doesn't couple to the full scene.
export interface PokerVoiceScene {
  state(): HoldemState;
  heroToAct(): boolean;
  commitHumanAction(action: PokerAction): void;
}

export interface PokerVoiceDeps {
  scene: PokerVoiceScene;
  botSeat: number;
  humanSeat: number;
  botModel: string; // actual realtime slug; drives the session, chat identity, and wisp tint
  botLabel: string; // short display name, for event-line text ("<name> stalled…")
  // Push a line to the poker chat rail. `speaker` is a model slug (colored like the
  // text path) or "You" for the human; `event` lines render nameless/grey.
  onChat(text: string, speaker: string, opts?: { event?: boolean }): void;
  // A parsed, legal human action is staged awaiting confirm (null clears the stage).
  onStage(action: PokerAction | null, label: string): void;
  requestRender(): void;
}

// Whether the voice path CAN run: a Gateway key + duplex audio (AEC sidecar, or a
// streaming player + a mic). Whether it SHOULD run is the user's setup toggle, passed
// into PokerMatch.start. Cheap — probe only checks availability, never opens a device.
export function pokerVoiceCapable(): boolean {
  if (!process.env.AI_GATEWAY_API_KEY) return false;
  const probe = new VoiceDuplex({ onForward: () => {} });
  return probe.probe(true).duplex;
}

export class PokerVoice {
  private session: RealtimeSession | null = null;
  private readonly model: string;
  private readonly audio: AudioBus;
  private readonly audioLog = new AudioLog();
  private connecting = false;

  // The in-progress bot turn (armed only while its chooseAction is pending), and the
  // model's accumulating spoken transcript for the current utterance.
  private pendingBot: { state: HoldemState; finish(action: PokerAction): void } | null = null;
  private botSay = '';
  // A human action parsed from speech, awaiting confirm before it commits.
  private staged: PokerAction | null = null;
  // The opponent's recent spoken lines. The bot already hears them (single session), but
  // we also fold them straight into the turn prompt so "read the table" is explicit and
  // verifiable — this is the table talk feeding the decision.
  private recentTalk: string[] = [];
  // Response coordination: OpenAI allows only ONE active response at a time, and server
  // VAD auto-creates responses when the human talks. We track whether one is in-flight
  // so we never create an overlapping one (the "active response in progress" error) —
  // the bot's turn prompt is deferred until the floor is free, and re-prompts fire on
  // `response-done`, never on a blind timer.
  private responding = false;
  private turnPromptSent = false; // have we asked the bot to act this turn yet?
  private turnPrompts = 0; // respond() calls this turn, capped so it can't loop

  // `open` and `makeAudio` are injected so the tool-call / turn logic can be exercised
  // headless — a mock socket + a no-op audio bus, no network and no real mic (the same
  // seam RealtimeSession uses for its socket).
  constructor(
    private readonly deps: PokerVoiceDeps,
    private readonly open: (model: string, handlers: RealtimeHandlers) => Promise<RealtimeSession> = openRealtime,
    makeAudio: (handlers: VoiceDuplexHandlers) => AudioBus = (h) => new VoiceDuplex(h),
  ) {
    this.model = deps.botModel;
    this.audio = makeAudio({
      onForward: (pcm) => this.session?.appendAudio(pcm),
      onMicDecision: (peak, playMs, decision) => this.audioLog.mic(peak, playMs, decision),
      onError: (m) => this.deps.onChat(`(mic: ${m})`, '', { event: true }),
    });
    this.audio.probe(!!process.env.AI_GATEWAY_API_KEY);
    // The poker table always runs hands-free (the human just talks) — there's no
    // push-to-talk control here. Without AEC the software echo gate handles it.
    this.audio.setMode('handsFree');
  }

  // The AI seat's player — a thin bridge whose chooseAction defers to this controller.
  player(): Player<PokerAction> {
    const voice = this;
    return {
      name: this.deps.botLabel,
      chooseAction: (state, ctx) => voice.botChoose(state as HoldemState, ctx),
    };
  }

  // Open the session for the whole match. Idempotent-ish: closes any prior one first.
  async start(): Promise<void> {
    this.close();
    this.connecting = true;
    try {
      const session = await this.open(this.model, this.handlers());
      session.updateSession(this.sessionConfig());
      this.session = session;
      this.audioLog.begin(this.model);
    } catch (err) {
      this.connecting = false;
      this.deps.onChat(`(voice unavailable: ${(err as Error).message})`, '', { event: true });
    }
  }

  close(): void {
    this.audioLog.flush();
    // Close the session FIRST so its event dispatch stops (see RealtimeSession.close):
    // otherwise a late audio delta could reopen the speaker right after we tear the audio
    // path down, leaving it open and spamming CoreAudio underflow warnings (the mid-speech
    // model-swap bug).
    this.session?.close();
    this.session = null;
    this.audio.stop();
    this.connecting = false;
    this.pendingBot = null;
    this.responding = false;
    this.staged = null;
  }

  // At the start of a hand, seed the bot with its own hole cards + the setup (its
  // private view — never the human's cards) so it can talk during the human's turn too.
  beginHand(state: HoldemState): void {
    this.botSay = '';
    this.staged = null;
    this.deps.onStage(null, '');
    this.session?.sendContext(`A new hand is dealt.\n${state.informationStateString(this.deps.botSeat)}`);
  }

  // ── human voice-action confirm (bound to a key by main) ────────────────────────
  confirmStaged(): void {
    const a = this.staged;
    if (!a) return;
    this.staged = null;
    this.deps.onStage(null, '');
    // Only commit if it's still the human's turn (they may have acted via a button, or
    // the turn moved on) — never fire a stale action into the wrong spot.
    if (this.deps.scene.heroToAct()) this.deps.scene.commitHumanAction(a);
    this.deps.requestRender();
  }
  cancelStaged(): void {
    if (!this.staged) return;
    this.staged = null;
    this.deps.onStage(null, '');
    this.deps.requestRender();
  }
  hasStaged(): boolean {
    return this.staged !== null;
  }

  // ── the bot's turn ─────────────────────────────────────────────────────────────
  private botChoose(state: HoldemState, ctx?: TurnContext): Promise<{ action: PokerAction; rationale?: string }> {
    return new Promise((resolve, reject) => {
      const signal = ctx?.signal;
      if (signal?.aborted) return reject(new Error('aborted'));
      // No live session → a safe legal action so the match never stalls.
      if (!this.session) return resolve({ action: safeFallback(state) });

      // The bot's turn means it's not the human's — drop any stale staged action so a
      // later "yes" can't commit it.
      if (this.staged) {
        this.staged = null;
        this.deps.onStage(null, '');
      }
      this.botSay = '';
      this.turnPromptSent = false;
      this.turnPrompts = 0;
      // Final backstop: if the bot never acts (silent, or keeps talking without calling
      // the tool past the prompt cap), auto-play a safe action so the hand can't hang.
      const hard = setTimeout(() => {
        const a = safeFallback(state);
        this.deps.onChat(`(${this.deps.botLabel} stalled — auto ${actionLabel(a)})`, '', { event: true });
        finish(a);
      }, TIMEOUT_MS);
      const onAbort = (): void => {
        cleanup();
        reject(new Error('aborted'));
      };
      const cleanup = (): void => {
        clearTimeout(hard);
        this.pendingBot = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (action: PokerAction): void => {
        cleanup();
        // Bot speech reaches chat via the transcript path (on 'done'), not the
        // rationale, so reactions and on-turn talk post through one place.
        resolve({ action });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingBot = { state, finish };

      // Push the authoritative private view + the opponent's recent table talk, then take
      // the turn — but only when the floor is free (driveTurn defers to response-done if a
      // response is in flight, so we never collide with a VAD-created reaction).
      const talk = this.recentTalk.length
        ? `\n\nWhat your opponent has said recently (factor it into your read):\n${this.recentTalk.map((l) => `- "${l}"`).join('\n')}`
        : '';
      this.session.sendContext(`It is your turn to act.\n${state.informationStateString(this.deps.botSeat)}${talk}`);
      this.driveTurn(TURN_INSTRUCTIONS);
    });
  }

  // Ask the bot to produce its turn response — but only when no response is active
  // (OpenAI rejects overlapping response.create). If the floor is busy this no-ops;
  // onResponseDone retries once it frees.
  private driveTurn(instructions: string): void {
    if (!this.session || !this.pendingBot || this.responding) return;
    this.turnPromptSent = true;
    this.turnPrompts++;
    this.session.respond(instructions);
  }

  // A response finished (the floor is now free). If the bot's turn is still pending,
  // either take the floor (a reaction just ended before we could prompt) or re-prompt it
  // to act — capped, then a safe fallback so the hand advances.
  private onResponseDone(): void {
    const pend = this.pendingBot;
    if (!pend) return;
    if (!this.turnPromptSent) {
      this.driveTurn(TURN_INSTRUCTIONS);
    } else if (this.turnPrompts < MAX_TURN_PROMPTS) {
      this.driveTurn('Make your move now — call the `act` tool with a legal action.');
    } else {
      const a = safeFallback(pend.state);
      this.deps.onChat(`(${this.deps.botLabel} didn't act — auto ${actionLabel(a)})`, '', { event: true });
      pend.finish(a);
    }
  }

  // ── session config + handlers ──────────────────────────────────────────────────
  private sessionConfig(): RealtimeSessionConfig {
    const provider = this.model.split('/')[0];
    const threshold = provider === 'openai' ? 0.99 : 0.5;
    return {
      instructions: VOICE_PERSONA,
      tools: [ACT_TOOL],
      outputModalities: ['audio'],
      inputAudioFormat: { type: 'audio/pcm', rate: RATE },
      outputAudioFormat: { type: 'audio/pcm', rate: RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Always hands-free: the human just talks, server VAD segments their turns, and
      // barge-in cuts the bot off. Without AEC the software echo gate (in VoiceDuplex)
      // keeps the bot's own playback out of this VAD. Bot ACTION turns are driven
      // explicitly via respond(), independent of VAD.
      turnDetection: { type: 'server-vad', threshold, silenceDurationMs: 600, prefixPaddingMs: 300 },
    };
  }

  private handlers(): RealtimeHandlers {
    return {
      onStatus: (s) => {
        this.connecting = s === 'connecting';
        if (s === 'responding') this.responding = true;
        if (s === 'open') this.audio.startMic();
        if (s === 'done') {
          this.responding = false;
          // The completed utterance → chat (covers on-turn talk AND off-turn reactions).
          const line = this.botSay.trim();
          this.botSay = '';
          if (line) {
            this.deps.onChat(line, this.deps.botModel); // model slug → wisp-colored name, like the text path
            this.audioLog.said(line);
            this.deps.requestRender();
          }
          this.audio.endReply();
          this.onResponseDone(); // floor is free — drive / re-prompt the bot's turn
        }
        if (s === 'closed') {
          // Session ended (incl. a mid-speech drop the socket closes on its own): make
          // sure the output device is closed so it can't sit open spamming underflow.
          this.responding = false;
          this.audio.stopPlayback();
        }
      },
      onSpeechStarted: () => {
        this.audioLog.event('speech-started');
        this.audio.stopPlayback(); // barge-in: stop the bot; the server cancels its response
      },
      onSpeechStopped: () => this.audioLog.event('speech-stopped'),
      onTranscript: (delta) => {
        this.botSay += delta;
      },
      onUserTranscript: (text) => this.onHuman(text),
      onAudio: (pcm) => {
        this.audioLog.out(pcm16Peak(pcm), (pcm.length / 2 / RATE) * 1000);
        this.audio.play(pcm);
      },
      onFunctionCall: ({ callId, name, argumentsJson }) => this.onToolCall(callId, name, argumentsJson),
      onError: (m) => {
        this.audio.stopPlayback(); // an error mid-reply shouldn't leave the speaker open
        this.deps.onChat(`(voice error: ${m})`, '', { event: true });
      },
    };
  }

  // The opponent called `act`. Only honor it while its turn is armed; validate, ack,
  // and resolve the move. Out-of-turn or illegal calls get an error result so the model
  // can correct (or is simply ignored until its real turn).
  private onToolCall(callId: string, name: string, argumentsJson: string): void {
    if (name !== 'act') return;
    const pend = this.pendingBot;
    if (!pend) {
      this.session?.sendFunctionResult(callId, name, JSON.stringify({ ok: false, error: 'not your turn' }), false);
      return;
    }
    const action = coerceAction(parseArgs(argumentsJson));
    if (!action) {
      // Illegal/incomplete: return the error (no response-create — the current response
      // is still finishing). onResponseDone will re-prompt for a legal action once it's
      // free, so we never overlap responses.
      this.session?.sendFunctionResult(callId, name, JSON.stringify({ ok: false, error: 'give a legal action; bet/raise need an amount' }), false);
      return;
    }
    this.session?.sendFunctionResult(callId, name, JSON.stringify({ ok: true, applied: actionLabel(action) }), false);
    pend.finish(action);
  }

  // The human said something. Always show it in chat + feed it to the bot (mic already
  // did). If an action is staged, a spoken yes/no confirms/cancels it. On the human's
  // turn, a clearly-spoken action gets staged for confirmation (never auto-committed —
  // a mishear or trash-talk must not misfire chips).
  private onHuman(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.audioLog.heard(trimmed);
    this.deps.onChat(trimmed, 'You');
    this.recentTalk.push(trimmed);
    if (this.recentTalk.length > 5) this.recentTalk.shift(); // keep the last few lines
    this.deps.requestRender();
    if (this.staged) {
      if (isAffirmative(trimmed)) return this.confirmStaged();
      if (isNegative(trimmed)) return this.cancelStaged();
      return;
    }
    if (!this.deps.scene.heroToAct()) return;
    const action = parseSpokenAction(trimmed);
    if (action) this.stage(action);
  }

  private stage(action: PokerAction): void {
    this.staged = action;
    const label = actionLabel(action);
    this.deps.onStage(action, label);
    this.deps.onChat(`Say “yes” or press enter to ${label} — “no” to cancel.`, '', { event: true });
    this.deps.requestRender();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────

// The conservative default when the bot won't/can't act: check for free if legal, else
// fold. Keeps a stalled or disconnected session from ever deadlocking the hand.
export function safeFallback(state: HoldemState): PokerAction {
  return state.legalActions().some((a) => a.type === 'check') ? { type: 'check' } : { type: 'fold' };
}

export function actionLabel(a: PokerAction): string {
  if (a.type === 'bet') return `bet ${a.amount}`;
  if (a.type === 'raise') return `raise to ${a.to}`;
  return a.type;
}

function parseArgs(json: string): { action?: string; amount?: number } {
  try {
    const o = JSON.parse(json) as { action?: unknown; amount?: unknown };
    return {
      action: typeof o.action === 'string' ? o.action : undefined,
      amount: typeof o.amount === 'number' ? o.amount : undefined,
    };
  } catch {
    return {};
  }
}

// Map the tool's {action, amount} to a PokerAction. Returns null when a bet/raise is
// missing its amount (the model is asked to retry); the engine clamps/normalizes the
// rest on apply, so mislabeled-but-close actions still resolve legally.
export function coerceAction(p: { action?: string; amount?: number }): PokerAction | null {
  switch (p.action) {
    case 'fold':
      return { type: 'fold' };
    case 'check':
      return { type: 'check' };
    case 'call':
      return { type: 'call' };
    case 'allin':
      return { type: 'allin' };
    case 'bet':
      return typeof p.amount === 'number' && p.amount > 0 ? { type: 'bet', amount: Math.round(p.amount) } : null;
    case 'raise':
      return typeof p.amount === 'number' && p.amount > 0 ? { type: 'raise', to: Math.round(p.amount) } : null;
    default:
      return null;
  }
}

// Light natural-speech → action parser for the human's turn. Handles fold/check/call,
// all-in/shove/jam, and bet/raise with a spoken integer ("raise to 200"). Word-number
// amounts ("two hundred") aren't parsed — the HUD buttons remain the exact path.
export function parseSpokenAction(text: string): PokerAction | null {
  const t = text.toLowerCase();
  // Only treat short, command-like utterances as an action; longer sentences are
  // table talk (and a staged action needs an explicit confirm anyway).
  if (t.split(/\s+/).filter(Boolean).length > 6) return null;
  if (/\b(all[\s-]?in|shove|jam)\b/.test(t)) return { type: 'allin' };
  if (/\bfold\b/.test(t)) return { type: 'fold' };
  if (/\bcheck\b/.test(t)) return { type: 'check' };
  const amount = ((): number | null => {
    const m = t.replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : null;
  })();
  if (/\braise\b/.test(t)) return amount ? { type: 'raise', to: amount } : null;
  if (/\bbet\b/.test(t)) return amount ? { type: 'bet', amount } : null;
  if (/\bcall\b/.test(t)) return { type: 'call' };
  return null;
}

export function isAffirmative(text: string): boolean {
  return /\b(yes|yeah|yep|yup|confirm|do it|lock it in|lock it|sure|go)\b/i.test(text);
}
export function isNegative(text: string): boolean {
  return /\b(no|nope|nah|cancel|wait|never\s?mind|stop)\b/i.test(text);
}
