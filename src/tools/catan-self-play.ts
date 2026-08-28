// Run the default four-seat Catan spectate lineup without the TUI and print an
// inspectable transcript. Setup-only is the safe default (16 model decisions);
// `--full` continues through regular turns with an action safety bound.
//
//   pnpm catan:self-play
//   pnpm catan:self-play -- --seed=123 --json
//   pnpm catan:self-play -- --full --max-actions=300 --timeout=900
//
// Reuses Arcade's cached Vercel login and selected team. No key is read from or
// printed to the terminal.

import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { MatchScene } from '../ai/match.ts';
import type { Player } from '../ai/player.ts';
import { ensureCachedGatewayKey } from '../auth/index.ts';
import { CATAN_DEFAULT_AI_SEATS } from '../arcade/match/catan-defaults.ts';
import {
  CatanMatchActionLimitError,
  createCatanModelPlayer,
  createCatanSetupModelPlayer,
  runCatanInitialPlacement,
  runCatanMatch,
} from '../arcade/match/catan-setup.ts';
import { shortModel } from '../arcade/match/model-label.ts';
import { normalizerModel } from '../arcade/match/models.ts';
import { NUM_EDGES, NUM_NODES } from '../rules/catan/board-topology.ts';
import { CatanState, type InitialSettlementOption } from '../rules/catan/catan.ts';
import {
  PLAYER_COLORS,
  RESOURCES,
  resourceIndex,
  type CatanAction,
  type Resource,
} from '../rules/catan/types.ts';

interface TranscriptEntry {
  action: number;
  seat: number;
  color: string;
  model: string;
  prompt: string;
  move: string;
  rationale?: string;
  resolution?: string;
  startingResources?: Resource[];
  handAfter: Record<Resource, number>;
  outcome?: unknown;
}

class HeadlessCatanScene implements MatchScene<CatanAction> {
  constructor(private readonly game: CatanState) {}

  state(): CatanState {
    return this.game;
  }

