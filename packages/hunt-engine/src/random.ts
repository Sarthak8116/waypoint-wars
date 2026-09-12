/**
 * Tiny seeded PRNG helpers.
 *
 * The hunt engine must be reproducible: the same seed must produce the same
 * route assignment and the same anti-cheat instruction on every machine, in
 * every process, forever. `Math.random()` is therefore banned in this package.
 *
 * mulberry32 is used because it is 5 lines, has no dependencies, and its output
 * is identical across every JS engine (it is pure uint32 arithmetic).
 */

/** FNV-1a 32-bit. Maps an arbitrary seed string to a uint32. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in uint32 range without BigInt.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function toSeedNumber(seed: number | string): number {
  if (typeof seed === 'number') {
    return Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) >>> 0 : 0;
  }
  return hashString(seed);
}

/** Returns a deterministic generator of floats in [0, 1). */
export function createRng(seed: number | string): () => number {
  let state = toSeedNumber(seed) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates using a supplied RNG. Returns a new array; never mutates. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
