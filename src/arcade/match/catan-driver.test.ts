import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player } from '../../ai/player.ts';
import type { CatanState } from '../../rules/catan/catan.ts';
import { RESOURCES, resourceIndex, type CatanAction, type PlayerColor } from '../../rules/catan/types.ts';
import { catanLiveView, catanPlayerLegend, catanStatusLine } from '../games/catan/game-hud.ts';
import { PLAYER_LOOK } from '../games/catan/palette.ts';
import { CatanDriver, type CatanBoardScene, type CatanSeatSpec } from './catan-driver.ts';

class DriverScene implements CatanBoardScene {
  live: CatanState | null = null;
  actions: CatanAction[] = [];

  beginSession(state: CatanState): void {
    this.live = state;
    this.actions = [];
  }

  endSession(): void {
    this.live = null;
  }

  state(): CatanState {
    if (!this.live) throw new Error('scene was read before beginSession');
    return this.live;
  }

  async playMove(action: CatanAction): Promise<void> {
    this.actions.push(action);
    this.state().applyAction(action);
  }

  async requestHumanMove(): Promise<CatanAction> {
    throw new Error('this test uses model seats only');
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

function progressingPlayer(name: string, random: () => number): Player<CatanAction> {
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

async function waitForIdle(driver: CatanDriver): Promise<void> {
  for (let i = 0; i < 100 && driver.isRunning(); i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(driver.isRunning(), false, 'driver did not settle');
}

test('driver installs the scene before models run a complete rules-authoritative game', async () => {
  const scene = new DriverScene();
  let syncs = 0;
  const driver = new CatanDriver({
    scene,
    syncLive: () => syncs++,
    createPlayer: (_spec, seat, label) => progressingPlayer(label, rng(100 + seat)),
  });
  const colors: PlayerColor[] = ['red', 'blue', 'orange', 'purple'];
  const seats: CatanSeatSpec[] = colors.map((color, seat) => ({
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
  assert.ok(driver.history().some((entry) => entry.message.startsWith('rolled ') && entry.message.includes(' = ')));
  assert.ok(driver.latestAction());
  assert.match(catanStatusLine(driver)?.detail ?? '', /^last: /);
  assert.ok(syncs >= scene.actions.length * 2 + 1, 'chat, actions, and completion should repaint the HUD');

  const view = catanLiveView(state, driver);
  assert.equal(view.source, 'live');
  const legendRows = catanPlayerLegend(driver, { x: 0, y: 0, w: 140, h: 50 }).children?.slice(1) ?? [];
  assert.deepEqual(legendRows.map((row) => row.text), colors.map((_color, seat) => `${seat === 0 ? '▸ ' : '  '}■ model-${seat}`));
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
    assert.equal(players[seat].longestRoad, state.roadLength(seat), `seat ${seat} road length`);
  }
  for (const resource of RESOURCES) {
    const total = view.bank[resource]
      + Array.from({ length: 4 }, (_, seat) => state.handOf(seat)[resourceIndex(resource)])
        .reduce((sum, count) => sum + count, 0);
    assert.equal(total, 19, `${resource} remains conserved after setup grants`);
  }
});

test('human UI labels stay conversational while model observations identify the human unambiguously', () => {
  const scene = new DriverScene();
  const driver = new CatanDriver({
    scene,
    syncLive: () => {},
    createPlayer: (_spec, _seat, label) => progressingPlayer(label, rng(101)),
  });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'anthropic/claude-haiku-4.5' },
  ], { autoRun: false, rng: rng(7) });

  assert.equal(driver.labelOf(0), 'You');
  const modelView = state.informationStateString(1);
  assert.match(modelView, /You are claude-haiku-4\.5\./);
  assert.match(modelView, /Opponents: the human player:/);
  assert.doesNotMatch(modelView, /Opponents: You:/);
});

test('human-facing trade history uses your and you instead of You possessives', () => {
  const scene = new DriverScene();
  const driver = new CatanDriver({
    scene,
    syncLive: () => {},
    createPlayer: (_spec, _seat, label) => progressingPlayer(label, rng(102)),
  });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'anthropic/claude-haiku-4.5' },
  ], { autoRun: false, rng: rng(8) });
  const before = { hands: [state.handOf(0).slice(), state.handOf(1).slice()], trade: { from: 0 } };
  const record = (driver as unknown as {
    record: (seat: number, action: CatanAction, before: unknown) => void;
  }).record.bind(driver);

  record(1, { type: 'rejectTrade' }, before);
  assert.equal(driver.history().at(-1)?.message, 'rejected your trade offer');
  record(1, { type: 'counterTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] }, before);
  assert.match(driver.history().at(-1)?.message ?? '', /^countered you with /);
});

test('reset aborts and clears both driver and scene session state', () => {
  const scene = new DriverScene();
  const driver = new CatanDriver({
    scene,
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
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/model' },
  ], { autoRun: false, communicationMode: 'ambient', rng: rng(3) });
  assert.equal(driver.sendHumanChat('Can you trade, Claude?', 1), true);
  assert.equal(driver.history().at(-1)?.message, 'Can you trade, Claude?');
  assert.equal(driver.history().at(-1)?.chat, true);
  driver.reset();
  driver.start([
    { kind: 'ai', color: 'red', model: 'test/a' },
    { kind: 'ai', color: 'blue', model: 'test/b' },
  ], { autoRun: false, rng: rng(4) });
  assert.equal(driver.sendHumanChat('invisible spectator speech'), false);
});
