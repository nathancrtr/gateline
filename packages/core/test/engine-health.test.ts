// Engine liveness plumbing (#100): machine-local, under the git common dir,
// presence = expectation. See engine-health.ts for why it is deliberately
// not committed state.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type EngineHealth, engineHealthPath, engineHealthStale, readEngineHealth, writeEngineHealth } from '../src/sources/engine-health.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-health-'))
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

  it('parses a pre-#141 file that predates the drift fields', async () => {
    const dir = gitRepo()
    const path = await engineHealthPath(dir)
    await mkdir(dirname(path), { recursive: true })
    // Hand-authored, not run through writeEngineHealth: simulates a file
    // written by an engine binary from before commit/codeHead/codeState
    // existed at all.
    const old = { at: new Date().toISOString(), pid: process.pid, heartbeatMs: 180_000, inFlight: 0, pushRejections: {} }
    await writeFile(path, JSON.stringify(old), 'utf8')

    const read = await readEngineHealth(dir)
    expect(read).toEqual(old)
    expect(read?.commit).toBeUndefined()
    expect(read?.codeHead).toBeUndefined()
    expect(read?.codeState).toBeUndefined()
    expect(read?.codeReason).toBeUndefined()
  })

  it('round-trips the #141 drift fields', async () => {
    const dir = gitRepo()
    const h = health({ commit: 'a'.repeat(40), codeHead: 'b'.repeat(40), codeState: 'superseded-pending' })
    await writeEngineHealth(dir, h)
    expect(await readEngineHealth(dir)).toEqual(h)

    // A paused heartbeat also carries the monitor's cause verbatim (#185).
    const paused = health({
      commit: 'a'.repeat(40),
      codeHead: 'b'.repeat(40),
      codeState: 'paused',
      codeReason: "checkout is on branch 'run/toy', not the default branch (main)",
    })
    await writeEngineHealth(dir, paused)
    expect(await readEngineHealth(dir)).toEqual(paused)
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
