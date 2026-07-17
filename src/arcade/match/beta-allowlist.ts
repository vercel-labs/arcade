// Private-beta model allowlist: the models the match-setup picker offers by
// default. Two layers:
//   AUDITED  — generated from the first-hand compatibility audit
//              (docs/model-compat.vercel-internal-playground.json): every model
//              here played BOTH chess and poker via native structured output on
//              the internal-playground team (the team beta users authenticate
//              with). Regenerate from a fresh audit; see docs/model-allowlist.md.
//   EXCLUDED — models that pass the audit but are held back for another reason
//              (hand-maintained; survives regeneration).
// A selected model still runs the ModelPlayer fallback ladder, so this governs the
// picker menu, not whether a chosen model can play.
const AUDITED: readonly string[] = [
  "alibaba/qwen-3-235b",
  "alibaba/qwen-3-32b",
  "alibaba/qwen3-coder",
  "alibaba/qwen3-coder-30b-a3b",
  "alibaba/qwen3-coder-next",
  "alibaba/qwen3-next-80b-a3b-instruct",
  "alibaba/qwen3-next-80b-a3b-thinking",
  "amazon/nova-2-lite",
  "amazon/nova-lite",
  "amazon/nova-micro",
  "amazon/nova-pro",
  "anthropic/claude-3-haiku",
  "anthropic/claude-fable-5",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-opus-4",
  "anthropic/claude-opus-4.1",
  "anthropic/claude-opus-4.5",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.7",
  "anthropic/claude-opus-4.7-fast",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-opus-4.8-fast",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-sonnet-5",
  "bytedance/seed-1.6",
  "bytedance/seed-1.8",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-thinking",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro",
  "google/gemini-3-flash",
  "google/gemini-3-pro-image",
  "google/gemini-3-pro-preview",
  "google/gemini-3.1-flash-image",
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.5-flash",
  "google/gemma-4-26b-a4b-it",
  "minimax/minimax-m2.1",
  "minimax/minimax-m2.5",
  "minimax/minimax-m2.7",
  "minimax/minimax-m3",
  "moonshotai/kimi-k2.5",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.7-code-highspeed",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-nano-12b-v2-vl",
  "nvidia/nemotron-nano-9b-v2",
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-4o-mini-search-preview",
  "openai/gpt-5",
  "openai/gpt-5-chat",
  "openai/gpt-5-codex",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-codex-max",
  "openai/gpt-5.1-codex-mini",
  "openai/gpt-5.1-instant",
  "openai/gpt-5.1-thinking",
  "openai/gpt-5.2",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2-pro",
  "openai/gpt-5.3-chat",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/o1",
  "openai/o3",
  "openai/o3-mini",
  "openai/o3-pro",
  "openai/o4-mini",
  "xai/grok-4.1-fast-non-reasoning",
  "xai/grok-4.1-fast-reasoning",
  "xai/grok-4.20-non-reasoning",
  "xai/grok-4.20-reasoning",
  "xai/grok-4.3",
  "xai/grok-4.5",
  "zai/glm-4.7",
  "zai/glm-4.7-flash",
  "zai/glm-5",
  "zai/glm-5.1",
  "zai/glm-5.2",
  "zai/glm-5.2-fast",
];

// Excluded despite passing the structured-output audit.
const EXCLUDED = new Set<string>([
  // Reasoning "pro" model: poker moves blow the move-time budget (times out /
  // unacceptably slow in gameplay). Verified twice + in-app.
  "openai/gpt-5.5-pro",
]);

export const BETA_MODEL_ALLOWLIST: ReadonlySet<string> = new Set(
  AUDITED.filter((id) => !EXCLUDED.has(id)),
);

// Models that play fine but are slow — the picker shows a "slow" hint next to
// them. Kept (not excluded): they complete their move, they just make you wait.
// Derived from poker latency, median-of-3 audit runs ≥ 30s (chess is uniformly
// fast). Hand-maintained — re-derive per docs/model-allowlist.md when re-auditing.
export const SLOW_MODELS: ReadonlySet<string> = new Set([
  'moonshotai/kimi-k2.6',
  'bytedance/seed-1.6',
  'bytedance/seed-1.8',
  'alibaba/qwen3-next-80b-a3b-thinking',
  'openai/o3-pro',
]);
