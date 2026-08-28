// Shared by the in-app Catan setup picker and the headless observer tool so the
// four-seat spectate lineup cannot drift between the two entry points.
export const CATAN_DEFAULT_AI_SEATS = [
  { creator: 'xai', model: 'xai/grok-4.1-fast-non-reasoning' },
  { creator: 'anthropic', model: 'anthropic/claude-haiku-4.5' },
  { creator: 'openai', model: 'openai/gpt-5.4-nano' },
  { creator: 'google', model: 'google/gemini-2.5-flash' },
] as const;
