import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldemState, type PokerAction } from '../../rules/poker/holdem.ts';
import { RealtimeSession, type RealtimeCodec, type RealtimeHandlers, type RealtimeSocket } from '../../voice/realtime-session.ts';
import { type AudioBus, coerceAction, isAffirmative, isNegative, parseSpokenAction, PokerVoice, type PokerVoiceScene, safeFallback } from './poker-voice.ts';

process.env.ARCADE_AUDIO_LOG = '0'; // don't write diagnostic files during tests

// A no-op audio bus: the controller thinks duplex is available but nothing touches the
// real mic/speaker. Keeps tests hardware-free (and non-hanging).
function stubAudio(): AudioBus {
  return {
    probe: () => ({ duplex: true, streaming: true, useAec: true }),
    useAec: true,
    setMode: () => {},
    startMic: () => {},
    play: () => {},
    endReply: (d) => d?.(),
    stopPlayback: () => {},
    stop: () => {},
  };
}

// ── pure helpers ────────────────────────────────────────────────────────────────

test('coerceAction maps tool args to PokerActions; bet/raise need an amount', () => {
  assert.deepEqual(coerceAction({ action: 'fold' }), { type: 'fold' });
  assert.deepEqual(coerceAction({ action: 'check' }), { type: 'check' });
  assert.deepEqual(coerceAction({ action: 'call' }), { type: 'call' });
  assert.deepEqual(coerceAction({ action: 'allin' }), { type: 'allin' });
  assert.deepEqual(coerceAction({ action: 'raise', amount: 120 }), { type: 'raise', to: 120 });
  assert.deepEqual(coerceAction({ action: 'bet', amount: 80 }), { type: 'bet', amount: 80 });
  assert.equal(coerceAction({ action: 'raise' }), null); // missing amount → retry
  assert.equal(coerceAction({ action: 'bet', amount: 0 }), null);
  assert.equal(coerceAction({ action: 'nonsense' }), null);
});

test('parseSpokenAction reads clear commands, ignores table talk', () => {
  assert.deepEqual(parseSpokenAction('I fold'), { type: 'fold' });
  assert.deepEqual(parseSpokenAction('check'), { type: 'check' });
  assert.deepEqual(parseSpokenAction("let's call"), { type: 'call' });
  assert.deepEqual(parseSpokenAction('all in baby'), { type: 'allin' });
  assert.deepEqual(parseSpokenAction('raise to 200'), { type: 'raise', to: 200 });
  assert.deepEqual(parseSpokenAction('bet 50'), { type: 'bet', amount: 50 });
  assert.equal(parseSpokenAction('raise'), null); // no amount → not staged
  assert.equal(parseSpokenAction('nice hand buddy'), null); // social line
  assert.equal(parseSpokenAction("you clearly have nothing, i really think you should just give up now"), null); // long → talk
});

test('affirmations / negations', () => {
  assert.ok(isAffirmative('yes do it'));
  assert.ok(isAffirmative('lock it in'));
  assert.ok(isNegative('no wait, cancel'));
  assert.ok(!isAffirmative('maybe later'));
});

test('safeFallback prefers a free check, else fold — always legal', () => {
  const s = new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20 });
  const fb = safeFallback(s);
  assert.ok(s.legalActions().some((a) => a.type === fb.type));
});

// ── controller over a mock session (no network, no mic) ──────────────────────────

