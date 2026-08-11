import type { ProjectedShapeHit } from './picking.ts';

export interface NearestHitOptions<T> {
  /** Maximum normalized score accepted as a hit. */
  maxScore?: number;
  /** Lower values win before score is compared. */
  priority?: (hit: T) => number;
}

/** Resolve the best normalized projected hit, optionally honoring semantic priority first. */
export function nearestHit<T extends ProjectedShapeHit>(
  hits: Iterable<T | null | undefined>,
  options: NearestHitOptions<T> = {},
): T | null {
  const maxScore = options.maxScore ?? 1;
  const priority = options.priority ?? (() => 0);
  let best: T | null = null;
  let bestPriority = Infinity;
  for (const hit of hits) {
    if (!hit || hit.score > maxScore) continue;
    const hitPriority = priority(hit);
    if (!best || hitPriority < bestPriority || (hitPriority === bestPriority && hit.score < best.score)) {
      best = hit;
      bestPriority = hitPriority;
    }
  }
  return best;
}

export interface StickyHoverOptions {
  /** Normalized score at which the current target is finally released. */
  leaveScore: number;
  /** Advantage a new target must gain before replacing the current target. */
  switchBias?: number;
}

/**
 * Keep a current projected target through a wider leave region and small neighbour crossings.
 * Callers remain responsible for measuring targets and filtering game-specific legality.
 */
export function resolveStickyHover<T extends ProjectedShapeHit>(
  current: T | null,
  candidate: T | null,
  options: StickyHoverOptions,
): T | null {
  const switchBias = options.switchBias ?? 0;
  if (
    current
    && current.score <= options.leaveScore
    && (!candidate || current.score <= candidate.score + switchBias)
  ) {
    return current;
  }
  return candidate;
}

/** Boolean threshold with separate show and hide cutoffs to prevent boundary flicker. */
export function hysteresisThreshold(
  value: number,
  current: boolean | null,
  showAt: number,
  hideBelow: number,
): boolean {
  if (current === null) return value >= showAt;
  return current ? value >= hideBelow : value >= showAt;
}
