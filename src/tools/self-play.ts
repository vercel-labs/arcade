// Run a real AI-vs-AI game on the terminal and trace every move so you can see
// exactly why a model falls back to a random legal move. For each ply it prints
// the chosen move, and for any failed generation attempt the raw model output +
// how it resolved (structured/text · legal/illegal/error). A ⚠ marks a ply that
// exhausted all attempts and played a random legal move.
//
//   pnpm exec tsx src/tools/self-play.ts [white-slug] [black-slug] [maxPlies]
//   pnpm exec tsx src/tools/self-play.ts anthropic/claude-3-haiku openai/gpt-5.4-nano 16
//
// Needs AI_GATEWAY_API_KEY (from .env.local).
import { loadEnv } from '../ai/env.ts';

loadEnv();

import { ChessState } from '../games/chess/chess.ts';
import { ModelPlayer } from '../ai/model-player.ts';
import type { Move } from '../games/chess/types.ts';

const FALLBACK_NOTE = '(no valid reply — fell back to a legal move)';
const illegal = process.argv.includes('--illegal'); // apply moves with no rules
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const whiteSlug = pos[0] || 'anthropic/claude-3-haiku';
const blackSlug = pos[1] || 'openai/gpt-5.4-nano';
const maxPlies = Number(pos[2]) || 30;

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY not set (cp .env.example .env.local and add a key)');
  process.exit(1);
}

type Attempt = { phase: 'structured' | 'text'; raw: string; result: 'legal' | 'illegal' | 'error' };
let attempts: Attempt[] = [];
const onAttempt = (a: Attempt): void => {
  attempts.push(a);
};

const players = [
  new ModelPlayer<Move>({ model: whiteSlug, gameName: 'chess', maxRetries: 2, onAttempt, allowIllegal: () => illegal }),
  new ModelPlayer<Move>({ model: blackSlug, gameName: 'chess', maxRetries: 2, onAttempt, allowIllegal: () => illegal }),
];

async function main(): Promise<void> {
  console.log(`White: ${whiteSlug}\nBlack: ${blackSlug}${illegal ? '\nillegal moves: ALLOWED (no rules)' : ''}\n`);
  const state = new ChessState();
  const sans: string[] = [];
  let fallbacks = 0;

  for (let ply = 0; ply < maxPlies && !state.isTerminal(); ply++) {
    const side = state.currentPlayer();
    attempts = [];
    const { action, rationale } = await players[side].chooseAction(state);
    const san = state.actionToString(action);
    const fellBack = rationale === FALLBACK_NOTE;
    if (fellBack) fallbacks++;

    const num = `${Math.floor(ply / 2) + 1}${side === 0 ? '.' : '...'}`;
    console.log(`${num.padEnd(5)} ${san.padEnd(8)} [${players[side].name}]${fellBack ? '  ⚠ FALLBACK → random legal move' : ''}`);
    // Show the attempts that didn't resolve to a legal move (the interesting ones).
    for (const a of attempts) {
      if (a.result === 'legal') continue;
      console.log(`        ${a.phase}/${a.result}: ${a.raw.slice(0, 110)}`);
    }

    sans.push(san);
    state.applyAction(action);
  }

  // PGN movetext + result.
  let pgn = '';
  for (let i = 0; i < sans.length; i += 2) pgn += `${i / 2 + 1}. ${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ''} `;
  const r = state.result();
  const token = !r ? '*' : r.winner === null ? '1/2-1/2' : r.winner === 0 ? '1-0' : '0-1';
  console.log(`\nPGN: ${pgn.trim()} ${token}`);
  console.log(`\nplies: ${sans.length}   fallbacks: ${fallbacks}   terminal: ${state.isTerminal()}${r ? ` (${r.reason})` : ''}`);
}

main();
