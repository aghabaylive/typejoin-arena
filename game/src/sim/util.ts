/** Small deterministic RNG (mulberry32) so tests and recordings are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

/** Returns a deep copy of `base` with `over` applied (arrays are replaced, not merged). */
export function deepMerge<T>(base: T, over?: DeepPartial<T>): T {
  if (!over) return structuredClone(base);
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMerge(cur, v as never);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

/** FNV-1a hash of a string -> uint32. Used for stable per-user colors. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform bucket grid for fast "pellets near point" queries. */
export class PointGrid<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  constructor(private cell: number) {}
  rebuild(items: readonly T[]): void {
    this.cells.clear();
    for (const it of items) {
      const k = this.key(Math.floor(it.x / this.cell), Math.floor(it.y / this.cell));
      const arr = this.cells.get(k);
      if (arr) arr.push(it);
      else this.cells.set(k, [it]);
    }
  }
  query(x: number, y: number, r: number, cb: (it: T) => void): void {
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const y0 = Math.floor((y - r) / this.cell), y1 = Math.floor((y + r) / this.cell);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const arr = this.cells.get(this.key(gx, gy));
        if (arr) for (const it of arr) cb(it);
      }
  }
  private key(gx: number, gy: number): number {
    return (gx + 1024) * 4096 + (gy + 1024);
  }
}
