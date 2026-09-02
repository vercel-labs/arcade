// Resolve compact display labels without losing the underlying identity used for color,
// routing, and model calls. Every repeated visible label is indexed in seat order—even when
// two distinct provider/model IDs shorten to the same name—so prompts stay unambiguous.
export interface LabelCandidate {
  key: string;
  label: string;
}

export function disambiguateLabels(candidates: readonly LabelCandidate[]): string[] {
  const totals = new Map<string, number>();
  for (const candidate of candidates) totals.set(candidate.label, (totals.get(candidate.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return candidates.map(({ label }) => {
    if ((totals.get(label) ?? 0) <= 1) return label;
    const index = (seen.get(label) ?? 0) + 1;
    seen.set(label, index);
    return `${label} (${index})`;
  });
}
