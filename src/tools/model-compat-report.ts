// Reproducible model-compatibility audit for the public catalog (AIG-183). For each
// selectable model it runs the REAL ModelPlayer fallback ladder once PER GAME (chess
// and poker) and records which rung produced a legal, attributable move — so the
// report says not just "does it work" but "how far down the ladder it had to go":
//
//   STRUCTURED  native structured output (Output.object) gave a legal move
//   TEXT        structured failed (no JSON schema support) → plain-text soft parse won
//   NORMALIZED  both deterministic rungs failed → the 2nd-LLM normalizer recovered it
//   FALLBACK    every rung failed → only a random legal move (last resort)
//   ACCESS      provider unreachable on this team (403 / no_providers_available)
//   TIMEOUT     hit the per-model deadline
//   ERROR       some other failure
//
// Results are tied to model ID, UTC date, and the selected team, and written to a
// PER-TEAM file `docs/model-compat.<team-slug>.json` so several teams can coexist and
// `model-compat-view.ts` can render a cross-team matrix (public vs team-exclusive).
// The view tool prints the human-readable report; this tool only produces the JSON.
//
//   pnpm models:audit [all|sweep|<creator>|<model>] [--team=<slug>]
//   pnpm models:audit all --game=chess           # one game only (default: both)
//   pnpm models:audit all --timeout=60 --out=docs # output dir (default: docs)
//
// Reuses Arcade's cached login + selected team; --team=<slug> switches (and persists).

import { writeFileSync } from 'node:fs';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { ChessState } from '../rules/chess/chess.ts';
import { HoldemState } from '../rules/poker/holdem.ts';
import type { GameState } from '../rules/game.ts';
import { isFallbackRationale, ModelPlayer, FALLBACK_RATIONALE, type MoveNotation } from '../ai/model-player.ts';
import { classifyModelError } from '../ai/model-errors.ts';
import { creators, modelsFor, modelName, normalizerModel } from '../arcade/match/models.ts';
import { availableTeams, ensureCachedGatewayKey, useTeam, type Team } from '../auth/index.ts';

const CONCURRENCY = 6;
const timeoutArg = process.argv.find((a) => /^--timeout=\d+(?:\.\d+)?$/.test(a));
const TIMEOUT_MS = timeoutArg ? Number(timeoutArg.split('=')[1]) * 1000 : 45_000;
const NO_NORMALIZE = process.argv.includes('--no-normalize');
const OUT_DIR = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? 'docs';
const gameArg = process.argv.find((a) => a.startsWith('--game='))?.slice('--game='.length);
const GAMES: GameKind[] = gameArg === 'chess' ? ['chess'] : gameArg === 'poker' ? ['poker'] : ['chess', 'poker'];

type GameKind = 'chess' | 'poker';
type Status = 'STRUCTURED' | 'TEXT' | 'NORMALIZED' | 'FALLBACK' | 'ACCESS' | 'TIMEOUT' | 'ERROR';

interface GameResult {
  status: Status;
  /** Whether the model emitted parseable structured output at all (schema support). */
  structured: 'yes' | 'no' | '—';
  move: string;
  ms: number;
  detail: string;
}
interface Row {
  id: string;
  name: string;
  chess?: GameResult;
  poker?: GameResult;
}

// Poker config mirrors src/arcade/match/poker-driver.ts (kept inline so this tool
// stays decoupled from the arcade scene graph). Split (speech) mode is used so the
// audit exercises the SAME private-reasoning / public-say path the app does.
const POKER_NOTATION: MoveNotation = {
  description: 'a poker action — one of "fold", "check", "call", "bet <amount>", "raise <amount>", or "allin" (amounts are TOTAL chips to put in this street)',
  examples: '"call", "raise 120", "fold", "allin"',
};
const POKER_PERSONA =
  "You are playing live no-limit Texas Hold'em against the other players at the table. " +
  'Anything you say out loud is heard by everyone, so do not reveal your own cards or hand strength unless you are bluffing.';
const POKER_SPEECH = 'a short line of live table talk in your own voice; never reveal your own cards or hand strength unless bluffing';

// A bare structured chess call, used only to DIAGNOSE a fallback (the ladder swallows
// the underlying provider errors). The reason is model-level, so chess suffices for
// either game's fallback.
const rawSchema = z.object({ move: z.string(), rationale: z.string() });
const rawPrompt = 'You are playing chess as White from the start position. Reply with one legal move in SAN (e.g. "e4") and a one-sentence rationale.';
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

function freshState(kind: GameKind): GameState<unknown> {
  if (kind === 'chess') return new ChessState() as unknown as GameState<unknown>;
  // Heads-up hand at the standard blinds — deals internally, so it opens on a real
  // decision node (preflop, first to act) with legal fold/call/raise/allin actions.
  return new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20 }) as unknown as GameState<unknown>;
}

