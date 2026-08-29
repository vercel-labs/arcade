import assert from 'node:assert/strict';
import test from 'node:test';
import { directedReplyOpportunities } from '../../communication/moments.ts';
import { CatanCommunicationCoordinator, catanActionSalience } from './catan-communication.ts';

test('Catan action salience distinguishes negotiations from routine turn mechanics', () => {
  assert.ok(catanActionSalience({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] }) > catanActionSalience({ type: 'roll' }));
  assert.ok(catanActionSalience({ type: 'playMonopoly', resource: 'ore' }) > catanActionSalience({ type: 'endTurn' }));
});

test('only ambient mode teaches models the public seat map for directed speech', () => {
  const ambient = new CatanCommunicationCoordinator('ambient', ['A', 'B']).modelConfig().guide;
  const autoreply = new CatanCommunicationCoordinator('autoreply', ['A', 'B']).modelConfig().guide;
  assert.match(ambient, /Current public seat map: 0=A, 1=B/);
  assert.doesNotMatch(autoreply, /Current public seat map/);
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

test('ambient admits an encouraged high-importance reaction opportunity', () => {
  const coordinator = new CatanCommunicationCoordinator('ambient', ['A', 'B']);
  const decision = coordinator.decideOpportunity({
    seat: 1,
    expectation: 'encouraged',
    reason: 'directly affected by the moment',
    moment: {
      id: 'catan-12-1', game: 'catan', type: 'route_cutoff', actorSeat: 0,
      affectedSeats: [1], relevantSeats: [1], strength: 'dramatic', importance: 0.92,
      publicSummary: 'A cut B off.', publicFacts: [], suggestedIntents: ['react'], responseExpectation: 'encouraged',
    },
  }, { mode: 'speak', intent: 'react', text: 'You really took that road from me.' }, 12);
  assert.equal(decision.communication.mode, 'speak');
});

test('directed model dialogue gets one reply beat and cannot recurse', () => {
  const coordinator = new CatanCommunicationCoordinator('ambient', ['A', 'B', 'C']);
  const opening = coordinator.decide(0, { type: 'buildRoad', edge: 1 }, {
    mode: 'speak', intent: 'table_politics', text: 'B, are you really taking that route?', addressedSeats: [1, 99, 0],
  }, 5);
  assert.equal(opening.communication.mode, 'speak');
  const message = coordinator.latestMessage();
  assert.deepEqual(message?.addressedSeats, [1], 'invalid and self-addressed seats are removed');
  const [opportunity] = directedReplyOpportunities(message!, 'catan', 3);
  assert.equal(opportunity.expectation, 'required');
  const reply = coordinator.decideDirectedReply(opportunity, {
    mode: 'speak', intent: 'reply', text: 'Yes—unless you have a better offer.', addressedSeats: [0], respondsTo: message!.id,
  }, 5);
  assert.equal(reply.communication.mode, 'speak');
  assert.doesNotMatch(coordinator.contextFor(0), /directly addressed/, 'the bounded reply does not force a reply-to-reply');
  assert.doesNotMatch(coordinator.contextFor(1), /directly addressed/, 'the original obligation is consumed after one opportunity');
});
