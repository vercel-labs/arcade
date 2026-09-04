import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { Player } from '../../harness/player.ts';
import type { IslandersState } from '../../rules/islanders/islanders.ts';
import { RESOURCES, resourceIndex, type IslandersAction, type PlayerColor } from '../../rules/islanders/types.ts';
import { islandersLiveView, islandersPlayerLegend, islandersStatusLine } from '../games/islanders/game-hud.ts';
import { PLAYER_LOOK } from '../games/islanders/palette.ts';
import { IslandersDriver, type IslandersBoardScene, type IslandersSeatSpec } from './islanders-driver.ts';

class DriverScene implements IslandersBoardScene {
  live: IslandersState | null = null;
  actions: IslandersAction[] = [];

  beginSession(state: IslandersState): void {
    this.live = state;
    this.actions = [];
  }

  endSession(): void {
    this.live = null;
  }

  state(): IslandersState {
    if (!this.live) throw new Error('scene was read before beginSession');
    return this.live;
  }

  async playMove(action: IslandersAction): Promise<void> {
    this.actions.push(action);
    this.state().applyAction(action);
  }

  async requestHumanMove(): Promise<IslandersAction> {
    throw new Error('this test uses model seats only');
  }
}

class GatedDriverScene extends DriverScene {
  private releaseSetup!: () => void;
  readonly setupReady = new Promise<void>((resolve) => { this.releaseSetup = resolve; });

  override beginSession(state: IslandersState): Promise<void> {
    super.beginSession(state);
    return this.setupReady;
  }

  release(): void {
    this.releaseSetup();
  }
}

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function progressingPlayer(name: string, random: () => number): Player<IslandersAction> {
  return {
    name,
    chooseAction: async (state) => {
      const legal = state.legalActions();
      let choices = legal;
      if (legal.some((action) => action.type !== 'endTurn')) {
        choices = legal.filter((action) => action.type !== 'endTurn');
      }
      return {
        action: choices[Math.floor(random() * choices.length)],
        rationale: `${name} explains the action`,
      };
    },
  };
}

function reactingPlayer(name: string, random: () => number): Player<IslandersAction> {
  return {
    ...progressingPlayer(name, random),
    chooseCommunication: async ({ opportunity }) => ({
      mode: 'speak',
      intent: 'react',
      text: `${name} reacts to ${opportunity.moment.type}`,
      privateReason: 'deterministic ambient reaction test',
    }),
  };
}

async function waitForIdle(driver: IslandersDriver): Promise<void> {
  for (let i = 0; i < 100 && driver.isRunning(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(driver.isRunning(), false, 'driver did not settle');
}

test('driver waits for board setup presentation before asking for initial placement', async () => {
  const scene = new GatedDriverScene();
  let choices = 0;
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, _seat, label) => ({
      name: label,
      chooseAction: async (state) => {
        choices++;
        return { action: state.legalActions()[0], rationale: 'test' };
      },
    }),
  });
  driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { maxActions: 1 });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(choices, 0);
  scene.release();
  await waitForIdle(driver);
  assert.equal(choices, 1);
});

