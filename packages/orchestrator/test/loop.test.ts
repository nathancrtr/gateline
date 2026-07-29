// runLoop's self-supersede wiring (#141): first test coverage for runLoop
// itself. Builds a real throwaway git repo (same idiom as
// engine.helper.ts's makeToyRepo and core's code-tree.test.ts) to back a
// real CodeTreeMonitor, and drives the loop with a manual `trigger()` call
// per boundary instead of racing the real heartbeat timer / fs watcher —
// runLoop exposes `trigger` on its returned handle for exactly this.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeTreeMonitor, engineHealthPath, type CodeTreeStatus, type EngineHealth } from '@agentic/core'
import type { TickOutcome } from '../src/engine.ts'
import { runLoop, type EngineLike } from '../src/triggers.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Isolate from the operator's real ~/.gitconfig, same as engine.helper.ts / core's code-tree.test.ts.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, 'file.txt'), `${message}\n${Math.random()}`)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-loop-'))
  cleanups.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Toy'])
  git(dir, ['config', 'user.email', 'toy@example.com'])
  commit(dir, 'initial')
  return dir
}

async function readHealth(dir: string): Promise<EngineHealth> {
  return JSON.parse(await readFile(await engineHealthPath(dir), 'utf8')) as EngineHealth
}

// Every test drives ticks manually via `loop.trigger()`. The real ref
// watcher and heartbeat timer stay wired (runLoop doesn't have a "disable"
// switch, by design — it's meant to be exercised for real outside tests),
// so push both intervals well past any test's runtime: a `commit()` call
// touches .git/refs and would otherwise schedule a debounced real 'refs'
// tick a few hundred ms later, racing the assertions below.
const NO_REAL_TRIGGERS = { heartbeatMs: 10 * 60 * 1000, debounceMs: 10 * 60 * 1000 }

/** Minimal fake standing in for Engine — just the surface runLoop drives. */
class FakeEngine implements EngineLike {
  onSettled: (() => void) | null = null
  tickCalls = 0
  syncCalls = 0
  async tick(): Promise<TickOutcome[]> {
    this.tickCalls++
    return [{ slug: 'toy', action: { kind: 'rest', rule: 'noop', why: 'test' }, wrote: false, launched: 0, detail: '' }]
  }
  async syncFromRemote(): Promise<void> {
    this.syncCalls++
  }
  inFlight(): number {
    return 0
  }
  pushHealth(): ReadonlyMap<string, number> {
    return new Map()
  }
  async drain(): Promise<void> {}
}