async function auditGame(kind: GameKind, id: string, normalizer: string | undefined): Promise<GameResult> {
  const state = freshState(kind);
  const t0 = Date.now();
  let structuredEmitted = false; // schema parsed (legal or illegal move) → structured output supported
  const legalRung: Record<'structured' | 'text' | 'normalize', boolean> = { structured: false, text: false, normalize: false };
  const player = new ModelPlayer<unknown>({
    model: id,
    normalizer,
    maxRetries: 1,
    onAttempt: (a) => {
      if (a.phase === 'structured' && a.result !== 'error') structuredEmitted = true;
      if (a.result === 'legal') legalRung[a.phase] = true;
    },
    ...(kind === 'chess'
      ? { gameName: 'chess' }
      : { gameName: "no-limit Texas Hold'em poker", moveNotation: POKER_NOTATION, persona: POKER_PERSONA, speech: POKER_SPEECH }),
  });
  try {
    const { action, rationale } = await player.chooseAction(state, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - t0;
    const structured: GameResult['structured'] = structuredEmitted ? 'yes' : 'no';
    const move = state.actionToString(action);
    if (legalRung.structured) return { status: 'STRUCTURED', structured, move, ms, detail: '' };
    if (legalRung.text) return { status: 'TEXT', structured, move, ms, detail: 'structured output unsupported; plain-text fallback' };
    if (legalRung.normalize) return { status: 'NORMALIZED', structured, move, ms, detail: `recovered via ${normalizer}` };
    if (rationale === FALLBACK_RATIONALE.unavailable) return { status: 'ACCESS', structured: '—', move: '', ms, detail: 'restricted provider access on this team' };
    if (isFallbackRationale(rationale)) return { status: 'FALLBACK', structured, move: '', ms, detail: `all ladder rungs failed — ${await rawReason(id)}` };
    return { status: 'STRUCTURED', structured, move, ms, detail: '' };
  } catch (e) {
    const ms = Date.now() - t0;
    const c = classifyModelError(e);
    const status: Status = c.kind === 'timeout' ? 'TIMEOUT' : c.kind === 'access' ? 'ACCESS' : 'ERROR';
    const http = c.status ? `HTTP ${c.status} ` : '';
    const type = c.gatewayType ? `[${c.gatewayType}] ` : '';
    return { status, structured: '—', move: '', ms, detail: `${http}${type}${c.message}`.slice(0, 180) };
  }
}

async function auditModel(id: string, normalizer: string | undefined): Promise<Row> {
  const row: Row = { id, name: modelName(id) };
  if (GAMES.includes('chess')) row.chess = await auditGame('chess', id, normalizer);
  if (GAMES.includes('poker')) {
    // Access is provider-level: if chess couldn't reach the provider, poker can't either
    // — skip the call and reuse the diagnosis rather than pay another timeout.
    if (row.chess?.status === 'ACCESS') row.poker = { ...row.chess };
    else row.poker = await auditGame('poker', id, normalizer);
  }
  return row;
}

function targets(arg: string | undefined): string[] {
  if (!arg || arg === 'all') return creators().flatMap((c) => modelsFor(c.slug).map((m) => m.id));
  if (arg === 'sweep') return creators().map((c) => modelsFor(c.slug)[0]?.id).filter((x): x is string => Boolean(x));
  if (creators().some((c) => c.slug === arg)) return modelsFor(arg).map((m) => m.id);
  return [arg];
}

const cell = (r?: GameResult): string => (r ? `${r.status}${r.move ? ` ${r.move}` : ''}` : '—');

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
  console.log(`auditing ${ids.length} model(s) · games ${GAMES.join('+')} · team ${team.name} (${team.slug}) · normalizer ${normalizer ?? '(disabled)'} · ${TIMEOUT_MS / 1000}s timeout\n`);

  const rows: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (next < ids.length) {
        const r = await auditModel(ids[next++], normalizer);
        rows.push(r);
        console.log(`${r.id.padEnd(42)}  chess: ${cell(r.chess).padEnd(16)}  poker: ${cell(r.poker)}`);
      }
    }),
  );
  rows.sort((a, b) => a.id.localeCompare(b.id));

  const out = `${OUT_DIR}/model-compat.${team.slug}.json`;
  const json = {
    generatedAt: new Date().toISOString(),
    team: { name: team.name, slug: team.slug },
    normalizer: normalizer ?? null,
    timeoutMs: TIMEOUT_MS,
    games: GAMES,
    models: rows,
  };
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
  const playable = (g: GameKind): number => rows.filter((r) => ['STRUCTURED', 'TEXT', 'NORMALIZED'].includes(r[g]?.status ?? '')).length;
  console.log(`\nwrote ${out}`);
  for (const g of GAMES) console.log(`  ${g}: ${playable(g)}/${rows.length} playable`);
  console.log(`\nView it: pnpm models:report --team=${team.slug}   (or \`pnpm models:report\` for the cross-team matrix)`);
}

main().catch((err) => {
  console.error('model-compat-report: could not prepare Arcade AI Gateway access —', (err as Error).message);
  process.exit(1);
});
