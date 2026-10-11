/** mulberry32 — small, fast, seedable PRNG. */
export function createRng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min: number, max: number) => min + (max - min) * next(),
    int: (min: number, max: number) => Math.floor(min + (max - min + 1) * next()),
    chance: (p: number) => next() < p,
    /** approx. standard normal (Irwin–Hall, n=6) */
    normal: () => {
      let sum = 0
      for (let i = 0; i < 6; i++) sum += next()
      return (sum - 3) / Math.sqrt(0.5)
    },
    getState: () => s,
    setState: (v: number) => {
      s = v >>> 0
    },
  }
}
export type Rng = ReturnType<typeof createRng>

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
