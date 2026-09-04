// Arcade's baked AI Gateway model catalog. Runtime match setup replaces this with
// the signed-in team's availability-aware catalog when possible; this committed JSON
// remains the instant offline/error fallback and the source used by audit tools.
import { readFileSync } from 'node:fs';
import { asset } from '../assets.ts';
import { BETA_MODEL_ALLOWLIST } from './beta-allowlist.ts';

export interface ModelInfo {
  id: string; // "creator/model" gateway slug
  name: string; // display name
}
export interface CreatorInfo {
  slug: string;
  name: string; // display label
  models: ModelInfo[];
}

const catalog: { creators: CreatorInfo[] } = JSON.parse(readFileSync(asset('models.json'), 'utf8'));

// Creator-level exclusions: creators that don't play through the gateway at all.
// Verified via the probe / report (`src/tools/model-compat-report.ts`): `arcee-ai`
// is gated behind a separate access profile, `meituan` reports "Unsupported model",
// and `sakana` hangs past the request timeout. Drop a slug once it works. Direct
// lookups (modelsFor / modelName) still resolve these; only the selectable set excludes them.
const UNSUPPORTED = new Set(['arcee-ai', 'meituan', 'sakana']);

// Selectable creators (full catalog minus unsupported). Used by the audit/probe
// tools (which must see every model to regenerate the allowlist) and as the base
// for the picker below.
export function creators(): CreatorInfo[] {
  return catalog.creators.filter((c) => !UNSUPPORTED.has(c.slug));
}
export function modelsFor(slug: string): ModelInfo[] {
  return catalog.creators.find((c) => c.slug === slug)?.models ?? [];
}

// Fallback-only policy. This filter never applies to a signed-in launch: the live team
// catalog (team-model-catalog.ts) replaces it wholesale using Gateway's per-team
// eligibility. It survives for the signed-out / offline / error path, where nothing else
// can keep a first pick off a model the compatibility audit showed can't play.
// BETA_MODEL_ALLOWLIST is a frozen snapshot of that audit, no longer regenerated. A
// selected model still runs the ModelPlayer fallback ladder (structured → soft parse →
// normalizer → random legal), so this governs the fallback menu, not whether a model can
// play. Set ARCADE_ALL_MODELS=1 to offer the full baked catalog. The base creators() /
// modelsFor() stay unfiltered so tools and direct lookups see everything.
function allowlistActive(): boolean {
  return !/^(1|on|true|yes)$/i.test(process.env.ARCADE_ALL_MODELS?.trim() ?? '');
}

// Whether the baked realtime fallback should offer early-access-only models (e.g. xAI
// Grok realtime voice). A live team catalog uses Gateway's actual eligibility instead.
export function includeEarlyAccessModels(): boolean {
  return !allowlistActive();
}
function allowed(models: ModelInfo[]): ModelInfo[] {
  return allowlistActive()
    ? models.filter((m) => BETA_MODEL_ALLOWLIST.has(m.id))
    : models;
}
export function pickerCreators(): CreatorInfo[] {
  return creators()
    .map((c) => ({ ...c, models: allowed(c.models) }))
    .filter((c) => c.models.length > 0);
}
export function pickerModelsFor(slug: string): ModelInfo[] {
  return allowed(modelsFor(slug));
}
export function creatorName(slug: string): string {
  return catalog.creators.find((c) => c.slug === slug)?.name ?? slug;
}
export function modelName(id: string): string {
  for (const c of catalog.creators) {
    const m = c.models.find((mm) => mm.id === id);
    if (m) return m.name;
  }
  return id;
}

// The structured-output-capable model used for ModelPlayer's normalization rung
// (AIG-183) — the last resort BEFORE a random legal move, invoked only after the
// native-structured and deterministic-soft-parse rungs have failed. Kept as a fast,
// cheap, reliably-structured model so the rare rescue call is light. Verified to do
// structured output on the standard team; if it's itself unreachable the rung just
// errors and we fall back to random, so enabling it never makes things worse.
//
// Automatic by default (a recovered real move beats a silent random one). Override
// via ARCADE_NORMALIZE: a slug swaps the model; "0"/"off"/"false"/"none" disables
// the rung entirely (chess and poker then random-fallback as before).
const DEFAULT_NORMALIZER = 'anthropic/claude-haiku-4.5';
export function normalizerModel(): string | undefined {
  const v = process.env.ARCADE_NORMALIZE?.trim();
  if (v && /^(0|off|false|no|none)$/i.test(v)) return undefined;
  if (v && !/^(1|on|true|yes)$/i.test(v)) return v; // an explicit override slug
  return DEFAULT_NORMALIZER;
}
