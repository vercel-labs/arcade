import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CommunicationDecision } from '../../harness/communication/types.ts';
import type { MatchLabEvent } from './types.ts';

export interface CommunicationReportRow {
  action: number;
  model: string;
  move?: string;
  decision: CommunicationDecision;
}

export interface CommunicationReport {
  decisions: number;
  proposedSpeech: number;
  surfacedSpeech: number;
  suppressedSpeech: number;
  modelSilence: number;
  rows: CommunicationReportRow[];
  byModel: Record<string, { decisions: number; proposedSpeech: number; surfacedSpeech: number; suppressedSpeech: number; modelSilence: number }>;
}

export function buildCommunicationReport(events: readonly MatchLabEvent[]): CommunicationReport {
  const moves = new Map<number, string>();
  for (const event of events) {
    if (event.type !== 'action_chosen' || event.action === undefined || !event.data || typeof event.data !== 'object') continue;
    const data = event.data as { move?: unknown; san?: unknown; action?: unknown };
    const move = data.move ?? data.san ?? data.action;
    if (typeof move === 'string') moves.set(event.action, move);
  }
  const rows: CommunicationReportRow[] = [];
  for (const event of events) {
    if (event.type !== 'communication_decision' || event.action === undefined || !event.model) continue;
    rows.push({
      action: event.action,
      model: event.model,
      ...(moves.has(event.action) ? { move: moves.get(event.action)! } : {}),
      decision: ((event.data as { decision?: CommunicationDecision })?.decision ?? event.data) as CommunicationDecision,
    });
  }
  const byModel: CommunicationReport['byModel'] = {};
  for (const row of rows) {
    const current = byModel[row.model] ?? { decisions: 0, proposedSpeech: 0, surfacedSpeech: 0, suppressedSpeech: 0, modelSilence: 0 };
    current.decisions++;
    if (row.decision.proposed.mode === 'speak') {
      current.proposedSpeech++;
      if (row.decision.communication.mode === 'speak') current.surfacedSpeech++;
      else current.suppressedSpeech++;
    } else {
      current.modelSilence++;
    }
    byModel[row.model] = current;
  }
  return {
    decisions: rows.length,
    proposedSpeech: rows.filter((row) => row.decision.proposed.mode === 'speak').length,
    surfacedSpeech: rows.filter((row) => row.decision.communication.mode === 'speak').length,
    suppressedSpeech: rows.filter((row) => row.decision.proposed.mode === 'speak' && row.decision.communication.mode !== 'speak').length,
    modelSilence: rows.filter((row) => row.decision.proposed.mode === 'silent').length,
    rows,
    byModel,
  };
}

function parseTrace(path: string): MatchLabEvent[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as MatchLabEvent);
}

function tracePaths(input: string): string[] {
  const path = resolve(input);
  if (!statSync(path).isDirectory()) return [path];
  const matches = join(path, 'matches');
  return readdirSync(matches, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(matches, entry.name, 'trace.jsonl'));
}

export function formatCommunicationReport(label: string, report: CommunicationReport, includeSilence = false): string {
  const lines = [
    label,
    `decisions ${report.decisions} | proposed ${report.proposedSpeech} | surfaced ${report.surfacedSpeech} | suppressed ${report.suppressedSpeech} | model silence ${report.modelSilence}`,
  ];
  for (const [model, counts] of Object.entries(report.byModel)) {
    lines.push(`  ${model}: ${counts.surfacedSpeech}/${counts.proposedSpeech} surfaced, ${counts.suppressedSpeech} suppressed, ${counts.modelSilence} silent`);
  }
  for (const row of report.rows) {
    const proposal = row.decision.proposed;
    if (!includeSilence && proposal.mode === 'silent') continue;
    const status = proposal.mode === 'silent'
      ? 'SILENT'
      : row.decision.communication.mode === 'speak'
        ? 'SURFACED'
        : 'SUPPRESSED';
    lines.push(`  [${status}] #${row.action} ${row.model}${row.move ? ` — ${row.move}` : ''}`);
    if (proposal.mode === 'speak') lines.push(`    ${proposal.intent}: ${proposal.text}`);
    lines.push(`    Arcade: ${row.decision.reason} (score ${row.decision.score.toFixed(2)}, threshold ${row.decision.threshold.toFixed(2)})`);
    if (proposal.privateReason) lines.push(`    private: ${proposal.privateReason}`);
  }
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const includeSilence = args.includes('--all');
  const inputs = args.filter((arg) => arg !== '--' && arg !== '--all');
  if (!inputs.length) {
    console.error('Usage: pnpm match:comms -- [--all] .runs/<run> [...]');
    process.exitCode = 1;
    return;
  }
  for (const input of inputs) {
    for (const trace of tracePaths(input)) {
      const label = `${basename(resolve(input))}/${basename(join(trace, '..'))}`;
      console.log(formatCommunicationReport(label, buildCommunicationReport(parseTrace(trace)), includeSilence));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