describe('runLoop code-tree wiring (#141)', () => {
  it('checks drift only on heartbeat/startup; refs and completion inherit the cached state instead of re-checking', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const engine = new FakeEngine()
    const loop = await runLoop(engine, dir, { ...NO_REAL_TRIGGERS, codeMonitor: monitor, log: () => {} })

    // Startup already ran inside runLoop() itself, on a clean tree: fresh.
    expect(engine.tickCalls).toBe(1)
    expect((await readHealth(dir)).codeState).toBe('fresh')

    // Dirty the tree *after* startup's check. If refs/completion invoked
    // check() themselves, this would flip the cached state to paused and
    // skip the tick body — proving they must not call it.
    writeFileSync(join(dir, 'scratch.txt'), 'wip')

    await loop.trigger('refs')
    expect(engine.tickCalls).toBe(2) // body still ran: refs didn't see the dirty tree
    expect((await readHealth(dir)).codeState).toBe('fresh') // stale cached state, untouched by refs

    await loop.trigger('completion')
    expect(engine.tickCalls).toBe(3) // same for completion
    expect((await readHealth(dir)).codeState).toBe('fresh')

    // Now a heartbeat: this is a boundary tick, so it must run the check,
    // observe the dirty tree, pause, and skip its own body.
    await loop.trigger('heartbeat')
    expect(engine.tickCalls).toBe(3) // body skipped this pass
    let health = await readHealth(dir)
    expect(health.codeState).toBe('paused')
    expect(health.commit).toBe(monitor.startHead)
    expect(health.codeReason).toBe('the working tree has uncommitted local changes')

    // Cached paused state must also govern non-boundary triggers, with no
    // further check() needed to prove it — a refs/completion tick arriving
    // while paused must not dispatch either.
    await loop.trigger('refs')
    expect(engine.tickCalls).toBe(3)
    await loop.trigger('completion')
    expect(engine.tickCalls).toBe(3)

    // Recovery: clean the tree, next heartbeat sees fresh again and resumes.
    rmSync(join(dir, 'scratch.txt'))
    await loop.trigger('heartbeat')
    expect(engine.tickCalls).toBe(4)
    health = await readHealth(dir)
    expect(health.codeState).toBe('fresh')
    // Self-clearing (#185): the recovered heartbeat carries no stale cause —
    // `reason` is undefined off `paused`, and JSON.stringify drops the key.
    expect(health.codeReason).toBeUndefined()

    await loop.stop()
  })

  it('writes codeState "paused" (with no supersede) for a dirty tree', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const engine = new FakeEngine()
    const superseded: CodeTreeStatus[] = []
    writeFileSync(join(dir, 'scratch.txt'), 'wip')
    const loop = await runLoop(engine, dir, {
      ...NO_REAL_TRIGGERS,
      codeMonitor: monitor,
      onSupersede: (status) => superseded.push(status),
      log: () => {},
    })

    // Startup is a boundary tick too: it should have seen the dirty tree
    // straight away and paused before ever running the body.
    expect(engine.tickCalls).toBe(0)
    const health = await readHealth(dir)
    expect(health.codeState).toBe('paused')
    expect(health.codeReason).toBe('the working tree has uncommitted local changes')
    expect(superseded).toHaveLength(0)

    await loop.trigger('heartbeat')
    expect(engine.tickCalls).toBe(0)
    expect(superseded).toHaveLength(0)

    await loop.stop()
  })

  it('fires onSupersede exactly once, after the confirming heartbeat is debounced on the second check', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const engine = new FakeEngine()
    const superseded: CodeTreeStatus[] = []
    const loop = await runLoop(engine, dir, {
      ...NO_REAL_TRIGGERS,
      codeMonitor: monitor,
      onSupersede: (status) => superseded.push(status),
      log: () => {},
    })
    expect(engine.tickCalls).toBe(1) // startup: fresh, body ran

    const next = commit(dir, 'second') // clean fast-forward of the default branch

    await loop.trigger('heartbeat') // first observation: pending
    let health = await readHealth(dir)
    expect(health.codeState).toBe('superseded-pending')
    expect(health.codeHead).toBe(next)
    expect(engine.tickCalls).toBe(1) // body skipped
    expect(superseded).toHaveLength(0)

    await loop.trigger('heartbeat') // same head again: confirmed
    health = await readHealth(dir)
    // D4: supersede-confirmed maps to superseded-pending on the heartbeat —
    // there is no further steady state to report once confirmed.
    expect(health.codeState).toBe('superseded-pending')
    expect(health.codeHead).toBe(next)
    expect(superseded).toHaveLength(1)
    expect(superseded[0]).toMatchObject({ state: 'supersede-confirmed', startHead: monitor.startHead, codeHead: next })

    // Steady state: further boundary and non-boundary ticks alike must not
    // fire the callback a second time, and must keep the loop idling.
    await loop.trigger('heartbeat')
    await loop.trigger('refs')
    await loop.trigger('completion')
    expect(superseded).toHaveLength(1)
    expect(engine.tickCalls).toBe(1)

    await loop.stop()
  })

  it('behaves exactly as before #141 when no codeMonitor is supplied', async () => {
    const dir = makeRepo()
    const engine = new FakeEngine()
    const loop = await runLoop(engine, dir, { ...NO_REAL_TRIGGERS, log: () => {} })

    expect(engine.tickCalls).toBe(1)
    const health = await readHealth(dir)
    expect(health.codeState).toBeUndefined()
    expect(health.commit).toBeUndefined()
    expect(health.codeHead).toBeUndefined()

    await loop.trigger('heartbeat')
    await loop.trigger('refs')
    await loop.trigger('completion')
    expect(engine.tickCalls).toBe(4)

    await loop.stop()
  })
})
