// Derivations are pure but git-call heavy; cache them per generation and
// bump the generation whenever a watched repo changes (or the TTL lapses).
// This is a render cache, not a store — deleting it loses nothing (R1).
export class GenerationCache {
  private generation = 0
  private entries = new Map<string, { gen: number; at: number; value: Promise<unknown> }>()
  private ttlMs: number

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs
  }

  bump(): void {
    this.generation++
  }

  get<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    const now = Date.now()
    if (hit && hit.gen === this.generation && now - hit.at < this.ttlMs) return hit.value as Promise<T>
    const value = compute()
    this.entries.set(key, { gen: this.generation, at: now, value })
    // A failed computation must not stick around as a poisoned entry.
    value.catch(() => this.entries.delete(key))
    return value
  }
}
