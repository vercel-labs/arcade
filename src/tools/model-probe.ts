// Probe AI Gateway models the way the chess match does: ask for a structured
// move from the start position and classify the outcome. Surfaces the RAW result
// (unlike ModelPlayer, which hides failures behind a legal-move fallback), so you
// can tell access errors (403 no_providers_available → wrong team/key) from
// malformed structured output from models that just don't follow instructions.
//
//   pnpm exec tsx src/tools/model-probe.ts <model-id>     # one model, verbose
//   pnpm exec tsx src/tools/model-probe.ts <creator>      # all of a creator's models
//   pnpm exec tsx src/tools/model-probe.ts sweep          # first model per creator (fast)
//   pnpm exec tsx src/tools/model-probe.ts all            # every language model
//   pnpm exec tsx src/tools/model-probe.ts <model> --stream [--timeout=60]
//   pnpm exec tsx src/tools/model-probe.ts <model> --team=<team-slug>
//
// By default it runs the REAL ModelPlayer (structured output → plain-text soft-
// parse fallback), so a result of OK means the match can actually use the model
// (FALLBACK = every attempt failed → it would only play random moves). Add --raw
// to instead test the bare structured-output call and see the raw provider error
// (ERROR / MALFORMED), which is what diagnoses access vs output-format problems.
// Add --stream to test that same bare structured-output call as a stream. A single-model
// run prints text/reasoning chunks live; creator/sweep/all runs report TTFT + chunk counts.
// --timeout=N changes the per-model deadline in seconds (default 30).
// Uses Arcade's cached Vercel login and selected team by default. --team=<slug>
// selects another team from that login. Either path mints a fresh process-local
// key and ignores inherited AI_GATEWAY_API_KEY values.

import { generateText, Output, streamText } from 'ai';
import { z } from 'zod';
import { ChessState } from '../rules/chess/chess.ts';
import type { Move } from '../rules/chess/types.ts';
import { isFallbackRationale, ModelPlayer, FALLBACK_RATIONALE } from '../harness/model-player.ts';
import { classifyModelError, type FailureKind } from '../harness/model-errors.ts';
import { creators, modelsFor } from '../arcade/match/models.ts';
import { availableTeams, ensureCachedGatewayKey, useTeam } from '../auth/index.ts';

const CONCURRENCY = 6;
const timeoutArg = process.argv.find((a) => /^--timeout=\d+(?:\.\d+)?$/.test(a));
const TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split('=')[1]) * 1000 : 30_000;

const schema = z.object({
  move: z.string().describe('One move from the legal list, in SAN (e.g. "e4", "Nf3").'),
  rationale: z.string().describe('One short sentence.'),
});

const state = new ChessState();
const legalSan = state.legalActions().map((m) => state.actionToString(m));
const prompt =
  `You are playing chess as White from the standard start position.\n` +
  `Legal moves: ${legalSan.join(', ')}\n` +
  `Reply with exactly one move from that list (SAN) and a one-sentence rationale.`;

// ACCESS is split out from ERROR so the report distinguishes "this team can't reach
// the provider" (a provisioning/team matter) from "the model or provider is broken"
// and from MALFORMED ("the model can't emit structured output") — the distinction
// AIG-183's compatibility audit needs.
type Status = 'OK' | 'FALLBACK' | 'ILLEGAL' | 'MALFORMED' | 'ACCESS' | 'ERROR' | 'TIMEOUT';
interface Result {
  id: string;
  status: Status;
  detail: string;
  ms: number;
  stream?: StreamStats;
}

const RAW = process.argv.includes('--raw');
const STREAM = process.argv.includes('--stream');

interface StreamStats {
  firstEventMs: number | null;
  firstTextMs: number | null;
  firstReasoningMs: number | null;
  textChunks: number;
  textChars: number;
  reasoningChunks: number;
  reasoningChars: number;
}

