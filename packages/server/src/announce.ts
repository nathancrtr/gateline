// Announcing ref movement to the event stream (#461, #496). Every trigger —
// a watcher settling, the recheck timer, a write — asks the prints what moved
// and sends one `change` event listing it. Triggers that arrive while a pass
// is running are coalesced into one more pass after it, so a burst of writes
// across several repositories becomes one or two events, never one per write.
import type { ChangeEvent } from './contract.ts'
import type { RefPrints } from './prints.ts'

/**
 * Returns the trigger. Its promise settles when the pass it started or joined
 * has finished, including any pass queued behind it.
 */
export function createAnnouncer(
  prints: Pick<RefPrints, 'changes'>,
  send: (event: ChangeEvent) => void,
  warn: (line: string) => void = (line) => console.warn(line),
): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  const pass = async () => {
    try {
      const changes = await prints.changes()
      if (changes.length > 0) send({ changes })
    } catch (e) {
      warn(`warning: reading refs failed: ${(e as Error).message}`)
    }
  }
  return () => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await pass()
      } while (again)
    })().finally(() => {
      running = null
    })
    return running
  }
}
