import type { Game, GameState } from './game.ts';

// An explicit name → factory registry (OpenSpiel uses a static-init macro; TS
// just uses a Map). Games self-register at module load by calling registerGame.
// The read side (loadGame/registeredGames) is intentionally unused for now: the app
// constructs its scenes directly. It's kept as the game-agnostic lookup seam for
// generic tooling and a third game, so don't drop it as "dead" without that context.
type AnyGame = Game<GameState<unknown>, unknown>;

const registry = new Map<string, () => AnyGame>();

export function registerGame(shortName: string, factory: () => AnyGame): void {
  registry.set(shortName, factory);
}

export function loadGame(shortName: string): AnyGame {
  const factory = registry.get(shortName);
  if (!factory) {
    throw new Error(`Unknown game "${shortName}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`);
  }
  return factory();
}

export function registeredGames(): string[] {
  return [...registry.keys()];
}
