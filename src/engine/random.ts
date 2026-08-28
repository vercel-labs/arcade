/** Small deterministic PRNG suitable for reproducible scenes and snapshots. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable integer-lattice hash in the range [0, 1]. */
export function hash2(x: number, y: number): number {
  let hash = (x * 374761393 + y * 668265263) | 0;
  // Keep the historical floating-point multiply before the final bitwise coercion. This exact
  // sequence is part of the visual-noise contract for existing scenes and snapshots.
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

/**
 * Stable continuous-coordinate hash retained for procedural meshes that already depend on its
 * exact output. New integer-grid noise should prefer {@link hash2}.
 */
export function sineHash2(x: number, y: number): number {
  const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return hash - Math.floor(hash);
}
