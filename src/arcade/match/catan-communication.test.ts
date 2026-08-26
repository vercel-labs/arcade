import assert from 'node:assert/strict';
import test from 'node:test';
import { CatanCommunicationCoordinator, catanActionSalience } from './catan-communication.ts';

test('Catan action salience distinguishes negotiations from routine turn mechanics', () => {
  assert.ok(catanActionSalience({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] }) > catanActionSalience({ type: 'roll' }));
  assert.ok(catanActionSalience({ type: 'playMonopoly', resource: 'ore' }) > catanActionSalience({ type: 'endTurn' }));
});

test('human table talk is public context and a direct target must be admitted by ambient policy', () => {
  const coordinator = new CatanCommunicationCoordinator('ambient', ['the human player', 'Claude']);
  const human = coordinator.addHuman(0, 'Claude, why block my route?', [1]);
  assert.ok(human);
  assert.match(coordinator.contextFor(1), /directly addressed/);
  const decision = coordinator.decide(1, { type: 'endTurn' }, {
    mode: 'speak',
    intent: 'reply',
    text: 'Because that road was about to run away with the game.',
    respondsTo: human!.id,
  }, 1);
  assert.equal(decision.communication.mode, 'speak');
  assert.equal(decision.requiredResponse, true);
  assert.doesNotMatch(coordinator.contextFor(1), /directly addressed/);
});

test('ambient suppresses routine captions while autoreply preserves the compatibility behavior', () => {
  const ambient = new CatanCommunicationCoordinator('ambient', ['A', 'B']);
  const proposal = { mode: 'speak', intent: 'react', text: 'I rolled.' } as const;
  assert.equal(ambient.decide(0, { type: 'roll' }, proposal, 1).communication.mode, 'silent');
  ambient.setMode('autoreply');
  assert.equal(ambient.decide(0, { type: 'roll' }, proposal, 2).communication.mode, 'speak');
});
