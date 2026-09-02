import type { ModelInfo } from './models.ts';

const FAST_SUFFIX = '-fast';

/**
 * Order one creator's models by Gateway popularity, with a deterministic
 * alphabetical fallback. Keep an exact `-fast` variant directly after its base.
 */
export function orderCreatorModels(
  models: readonly ModelInfo[],
  popularityOrder: readonly string[],
): ModelInfo[] {
  const rank = new Map(popularityOrder.map((id, index) => [id, index]));
  const ordered = [...models].sort((a, b) => {
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      if (aRank !== bRank) return aRank - bRank;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

  const present = new Set(ordered.map(({ id }) => id));
  const fastByBase = new Map<string, ModelInfo[]>();
  for (const model of ordered) {
    if (!model.id.endsWith(FAST_SUFFIX)) continue;
    const base = model.id.slice(0, -FAST_SUFFIX.length);
    if (present.has(base)) fastByBase.set(base, [...(fastByBase.get(base) ?? []), model]);
  }

  const result: ModelInfo[] = [];
  const appendFastVariants = (base: string): void => {
    for (const variant of fastByBase.get(base) ?? []) {
      result.push(variant);
      appendFastVariants(variant.id);
    }
  };
  for (const model of ordered) {
    if (model.id.endsWith(FAST_SUFFIX) && fastByBase.has(model.id.slice(0, -FAST_SUFFIX.length))) continue;
    result.push(model);
    appendFastVariants(model.id);
  }
  return result;
}
