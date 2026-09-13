// The drain ladder (#150): first signal drains visibly, second aborts with
// the books still closing, third exits without waiting. Pure choreography —
// the target is faked; the seam test proves the SIGKILL side.
import { describe, expect, it } from 'vitest'
import type { InFlightJob } from '../src/engine.ts'
import { type ShutdownTarget, stagedShutdown } from '../src/shutdown.ts'

const job = (over: Partial<InFlightJob> = {}): InFlightJob => ({
  slug: 'toy',
  role: 'implementer',
  task: '01-core',
  round: 1,
  startedAt: Date.now() - 5 * 60_000,
  ...over,
})

function makeTarget(over: Partial<ShutdownTarget> = {}) {
  const lines: string[] = []
  const exits: number[] = []
  let resolveDrain!: () => void
  const drained = new Promise<void>((r) => (resolveDrain = r))
  let aborts = 0
  const target: ShutdownTarget = {
    inFlight: () => [job()],
    drain: () => drained,
    abort: () => {
      aborts++
      return 1
    },
    log: (line) => lines.push(line),
    exit: (code) => exits.push(code),
    progressMs: 20,
    ...over,
  }
  return { target, lines, exits, resolveDrain, abortCount: () => aborts }
}

const settle = () => new Promise((r) => setTimeout(r, 5))

describe('stagedShutdown (#150)', () => {
  it('first signal names the in-flight work, drains, and exits 0 when the drain completes', async () => {
    const { target, lines, exits, resolveDrain } = makeTarget()
    const onSignal = stagedShutdown(target)
    onSignal()
    expect(lines.some((l) => l.includes('draining 1 in-flight dispatch'))).toBe(true)
    expect(lines.some((l) => l.includes('implementer(01-core r1) on toy'))).toBe(true)
    expect(exits).toHaveLength(0) // still waiting on the drain
    resolveDrain()
    await settle()
    expect(lines.some((l) => l.includes('drained — all ledger entries closed'))).toBe(true)
    expect(exits).toEqual([0])
  })

  it('reports progress while the drain waits', async () => {
    const { target, lines, resolveDrain } = makeTarget()
    stagedShutdown(target)()
    await new Promise((r) => setTimeout(r, 50))
    expect(lines.some((l) => l.includes('still draining 1 dispatch'))).toBe(true)
    resolveDrain()
    await settle()
  })

  it('second signal aborts once; third exits 130 without waiting for the drain', async () => {
    const { target, lines, exits, abortCount, resolveDrain } = makeTarget()
    const onSignal = stagedShutdown(target)
    onSignal()
    onSignal()
    expect(abortCount()).toBe(1)
    expect(lines.some((l) => l.includes('SIGKILLed 1 harness process group'))).toBe(true)
    expect(exits).toHaveLength(0) // abort still lets the drain close the books
    onSignal()
    expect(exits).toEqual([130])
    resolveDrain()
    await settle()
  })

  it('with nothing in flight the first signal stops without ceremony', async () => {
    const { target, lines, exits, resolveDrain } = makeTarget({ inFlight: () => [] })
    stagedShutdown(target)()
    expect(lines.some((l) => l.includes('no dispatches in flight'))).toBe(true)
    resolveDrain()
    await settle()
    expect(exits).toEqual([0])
  })
})
