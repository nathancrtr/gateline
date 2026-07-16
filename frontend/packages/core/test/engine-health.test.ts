// Engine liveness plumbing (#100): machine-local, under the git common dir,
// presence = expectation. See engine-health.ts for why it is deliberately
// not committed state.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engineHealthStale, readEngineHealth, writeEngineHealth, type EngineHealth } from '../src/engine-health.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-health-'))
  cleanups.push(dir)
  execFileSync('git', ['init', '-q', dir])
  return dir
}

const health = (over: Partial<EngineHealth> = {}): EngineHealth => ({
  at: new Date().toISOString(),
  pid: process.pid,
  heartbeatMs: 180_000,
  inFlight: 0,
  pushRejections: {},
  ...over,
})

describe('engine health (#100)', () => {
  it('round-trips through the git common dir and is absent before any write', async () => {
    const dir = gitRepo()
    expect(await readEngineHealth(dir)).toBeNull() // viewer-only: no expectation, no banner
    const h = health({ pushRejections: { 'run/toy': 2 } })
    await writeEngineHealth(dir, h)
    expect(await readEngineHealth(dir)).toEqual(h)
  })

  it('staleness allows two missed heartbeats plus grace, no more', () => {
    const now = new Date('2026-07-16T12:00:00Z')
    const fresh = health({ at: new Date(now.getTime() - 180_000).toISOString() })
    const gone = health({ at: new Date(now.getTime() - (2 * 180_000 + 61_000)).toISOString() })
    expect(engineHealthStale(fresh, now)).toBe(false)
    expect(engineHealthStale(gone, now)).toBe(true)
    expect(engineHealthStale(health({ at: 'not-a-date' }), now)).toBe(true)
  })
})
