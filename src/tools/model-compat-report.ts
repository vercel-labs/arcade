// Reproducible model-compatibility audit for the public catalog (AIG-183). For each
// selectable model it runs the REAL ModelPlayer fallback ladder once and records
// which rung produced a legal chess move — so the report says not just "does it
// work" but "how far down the ladder it had to go":
//
//   STRUCTURED  native structured output (Output.object) gave a legal move
//   TEXT        structured failed (no JSON schema support) → plain-text soft parse won
//   NORMALIZED  both deterministic rungs failed → the 2nd-LLM normalizer recovered it
//   FALLBACK    every rung failed → only a random legal move (last resort)
//   ACCESS      provider unreachable on this team (403 / no_providers_available)
//   TIMEOUT     hit the per-model deadline
//   ERROR       some other failure
//
// A single onAttempt trace drives the classification, so each model costs one
// ladder run (not a separate raw + player pass). Results are tied to model ID,
// UTC date, and the selected team, and written as markdown + JSON.
//
//   pnpm exec tsx src/tools/model-compat-report.ts [all|sweep|<creator>|<model>]
//   pnpm exec tsx src/tools/model-compat-report.ts all --team=<slug> --timeout=45
//   pnpm exec tsx src/tools/model-compat-report.ts all --no-normalize   # ladder w/o rung 4
//   pnpm exec tsx src/tools/model-compat-report.ts sweep --out=docs/model-compat
//
// Reuses Arcade's cached login + selected team; --team=<slug> switches (and persists).

import { writeFileSync } from 'node:fs';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { ChessState } from '../rules/chess/chess.ts';
import type { Move } from '../rules/chess/types.ts';
import { isFallbackRationale, ModelPlayer, FALLBACK_RATIONALE } from '../ai/model-player.ts';
import { classifyModelError } from '../ai/model-errors.ts';
import { creators, modelsFor, modelName, normalizerModel } from '../arcade/match/models.ts';
import { availableTeams, ensureCachedGatewayKey, useTeam, type Team } from '../auth/index.ts';

const CONCURRENCY = 6;
const timeoutArg = process.argv.find((a) => /^--timeout=\d+(?:\.\d+)?$/.test(a));
const TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split('=')[1]) * 1000 : 45_000;
const NO_NORMALIZE = process.argv.includes('--no-normalize');
const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
const OUT = outArg ?? 'docs/model-compat';

type Status = 'STRUCTURED' | 'TEXT' | 'NORMALIZED' | 'FALLBACK' | 'ACCESS' | 'TIMEOUT' | 'ERROR';
const STATUSES: Status[] = ['STRUCTURED', 'TEXT', 'NORMALIZED', 'FALLBACK', 'ACCESS', 'TIMEOUT', 'ERROR'];
// Whether each status counts as "the catalog can use this model" (produces a real,
// attributable move) — FALLBACK/ACCESS/TIMEOUT/ERROR do not.
const PLAYABLE: Record<Status, boolean> = { STRUCTURED: true, TEXT: true, NORMALIZED: true, FALLBACK: false, ACCESS: false, TIMEOUT: false, ERROR: false };

interface Row {
  id: string;
  name: string;
  status: Status;
  /** Whether the model emitted parseable structured output at all (schema support). */
  structured: 'yes' | 'no' | '—';
  move: string;
  ms: number;
  detail: string;
}

const startState = new ChessState();
const rawSchema = z.object({ move: z.string(), rationale: z.string() });
const rawPrompt = 'You are playing chess as White from the start position. Reply with one legal move in SAN (e.g. "e4") and a one-sentence rationale.';

// For a model whose whole ladder failed, ModelPlayer swallowed the underlying errors
// behind a random move. Do ONE bare structured call to recover the real reason so the
// report DIAGNOSES the fallback (e.g. an unsupported-schema 400, a max_tokens>context
// 400) instead of a useless "all rungs failed". Only called for the few failures.
async function rawReason(id: string): Promise<string> {
  try {
    await generateText({ model: id, abortSignal: AbortSignal.timeout(TIMEOUT_MS), output: Output.object({ schema: rawSchema }), prompt: rawPrompt });
    return 'ladder failed but a bare structured call succeeded (likely illegal/unparseable moves)';
  } catch (e) {
    const c = classifyModelError(e);
    const http = c.status ? `HTTP ${c.status} ` : '';
    const type = c.gatewayType ? `[${c.gatewayType}] ` : '';
    return `${http}${type}${c.message}`.slice(0, 180);
  }
}