// Build a PokerVoice wired to an in-memory RealtimeSession (identity codec + capturing
// socket). Returns handles to drive server frames and inspect what was sent + emitted.
function rig(botSeat: number, humanSeat: number, heroTurn = false) {
  let hero = heroTurn;
  const setHero = (v: boolean): void => {
    hero = v;
  };
  const state = new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20 });
  const sent: string[] = [];
  const listeners: Record<string, (a?: unknown) => void> = {};
  const socket: RealtimeSocket = { send: (d) => sent.push(d), close: () => {}, on: (ev, cb) => { listeners[ev] = cb; } };
  const codec: RealtimeCodec = { serializeClientEvent: (e) => e, parseServerEvent: (d) => d };
  const chat: { text: string; speaker: string; event?: boolean }[] = [];
  const staged: (PokerAction | null)[] = [];
  const committed: PokerAction[] = [];
  const scene: PokerVoiceScene = { state: () => state, heroToAct: () => hero, commitHumanAction: (a) => committed.push(a) };
  const open = async (_m: string, handlers: RealtimeHandlers): Promise<RealtimeSession> => {
    const s = new RealtimeSession(codec, socket, handlers);
    listeners.open?.();
    return s;
  };
  const voice = new PokerVoice(
    {
      scene,
      botSeat,
      humanSeat,
      botModel: 'anthropic/claude-haiku-4.5',
      botLabel: 'claude-haiku-4.5',
      onChat: (text, speaker, opts) => chat.push({ text, speaker, event: opts?.event }),
      onStage: (a) => staged.push(a),
      requestRender: () => {},
    },
    open,
    stubAudio,
  );
  const recv = (obj: unknown): void => listeners.message?.(JSON.stringify(obj));
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return { state, voice, sent, recv, flush, chat, staged, committed, setHero };
}

test('bot turn pushes ONLY the bot\'s own view (no human hole cards) and a tool call resolves the move', async () => {
  const botSeat = 1;
  const humanSeat = 0;
  const r = rig(botSeat, humanSeat);
  await r.voice.start();

  const pending = r.voice.player().chooseAction(r.state);
  await r.flush();

  // Hole-card safety (AIG-78): the turn context is EXACTLY the bot's own view, which by
  // the engine's contract contains only the bot's cards — never the human's.
  const items = r.sent.filter((s) => s.includes('conversation-item-create')).map((s) => JSON.parse(s).item);
  const turnItem = items.find((it: { text?: string }) => it.text?.includes('your turn'));
  assert.ok(turnItem, 'pushed a turn context');
  assert.equal(turnItem.text, `It is your turn to act.\n${r.state.informationStateString(botSeat)}`);
  assert.notEqual(r.state.informationStateString(botSeat), r.state.informationStateString(humanSeat));

  // The opponent calls act → chooseAction resolves the mapped move, acked ok.
  r.recv({ type: 'function-call-arguments-done', callId: 'c1', name: 'act', arguments: JSON.stringify({ action: 'raise', amount: 60 }) });
  const res = await pending;
  assert.deepEqual(res.action, { type: 'raise', to: 60 });
  const out = r.sent.filter((s) => s.includes('function-call-output')).map((s) => JSON.parse(s).item);
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0].output), { ok: true, applied: 'raise to 60' });

  r.voice.close();
});

test('bot turn defers its prompt while a response is active, then fires on response-done (no overlap)', async () => {
  const r = rig(1, 0);
  await r.voice.start();

  // A response is already in flight (e.g. a VAD-created reaction to the human).
  r.recv({ type: 'response-created', responseId: 'r1' });

  // It becomes the bot's turn: it should push context but NOT create an overlapping
  // response (that's the "active response in progress" bug).
  const pending = r.voice.player().chooseAction(r.state);
  await r.flush();
  assert.ok(r.sent.some((s) => s.includes('conversation-item-create')), 'pushed the turn context');
  assert.equal(r.sent.filter((s) => s.includes('response-create')).length, 0, 'no overlapping response-create while one is active');

  // The active response finishes → the floor is free → the turn prompt fires now.
  r.recv({ type: 'response-done', responseId: 'r1', status: 'completed' });
  await r.flush();
  assert.equal(r.sent.filter((s) => s.includes('response-create')).length, 1, 'exactly one response-create, after the floor freed');

  // And the bot's tool call still resolves the move.
  r.recv({ type: 'function-call-arguments-done', callId: 'c2', name: 'act', arguments: JSON.stringify({ action: 'call' }) });
  const res = await pending;
  assert.deepEqual(res.action, { type: 'call' });
  r.voice.close();
});

