// Probe AI Gateway models the way the chess match does: ask for a structured
// move from the start position and classify the outcome. Surfaces the RAW result
// (unlike ModelPlayer, which hides failures behind a legal-move fallback), so you
// can tell access errors (403 no_providers_available → wrong team/key) from
// malformed structured output from models that just don't follow instructions.
//
//   pnpm exec tsx src/tools/model-probe.ts <model-id>     # one model, verbose
//   pnpm exec tsx src/tools/model-probe.ts <provider>     # all of a provider's models
//   pnpm exec tsx src/tools/model-probe.ts sweep          # first model per provider (fast)
//   pnpm exec tsx src/tools/model-probe.ts all            # every language model
//
// By default it runs the REAL ModelPlayer (structured output → plain-text soft-
// parse fallback), so a result of OK means the match can actually use the model
// (FALLBACK = every attempt failed → it would only play random moves). Add --raw
// to instead test the bare structured-output call and see the raw provider error
// (ERROR / MALFORMED), which is what diagnoses access vs output-format problems.
//
// Needs AI_GATEWAY_API_KEY (from .env.local). Try a key from the
// ai-gateway-early-access-models team to reach internal-only providers.
import { loadEnv } from '../ai/env.ts';

loadEnv();

import { APICallError, generateText, Output } from 'ai';
import { z } from 'zod';
import { ChessState } from '../games/chess/chess.ts';
import type { Move } from '../games/chess/types.ts';
import { ModelPlayer } from '../ai/model-player.ts';
import { modelsFor, providers } from '../arcade/models.ts';

const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;

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

type Status = 'OK' | 'FALLBACK' | 'ILLEGAL' | 'MALFORMED' | 'ERROR' | 'TIMEOUT';
interface Result {
  id: string;
  status: Status;
  detail: string;
  ms: number;
}

const RAW = process.argv.includes('--raw');
const FALLBACK_NOTE = '(no valid reply — fell back to a legal move)';

// End-to-end: run the real ModelPlayer (structured → text fallback). OK = a real
// move; FALLBACK = every attempt failed (would only play random moves).
async function probePlayer(id: string): Promise<Result> {
  const t0 = Date.now();
  try {
    const player = new ModelPlayer<Move>({ model: id, gameName: 'chess', maxRetries: 1 });
    const { action, rationale } = await player.chooseAction(state, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - t0;
    if (rationale === FALLBACK_NOTE) return { id, status: 'FALLBACK', detail: 'all attempts failed', ms };
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

function classifyError(id: string, e: unknown, ms: number): Result {
  const err = e as { name?: string; message?: string; statusCode?: number; responseBody?: string };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return { id, status: 'TIMEOUT', detail: `${TIMEOUT_MS / 1000}s`, ms };
  if (APICallError.isInstance(e)) {
    const body = (err.responseBody ?? err.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return { id, status: 'ERROR', detail: `HTTP ${err.statusCode ?? '?'} ${body}`, ms };
  }
  const malformed = (err.name ?? '').includes('Object') || /object|schema|parse|json/i.test(err.message ?? '');
  return { id, status: malformed ? 'MALFORMED' : 'ERROR', detail: (err.message ?? String(e)).replace(/\s+/g, ' ').slice(0, 140), ms };
}

const probe = (id: string): Promise<Result> => (RAW ? probeRaw(id) : probePlayer(id));

function targets(arg: string | undefined): string[] {
  if (!arg || arg === 'all') return providers().flatMap((p) => modelsFor(p.slug).map((m) => m.id));
  if (arg === 'sweep') return providers().map((p) => modelsFor(p.slug)[0]?.id).filter((x): x is string => Boolean(x));
  if (providers().some((p) => p.slug === arg)) return modelsFor(arg).map((m) => m.id);
  return [arg];
}

const MARK: Record<Status, string> = { OK: 'OK      ', FALLBACK: 'FALLBACK', ILLEGAL: 'ILLEGAL ', MALFORMED: 'MALFORM ', ERROR: 'ERROR   ', TIMEOUT: 'TIMEOUT ' };
const STATUSES: Status[] = ['OK', 'FALLBACK', 'ILLEGAL', 'MALFORMED', 'ERROR', 'TIMEOUT'];

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('AI_GATEWAY_API_KEY not set (cp .env.example .env.local and add a key)');
    process.exit(1);
  }
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const ids = targets(arg);
  console.log(`probing ${ids.length} model(s) via ${RAW ? 'raw structured call' : 'ModelPlayer (structured → text fallback)'} — concurrency ${CONCURRENCY}, ${TIMEOUT_MS / 1000}s timeout\n`);

  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (next < ids.length) {
        const r = await probe(ids[next++]);
        results.push(r);
        console.log(`${MARK[r.status]} ${r.id.padEnd(40)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
      }
    }),
  );

  const by = (s: Status): Result[] => results.filter((r) => r.status === s);
  console.log('\n── summary ──');
  for (const s of STATUSES) console.log(`  ${MARK[s].trim().padEnd(9)} ${by(s).length}`);
  const broken = [...by('FALLBACK'), ...by('ERROR'), ...by('TIMEOUT'), ...by('MALFORMED'), ...by('ILLEGAL')];
  if (broken.length) {
    console.log('\n── not usable ──');
    for (const r of broken) console.log(`  ${r.id.padEnd(40)} ${r.status}: ${r.detail}`);
  }
}

main();