async function audit(id: string, normalizer: string | undefined): Promise<Row> {
  const name = modelName(id);
  const state = new ChessState();
  const t0 = Date.now();
  // Track how each ladder rung resolved from ModelPlayer's own diagnostics.
  let structuredEmitted = false; // schema parsed (legal or illegal move) → structured output supported
  const legalRung: Record<'structured' | 'text' | 'normalize', boolean> = { structured: false, text: false, normalize: false };
  const player = new ModelPlayer<Move>({
    model: id,
    gameName: 'chess',
    maxRetries: 1,
    normalizer,
    onAttempt: (a) => {
      if (a.phase === 'structured' && a.result !== 'error') structuredEmitted = true;
      if (a.result === 'legal') legalRung[a.phase] = true;
    },
  });
  try {
    const { action, rationale } = await player.chooseAction(startState, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - t0;
    const structured: Row['structured'] = structuredEmitted ? 'yes' : 'no';
    if (legalRung.structured) return { id, name, status: 'STRUCTURED', structured, move: state.actionToString(action), ms, detail: '' };
    if (legalRung.text) return { id, name, status: 'TEXT', structured, move: state.actionToString(action), ms, detail: 'structured output unsupported; plain-text fallback' };
    if (legalRung.normalize) return { id, name, status: 'NORMALIZED', structured, move: state.actionToString(action), ms, detail: `recovered via ${normalizer}` };
    if (rationale === FALLBACK_RATIONALE.unavailable) return { id, name, status: 'ACCESS', structured: '—', move: '', ms, detail: 'restricted provider access on this team' };
    if (isFallbackRationale(rationale)) return { id, name, status: 'FALLBACK', structured, move: '', ms, detail: `all ladder rungs failed — ${await rawReason(id)}` };
    // A legal move with no rung flagged legal shouldn't happen, but record it safely.
    return { id, name, status: 'STRUCTURED', structured, move: state.actionToString(action), ms, detail: '' };
  } catch (e) {
    const ms = Date.now() - t0;
    const c = classifyModelError(e);
    const status: Status = c.kind === 'timeout' ? 'TIMEOUT' : c.kind === 'access' ? 'ACCESS' : 'ERROR';
    const http = c.status ? `HTTP ${c.status} ` : '';
    const type = c.gatewayType ? `[${c.gatewayType}] ` : '';
    return { id, name, status, structured: '—', move: '', ms, detail: `${http}${type}${c.message}`.slice(0, 160) };
  }
}

function targets(arg: string | undefined): string[] {
  if (!arg || arg === 'all') return creators().flatMap((c) => modelsFor(c.slug).map((m) => m.id));
  if (arg === 'sweep') return creators().map((c) => modelsFor(c.slug)[0]?.id).filter((x): x is string => Boolean(x));
  if (creators().some((c) => c.slug === arg)) return modelsFor(arg).map((m) => m.id);
  return [arg];
}

function toMarkdown(rows: Row[], meta: { team: Team; date: string; normalizer: string | undefined }): string {
  const by = (s: Status): number => rows.filter((r) => r.status === s).length;
  const playable = rows.filter((r) => PLAYABLE[r.status]).length;
  const lines: string[] = [];
  lines.push('# Arcade model compatibility report');
  lines.push('');
  lines.push(`_Generated ${meta.date} · team **${meta.team.name}** (${meta.team.slug}) · ${rows.length} models · normalizer: ${meta.normalizer ?? '(disabled)'}_`);
  lines.push('');
  lines.push('Each model ran the real chess `ModelPlayer` fallback ladder once from the start position. Status = the highest rung that produced a **legal, attributable** move.');
  lines.push('');
  lines.push('| status | meaning |');
  lines.push('| --- | --- |');
  lines.push('| `STRUCTURED` | native structured output (JSON schema) gave a legal move |');
  lines.push('| `TEXT` | no structured-output support → plain-text soft parse recovered the move |');
  lines.push('| `NORMALIZED` | both deterministic rungs failed → 2nd-LLM normalizer recovered it |');
  lines.push('| `FALLBACK` | every rung failed → random legal move only (last resort) |');
  lines.push('| `ACCESS` | provider unreachable on this team (403 / no_providers_available) |');
  lines.push('| `TIMEOUT` / `ERROR` | deadline / other failure |');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Playable (STRUCTURED + TEXT + NORMALIZED): ${playable} / ${rows.length}**`);
  for (const s of STATUSES) lines.push(`- ${s}: ${by(s)}`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| model | status | structured | move | ms | detail |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of [...rows].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.id.localeCompare(b.id))) {
    lines.push(`| \`${r.id}\` | ${r.status} | ${r.structured} | ${r.move} | ${r.ms} | ${r.detail.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const teamArg = process.argv.find((a) => a.startsWith('--team='))?.slice('--team='.length);
  let team: Team;
  if (teamArg) {
    const available = await availableTeams();
    const found = available?.teams.find((t) => t.slug === teamArg);
    if (!found) {
      console.error(`Vercel team not found in Arcade login: ${teamArg}. Run \`pnpm dev --login\` once.`);
      process.exit(1);
    }
    await useTeam(found);
    team = found;
  } else {
    const auth = await ensureCachedGatewayKey();
    if (!auth?.team) {
      console.error('No cached Arcade login/team. Run `pnpm dev --login` once, then retry.');
      process.exit(1);
    }
    team = auth.team;
  }

  const normalizer = NO_NORMALIZE ? undefined : normalizerModel();
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const ids = targets(arg);
  // A UTC calendar date, derived without Date.now()-style non-determinism concerns
  // (this is a report, run manually — a wall-clock stamp is exactly what we want).
  const date = new Date().toISOString().slice(0, 10);
  console.log(`auditing ${ids.length} model(s) · team ${team.name} (${team.slug}) · normalizer ${normalizer ?? '(disabled)'} · ${TIMEOUT_MS / 1000}s timeout\n`);

  const rows: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (next < ids.length) {
        const r = await audit(ids[next++], normalizer);
        rows.push(r);
        console.log(`${r.status.padEnd(11)} ${r.id.padEnd(42)} ${String(r.ms).padStart(6)}ms  ${r.move || r.detail}`);
      }
    }),
  );

  const md = toMarkdown(rows, { team, date, normalizer });
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), team: { name: team.name, slug: team.slug }, normalizer: normalizer ?? null, timeoutMs: TIMEOUT_MS, models: rows }, null, 2);
  writeFileSync(`${OUT}.md`, `${md}\n`);
  writeFileSync(`${OUT}.json`, `${json}\n`);
  const playable = rows.filter((r) => PLAYABLE[r.status]).length;
  console.log(`\nplayable ${playable}/${rows.length} — wrote ${OUT}.md and ${OUT}.json`);
}

main().catch((err) => {
  console.error('model-compat-report: could not prepare Arcade AI Gateway access —', (err as Error).message);
  process.exit(1);
});
