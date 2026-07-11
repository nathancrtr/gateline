// Shadow mode against this repository's real history (M1 exit criterion):
// replay the wordfreq run and hold the engine to what the human orchestrator
// actually did. Every disagreement must belong to a dispositioned class —
// see shadow-wordfreq.md for the disposition table.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Git, LocalGitSource } from '@agentic/core'
import { loadRegistry } from '../src/registry.ts'
import { shadowReplay, type ShadowStep } from '../src/shadow.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..')
const source = new LocalGitSource('sandbox', repoRoot)

// One replay serves both tests — it walks every commit of the run and is
// the expensive part.
let cached: Promise<ShadowStep[]> | null = null
function replay(): Promise<ShadowStep[]> {
  cached ??= (async () => {
    const git = new Git(repoRoot)
    const registry = await loadRegistry(git, await git.defaultBranch())
    const runs = await source.listRuns()
    const wordfreq = runs.find((r) => r.slug === 'wordfreq')
    expect(wordfreq).toBeDefined()
    return shadowReplay(source, 'wordfreq', wordfreq!.ref, { estimates: registry?.estimates ?? {} })
  })()
  return cached
}

// The replay walks every commit of the real run (dozens of git subprocesses);
// give the test that triggers it room well past the suite default.
describe('wordfreq shadow replay', { timeout: 120_000 }, () => {
  it('agrees with the human orchestrator at every bookkeeping-synced state', async () => {
    const steps = await replay()
    expect(steps.length).toBeGreaterThanOrEqual(15)

    // The pipeline's spine, in order: dispatch analyst → architect → first
    // implementer — each derived where the human actually did it.
    expect(steps[0]!.action).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(steps[0]!.verdict).toBe('agree')
    expect(steps[1]!.action).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(steps[1]!.verdict).toBe('agree')
    expect(steps[2]!.action).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(steps[2]!.action.kind === 'dispatch' && steps[2]!.action.dispatches[0]!.task).toBe('01-core-logic')
    expect(steps[2]!.verdict).toBe('agree')

    // With the G2 packet complete, the engine rests at the gate and the
    // human decides next — the autonomy boundary holding exactly where P4 puts it.
    const g2Ready = steps.find((s) => s.subject.includes('ready for G2'))
    expect(g2Ready).toBeDefined()
    expect(g2Ready!.action).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(g2Ready!.verdict).toBe('agree')

    // Once the run is done, the engine rests forever.
    const done = steps.find((s) => s.subject.includes('run done'))
    expect(done).toBeDefined()
    expect(done!.action).toMatchObject({ kind: 'rest', rule: 'D1' })
  })

  it('every disagreement belongs to a dispositioned class (shadow-wordfreq.md)', async () => {
    const steps = await replay()
    for (const step of steps.filter((s) => s.verdict === 'disagree')) {
      // Class 1 — v0 deferred dispatch bookkeeping: the engine derives a
      // dispatch for work whose artifacts landed without a state update.
      // Class 2 — v0 deferred round bookkeeping: the engine converges
      // review_rounds/status that the human batched later.
      // Both are impossible under M2's commit-then-launch protocol; neither
      // is an engine bug. Anything else failing here is a new finding that
      // needs a disposition before M1 can be considered passing.
      expect(['dispatch', 'record']).toContain(step.action.kind)
    }
    // The engine never derived an escalation or pause the human didn't perform.
    expect(steps.filter((s) => s.verdict === 'disagree' && s.action.kind === 'escalate')).toHaveLength(0)
  })
})