// End-to-end: run the real ModelPlayer (structured → text fallback). OK = a real
// move; FALLBACK = every attempt failed (would only play random moves).
async function probePlayer(id: string): Promise<Result> {
  const t0 = Date.now();
  try {
    const player = new ModelPlayer<Move>({ model: id, gameName: 'chess', maxRetries: 1 });
    const { action, rationale } = await player.chooseAction(state, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - t0;
    // A diagnosed fallback means every rung failed. Report the "unavailable" reason as
    // ACCESS (the team can't reach the provider) rather than a generic FALLBACK.
    if (rationale === FALLBACK_RATIONALE.unavailable) return { id, status: 'ACCESS', detail: 'restricted provider access on this team', ms };
    if (isFallbackRationale(rationale)) return { id, status: 'FALLBACK', detail: 'all attempts failed', ms };
    return { id, status: 'OK', detail: state.actionToString(action), ms };
  } catch (e) {
    return classifyError(id, e, Date.now() - t0);
  }
}

// Raw: the bare structured-output call, to see the provider's actual error.
async function probeRaw(id: string): Promise<Result> {
  const t0 = Date.now();
  try {
    const { output } = await generateText({ model: id, abortSignal: AbortSignal.timeout(TIMEOUT_MS), output: Output.object({ schema }), prompt });
    const ms = Date.now() - t0;
    const legal = state.actionFromString(output.move) !== null;
    return { id, status: legal ? 'OK' : 'ILLEGAL', detail: output.move, ms };
  } catch (e) {
    return classifyError(id, e, Date.now() - t0);
  }
}

// Stream the exact structured chess response used by the raw probe. `fullStream`
// separates provider-exposed reasoning from output text, so the report shows what a
// model/provider actually makes observable. Reasoning is never inferred from silence:
// no reasoning chunks means only that the provider did not expose them.
async function probeStream(id: string, verbose: boolean): Promise<Result> {
  const t0 = Date.now();
  const stats: StreamStats = {
    firstEventMs: null,
    firstTextMs: null,
    firstReasoningMs: null,
    textChunks: 0,
    textChars: 0,
    reasoningChunks: 0,
    reasoningChars: 0,
  };
  let traceChannel: 'text' | 'reasoning' | null = null;
  const trace = (channel: 'text' | 'reasoning', text: string): void => {
    if (!verbose) return;
    if (traceChannel !== channel) {
      process.stdout.write(`${traceChannel === null ? '' : '\n'}  [${channel} @ ${Date.now() - t0}ms]\n  `);
      traceChannel = channel;
    }
    process.stdout.write(text.replace(/\n/g, '\n  '));
  };

  try {
    if (verbose) console.log(`STREAM  ${id}`);
    const result = streamText({
      model: id,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      output: Output.object({ schema }),
      prompt,
      // `fullStream` carries the error event that we classify below. Suppress the SDK's
      // default console dump so a provider rejection stays a single compact probe row.
      onError: () => {},
    });
    for await (const part of result.fullStream) {
      const elapsed = Date.now() - t0;
      if (part.type === 'text-start' || part.type === 'reasoning-start' || part.type === 'text-delta' || part.type === 'reasoning-delta') {
        stats.firstEventMs ??= elapsed;
      }
      if (part.type === 'text-delta') {
        stats.firstTextMs ??= elapsed;
        stats.textChunks++;
        stats.textChars += part.text.length;
        trace('text', part.text);
      } else if (part.type === 'reasoning-delta') {
        stats.firstReasoningMs ??= elapsed;
        stats.reasoningChunks++;
        stats.reasoningChars += part.text.length;
        trace('reasoning', part.text);
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
    if (verbose && traceChannel !== null) process.stdout.write('\n');
    const output = await result.output;
    const ms = Date.now() - t0;
    const legal = state.actionFromString(output.move) !== null;
    return { id, status: legal ? 'OK' : 'ILLEGAL', detail: output.move, ms, stream: stats };
  } catch (e) {
    if (verbose && traceChannel !== null) process.stdout.write('\n');
    return { ...classifyError(id, e, Date.now() - t0), stream: stats };
  }
}

// Map the shared classifier's kind onto a probe status. `classifyModelError` walks
// the gateway's cause chain, so an access error surfaces its real HTTP 403 +
// `no_providers_available` type instead of being lumped into a generic ERROR.
const KIND_STATUS: Record<FailureKind, Status> = {
  timeout: 'TIMEOUT',
  access: 'ACCESS',
  schema: 'MALFORMED',
  transient: 'ERROR',
  unknown: 'ERROR',
};
function classifyError(id: string, e: unknown, ms: number): Result {
  const c = classifyModelError(e);
  if (c.kind === 'timeout') return { id, status: 'TIMEOUT', detail: `${TIMEOUT_MS / 1000}s`, ms };
  const http = c.status ? `HTTP ${c.status} ` : '';
  const type = c.gatewayType ? `[${c.gatewayType}] ` : '';
  return { id, status: KIND_STATUS[c.kind], detail: `${http}${type}${c.message}`.slice(0, 160), ms };
}

function targets(arg: string | undefined): string[] {
  if (!arg || arg === 'all') return creators().flatMap((c) => modelsFor(c.slug).map((m) => m.id));
  if (arg === 'sweep') return creators().map((c) => modelsFor(c.slug)[0]?.id).filter((x): x is string => Boolean(x));
  if (creators().some((c) => c.slug === arg)) return modelsFor(arg).map((m) => m.id);
  return [arg];
}

function streamDetail(s: StreamStats): string {
  const fmt = (n: number | null): string => (n === null ? 'none' : `${n}ms`);
  return `first ${fmt(s.firstEventMs)}, text ${s.textChunks}/${s.textChars}c @ ${fmt(s.firstTextMs)}, reasoning ${s.reasoningChunks}/${s.reasoningChars}c @ ${fmt(s.firstReasoningMs)}`;
}

const MARK: Record<Status, string> = { OK: 'OK      ', FALLBACK: 'FALLBACK', ILLEGAL: 'ILLEGAL ', MALFORMED: 'MALFORM ', ACCESS: 'ACCESS  ', ERROR: 'ERROR   ', TIMEOUT: 'TIMEOUT ' };
const STATUSES: Status[] = ['OK', 'FALLBACK', 'ILLEGAL', 'MALFORMED', 'ACCESS', 'ERROR', 'TIMEOUT'];

async function main(): Promise<void> {
  const teamArg = process.argv.find((a) => a.startsWith('--team='))?.slice('--team='.length);
  if (teamArg) {
    const available = await availableTeams();
    if (!available) {
      console.error('No cached Arcade login. Run `pnpm dev --login` once, then retry this probe.');
      process.exit(1);
    }
    const team = available.teams.find((t) => t.slug === teamArg);
    if (!team) {
      console.error(`Vercel team not found in Arcade login: ${teamArg}`);
      process.exit(1);
    }
    await useTeam(team); // deliberately replaces an inherited/env-file key in this process
    console.log(`using freshly minted AI Gateway key for ${team.name} (${team.slug})`);
  } else {
    const auth = await ensureCachedGatewayKey();
    if (!auth?.team) {
      console.error('No cached Arcade login/team. Run `pnpm dev --login` once, then retry this probe.');
      process.exit(1);
    }
    console.log(`using Arcade login for ${auth.team.name} (${auth.team.slug})`);
  }
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const ids = targets(arg);
  const verbose = STREAM && (ids.length === 1 || process.argv.includes('--verbose'));
  const concurrency = verbose ? 1 : CONCURRENCY;
  const mode = STREAM ? 'streamed structured call' : RAW ? 'raw structured call' : 'ModelPlayer (structured → text fallback)';
  const probe = (id: string): Promise<Result> => (STREAM ? probeStream(id, verbose) : RAW ? probeRaw(id) : probePlayer(id));
  console.log(`probing ${ids.length} model(s) via ${mode} — concurrency ${concurrency}, ${TIMEOUT_MS / 1000}s timeout\n`);

  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (next < ids.length) {
        const r = await probe(ids[next++]);
        results.push(r);
        const streaming = r.stream ? `  ${streamDetail(r.stream)}` : '';
        console.log(`${MARK[r.status]} ${r.id.padEnd(40)} ${String(r.ms).padStart(6)}ms  ${r.detail}${streaming}`);
      }
    }),
  );

  const by = (s: Status): Result[] => results.filter((r) => r.status === s);
  console.log('\n── summary ──');
  for (const s of STATUSES) console.log(`  ${MARK[s].trim().padEnd(9)} ${by(s).length}`);
  const broken = [...by('FALLBACK'), ...by('ACCESS'), ...by('ERROR'), ...by('TIMEOUT'), ...by('MALFORMED'), ...by('ILLEGAL')];
  if (broken.length) {
    console.log('\n── not usable ──');
    for (const r of broken) console.log(`  ${r.id.padEnd(40)} ${r.status}: ${r.detail}`);
  }
}

main().catch((err) => {
  console.error('model-probe: could not prepare Arcade AI Gateway access —', (err as Error).message);
  process.exit(1);
});