  async playMove(action: CatanAction): Promise<void> {
    this.game.applyAction(action);
  }
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveNumber(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`--${name} must be positive`);
  return value;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function resourceCounts(deck: readonly number[]): Record<Resource, number> {
  return Object.fromEntries(
    RESOURCES.map((resource) => [resource, deck[resourceIndex(resource)] ?? 0]),
  ) as Record<Resource, number>;
}

function resourceList(resources: readonly Resource[]): string {
  return resources.length > 0 ? resources.join(', ') : 'none';
}

function settlementOption(state: CatanState, action: CatanAction): InitialSettlementOption | undefined {
  if (action.type !== 'initialSettlement') return undefined;
  return state.initialSettlementOptions().find((option) => option.node === action.node);
}

function printSummary(state: CatanState, models: readonly string[]): void {
  console.log('\nFinal public table');
  for (let seat = 0; seat < models.length; seat++) {
    let buildings = 0;
    let roads = 0;
    for (let node = 0; node < NUM_NODES; node++) if (state.buildingAt(node)?.player === seat) buildings++;
    for (let edge = 0; edge < NUM_EDGES; edge++) if (state.roadAt(edge) === seat) roads++;
    const cards = resourceCounts(state.handOf(seat));
    console.log(
      `${seat + 1}. ${PLAYER_COLORS[seat]} ${shortModel(models[seat])}: `
      + `${state.victoryPoints(seat, false)} public VP, ${buildings} buildings, ${roads} roads, `
      + `${Object.values(cards).reduce((sum, count) => sum + count, 0)} resource cards`,
    );
    console.log(`   observer hand: ${JSON.stringify(cards)}`);
  }
  console.log(`Bank: ${JSON.stringify(resourceCounts(state.bankDeck()))}`);
  const conserved = Object.fromEntries(RESOURCES.map((resource) => {
    const index = resourceIndex(resource);
    const total = state.bankDeck()[index]
      + Array.from({ length: models.length }, (_, seat) => state.handOf(seat)[index])
        .reduce((sum, count) => sum + count, 0);
    return [resource, total];
  }));
  console.log(`Resource conservation: ${JSON.stringify(conserved)} (expected 19 each)`);
}

function usage(): void {
  console.log(`Catan model observer

Usage:
  pnpm catan:self-play
  pnpm catan:self-play -- --seed=123 --json
  pnpm catan:self-play -- --full --max-actions=300 --timeout=900

Options:
  --full               Continue past setup into regular turns
  --max-actions=N      Full-game safety bound (default 300)
  --timeout=N          Overall timeout in seconds (default 600)
  --seed=N             Deterministic board/dice seed (default 828324)
  --json[=PATH]        Save the structured transcript (default .snapshots/catan-self-play.json)`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const full = process.argv.includes('--full');
  const seed = Math.floor(positiveNumber('seed', 0xca3a4));
  const timeoutSeconds = positiveNumber('timeout', 600);
  const maxActions = Math.floor(positiveNumber('max-actions', 300));
  const jsonFlag = process.argv.slice(2).find((arg) => arg === '--json' || arg.startsWith('--json='));
  const jsonPath = jsonFlag
    ? resolve(jsonFlag.includes('=') ? jsonFlag.slice(jsonFlag.indexOf('=') + 1) : '.snapshots/catan-self-play.json')
    : null;

  const auth = await ensureCachedGatewayKey();
  if (!auth?.team) throw new Error('no cached Arcade login/team. Run `pnpm dev --login` once.');

  const models = CATAN_DEFAULT_AI_SEATS.map((seat) => seat.model);
  const labels = models.map(shortModel);
  const state = new CatanState({
    numPlayers: 4,
    seatNames: labels,
    domesticTrade: true,
    domesticTradeOfferLimit: 3,
    rng: mulberry32(seed),
  });
  const scene = new HeadlessCatanScene(state);
  const normalizer = normalizerModel();
  const players: Player<CatanAction>[] = models.map((model, seat) =>
    full
      ? createCatanModelPlayer({ model, name: labels[seat], normalizer })
      : createCatanSetupModelPlayer({ model, name: labels[seat], normalizer }),
  );
  const transcript: TranscriptEntry[] = [];
  let pendingSettlement: InitialSettlementOption | undefined;
  let pendingPrompt = '';
  const signal = AbortSignal.timeout(timeoutSeconds * 1_000);

  console.log(`AI Gateway team: ${auth.team.name} (${auth.team.slug})`);
  console.log(`Mode: ${full ? `full game (max ${maxActions} actions)` : 'initial placement only'}`);
  console.log(`Seed: ${seed}`);
  for (let seat = 0; seat < models.length; seat++) {
    console.log(`Seat ${seat + 1} (${PLAYER_COLORS[seat]}): ${models[seat]}`);
  }
  console.log('');

  const hooks = {
    signal,
    onThinking: (_player: Player<CatanAction>, seat: number) => {
      const prompt = state.currentPrompt().kind;
      console.log(`thinking  ${seat + 1}/${PLAYER_COLORS[seat]} ${shortModel(models[seat])} — ${prompt}`);
    },
    onCommentary: (text: string, _player: Player<CatanAction>, seat: number) => {
      console.log(`chat      ${shortModel(models[seat])}: ${text}`);
    },
    onActionChosen: ({ choice }: { choice: { action: CatanAction } }) => {
      pendingPrompt = state.currentPrompt().kind;
      pendingSettlement = settlementOption(state, choice.action);
    },
    onActionApplied: ({ playerIndex, choice }: {
      playerIndex: number;
      choice: Awaited<ReturnType<Player<CatanAction>['chooseAction']>>;
    }) => {
      const move = state.actionToString(choice.action);
      const record = state.actionRecords().at(-1);
      const entry: TranscriptEntry = {
        action: transcript.length + 1,
        seat: playerIndex,
        color: PLAYER_COLORS[playerIndex],
        model: models[playerIndex],
        prompt: pendingPrompt,
        move,
        rationale: choice.rationale,
        resolution: choice.diagnostics?.resolution,
        startingResources: pendingSettlement?.portfolio.startingResources,
        handAfter: resourceCounts(state.handOf(playerIndex)),
        outcome: record?.outcome,
      };
      transcript.push(entry);
      const start = entry.startingResources?.length
        ? `; starting cards: ${resourceList(entry.startingResources)}`
        : '';
      console.log(
        `action ${String(entry.action).padStart(3)}  ${shortModel(entry.model)} → ${move}`
        + `${entry.resolution ? ` [${entry.resolution}]` : ''}${start}`,
      );
      pendingSettlement = undefined;
      pendingPrompt = '';
    },
  };

  let stopReason = 'setup complete';
  let runError: unknown;
  try {
    if (full) await runCatanMatch(scene, players, { ...hooks, maxActions });
    else await runCatanInitialPlacement(scene, players, hooks);
    if (state.isTerminal()) stopReason = 'game complete';
  } catch (error) {
    if (error instanceof CatanMatchActionLimitError) stopReason = `action limit ${error.maxActions}`;
    else {
      stopReason = signal.aborted ? `timeout after ${timeoutSeconds}s` : `error: ${error instanceof Error ? error.message : String(error)}`;
      runError = error;
    }
  }

  printSummary(state, models);
  console.log(`Stopped: ${stopReason}; prompt=${state.currentPrompt().kind}; actions=${transcript.length}`);

  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify({
      seed,
      full,
      models,
      stopReason,
      transcript,
      final: {
        terminal: state.isTerminal(),
        prompt: state.currentPrompt().kind,
        bank: resourceCounts(state.bankDeck()),
        hands: models.map((_, seat) => resourceCounts(state.handOf(seat))),
      },
    }, null, 2)}\n`, { mode: 0o600 });
    console.log(`Transcript: ${jsonPath}`);
  }
  if (runError) throw runError;
}

main().catch((error) => {
  console.error('catan-self-play:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
