// Derivations are pure but git-call heavy, so a finished one is kept for as
// long as the refs it was derived from stay where they were (#461). Each
// entry carries the print of those refs; a lookup under a different print
// recomputes. This is a render cache, not a store — deleting it loses
// nothing (R1).
//
// Two kinds of entry also expire on a timer: one whose source cannot name its
// refs (a null print), and one whose value reads the clock, which the caller
// declares through `expires`.
export interface CacheOptions<T> {
  /** True when this value goes stale by time alone, refs unmoved. */
  expires?: (value: T) => boolean
}

interface Entry {
  print: string | null
  at: number
  expiring: boolean
  value: Promise<unknown>
}

export class ViewCache {
  private entries = new Map<string, Entry>()
  private ttlMs: number

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs
  }

  get<T>(key: string, print: string | null, compute: () => Promise<T>, options: CacheOptions<T> = {}): Promise<T> {
    const hit = this.entries.get(key)
    const now = Date.now()
    if (hit && hit.print === print && (!hit.expiring || now - hit.at < this.ttlMs)) return hit.value as Promise<T>
    const value = compute()
    // Expiring until the value says otherwise: what it is decides that, and
    // it is not here yet.
    const entry: Entry = { print, at: now, expiring: true, value }
    this.entries.set(key, entry)
    value.then(
      (v) => {
        entry.expiring = print === null || (options.expires?.(v) ?? false)
      },
      // A failed computation must not stick around as a poisoned entry.
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
      },
    )
    return value
  }
}
