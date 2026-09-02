// Arcade product defaults shared by the setup picker and repository-owned tools. These
// provider choices are intentionally not part of the public game harness contract.
export const ISLANDERS_DEFAULT_AI_SEATS = [
  { creator: 'xai', model: 'xai/grok-4.1-fast-non-reasoning' },
  { creator: 'anthropic', model: 'anthropic/claude-haiku-4.5' },
  { creator: 'openai', model: 'openai/gpt-5.4-nano' },
  { creator: 'google', model: 'google/gemini-2.5-flash' },
] as const;
