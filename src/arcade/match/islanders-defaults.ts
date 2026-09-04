// Arcade product defaults shared by repository-owned tools (self-play, match-lab). These
// provider choices are intentionally not part of the public game harness contract. The
// live setup panel resolves the same ladder against the team's catalog instead.
import { defaultSeatModelIds } from './default-seats.ts';

export const ISLANDERS_DEFAULT_AI_MODELS: readonly string[] = defaultSeatModelIds(4);