test('driver installs the scene before models run a complete rules-authoritative game', async () => {
  const scene = new DriverScene();
  let syncs = 0;
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => syncs++,
    createPlayer: (_spec, seat, label) => progressingPlayer(label, rng(100 + seat)),
  });
  const colors: PlayerColor[] = ['red', 'blue', 'orange', 'purple'];
  const seats: IslandersSeatSpec[] = colors.map((color, seat) => ({
    kind: 'ai',
    color,
    model: `test/model-${seat}`,
  }));

  const state = driver.start(seats, { rng: rng(7), maxActions: 5_000 });
  assert.equal(scene.live, state);
  await waitForIdle(driver);

  assert.equal(driver.error(), null);
  assert.equal(driver.isComplete(), true);
  assert.equal(state.isTerminal(), true);
  assert.ok(driver.winner() >= 0);
  assert.ok(scene.actions.length > 16);
  assert.ok(driver.history().length >= scene.actions.length * 2);
  assert.equal(driver.history().filter((entry) => entry.chat).length, scene.actions.length);
  assert.ok(driver.history().some((entry) => entry.message.includes('🏠 placed a settlement')));
  for (const entry of driver.history()) {
    if (/placed a (?:road|settlement|city)/.test(entry.message)) {
      assert.doesNotMatch(entry.message, /\b(?:node|edge) \d+\b/);
    }
  }
  assert.ok(driver.history().some((entry) => entry.message.startsWith('rolled ') && entry.message.includes(' = ')));
  const winner = driver.winner();
  assert.deepEqual(driver.history().at(-1), {
    seat: winner,
    color: driver.colorOf(winner),
    actor: driver.labelOf(winner),
    message: `wins · ${state.victoryPoints(winner, true)} victory points`,
  });
  assert.ok(driver.latestAction());
  assert.match(islandersStatusLine(driver)?.narration ?? '', /^wins · 10 victory points$/);
  assert.equal('detail' in (islandersStatusLine(driver) ?? {}), false, 'top narration does not repeat sidebar history');
  assert.ok(syncs >= scene.actions.length * 2 + 1, 'chat, actions, and completion should repaint the HUD');

  const view = islandersLiveView(state, driver);
  assert.equal(view.source, 'live');
  const legendRows = islandersPlayerLegend(driver, { x: 0, y: 0, w: 140, h: 50 }).children?.slice(1) ?? [];
  assert.deepEqual(legendRows.map((row) => row.text), colors.map((_color, seat) => `■ model-${seat}`));
  assert.deepEqual(legendRows.map((row) => row.style.color), colors.map((color) => PLAYER_LOOK[color]));
  const players = [view.localPlayer, ...view.opponents];
  assert.equal(players.length, 4);
  for (let seat = 0; seat < players.length; seat++) {
    const expectedCards = RESOURCES.reduce(
      (sum, resource) => sum + state.handOf(seat)[resourceIndex(resource)],
      0,
    );
    assert.equal(players[seat].resourceCards, expectedCards, `seat ${seat} public hand count`);
    assert.equal(players[seat].publicVp, state.victoryPoints(seat, false), `seat ${seat} public victory points`);
    assert.equal(players[seat].actualVp, state.victoryPoints(seat, true), `seat ${seat} final victory points are revealed`);
    assert.equal(players[seat].longestRoad, state.roadLength(seat), `seat ${seat} road length`);
  }
  for (const resource of RESOURCES) {
    const total = view.bank[resource]
      + Array.from({ length: 4 }, (_, seat) => state.handOf(seat)[resourceIndex(resource)])
        .reduce((sum, count) => sum + count, 0);
    assert.equal(total, 19, `${resource} remains conserved after setup grants`);
  }
});

test('ambient live games offer affected models reaction-only turns while autoreply stays actor-only', async () => {
  const make = (mode: 'ambient' | 'autoreply') => {
    const scene = new DriverScene();
    const driver = new IslandersDriver({
      scene,
      reflectionModel: () => null,
      syncLive: () => {},
      createPlayer: (_spec, seat, label) => reactingPlayer(label, rng(300 + seat)),
    });
    driver.start([
      { kind: 'ai', color: 'red', model: 'test/a' },
      { kind: 'ai', color: 'blue', model: 'test/b' },
    ], { rng: rng(12), communicationMode: mode, maxActions: 5_000 });
    return driver;
  };
  const ambient = make('ambient');
  await waitForIdle(ambient);
  assert.ok(ambient.history().some((entry) => entry.chat && entry.message.includes('reacts to')));

  const autoreply = make('autoreply');
  await waitForIdle(autoreply);
  assert.equal(autoreply.history().some((entry) => entry.chat && entry.message.includes('reacts to')), false);
});

test('directly addressed trade participants reply through their required actions only once', async () => {
  const scene = new DriverScene();
  const directedReplies = [0, 0];
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, seat, label): Player<IslandersAction> => ({
      name: label,
      chooseAction: async (game) => {
        const prompt = (game as IslandersState).currentPrompt();
        if (seat === 0 && prompt.kind === 'playTurn') return {
          action: { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] },
          communication: { mode: 'speak', intent: 'negotiate', text: 'I can trade one brick for one grain.', addressedSeats: [1] },
        };
        if (seat === 1 && prompt.kind === 'respondTrade') return {
          action: { type: 'acceptTrade' },
          communication: { mode: 'speak', intent: 'negotiate', text: 'Accepted. Please confirm the exchange.', addressedSeats: [0] },
        };
        if (seat === 0 && prompt.kind === 'decideAcceptees') return {
          action: { type: 'confirmTrade', with: 1 },
          communication: { mode: 'speak', intent: 'negotiate', text: 'I am locking in the exchange now.', addressedSeats: [1] },
        };
        throw new Error(`unexpected prompt ${prompt.kind} for seat ${seat}`);
      },
      chooseCommunication: async () => {
        directedReplies[seat]++;
        return { mode: 'speak', intent: 'reply', text: 'The agreement works for me.' };
      },
    }),
  });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: rng(13), communicationMode: 'ambient' });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  state.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0].fill(0);
  hands[1].fill(0);
  hands[0][resourceIndex('brick')] = 1;
  hands[1][resourceIndex('grain')] = 1;

  await (driver as unknown as { run(maxActions: number): Promise<void> }).run(3);

  assert.deepEqual(directedReplies, [0, 1], 'a participant may react after completion, but never just before its own trade action');
  assert.deepEqual(
    driver.history().filter((entry) => entry.chat).map((entry) => entry.message),
    ['I can trade one brick for one grain.', 'Accepted. Please confirm the exchange.', 'I am locking in the exchange now.', 'The agreement works for me.'],
  );
  assert.equal(driver.history().some((entry, index, history) =>
    entry.chat && history[index + 1]?.chat && history[index + 1]?.seat === entry.seat), false,
  'one model never produces adjacent reply and action-speech entries');
});

