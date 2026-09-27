// The refs each source's views read, held as comparable strings (#461). A
// cache entry is valid while its print matches; a change is announced when
// a source's print differs from the last one announced. Both are answers
// about refs, so neither depends on the file watcher noticing anything: the
// watcher only says "look again", and so does the clock.
import { mapBounded, REPOSITORIES_AT_ONCE, type RunRef, type RunSource, runPrint, type ViewRefs } from '@gateline/core'
import type { RefChange } from './contract.ts'

const MAX_AGE_MS = 30_000

/**
 * Past this many runs moving in one repository at once — a fetch that
 * brought a batch of branches — the event says the repository changed rather
 * than listing each run. The client refreshes about the same set of views
 * either way, and the event stays small.
 */
export const RUNS_PER_CHANGE = 16

export class RefPrints {
  private readonly sources: RunSource[]
  private refs = new Map<string, ViewRefs | null>()
  private readAt = 0
  /** Bumped by every "look again"; a read that started before the bump does not satisfy it. */
  private wanted = 1
  private satisfied = 0
  private reading: Promise<void> | null = null
  private announced: Map<string, ViewRefs | null> | null = null

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
   * Read the refs now, and say what moved since the last time this was asked
   * (#496): per repository, the runs whose refs moved, or the repository as a
   * whole (slug null) when its default branch moved, when it could not say
   * what its refs were one time and could the other, or when more than
   * `RUNS_PER_CHANGE` runs moved together. Ordered as the sources are, then by
   * slug. The first call sets the baseline and reports nothing.
   *
   * A repository that cannot say what its refs are, now or before, is judged
   * on its own: it no longer hides a change in every other repository, as a
   * single print across all of them did.
   */
  async changes(): Promise<RefChange[]> {
    this.markDirty()
    const now = await this.current()
    const before = this.announced
    this.announced = now
    if (before === null) return []
    const out: RefChange[] = []
    for (const source of this.sources) {
      const was = before.get(source.id) ?? null
      const is = now.get(source.id) ?? null
      if (was === null && is === null) continue
      if (was === null || is === null || was.shared !== is.shared) {
        out.push({ source: source.id, slug: null })
        continue
      }
      if (was.all === is.all) continue
      const slugs = [...new Set([...was.runs.keys(), ...is.runs.keys()])]
      const moved = slugs.filter((slug) => was.runs.get(slug) !== is.runs.get(slug)).sort()
      if (moved.length > RUNS_PER_CHANGE) out.push({ source: source.id, slug: null })
      else for (const slug of moved) out.push({ source: source.id, slug })
    }
    return out
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
    // A source that cannot be read here fails the same way in the
    // derivation, which is where the error belongs; its entries fall back to
    // expiry meanwhile. Read side by side under the same bound as the
    // portfolio, and the map keeps the sources' order.
    const read = await mapBounded(
      this.sources,
      REPOSITORIES_AT_ONCE,
      async (source) => [source.id, source.viewRefs ? await source.viewRefs().catch(() => null) : null] as const,
    )
    this.refs = new Map(read)
    this.readAt = Date.now()
    this.satisfied = wanted
  }
}
