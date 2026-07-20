import { appendFileSync } from 'node:fs';
import { gateway } from '@ai-sdk/gateway';
import WebSocket from 'ws';

// Opt-in debug trace for the live conversation: set ARCADE_RT_LOG to a file path to
// log every client event sent / server event received, with high-frequency audio
// frames (input-audio-append, audio-delta) collapsed into a run summary — count,
// span, and largest inter-frame gap, separated into mic-up vs model-down so capture
// vs playback delivery is visible. Off unless ARCADE_RT_LOG is set.
const RT_LOG = process.env.ARCADE_RT_LOG;
// Separate run-counters for mic-up (input-audio-append) vs model-down (audio-delta)
// so we can tell whether the mic is truly gated after commit (echo) and whether the
// model's audio streams smoothly. Other events are logged individually; unmapped
// ('custom') server events also log their underlying provider type.
interface AudioRun {
  label: string;
  n: number;
  start: number;
  last: number;
  gap: number;
}
function mkRun(label: string): AudioRun {
  return { label, n: 0, start: 0, last: 0, gap: 0 };
}
const rtMic = mkRun('mic↑');
const rtMod = mkRun('model↓');
function rtMark(line: string): void {
  if (!RT_LOG) return;
  try {
    appendFileSync(RT_LOG, `${line}\n`);
  } catch {
    // best-effort — never break the session over a log write
  }
}
function rtBump(run: AudioRun): void {
  const now = Date.now();
  if (run.n === 0) run.start = now;
  else run.gap = Math.max(run.gap, now - run.last);
  run.last = now;
  run.n++;
}
function rtFlush(run: AudioRun): void {
  if (run.n === 0) return;
  rtMark(`${Date.now()}   · ${run.label} ${run.n} frames over ${run.last - run.start}ms, maxgap ${run.gap}ms`);
  run.n = 0;
  run.gap = 0;
}
function rtTrace(dir: '→' | '←', type: string, rawType?: string): void {
  if (!RT_LOG) return;
  if (type === 'input-audio-append') return rtBump(rtMic);
  if (type === 'audio-delta') return rtBump(rtMod);
  rtFlush(rtMic);
  rtFlush(rtMod);
  rtMark(`${Date.now()} ${dir} ${type}${rawType ? ` [${rawType}]` : ''}`);
}

// A real-time voice session over the Vercel AI Gateway. Wraps the gateway's
// `experimental_realtime` speech-to-speech WebSocket API behind a small, testable
// seam: the codec (serialize/parse events) and the socket are INJECTED, so the
// conversation logic can be exercised headless with a mock socket — no network,
// no key. `openRealtime` wires the live gateway codec + the `ws` client. Like the
// chess `Player`/`TurnContext`, transcript and audio stream out via callbacks as
// they arrive rather than being returned at the end.

export type RealtimeStatus = 'connecting' | 'open' | 'responding' | 'done' | 'closed' | 'error';

export interface RealtimeHandlers {
  /** A chunk of the model's spoken-reply transcript. */
  onTranscript?(delta: string): void;
  /** A chunk of reply audio: raw PCM16, 24 kHz mono (decoded from the wire base64). */
  onAudio?(pcm16: Buffer): void;
  /** Session lifecycle transitions, for the UI (connecting / speaking / done …). */
  onStatus?(status: RealtimeStatus): void;
  /** Server VAD detected the user started speaking — the cue for barge-in. */
  onSpeechStarted?(): void;
  /** Server VAD detected the user stopped speaking (end of the user's turn). */
  onSpeechStopped?(): void;
  /** The transcript of what the user said (when input transcription is enabled). */
  onUserTranscript?(text: string): void;
  /**
   * The model called a tool/function (a completed `function-call-arguments-done`).
   * `argumentsJson` is the raw JSON string of the call's arguments; reply with
   * `sendFunctionResult(callId, name, output)` so the model can continue.
   */
  onFunctionCall?(call: { callId: string; name: string; argumentsJson: string }): void;
  /** A provider/socket error message. */
  onError?(message: string): void;
}

// A function tool the model may call, sent in the session config (mirrors the AI SDK
// realtime v4 tool spec). `parameters` is a JSON Schema object describing the args.
export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

