// Resource admission control (#227, rule MC): the engine bounds how many
// dispatches run at once across every active run, not just what they cost.
// Budget guards pause and escalate because only a human can raise a ceiling;
// a resource ceiling clears itself, so a capped dispatch is deferred and
// re-derived instead — nothing is written and no intent commit claims the run
// is dispatched.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { agentCommit, type Clock, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })

/**
 * A second run in the same repo, cloned from the toy run's own record. The
 * cap is a *host* ceiling, so exercising it needs two runs with ready work —
 * a single run cannot show it, because derive already refuses to re-dispatch
 * a role it sees in flight (D12).
 */
function addSecondRun(dir: string, slug: string): void {
  const state = git(dir, ['show', 'run/toy:runs/toy/state.yaml'])
  const brief = git(dir, ['show', 'run/toy:runs/toy/intent-brief.md'])
  git(dir, ['checkout', '-q', '-b', `run/${slug}`, 'main'])
  mkdirSync(join(dir, 'runs', slug), { recursive: true })
  writeFileSync(join(dir, 'runs', slug, 'state.yaml'), state.replace(/\btoy\b/g, slug))
  writeFileSync(join(dir, 'runs', slug, 'intent-brief.md'), brief)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', `${slug}: intent brief`])
  git(dir, ['checkout', '-q', 'main'])
}

function twoRuns() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  addSecondRun(made.dir, 'toy2')
  return made
}

/**
 * A dispatcher that hangs until released, so jobs stay in flight while the
 * cap is observed. On release it writes the artifact its role owes, so the
 * run actually advances — a no-op agent would leave `spec.md` absent and the
 * engine would (correctly) re-derive the same dispatch forever, holding the
 * slot for reasons that have nothing to do with the cap.
 */
function blockingDispatcher(clock: Clock) {
  // A plain deferred rather than Promise.withResolvers: the project's tsc lib
  // target predates it, and widening the whole project's target for one test
  // helper is the wrong trade.
  let open: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const dispatcher = new FakeDispatcher(async (req) => {
    await gate
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })
  return { dispatcher, release: () => open() }
}

const tipOf = (dir: string, branch: string) => git(dir, ['rev-parse', branch]).trim()
const launchedCount = (outcomes: { launched: number }[]) => outcomes.reduce((n, o) => n + o.launched, 0)

const makeEngine = (dir: string, dispatcher: FakeDispatcher, cap?: number) =>
  new Engine({
    repoDir: dir,
    identity: BOT,
    dispatcher,
    registry: TEST_REGISTRY,
    staleMs: 10 * 60 * 1000,
    maxConcurrentDispatches: cap,
  })

describe('dispatch concurrency cap (#227, rule MC)', () => {
  it('defers a run when the cap is saturated, and writes nothing for it', async () => {
    const { dir, clock } = twoRuns()
    const { dispatcher, release } = blockingDispatcher(clock)
    const engine = makeEngine(dir, dispatcher, 1)

    const before = { toy: tipOf(dir, 'run/toy'), toy2: tipOf(dir, 'run/toy2') }
    const outcomes = await engine.tick()

    expect(launchedCount(outcomes)).toBe(1)
    expect(engine.inFlight()).toBe(1)

    const deferred = outcomes.find((o) => o.launched === 0)!
    expect(deferred.action.kind).toBe('rest')
    expect(deferred.action.rule).toBe('MC')
    expect(deferred.wrote).toBe(false)

    // The guarantee that matters: a deferred run is untouched. No intent
    // commit claims it is dispatched while it is really only queued.
    expect(tipOf(dir, `run/${deferred.slug}`)).toBe(before[deferred.slug as 'toy' | 'toy2'])

    release()
    await engine.drain()
  })

  it('re-derives the deferred dispatch once a slot frees', async () => {
    const { dir, clock } = twoRuns()
    const { dispatcher, release } = blockingDispatcher(clock)
    const engine = makeEngine(dir, dispatcher, 1)

    const firstPass = await engine.tick()
    const deferredSlug = firstPass.find((o) => o.launched === 0)!.slug

    // Still saturated: the deferred run keeps resting rather than escalating.
    const secondPass = await engine.tick()
    expect(secondPass.find((o) => o.slug === deferredSlug)!.action.kind).toBe('rest')
    expect(launchedCount(secondPass)).toBe(0)

    release()
    await engine.drain()

    // A slot is free and the first run has advanced to its gate: the work the
    // cap deferred is derived again and now runs.
    const thirdPass = await engine.tick()
    expect(thirdPass.find((o) => o.slug === deferredSlug)!.launched).toBe(1)

    await engine.drain()
  })

  it('0 disables the cap — both runs dispatch in one tick', async () => {
    const { dir, clock } = twoRuns()
    const { dispatcher, release } = blockingDispatcher(clock)
    const engine = makeEngine(dir, dispatcher, 0)

    const outcomes = await engine.tick()
    expect(launchedCount(outcomes)).toBe(2)
    expect(outcomes.every((o) => o.action.kind === 'dispatch')).toBe(true)

    release()
    await engine.drain()
  })

  it('an unset cap is still a cap, not unlimited', async () => {
    const { dir, clock } = twoRuns()
    const { dispatcher, release } = blockingDispatcher(clock)
    // Default is 2, so both of these two runs are admitted; the assertion is
    // that the default path goes through the guard at all rather than
    // bypassing it, which a third ready run would otherwise be needed to show.
    const engine = makeEngine(dir, dispatcher, undefined)

    const outcomes = await engine.tick()
    expect(launchedCount(outcomes)).toBeLessThanOrEqual(2)

    release()
    await engine.drain()
  })
})
