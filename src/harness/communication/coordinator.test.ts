import assert from 'node:assert/strict';
import test from 'node:test';
import { TableCommunicationCoordinator } from './coordinator.ts';

const proposal = { mode: 'speak', intent: 'banter', text: 'That was ambitious.' } as const;

test('table coordinator preserves autoreply and gates routine ambient chatter', () => {
  const autoreply = new TableCommunicationCoordinator('autoreply', ['A', 'B'], 'guide');
  assert.equal(autoreply.decide(0, proposal, 1, 0.05).communication.mode, 'speak');

  const ambient = new TableCommunicationCoordinator('ambient', ['A', 'B'], 'guide');
  assert.equal(ambient.decide(0, proposal, 1, 0.05).communication.mode, 'silent');
  assert.equal(ambient.decide(1, { ...proposal, text: 'Now that is a real threat.', intent: 'react' }, 8, 0.8).communication.mode, 'speak');
  assert.equal(ambient.summary().spoken, 1);
});