test('human UI labels stay conversational while model observations identify the human unambiguously', () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, _seat, label) => progressingPlayer(label, rng(101)),
  });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'anthropic/claude-haiku-4.5' },
  ], { autoRun: false, rng: rng(7) });

  assert.equal(driver.labelOf(0), 'You');
  const modelView = state.informationStateString(1);
  assert.match(modelView, /YOU ARE: claude-haiku-4\.5\./);
  assert.match(modelView, /Opponents: the human player:/);
  assert.doesNotMatch(modelView, /Opponents: You:/);
});

test('human-facing trade history uses your and you instead of You possessives', () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, _seat, label) => progressingPlayer(label, rng(102)),
  });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'anthropic/claude-haiku-4.5' },
    { kind: 'ai', color: 'orange', model: 'google/gemini-3-flash' },
  ], { autoRun: false, rng: rng(8) });
  const before = { hands: [state.handOf(0).slice(), state.handOf(1).slice(), state.handOf(2).slice()], trade: { from: 0 } };
  const record = (driver as unknown as {
    record: (seat: number, action: IslandersAction, before: unknown) => void;
  }).record.bind(driver);

  record(1, { type: 'rejectTrade' }, before);
  assert.equal(driver.history().at(-1)?.message, 'rejected your trade offer');
  record(1, { type: 'counterTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] }, before);
  assert.match(driver.history().at(-1)?.message ?? '', /^countered you with /);

  const monopolyHands = [Array(RESOURCES.length).fill(0), Array(RESOURCES.length).fill(0), Array(RESOURCES.length).fill(0)];
  monopolyHands[1][resourceIndex('grain')] = 6;
  record(0, { type: 'playMonopoly', resource: 'grain' }, { hands: monopolyHands, trade: null });
  assert.equal(driver.history().at(-1)?.message, 'took 🌾 x6 with monopoly');

  (state as unknown as { actionRecords: () => unknown[] }).actionRecords = () => [{ outcome: { stolenResource: 'grain' } }];
  record(1, { type: 'moveRobber', hex: 1, victim: 2 }, null);
  assert.match(driver.history().at(-1)?.message ?? '', /stole a card from/);
  assert.doesNotMatch(driver.history().at(-1)?.message ?? '', /stole 🌾/, 'an uninvolved human cannot see the random card');
  record(0, { type: 'moveRobber', hex: 1, victim: 2 }, null);
  assert.match(driver.history().at(-1)?.message ?? '', /stole 🌾 x1 from/);
  record(1, { type: 'moveRobber', hex: 1, victim: 0 }, null);
  assert.match(driver.history().at(-1)?.message ?? '', /stole 🌾 x1 from you/);
});

test('reset aborts and clears both driver and scene session state', () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, seat, label) => progressingPlayer(label, rng(200 + seat)),
  });
  driver.start(
    [
      { kind: 'ai', color: 'red', model: 'test/a' },
      { kind: 'ai', color: 'blue', model: 'test/b' },
    ],
    { autoRun: false },
  );

  driver.reset();

  assert.equal(driver.state(), null);
  assert.equal(scene.live, null);
  assert.deepEqual(driver.history(), []);
  assert.equal(driver.latestAction(), null);
});

test('human chat is accepted only in human games and can directly address one model', () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {}, reflectionModel: () => null });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/model' },
  ], { autoRun: false, communicationMode: 'ambient', rng: rng(3) });
  assert.equal(driver.sendHumanChat('Can you trade, Claude?', [1]), true);
  assert.equal(driver.history().at(-1)?.message, 'Can you trade, Claude?');
  assert.equal(driver.history().at(-1)?.chat, true);
  driver.reset();
  driver.start([
    { kind: 'ai', color: 'red', model: 'test/a' },
    { kind: 'ai', color: 'blue', model: 'test/b' },
  ], { autoRun: false, rng: rng(4) });
  assert.equal(driver.sendHumanChat('invisible spectator speech'), false);
});

