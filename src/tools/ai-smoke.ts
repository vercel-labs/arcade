// Optional LIVE smoke test of a real model through AI Gateway. Gated on
// AI_GATEWAY_API_KEY — skips cleanly (exit 0) when no key is set, so it's safe to
// run anywhere. Asks the default White model for one move on the start position
// and checks it's legal.
//
//   pnpm exec tsx src/tools/ai-smoke.ts            (uses anthropic/claude-sonnet-4.6)
//   pnpm exec tsx src/tools/ai-smoke.ts openai/gpt-5.4
import { loadEnv } from '../auth/env.ts';
import { ChessState } from '../games/chess/chess.ts';
import { ModelPlayer } from '../ai/model-player.ts';
import type { Move } from '../games/chess/types.ts';

loadEnv();

async function main(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.log('ai-smoke: AI_GATEWAY_API_KEY not set — skipped. (cp .env.example .env.local and add a key)');
    return;
  }
  const model = process.argv[2] || 'anthropic/claude-sonnet-4.6';
  const state = new ChessState();
  const player = new ModelPlayer<Move>({ model, gameName: 'chess' });
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
