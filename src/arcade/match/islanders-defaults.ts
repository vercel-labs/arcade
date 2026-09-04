// Arcade product defaults shared by repository-owned tools (self-play, match-lab). These
// provider choices are intentionally not part of the public game harness contract. The
// live setup panel pre-fills creators only and lets the player pick the model.
import { defaultToolModels } from './default-seats.ts';

export const ISLANDERS_DEFAULT_AI_MODELS: readonly string[] = defaultToolModels(4);
