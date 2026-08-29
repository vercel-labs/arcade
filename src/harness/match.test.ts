import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatch, type MatchScene } from './match.ts';
import type { Player } from './player.ts';
import { CHANCE, TERMINAL, type GameState, type ImperfectInfoState } from '../rules/game.ts';

class OneMoveState implements GameState<number> {
  applied = false;
  currentPlayer(): number { return this.applied ? -1 : 0; }
  legalActions(): number[] { return this.applied ? [] : [7]; }
  applyAction(action: number): void { assert.equal(action, 7); this.applied = true; }
  isTerminal(): boolean { return this.applied; }
  returns(): number[] { return this.applied ? [1] : [0]; }
  clone(): GameState<number> { const s = new OneMoveState(); s.applied = this.applied; return s; }
  toString(): string { return this.applied ? 'done' : 'ready'; }
  actionToString(action: number): string { return String(action); }
  actionFromString(value: string): number | null { return value === '7' ? 7 : null; }
}

test('runMatch fires chosen/applied around settlement with the captured player identity', async () => {
  const state = new OneMoveState();
  const scene: MatchScene<number> = {
    state: () => state,
    playMove: async (action) => { state.applyAction(action); },
  };
  const original: Player<number> = { name: 'original', chooseAction: async () => ({ action: 7 }) };
  const replacement: Player<number> = { name: 'replacement', chooseAction: async () => ({ action: 7 }) };
  const players = [original];
  const events: string[] = [];

  const returns = await runMatch(scene, players, {
    onActionChosen: ({ player, state: before }) => {
      events.push(`chosen:${player.name}:${before.toString()}`);
      players[0] = replacement;
    },
    onActionApplied: ({ player, state: after }) => {
      events.push(`applied:${player.name}:${after.toString()}`);
    },
  });

  assert.deepEqual(events, ['chosen:original:ready', 'applied:original:done']);
  assert.deepEqual(returns, [1]);
});

test('runMatch emits no action hooks when a decision is aborted', async () => {
  const state = new OneMoveState();
  const controller = new AbortController();
  const player: Player<number> = {
    name: 'cancelled',
    chooseAction: async () => {
      controller.abort();
      return { action: 7 };
    },
  };
  let hooks = 0;
  const returns = await runMatch({ state: () => state, playMove: async (a) => state.applyAction(a) }, [player], {
    signal: controller.signal,
    onActionChosen: () => { hooks++; },
    onActionApplied: () => { hooks++; },
  });
  assert.equal(hooks, 0);
  assert.equal(state.applied, false);
  assert.deepEqual(returns, [0]);
});

class ExplicitChanceState implements ImperfectInfoState<number> {
  selected: number | null = null;
  currentPlayer(): number { return this.selected === null ? CHANCE : TERMINAL; }
  legalActions(): number[] { return this.selected === null ? [1, 2] : []; }
  applyAction(action: number): void { this.selected = action; }
  isTerminal(): boolean { return this.selected !== null; }
  returns(): number[] { return [this.selected ?? 0]; }
  clone(): GameState<number> { const state = new ExplicitChanceState(); state.selected = this.selected; return state; }
  toString(): string { return this.selected === null ? 'chance' : `selected ${this.selected}`; }
  actionToString(action: number): string { return String(action); }
  actionFromString(value: string): number | null { const parsed = Number(value); return parsed === 1 || parsed === 2 ? parsed : null; }
  isChanceNode(): boolean { return this.selected === null; }
  chanceOutcomes(): { action: number; prob: number }[] { return this.selected === null ? [{ action: 1, prob: 0.25 }, { action: 2, prob: 0.75 }] : []; }
  informationStateString(): string { return this.toString(); }
  observationString(): string { return this.toString(); }
}

test('runMatch resolves explicit chance nodes without asking a player', async () => {
  const state = new ExplicitChanceState();
  const events: string[] = [];
  const returns = await runMatch(
    { state: () => state, playMove: async (action) => state.applyAction(action) },
    [],
    {
      chanceRng: () => 0.5,
      onChanceChosen: ({ action, probability, state: before }) => events.push(`chosen:${action}:${probability}:${before.toString()}`),
      onChanceApplied: ({ action, state: after }) => {
        events.push(`applied:${action}:${after.toString()}`);
      },
    },
  );
  assert.equal(state.selected, 2);
  assert.deepEqual(events, ['chosen:2:0.75:chance', 'applied:2:selected 2']);
  assert.deepEqual(returns, [2]);
});

test('runMatch rejects malformed chance distributions', async () => {
  const state = new ExplicitChanceState();
  state.chanceOutcomes = () => [{ action: 1, prob: 0.4 }];
  await assert.rejects(
    () => runMatch({ state: () => state, playMove: async (action) => state.applyAction(action) }, [], { chanceRng: () => 0 }),
    /sum to 1/,
  );
});
