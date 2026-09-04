import type { EngineHealthEntry } from './api.ts'

/**
 * The pause chip's voice (#222). The monitor's free-text reason says why the
 * engine paused; two things it cannot carry are decided here — which palette
 * the chip renders in, and what the pause costs the operator.
 *
 * `dirty` is ordinary and self-inflicted (someone ran `npm install`) and gets
 * the warn voice, so the alarmed voice stays reserved for the topology
 * family — wrong branch, detached HEAD, rewritten history, mid-rebase — and
 * keeps meaning something when it appears. An engine too old to report a
 * cause gets the alarmed voice: unknown is not the same as ordinary.
 */
export interface PauseVoice {
  tone: 'warn' | 'bad'
  /** What the pause costs, and what ends it. */
  consequence: string
}

export function pauseVoice(entry: Pick<EngineHealthEntry, 'codeCause'>): PauseVoice {
  if (entry.codeCause === 'dirty') {
    return {
      tone: 'warn',
      consequence: 'No run in this deployment dispatches until they are committed or discarded.',
    }
  }
  return {
    tone: 'bad',
    consequence: 'No run in this deployment dispatches until the checkout is clean and back on the default branch.',
  }
}
