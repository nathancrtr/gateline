// The terminal-run guard as a release path (#501). Derivation rests a `done`
// or `closed` run on D1, so the guard in `execute` only fires if something
// upstream substitutes an action it should not — which is exactly the case
// the guard exists for. To reach it, this file swaps derivation for one that
// (wrongly) dispatches on a done run, and checks that the slot the governor
// granted for that dispatch comes back.
import { rmSync } from 'node:fs'
import { LocalGitSource } from '@gateline/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Engine } from '../src/engine.ts'
import { Governor, type ReservationRequest, type ReserveResult } from '../src/governor.ts'
import { FakeDispatcher, makeToyRepo, TEST_REGISTRY } from './engine.helper.ts'

vi.mock('../src/derive.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/derive.ts')>()
  return {
    ...real,
    deriveAction: (obs: Parameters<typeof real.deriveAction>[0]) =>
      obs.state?.phase === 'done'
        ? {
            kind: 'dispatch',
            rule: 'BUG',
            why: 'a faulty rule dispatching on a finished run',
            dispatches: [{ role: 'analyst', task: null, round: null, bounce: null, reason: 'bug', lands: null }],
          }
        : real.deriveAction(obs),
  }
})

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

class CountingGovernor extends Governor {
  grants = 0
  override reserve(req: ReservationRequest): ReserveResult {
    const res = super.reserve(req)
    this.grants += res.granted.length
    return res
  }
}

describe('the terminal-run guard releases the slot it was granted for', () => {
  it('a dispatch on a done run is refused in execute, and its reservation comes back', async () => {
    const { dir } = makeToyRepo()
    cleanups.push(dir)
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    expect((await human.writeState(ref, (doc) => doc.setIn(['phase'], 'done'), 'state(toy): done')).ok).toBe(true)

    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, governor: gov })
    const outcomes = await engine.tick()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('rest')
    expect(toy.detail).toContain('the engine does not move a terminal run')
    expect(gov.grants).toBe(1)
    expect(gov.snapshot().occupied).toBe(0)
    expect(dispatcher.calls).toHaveLength(0)
  })
})
