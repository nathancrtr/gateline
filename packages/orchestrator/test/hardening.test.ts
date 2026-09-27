// M4 hardening: the crash-recovery drill (kill mid-dispatch, restart,
// converge with no duplicate) and per-task worktree isolation for parallel
// implementers (the wordfreq retro fix), including the fold-conflict → plan
// defect escalation.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { Governor, type GovernorPort } from '../src/governor.ts'
import { parseLedger } from '../src/observe.ts'
import {
  agentCommit,
  deadEngineId,
  FakeDispatcher,
  humanDecide,
  log,
  makeToyRepo,
  PLAN,
  REVIEW,
  reconcile,
  SPEC,
  TEST_REGISTRY,
  taskYaml,
  toyRef,
  VERIFICATION,
} from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

describe('crash recovery (M4 drill)', () => {
  it('a dispatch lost to a crash is aged out and re-dispatched exactly once', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()

    // Engine 1 commits the dispatch intent, then the host "dies": the
    // dispatcher never returns and the process state is simply abandoned —
    // exactly the §4.4 crash between commit and completion. It runs under the
    // identity of a process that has already exited (#349), which is what the
    // record of a crashed engine actually looks like: the ledger entry names a
    // pid, and by the time the restart sweeps, that pid is gone.
    const hung = new FakeDispatcher(() => new Promise(() => {}))
    const engine1 = new Engine({ repoDir: dir, identity: BOT, dispatcher: hung, registry: TEST_REGISTRY, engineId: deadEngineId() })
    await engine1.tick() // commits intent, launches the never-returning job
    // (engine1 is now abandoned; its in-memory job table dies with it)

    const source = new LocalGitSource('check', dir)
    let { state } = await source.readState(toyRef(dir))
    let ledger = parseLedger(state)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ role: 'analyst', cost_usd: null, failed: false }) // open, no living job

    // A fresh engine (the restart) with an aggressive stale window probes,
    // ages the orphan, and re-dispatches. Converges to one success.
    const live = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine2 = new Engine({ repoDir: dir, identity: BOT, dispatcher: live, registry: TEST_REGISTRY, staleMs: 0 })
    await reconcile(engine2)

    state = (await source.readState(toyRef(dir))).state
    ledger = parseLedger(state)
    const analyst = ledger.filter((e) => e.role === 'analyst')
    expect(analyst).toHaveLength(2) // the aged orphan + the successful retry
    expect(analyst.filter((e) => e.failed)).toHaveLength(1)
    expect(analyst.filter((e) => !e.failed && e.cost_usd !== null)).toHaveLength(1)
    expect(live.calls).toHaveLength(1) // no duplicate dispatch
    expect(state!.phase).toBe('spec') // resting at G0, not paused: one failure is a retry, not an escalation
    const g0Waits = log(dir).filter((l) => l.includes('dispatched analyst'))
    expect(g0Waits).toHaveLength(2) // intent committed once per dispatch, never doubled
  })
})

