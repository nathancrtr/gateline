// The refs each source's views read, held as comparable strings (#461). A
// cache entry is valid while its print matches; a change is announced when
// a source's print differs from the last one announced. Both are answers
// about refs, so neither depends on the file watcher noticing anything: the
// watcher only says "look again", and so does the clock.
import { type RunRef, type RunSource, runPrint, type ViewRefs } from '@gateline/core'

const MAX_AGE_MS = 30_000

export class RefPrints {
  private readonly sources: RunSource[]
  private refs = new Map<string, ViewRefs | null>()
  private readAt = 0
  /** Bumped by every "look again"; a read that started before the bump does not satisfy it. */
  private wanted = 1
  private satisfied = 0
  private reading: Promise<void> | null = null
  private announced: string | null = null

  constructor(sources: RunSource[]) {
    this.sources = sources
  }

  /** The refs may have moved: the next lookup reads them again. */
  markDirty(): void {
    this.wanted++
  }

  /** What `listRuns` and cross-run views of this source depend on, or null when the source cannot say. */
  async repo(sourceId: string): Promise<string | null> {
    return (await this.current()).get(sourceId)?.all ?? null
  }

  /** What one run's views depend on, or null when its source cannot say. */
  async run(ref: RunRef): Promise<string | null> {
    const refs = (await this.current()).get(ref.source)
    return refs ? runPrint(refs, ref.slug) : null
  }

  /** What a view across every source depends on, or null when any source cannot say. */
  async everything(): Promise<string | null> {
    const current = await this.current()
    const parts: string[] = []
    for (const source of this.sources) {
      const refs = current.get(source.id)
      if (!refs) return null
      parts.push(`${source.id}\n${refs.all}`)
    }
    return parts.join('\n==\n')
  }

  /**
   * Read the refs now, and say whether any view's refs differ from the last
   * time this was asked. The first call sets the baseline and reports no change.
   */
  async changed(): Promise<boolean> {
    this.markDirty()
    const now = (await this.everything()) ?? ''
    const before = this.announced
    this.announced = now
    return before !== null && before !== now
  }

  private async current(): Promise<Map<string, ViewRefs | null>> {
    while (this.satisfied < this.wanted || Date.now() - this.readAt > MAX_AGE_MS) {
      this.reading ??= this.read().finally(() => {
        this.reading = null
      })
      await this.reading
    }
    return this.refs
  }

  private async read(): Promise<void> {
    const wanted = this.wanted
    const next = new Map<string, ViewRefs | null>()
    for (const source of this.sources) {
      // A source that cannot be read here fails the same way in the
      // derivation, which is where the error belongs; its entries fall back
      // to expiry meanwhile.
      next.set(source.id, source.viewRefs ? await source.viewRefs().catch(() => null) : null)
    }
    this.refs = next
    this.readAt = Date.now()
    this.satisfied = wanted
  }
}
