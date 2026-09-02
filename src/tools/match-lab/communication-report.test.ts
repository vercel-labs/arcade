import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchLabEvent } from './types.ts';
import { buildCommunicationReport, formatCommunicationReport } from './communication-report.ts';

const base = { runId: 'run', matchId: '0001', at: '2026-08-26T00:00:00.000Z', game: 'islanders' as const };

test('communication report preserves model proposals and Arcade decisions', () => {
  const events: MatchLabEvent[] = [
    { ...base, type: 'communication_decision', model: 'A', seat: 0, action: 1, data: {
      proposed: { mode: 'speak', intent: 'react', text: 'That changes things.' },
      communication: { mode: 'silent', intent: 'none' },
      score: 0.4, threshold: 0.62, requiredResponse: false, reason: 'below ambient threshold',
    } },
    { ...base, type: 'action_chosen', model: 'A', seat: 0, action: 1, data: { move: 'roll' } },
    { ...base, type: 'communication_decision', model: 'B', seat: 1, action: 2, data: {
      proposed: { mode: 'speak', intent: 'reply', text: 'No deal.' },
      communication: { mode: 'speak', intent: 'reply', text: 'No deal.' },
      score: 1, threshold: 0.62, requiredResponse: true, reason: 'direct response',
    } },
    { ...base, type: 'communication_decision', model: 'B', seat: 1, action: 3, data: {
      proposed: { mode: 'silent', intent: 'none', privateReason: 'routine' },
      communication: { mode: 'silent', intent: 'none', privateReason: 'routine' },
      score: 0, threshold: 0.62, requiredResponse: false, reason: 'model chose silence',
    } },
    { ...base, game: 'poker', type: 'action_chosen', model: 'C', seat: 2, action: 4, data: { action: 'raise 80' } },
    { ...base, game: 'poker', type: 'communication_decision', model: 'C', seat: 2, action: 4, data: { decision: {
      proposed: { mode: 'speak', intent: 'banter', text: 'Pressure is on.' },
      communication: { mode: 'speak', intent: 'banter', text: 'Pressure is on.' },
      score: 0.8, threshold: 0.62, requiredResponse: false, reason: 'ambient threshold met',
    } } },
  ];
  const report = buildCommunicationReport(events);
  assert.deepEqual(
    { decisions: report.decisions, proposed: report.proposedSpeech, surfaced: report.surfacedSpeech, suppressed: report.suppressedSpeech, silence: report.modelSilence },
    { decisions: 4, proposed: 3, surfaced: 2, suppressed: 1, silence: 1 },
  );
  assert.equal(report.rows[0].move, 'roll');
  assert.equal(report.rows[3].move, 'raise 80');
  const formatted = formatCommunicationReport('run/0001', report);
  assert.match(formatted, /\[SUPPRESSED\].*roll/);
  assert.match(formatted, /\[SURFACED\]/);
  assert.doesNotMatch(formatted, /\[SILENT\]/);
  assert.match(formatCommunicationReport('run/0001', report, true), /\[SILENT\]/);
});