test('chat: bot lines carry the model slug (wisp-colored), human lines are tagged "You"', async () => {
  const r = rig(1, 0, true);
  await r.voice.start();
  // The bot speaks (a reaction), streamed as transcript deltas then completed.
  r.recv({ type: 'audio-transcript-delta', delta: 'Nice ' });
  r.recv({ type: 'audio-transcript-delta', delta: 'flop.' });
  r.recv({ type: 'response-done', responseId: 'r1', status: 'completed' });
  // The human says something (tracked into chat too).
  r.recv({ type: 'input-transcription-completed', transcript: 'you got lucky pal' });

  const bot = r.chat.find((c) => c.text === 'Nice flop.');
  const human = r.chat.find((c) => c.text === 'you got lucky pal');
  assert.ok(bot && bot.speaker === 'anthropic/claude-haiku-4.5' && !bot.event, 'bot line uses the model slug (not an event)');
  assert.ok(human && human.speaker === 'You' && !human.event, 'human speech is tracked as a "You" line');
  r.voice.close();
});

test('the opponent\'s recent table talk is fed into the bot\'s decision prompt', async () => {
  const r = rig(1, 0, false);
  await r.voice.start();
  r.recv({ type: 'input-transcription-completed', transcript: 'I flopped the nuts, you should get out of here' });
  const pending = r.voice.player().chooseAction(r.state);
  await r.flush();
  const turnCtx = r.sent
    .filter((s) => s.includes('conversation-item-create'))
    .map((s) => JSON.parse(s).item.text as string | undefined)
    .find((t) => t?.includes('your turn'));
  assert.ok(turnCtx?.includes('I flopped the nuts'), "the human's claim is woven into the decision prompt");
  r.recv({ type: 'function-call-arguments-done', callId: 'c3', name: 'act', arguments: JSON.stringify({ action: 'call' }) });
  await pending;
  r.voice.close();
});

test('an out-of-turn tool call is rejected, not applied', async () => {
  const r = rig(1, 0);
  await r.voice.start();
  r.recv({ type: 'function-call-arguments-done', callId: 'c9', name: 'act', arguments: JSON.stringify({ action: 'allin' }) });
  await r.flush();
  const out = r.sent.filter((s) => s.includes('function-call-output')).map((s) => JSON.parse(s).item);
  assert.equal(out.length, 1);
  assert.equal(JSON.parse(out[0].output).ok, false); // "not your turn"
  r.voice.close();
});

test('no session → chooseAction falls back to a safe legal action (never stalls)', async () => {
  const r = rig(1, 0); // note: start() NOT called → session is null
  const res = await r.voice.player().chooseAction(r.state);
  assert.ok(r.state.legalActions().some((a) => a.type === res.action.type));
});

test('human voice action stages, then a spoken "yes" commits it', async () => {
  const r = rig(1, 0, /* heroTurn */ true);
  await r.voice.start();
  r.recv({ type: 'input-transcription-completed', transcript: 'I raise to 80' });
  assert.deepEqual(r.staged.at(-1), { type: 'raise', to: 80 });
  assert.equal(r.committed.length, 0, 'staged only — awaits confirm');
  r.recv({ type: 'input-transcription-completed', transcript: 'yeah do it' });
  assert.deepEqual(r.committed.at(-1), { type: 'raise', to: 80 });
  r.voice.close();
});

test('trash talk on the human turn does not stage an action', async () => {
  const r = rig(1, 0, true);
  await r.voice.start();
  r.recv({ type: 'input-transcription-completed', transcript: 'nice hand buddy, you got lucky' });
  assert.equal(r.staged.length, 0);
  assert.equal(r.committed.length, 0);
  r.voice.close();
});

test('a staged action is not committed once it is no longer the human turn', async () => {
  const r = rig(1, 0, true);
  await r.voice.start();
  r.recv({ type: 'input-transcription-completed', transcript: 'raise to 80' });
  assert.deepEqual(r.staged.at(-1), { type: 'raise', to: 80 });
  r.setHero(false); // the human acted via a HUD button instead; the turn moved on
  r.recv({ type: 'input-transcription-completed', transcript: 'yes' });
  assert.equal(r.committed.length, 0, 'stale stage must not fire into the wrong turn');
  r.voice.close();
});