// Provider-neutral session configuration (a subset of the AI SDK realtime spec):
// audio formats, server VAD turn detection, and transcription. Sent as a
// `session-update` once the socket opens.
export interface RealtimeSessionConfig {
  instructions?: string;
  voice?: string;
  outputModalities?: Array<'text' | 'audio'>;
  inputAudioFormat?: { type: string; rate?: number };
  outputAudioFormat?: { type: string; rate?: number };
  inputAudioTranscription?: { model?: string; language?: string } | null;
  outputAudioTranscription?: { model?: string; language?: string } | null;
  turnDetection?: {
    type: 'server-vad' | 'semantic-vad' | 'disabled';
    threshold?: number;
    silenceDurationMs?: number;
    prefixPaddingMs?: number;
  } | null;
  /** Function tools the model may call this session (see RealtimeToolDefinition). */
  tools?: RealtimeToolDefinition[];
}

// The minimal WebSocket surface we use; `ws` satisfies it, and tests pass a mock.
export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'message' | 'close' | 'error', cb: (arg?: unknown) => void): void;
}

// The minimal codec surface that `gateway.experimental_realtime(modelId)` provides:
// it translates between normalized AI SDK realtime events and the provider wire
// format. (It also builds the WebSocket config — used only on the live path.)
export interface RealtimeCodec {
  serializeClientEvent(event: unknown): unknown | Promise<unknown>;
  parseServerEvent(data: unknown): unknown;
}

export class RealtimeSession {
  private open = false;
  // Once closed, drop every inbound server event. socket.close() is async, so buffered
  // frames (e.g. a response's audio deltas) can still arrive — and a torn-down session
  // must not fire handlers, or it reopens the speaker and orphans it (underflow spam).
  private closed = false;
  private outbox: unknown[] = []; // client events queued until the socket opens

  constructor(
    private readonly codec: RealtimeCodec,
    private readonly socket: RealtimeSocket,
    private readonly handlers: RealtimeHandlers,
  ) {
    socket.on('open', () => {
      this.open = true;
      handlers.onStatus?.('open');
      void this.flushOutbox();
    });
    socket.on('message', (data) => this.onMessage(data));
    socket.on('close', () => handlers.onStatus?.('closed'));
    socket.on('error', (e) => handlers.onError?.(errText(e)));
  }

  // Send a user text turn and ask the model to reply (audio + transcript stream
  // back through the handlers). This is the "type to talk" entry point. Sends
  // before the socket opens are queued (see send/flushOutbox), so calling this
  // immediately after connecting is safe.
  async say(text: string): Promise<void> {
    this.handlers.onStatus?.('responding');
    await this.send({ type: 'conversation-item-create', item: { type: 'text-message', role: 'user', text } });
    await this.send({ type: 'response-create' });
  }

  // Push the session configuration (audio formats, server VAD, transcription, tools).
  // Queued until open like any other client event, so call it right after
  // connecting and it lands first.
  updateSession(config: RealtimeSessionConfig): void {
    void this.send({ type: 'session-update', config });
  }

  // Add a text item to the conversation WITHOUT asking for a reply — a silent
  // knowledge update (e.g. the current game state) the model uses on its next turn.
  // Unlike `say`, no `response-create` follows, so it doesn't make the model talk.
  sendContext(text: string): void {
    void this.send({ type: 'conversation-item-create', item: { type: 'text-message', role: 'user', text } });
  }

  // Ask the model to produce a response now, optionally steering just this response
  // with extra instructions (e.g. "it's your turn — call your action"). Use when
  // turn boundaries are driven explicitly rather than by the mic/VAD.
  respond(instructions?: string): void {
    this.handlers.onStatus?.('responding');
    void this.send({ type: 'response-create', options: instructions ? { instructions } : undefined });
  }

  // Return a tool/function result to the model. `output` is a JSON string; `callId`
  // must match the one from the `onFunctionCall` it answers. `respond` asks the model
  // to continue after the result (default) — pass false when the turn is fully driven
  // by the caller and a follow-up utterance would just be noise (e.g. an accepted
  // action), or true to let it retry after an error result.
  sendFunctionResult(callId: string, name: string, output: string, respond = true): void {
    void this.send({ type: 'conversation-item-create', item: { type: 'function-call-output', callId, name, output } });
    if (respond) void this.send({ type: 'response-create' });
  }

  // Append a chunk of microphone audio to the input buffer (base64 PCM16). With
  // server VAD on, the model decides turn boundaries from this stream. With VAD
  // disabled (push-to-talk), commit the buffer with `commitAudioAndRespond` to end
  // the turn and ask for a reply.
  appendAudio(pcm16: Buffer): void {
    void this.send({ type: 'input-audio-append', audio: pcm16.toString('base64') });
  }