describe('the stale sweep reads who opened the entry (#349)', () => {
  /** Tick an engine into a never-returning analyst dispatch and walk away from it. */
  async function orphanAnalyst(dir: string, engineId?: string): Promise<void> {
    const hung = new FakeDispatcher(() => new Promise(() => {}))
    await new Engine({ repoDir: dir, identity: BOT, dispatcher: hung, registry: TEST_REGISTRY, engineId }).tick()
  }

  const analystEntries = async (dir: string) =>
    parseLedger((await new LocalGitSource('check', dir).readState(toyRef(dir))).state).filter((e) => e.role === 'analyst')

  it('ages an entry opened under its own identity once staleMs has passed', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const id = `${hostname()}:4242`
    await orphanAnalyst(dir, id)
    expect((await analystEntries(dir))[0]!.engine).toBe(id) // the dispatch signs its intent

    // The engine comes back under the same name — a restart the supervisor
    // re-identifies, or an operator-set engineId. An entry it wrote with no
    // job of its own behind it is the §4.4 crash signature, and nothing else:
    // age it on the short window.
    const live = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const restart = new Engine({ repoDir: dir, identity: BOT, dispatcher: live, registry: TEST_REGISTRY, staleMs: 0, engineId: id })
    await restart.tick()
    await restart.drain()

    const entries = await analystEntries(dir)
    expect(entries).toHaveLength(2)
    expect(entries.filter((e) => e.failed)).toHaveLength(1)
    expect(live.calls).toHaveLength(1)
  })

  it('claims an entry that names no engine at all — a pre-#349 or hand-written one', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const source = new LocalGitSource('human', dir)
    const at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const write = await source.writeState(
      toyRef(dir),
      (doc) =>
        doc.setIn(
          ['budget', 'ledger'],
          [{ at, role: 'analyst', task: null, round: null, adapter: 'test', model: 'test', tokens_in: null, tokens_out: null, cost_usd: null }],
        ),
      'state(toy): hand-written open entry, no engine named',
    )
    expect(write.ok).toBe(true)
    expect((await analystEntries(dir))[0]!.engine).toBeNull()

    // Nothing names an owner, so nobody else can be waiting on it: the default
    // five-minute window applies, and an engine upgraded across the key still
    // recovers the entries its old code wrote.
    const live = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: live, registry: TEST_REGISTRY })
    await engine.tick()
    await engine.drain()

    const entries = await analystEntries(dir)
    expect(entries).toHaveLength(2)
    expect(entries.filter((e) => e.failed)).toHaveLength(1)
    expect(live.calls).toHaveLength(1)
  })

  it('waits out the role timeout on an entry another live engine opened', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    await orphanAnalyst(dir) // default identity: this very process, demonstrably alive
    const roleTimeoutMs = 30 * 60 * 1000

    const live = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const other = new Engine({ repoDir: dir, identity: BOT, dispatcher: live, registry: TEST_REGISTRY, staleMs: 0, roleTimeoutMs })
    await other.tick()
    await other.drain()
    // staleMs: 0 is the most aggressive window there is, and it still does not
    // touch someone else's live job — the #349 regression in one line.
    expect(live.calls).toHaveLength(0)
    expect((await analystEntries(dir)).filter((e) => e.failed)).toHaveLength(0)

    // Past the role timeout plus the stale grace, no live job can be behind it
    // whoever opened it: that is when its own engine would have killed it.
    const later = new Engine({
      repoDir: dir,
      identity: BOT,
      dispatcher: live,
      registry: TEST_REGISTRY,
      staleMs: 0,
      roleTimeoutMs,
      now: () => new Date(Date.now() + roleTimeoutMs + 60_000),
    })
    await later.tick()
    await later.drain()

    const entries = await analystEntries(dir)
    expect(entries).toHaveLength(2)
    expect(entries.filter((e) => e.failed)).toHaveLength(1)
    expect(live.calls).toHaveLength(1)
  })
})

/** What an implementer's worktree was cut from, read inside the dispatch before the agent writes (#547). */
interface TaskCut {
  task: string
  /** The commit the worktree was cut from: its HEAD before the agent commits. */
  base: string
  /** The intent commit that dispatched this task: the newest one in the worktree's history naming it. */
  intent: string | null
  /** Sibling tasks whose agent commit is already in the worktree's history — folded before it was cut. */
  folded: string[]
}

