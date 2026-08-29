// Optional LIVE smoke test of a real model through AI Gateway. Reuses Arcade's
// cached Vercel login + selected team, then asks the default White model for one
// move on the start position and checks it's legal.
//
//   pnpm exec tsx src/tools/ai-smoke.ts            (uses anthropic/claude-sonnet-4.6)
//   pnpm exec tsx src/tools/ai-smoke.ts openai/gpt-5.4
import { ensureCachedGatewayKey } from '../auth/index.ts';
import { ChessState } from '../rules/chess/chess.ts';
import { ModelPlayer } from '../harness/model-player.ts';
import type { Move } from '../rules/chess/types.ts';

async function main(): Promise<void> {
  const auth = await ensureCachedGatewayKey();
  if (!auth?.team) {
    console.error('ai-smoke: no cached Arcade login/team. Run `pnpm dev --login` once.');
    process.exit(1);
  }
  const model = process.argv[2] || 'anthropic/claude-sonnet-4.6';
  const state = new ChessState();
  const player = new ModelPlayer<Move>({ model, gameName: 'chess' });
  console.log(`ai-smoke: using ${auth.team.name} (${auth.team.slug})`);
  console.log(`ai-smoke: asking ${model} for a move on the start position…`);
  const { action, rationale } = await player.chooseAction(state);
  const san = state.actionToString(action);
  const legal = state.legalActions().some((m) => m.from === action.from && m.to === action.to && m.promotion === action.promotion);
  console.log(`  → ${san}  (${rationale ?? 'no rationale'})`);
  console.log(legal ? 'ai-smoke: legal move ✓' : 'ai-smoke: ILLEGAL move ✗');
  process.exit(legal ? 0 : 1);
}

main().catch((err) => {
  console.error('ai-smoke: error —', (err as Error).message);
  process.exit(1);
});
