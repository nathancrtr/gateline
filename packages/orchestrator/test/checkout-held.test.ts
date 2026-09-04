// #154 / #155 / #114: a dispatch the host cannot start is not a dispatch the
// agent failed. The run branch held by a checkout the orchestrator does not
// own is a standing condition — probed before the intent commit and deferred
// (rule CH), written nowhere, re-derived once released. A refusal that does
// reach the close path meters $0 and counts toward nothing. And an escalation
// says how many attempts the ledger actually shows.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalGitSource } from '@gateline/core'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { heldCheckout, removeRunCheckout } from '../src/workspace.ts'
import { agentCommit, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY, toyRef, type Clock } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

const makeEngine = (dir: string, dispatcher: FakeDispatcher, log?: (l: string) => void) =>
  new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, log })

/** A human's worktree holding the run branch — a path with no orchestrator marker in it. */
function humanCheckout(dir: string, branch: string): string {
  const path = mkdtempSync(join(tmpdir(), 'human-worktree-'))
  cleanups.push(path)
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', path, branch])
  return path
}

describe('a run branch held by a human checkout defers the dispatch (#154, rule CH)', () => {
  it('writes nothing, spends nothing, counts nothing, and reports the condition with its remedy', async () => {
    const { dir } = toyRepo()
    const held = humanCheckout(dir, 'run/toy')
    expect(await heldCheckout(dir, 'run/toy')).not.toBeNull()

    const dispatcher = new FakeDispatcher(() => ({}))
    const lines: string[] = []
    const engine = makeEngine(dir, dispatcher, (l) => lines.push(l))
    const source = new LocalGitSource('check', dir)
    const before = await source.git.revParse('refs/heads/run/toy')

    const outcomes = await engine.tick()
    await engine.drain()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('rest')
    expect(toy.action.rule).toBe('CH')
    expect(toy.wrote).toBe(false)
    expect(dispatcher.calls).toHaveLength(0)
    // Nothing landed on the branch: no intent commit, so no ledger entry to
    // meter, no failure to count, and no escalation calling the role broken.
    expect(await source.git.revParse('refs/heads/run/toy')).toBe(before)
    const { state } = await source.readState(toyRef(dir))
    expect(parseLedger(state)).toHaveLength(0)
    expect(state!.escalations).toHaveLength(0)
    expect(state!.phase).toBe('spec')
    // The condition is reported at the host level, remedy ahead of the path.
    const [deferral] = engine.deferrals()
    expect(deferral).toMatchObject({ slug: 'toy', rule: 'CH' })
    expect(deferral!.reason).toContain(held.replace(/\/$/, ''))
    expect(deferral!.reason).toContain('git worktree remove')
    expect(deferral!.reason).toContain('run the agent by hand')
    expect(lines.join('\n')).toContain('dispatch blocked')
  })

  it('dispatches on the next tick once the checkout is released', async () => {
    const { dir, clock } = toyRepo()
    const held = humanCheckout(dir, 'run/toy')
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher)

    await engine.tick()
    await engine.drain()
    expect(dispatcher.calls).toHaveLength(0)
    expect(engine.deferrals()).toHaveLength(1)

    execFileSync('git', ['-C', dir, 'worktree', 'remove', '--force', held])
    expect(await heldCheckout(dir, 'run/toy')).toBeNull()

    const outcomes = await engine.tick()
    await engine.drain()
    try {
      expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
      expect(dispatcher.calls.map((c) => c.role)).toEqual(['analyst'])
      expect(engine.deferrals()).toHaveLength(0)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('does not mistake its own worktree for a human one', async () => {
    const { dir, clock } = toyRepo()
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher)
    try {
      const outcomes = await engine.tick()
      // The engine's own checkout exists while the job runs; a second tick
      // mid-flight must not read it as held.
      const again = await engine.tick()
      await engine.drain()
      expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
      expect(again.find((o) => o.slug === 'toy')?.action.rule).not.toBe('CH')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('a dispatch refused before spawn meters nothing (#155)', () => {
  it('closes the ledger entry at $0, marked refused, and neither fails nor retries nor escalates', async () => {
    const { dir } = toyRepo()
    // The seam's own word for "nothing ran": the same shape the engine's
    // pre-spawn catch produces when the checkout is refused in the gap
    // between the guard and the launch.
    const dispatcher = new FakeDispatcher(() => ({ ok: false, refused: true, costUsd: 0, tokensIn: null, tokensOut: null, error: 'preflight refused' }))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await engine.tick()
      await engine.drain()
      await engine.tick()
      await engine.drain()

      const { state } = await source.readState(toyRef(dir))
      const ledger = parseLedger(state)
      expect(ledger).toHaveLength(2) // re-derived each tick; nothing was "tried"
      for (const entry of ledger) {
        expect(entry).toMatchObject({ role: 'analyst', cost_usd: 0, refused: true, failed: false })
      }
      expect(state!.budget!.cost_spent_usd).toBe(0)
      expect(state!.escalations).toHaveLength(0)
      expect(state!.phase).toBe('spec')
      const subjects = execFileSync('git', ['-C', dir, 'log', '--format=%s', 'run/toy'], { encoding: 'utf8' })
      expect(subjects).toContain('metered analyst $0.00 — refused: preflight refused')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('the escalation is worded from the facts (#114)', () => {
  it('a fatal first failure says one attempt, not twice', async () => {
    const { dir } = toyRepo()
    const dispatcher = new FakeDispatcher(() => ({ ok: false, fatal: true, costUsd: null, tokensIn: null, tokensOut: null, error: 'plan defect' }))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await engine.tick()
      await engine.drain()
      const { state } = await source.readState(toyRef(dir))
      expect(parseLedger(state).filter((e) => e.failed)).toHaveLength(1)
      expect(state!.phase).toBe('paused')
      const reason = state!.escalations[0]!.reason
      expect(reason).toContain('failed on its first attempt (fatal')
      expect(reason).not.toContain('twice')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})