const readGit = (cwd: string, args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const short = (sha: string | null): string => (sha === null ? 'none' : sha.slice(0, 7))

function cutOf(cwd: string, task: string, tasks: string[]): TaskCut {
  const base = readGit(cwd, ['rev-parse', 'HEAD'])
  const history = readGit(cwd, ['log', '--format=%H %s', 'HEAD']).split('\n')
  const intent = history.find((l) => l.includes(' dispatched ') && l.includes(`implementer(${task} r`))?.split(' ')[0] ?? null
  const folded = tasks.filter((t) => t !== task && history.some((l) => l.endsWith(` toy: task ${t} r1`)))
  return { task, base, intent, folded }
}

/** The run branch from the first implementer intent on, oldest first: the dispatch and fold order. */
function foldOrder(dir: string, tasks: string[]): string[] {
  const history = readGit(dir, ['log', '--reverse', '--format=%h %s', 'run/toy']).split('\n')
  const from = history.findIndex((l) => l.includes(' dispatched ') && tasks.some((t) => l.includes(`implementer(${t} r`)))
  return from < 0 ? ['(no implementer was dispatched)'] : history.slice(from).map((l) => `run/toy: ${l}`)
}

/**
 * Land a commit on run/toy behind the engine's back, synchronously, with
 * plumbing only (no checkout of the run branch, which would change how the
 * engine writes state). It stands for a sibling job's fold landing.
 */
function landBehind(dir: string, path: string, message: string): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_INDEX_FILE: join(dir, '.git', 'land-behind.index') }
  const run = (args: string[], input?: string) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, input }).trim()
  const tip = run(['rev-parse', 'refs/heads/run/toy'])
  run(['read-tree', tip])
  const blob = run(['hash-object', '-w', '--stdin'], `# ${message}\n`)
  run(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`])
  const tree = run(['write-tree'])
  const commit = run(['-c', 'user.name=toy-sibling', '-c', 'user.email=sibling@example.test', 'commit-tree', tree, '-p', tip, '-m', message])
  run(['update-ref', 'refs/heads/run/toy', commit, tip])
  return commit
}

/**
 * A governor that moves the run branch at the moment the engine hands a
 * matching grant over to its launched job — after the intent commit, and
 * before that job's `git worktree add` can have run, since the hand-over is
 * synchronous and the job's first git command has only just been spawned.
 * That is exactly the window in which a sibling job's fold can land (#547),
 * made deterministic.
 */
function movingGovernor(matches: (key: string) => boolean, move: () => void): GovernorPort {
  const governor = new Governor({ maxConcurrentDispatches: 2 })
  const reserve = governor.reserve.bind(governor)
  governor.reserve = (request) => {
    const result = reserve(request)
    for (const slot of result.granted) {
      if (!matches(slot.key)) continue
      const commit = slot.commit.bind(slot)
      slot.commit = (ledgerAt) => {
        commit(ledgerAt)
        move()
      }
    }
    return result
  }
  return governor
}

describe('per-task worktree isolation (M4, wordfreq retro fix)', () => {
  /**
   * `leaveUncommitted` plays #184's implementer: it writes its surface file
   * and never commits it, so only the fold's harvest can save the work from
   * the task worktree's teardown.
   */
  function repoThroughG1(surfaces: Record<string, string>, leaveUncommitted = false, governor?: (dir: string) => GovernorPort) {
    const { dir, clock } = makeToyRepo()
    const observed: Record<string, boolean> = {}
    const cuts: Record<string, TaskCut> = {}
    const timeline: string[] = []
    const dispatcher = new FakeDispatcher((req) => {
      switch (req.role) {
        case 'analyst':
          agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
          return {}
        case 'architect': {
          const files: Record<string, string> = { 'runs/toy/plan.md': PLAN }
          for (const [task, surface] of Object.entries(surfaces)) files[`runs/toy/tasks/${task}.yaml`] = taskYaml(task, surface)
          agentCommit(req.cwd, clock, files, 'toy: plan and tasks')
          return {}
        }
        case 'implementer': {
          const task = Object.keys(surfaces).find((t) => req.body.includes(t))!
          const surface = surfaces[task]!
          // What this worktree was cut from, recorded before the agent writes
          // anything: the commit, the intent commit that dispatched this task,
          // and which sibling tasks' work was already folded into it. That is
          // what lets a failure below say which case it caught (#547).
          cuts[task] = cutOf(req.cwd, task, Object.keys(surfaces))
          timeline.push(
            `${task} starts in a worktree cut from ${short(cuts[task].base)}` +
              (cuts[task].folded.length > 0 ? `, which already holds ${cuts[task].folded.join(', ')}'s fold` : ''),
          )
          // The isolation assertion itself: the sibling task's surface file
          // must not be visible in this implementer's working tree.
          for (const [other, otherSurface] of Object.entries(surfaces)) {
            if (other !== task) observed[`${task}-saw-${other}`] = existsSync(join(req.cwd, otherSurface))
          }
          const bookkeeping = { [`runs/toy/tasks/${task}.yaml`]: taskYaml(task, surface, [], 'done') }
          if (leaveUncommitted) {
            // After the bookkeeping commit, so it stays genuinely uncommitted
            // (`agentCommit` stages the whole tree).
            agentCommit(req.cwd, clock, bookkeeping, `toy: task ${task} r1`)
            mkdirSync(dirname(join(req.cwd, surface)), { recursive: true })
            writeFileSync(join(req.cwd, surface), `# built by ${task}\n`)
          } else {
            agentCommit(req.cwd, clock, { [surface]: `# built by ${task}\n`, ...bookkeeping }, `toy: task ${task} r1`)
          }
          timeline.push(`${task} returns; its fold follows`)
          return {}
        }
        case 'reviewer': {
          const task = Object.keys(surfaces).find((t) => req.body.includes(t))!
          const n = Object.keys(surfaces).indexOf(task) + 1
          agentCommit(req.cwd, clock, { [`runs/toy/review-0${n}.md`]: REVIEW(task, 'approve', 1) }, `toy: review ${task}`)
          return {}
        }
        case 'verifier':
          agentCommit(req.cwd, clock, { 'runs/toy/verification-report.md': VERIFICATION }, 'toy: verification')
          return {}
        default:
          return {}
      }
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 600_000, governor: governor?.(dir) })
    return { dir, engine, observed, dispatcher, cuts, timeline }
  }

  it('parallel implementers never observe each other’s mid-flight state; folds land both', { timeout: 90_000 }, async () => {
    const { dir, engine, observed, cuts, timeline } = repoThroughG1({ '01-a': 'src/a.py', '02-b': 'src/b.py' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
    await reconcile(engine)

    // Three ways the sibling's file can reach an implementer, told apart so a
    // failure names its case (#547). The order of events goes with each one.
    const a = cuts['01-a']!
    const b = cuts['02-b']!
    const story = `\n  ${[...foldOrder(dir, ['01-a', '02-b']), ...timeline].join('\n  ')}`
    // 1. Held back: both tasks are pending with disjoint surfaces under a cap
    //    of 2, so one tick dispatches both, in one intent commit.
    for (const [late, early] of [
      [b, a],
      [a, b],
    ] as const) {
      expect(
        late.intent,
        `${late.task} was dispatched by a later intent commit (${short(late.intent)}) than ${early.task} (${short(early.intent)}): ` +
          `its dispatch was held back out of the tick that dispatched ${early.task}${story}`,
      ).toBe(early.intent)
    }
    // 2. Cut late: a dispatch works on the state its intent commit recorded.
    //    Its worktree is cut from that commit, never from wherever the run
    //    branch has moved since, so a sibling that finished and folded first
    //    is not in it.
    for (const cut of [a, b]) {
      expect(
        cut.base,
        `${cut.task}'s worktree was cut from ${short(cut.base)}, not from the intent commit that dispatched it (${short(cut.intent)})` +
          (cut.folded.length > 0 ? `: ${cut.folded.join(', ')} had already folded into the run branch` : '') +
          story,
      ).toBe(cut.intent)
    }
    // 3. Leaked: neither implementer saw the other's surface file mid-flight.
    expect(observed['01-a-saw-02-b'], `01-a saw 02-b's file while 02-b was still running${story}`).toBe(false)
    expect(observed['02-b-saw-01-a'], `02-b saw 01-a's file while 01-a was still running${story}`).toBe(false)

    // Both results folded back into the run branch; both tasks progressed.
    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    expect(state!.tasks.map((t) => t.status).sort()).toEqual(['review-approved', 'review-approved'])
    const git = source.git
    expect(await git.show('run/toy', 'src/a.py')).toContain('01-a')
    expect(await git.show('run/toy', 'src/b.py')).toContain('02-b')
    // No task branches or worktrees left behind.
    expect(await git.forEachRef(['refs/heads/run/toy--task/*'])).toHaveLength(0)
  })

  it('a dispatch works on the state its intent commit recorded, when the run branch moves before its worktree is cut (#547)', { timeout: 90_000 }, async () => {
    // A sibling's fold lands on run/toy after 01-a's intent commit and before
    // 01-a's worktree is cut: the order that made the parallel test above
    // fail once on CI, forced here every time.
    let landed: string | null = null
    const { dir, engine, cuts } = repoThroughG1({ '01-a': 'src/a.py' }, false, (repo) =>
      movingGovernor(
        (key) => key === 'toy|implementer|01-a|1',
        () => {
          landed = landBehind(repo, 'src/sibling.py', 'toy: a sibling fold lands')
        },
      ),
    )
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
    await reconcile(engine)

    expect(landed, 'the governor never handed over 01-a’s grant, so nothing moved the run branch').not.toBeNull()
    const cut = cuts['01-a']!
    expect(cut.intent).not.toBeNull()
    expect(
      cut.base,
      `01-a's worktree was cut from ${short(cut.base)}, where the run branch stood when the job ran, ` +
        `not from its intent commit ${short(cut.intent)}; the sibling commit ${short(landed)} had landed in between`,
    ).toBe(cut.intent)
    // The fold rebased onto the moved tip, so both reached the run branch.
    const source = new LocalGitSource('check', dir)
    expect(await source.git.show('run/toy', 'src/a.py')).toContain('01-a')
    expect(await source.git.show('run/toy', 'src/sibling.py')).toContain('sibling fold')
    const { state } = await source.readState(toyRef(dir))
    expect(state!.tasks.map((t) => t.status)).toEqual(['review-approved'])
  })

  it('the fold harvests what an implementer left uncommitted inside its own surface (#184)', { timeout: 90_000 }, async () => {
    const { dir, engine } = repoThroughG1({ '01-a': 'src/a.py' }, true)
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
    await reconcile(engine)

    // The engine read the task's file_contact_surface out of its YAML and
    // handed it to the fold as the harvest's scope, so the uncommitted work
    // reached the run branch instead of dying with the task worktree.
    const source = new LocalGitSource('check', dir)
    expect(await source.git.show('run/toy', 'src/a.py')).toContain('01-a')
    const harvests = log(dir).filter((l) => l.includes('harvested implementer(01-a'))
    expect(harvests).toHaveLength(1)
    expect(harvests[0]!.startsWith(`${BOT.name}|`)).toBe(true)
    const { state } = await source.readState(toyRef(dir))
    expect(state!.tasks.map((t) => t.status)).toEqual(['review-approved'])
  })

  it('a fold conflict escalates as a plan defect (declared-disjoint surfaces that were not)', { timeout: 90_000 }, async () => {
    // Both tasks declare different surfaces but write the same file — the
    // Architect's guarantee was wrong, and the rebase add/add conflict is
    // the proof. Pause + escalation, not a mangled merge.
    const { dir, engine } = (() => {
      const { dir, clock } = makeToyRepo()
      const dispatcher = new FakeDispatcher((req) => {
        switch (req.role) {
          case 'analyst':
            agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
            return {}
          case 'architect':
            agentCommit(
              req.cwd,
              clock,
              {
                'runs/toy/plan.md': PLAN,
                'runs/toy/tasks/01-a.yaml': taskYaml('01-a', 'src/a.py'),
                'runs/toy/tasks/02-b.yaml': taskYaml('02-b', 'src/b.py'),
              },
              'toy: plan and tasks',
            )
            return {}
          case 'implementer': {
            const task = req.body.includes('01-a') ? '01-a' : '02-b'
            // Both write src/shared.py with different content: the lie.
            agentCommit(
              req.cwd,
              clock,
              { 'src/shared.py': `# ${task} version\n`, [`runs/toy/tasks/${task}.yaml`]: taskYaml(task, `src/${task}.py`, [], 'done') },
              `toy: task ${task} r1`,
            )
            return {}
          }
          default:
            return {}
        }
      })
      const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 600_000 })
      return { dir, engine }
    })()

    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
    await reconcile(engine)

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe('escalation')
    expect(state!.escalations.some((e) => e.reason.includes('plan defect'))).toBe(true)
    // The surviving fold landed; the conflicting one did not mangle the branch.
    expect(await source.git.show('run/toy', 'src/shared.py')).toBeTruthy()
  })
})