  // Push-to-talk turn end: commit the appended mic audio as the user's turn and ask
  // the model to reply. Used when server VAD is disabled and the client decides turn
  // boundaries (e.g. a spacebar toggle).
  commitAudioAndRespond(): void {
    this.handlers.onStatus?.('responding');
    void this.send({ type: 'input-audio-commit' });
    void this.send({ type: 'response-create' });
  }

  // Cancel the model's in-progress response (barge-in). Harmless if no response is
  // active — the server ignores it.
  cancelResponse(): void {
    void this.send({ type: 'response-cancel' });
  }

  // Discard any uncommitted audio in the input buffer (e.g. stale chunks before a
  // fresh push-to-talk turn).
  clearInput(): void {
    void this.send({ type: 'input-audio-clear' });
  }

  close(): void {
    this.closed = true; // stop dispatching further server events before the async close
    try {
      this.socket.close();
    } catch {
      // already closed — nothing to do
    }
  }

  // Send now if the socket is open; otherwise queue (a send before 'open' would
  // throw, and closing a still-connecting socket is what produced the spurious
  // "closed before the connection was established" error).
  private async send(event: unknown): Promise<void> {
    rtTrace('→', (event as { type?: string })?.type ?? 'unknown');
    if (!this.open) {
      this.outbox.push(event);
      return;
    }
    this.socket.send(JSON.stringify(await this.codec.serializeClientEvent(event)));
  }

  // Drain queued client events once the socket is open, preserving order.
  private async flushOutbox(): Promise<void> {
    const pending = this.outbox.splice(0);
    for (const event of pending) {
      this.socket.send(JSON.stringify(await this.codec.serializeClientEvent(event)));
    }
  }

  private onMessage(data: unknown): void {
    if (this.closed) return; // a closed session must not deliver late/buffered frames
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // non-JSON frame — ignore
    }
    const parsed = this.codec.parseServerEvent(raw);
    for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
      const e = ev as {
        type?: string;
        delta?: string;
        message?: string;
        transcript?: string;
        callId?: string;
        name?: string;
        arguments?: string;
        raw?: { type?: string };
      } | null;
      if (!e?.type) continue;
      rtTrace('←', e.type, e.type === 'custom' ? e.raw?.type : undefined);
      switch (e.type) {
        case 'audio-transcript-delta':
          if (e.delta) this.handlers.onTranscript?.(e.delta);
          break;
        case 'audio-delta':
          if (e.delta) this.handlers.onAudio?.(Buffer.from(e.delta, 'base64'));
          break;
        case 'speech-started':
          this.handlers.onSpeechStarted?.();
          break;
        case 'speech-stopped':
          this.handlers.onSpeechStopped?.();
          break;
        case 'input-transcription-completed':
          if (e.transcript) this.handlers.onUserTranscript?.(e.transcript);
          break;
        case 'function-call-arguments-done':
          if (e.callId && e.name) {
            this.handlers.onFunctionCall?.({ callId: e.callId, name: e.name, argumentsJson: e.arguments ?? '{}' });
          }
          break;
        case 'response-created':
          // Marks a response in-flight — including ones the SERVER auto-creates from
          // VAD, not just our client-driven ones — so callers can avoid creating an
          // overlapping response ("active response in progress").
          this.handlers.onStatus?.('responding');
          break;
        case 'response-done':
          this.handlers.onStatus?.('done');
          break;
        case 'error':
          this.handlers.onError?.(e.message ?? 'realtime error');
          break;
      }
    }
  }
}

function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

// Open a live session: fetch an ephemeral token (server-side, where the key
// lives), build the WebSocket config from the provider codec, and connect with
// `ws`. Requires AI_GATEWAY_API_KEY in the environment.
export async function openRealtime(modelId: string, handlers: RealtimeHandlers): Promise<RealtimeSession> {
  rtMark(`\n=== ${new Date().toISOString()} session ${modelId} ===`);
  handlers.onStatus?.('connecting');
  const rt = gateway.experimental_realtime as unknown as {
    (id: string): RealtimeCodec & { getWebSocketConfig(o: { token: string; url: string }): { url: string; protocols?: string[] } };
    getToken(o: { model: string }): Promise<{ token: string; url: string }>;
  };
  const { token, url } = await rt.getToken({ model: modelId });
  const codec = rt(modelId);
  const cfg = codec.getWebSocketConfig({ token, url });
  const ws = new WebSocket(cfg.url, cfg.protocols) as unknown as RealtimeSocket;
  return new RealtimeSession(codec, ws, handlers);
}