test('an @-addressed human message prompts one immediate model reply in ambient mode', async () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({
    scene,
    reflectionModel: () => null,
    syncLive: () => {},
    createPlayer: (_spec, seat, label) => ({
      ...progressingPlayer(label, rng(500 + seat)),
      chooseCommunication: async ({ opportunity }) => ({
        mode: 'speak',
        intent: 'reply',
        text: `Replying once to ${opportunity.moment.publicSummary}`,
        addressedSeats: [0],
        privateReason: 'directly addressed by the human',
      }),
    }),
  });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'anthropic/claude-haiku-4.5' },
  ], { autoRun: false, communicationMode: 'ambient', rng: rng(9) });

  assert.equal(driver.sendHumanChat('@claude-haiku-4.5 why block me?', [1]), true);
  for (let i = 0; i < 20 && driver.history().filter((entry) => entry.chat).length < 2; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const chat = driver.history().filter((entry) => entry.chat);
  assert.equal(chat.length, 2);
  assert.equal(chat[0]?.seat, 0);
  assert.equal(chat[1]?.seat, 1);
  assert.match(chat[1]?.message ?? '', /^Replying once to /);
});

test('practice bots play a complete offline game and a stocked hand stays card-conserving', async () => {
  const scene = new DriverScene();
  const driver = new IslandersDriver({ scene, syncLive() {} });
  const seats: IslandersSeatSpec[] = [
    { kind: 'bot', color: 'red' },
    { kind: 'bot', color: 'blue' },
    { kind: 'bot', color: 'orange' },
  ];
  const state = driver.start(seats, { rng: rng(11), maxActions: 5_000 });
  assert.deepEqual([0, 1, 2].map((seat) => driver.labelOf(seat)), ['bot 0', 'bot 1', 'bot 2']);
  await waitForIdle(driver);
  assert.equal(driver.error(), null);
  assert.equal(driver.isComplete(), true);
  assert.equal(state.isTerminal(), true);
  assert.ok(driver.history().every((entry) => !entry.chat || !entry.message.startsWith('@')), 'bots never open player trades');

  // The tutorial's opening-hand grant moves cards out of the bank, never conjuring them.
  const staged = driver.start(seats, { rng: rng(12), autoRun: false });
  const before = RESOURCES.map((resource) => staged.bankDeck()[resourceIndex(resource)] + staged.handOf(0)[resourceIndex(resource)]);
  staged.grantResources(0, [2, 1, 2, 4, 1]);
  assert.deepEqual(staged.handOf(0), [2, 1, 2, 4, 1]);
  const after = RESOURCES.map((resource) => staged.bankDeck()[resourceIndex(resource)] + staged.handOf(0)[resourceIndex(resource)]);
  assert.deepEqual(after, before);
  driver.reset();
});

test('model seats reflect into a private notebook at the end of their own turns', async () => {
  let reflections = 0;
  const reflectionModel = new MockLanguageModelV3({
    doGenerate: async () => {
      reflections++;
      return {
        content: [{ type: 'text', text: JSON.stringify({ plan: `plan ${reflections}`, players: [{ player: 'model-1', notes: ['Refuses every offer.'] }] }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      } as unknown as Awaited<ReturnType<InstanceType<typeof MockLanguageModelV3>['doGenerate']>>;
    },
  });
  const scene = new DriverScene();
  const driver = new IslandersDriver({
    scene,
    syncLive: () => {},
    createPlayer: (_spec, seat, label) => progressingPlayer(label, rng(700 + seat)),
    reflectionModel: () => reflectionModel,
  });
  const seats: IslandersSeatSpec[] = [
    { kind: 'ai', color: 'red', model: 'test/model-0' },
    { kind: 'ai', color: 'blue', model: 'test/model-1' },
  ];
  driver.start(seats, { rng: rng(21), maxActions: 400 });
  await waitForIdle(driver);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(reflections > 0, 'each model turn end reflects');
  assert.deepEqual(driver.noteObservers().map((o) => o.seat), [0, 1]);
  const notebook = driver.notesView(0);
  assert.match(notebook.plan, /^plan \d+$/);
  assert.deepEqual(notebook.reads, [{ label: 'model-1', notes: ['Refuses every offer.'] }]);
});
