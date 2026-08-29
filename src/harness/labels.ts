// Resolve compact display labels without losing the underlying identity used for color,
// routing, and model calls. Only identical keys are disambiguated: two providers may expose
// the same short name without being treated as the same model.
export interface LabelCandidate {
  key: string;
  label: string;
}

export function disambiguateLabels(candidates: readonly LabelCandidate[]): string[] {
  const totals = new Map<string, number>();
  for (const candidate of candidates) totals.set(candidate.key, (totals.get(candidate.key) ?? 0) + 1);
  const seen = new Map<string, number>();
  return candidates.map(({ key, label }) => {
    if ((totals.get(key) ?? 0) <= 1) return label;
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    return `${label} (${index})`;
  });
}
