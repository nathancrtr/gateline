// The M2 exit criteria, mechanically: a toy run travels G0→G3 with humans
// acting only at gates; the ledger populates automatically; a mid-run pause
// is honored; CAS makes duplicate dispatch impossible; failures retry once
// then escalate; decline recovery re-dispatches with the decline notes.
// The FakeDispatcher plays the harness; humans decide through core's own
// write path, never the engine's.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { LocalGitSource } from '@agentic/core'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import {
  agentCommit,
  appendToFile,
  FakeDispatcher,
  HUMAN,
  humanDecide,
  log,
  makeToyRepo,
  PLAN,
  reconcile,
  RELEASE_PLAN,
  REVIEW,
  SPEC,
  taskYaml,
  TEST_REGISTRY,
  toyRef,
  VERIFICATION,
  type Clock,
} from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

function makeEngine(dir: string, dispatcher: FakeDispatcher, over: Partial<ConstructorParameters<typeof Engine>[0]> = {}): Engine {
  return new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, ...over })
}

/** The full toy pipeline as a dispatcher script: each role produces its contract artifact. */
function pipelineScript(dir: string, clock: Clock) {
  let reviewer01Calls = 0
  let analystCalls = 0
  return (req: { cwd: string; role: string; body: string }) => {
    switch (req.role) {
      case 'analyst':
        // A redone spec differs from its declined predecessor — the landing
        // must be observable as a change to the artifact, not just a commit.
        analystCalls++
        agentCommit(req.cwd, clock, { 'runs/toy/spec.md': analystCalls === 1 ? SPEC : `${SPEC}\n<!-- revision ${analystCalls} -->\n` }, 'toy: spec')
        return {}
      case 'architect':
        agentCommit(
          req.cwd,
          clock,
          {
            'runs/toy/plan.md': PLAN,
            'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py'),
            'runs/toy/tasks/02-cli.yaml': taskYaml('02-cli', 'src/cli.py'),
          },
          'toy: plan and task breakdown',
        )
        return {}
      case 'implementer': {
        const task = req.body.includes('01-core') ? '01-core' : '02-cli'
        const round = req.body.includes('round 2') ? 2 : 1
        agentCommit(
          req.cwd,
          clock,
          {
            [`src/${task === '01-core' ? 'core' : 'cli'}.py`]: `# ${task} round ${round}\n`,
            [`runs/toy/tasks/${task}.yaml`]: taskYaml(task, `src/${task === '01-core' ? 'core' : 'cli'}.py`, [], `round ${round} done`),
          },
          `toy: task ${task} round ${round}`,
        )
        return {}
      }
      case 'reviewer': {
        const task = req.body.includes('01-core') ? '01-core' : '02-cli'
        if (task === '01-core') {
          reviewer01Calls++
          if (reviewer01Calls === 1) {
            agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': REVIEW('01-core', 'request-changes', 1) }, 'toy: review 01 round 1')
          } else {
            const appended = appendToFile(req.cwd, 'runs/toy/review-01.md', `\n# Round 2\n\n**Verdict:** approve\n\n## Findings\nResolved.\n`)
            agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': appended }, 'toy: review 01 round 2')
          }
        } else {
          agentCommit(req.cwd, clock, { 'runs/toy/review-02.md': REVIEW('02-cli', 'approve', 1) }, 'toy: review 02 round 1')
        }
        return {}
      }
      case 'verifier':
        agentCommit(req.cwd, clock, { 'runs/toy/verification-report.md': VERIFICATION }, 'toy: verification report')
        return {}
      case 'ops':
        agentCommit(req.cwd, clock, { 'runs/toy/release-plan.md': RELEASE_PLAN }, 'toy: release plan')
        return {}
      default:
        throw new Error(`unscripted role ${req.role}`)
    }
  }
}

describe('the autonomous loop, one vendor (M2)', () => {
  it(
    'carries a toy run G0→G3 with humans acting only at gates',
    { timeout: 120_000 },
    async () => {
      const { dir, clock } = makeToyRepo()
      const dispatcher = new FakeDispatcher(pipelineScript(dir, clock))
      const engine = makeEngine(dir, dispatcher)
      const source = new LocalGitSource('check', dir)
      const ref = toyRef(dir)

      try {
        // Spec: the engine dispatches the analyst and rests at G0.
        await reconcile(engine)
        let { state } = await source.readState(ref)
        expect(state!.phase).toBe('spec')
        expect(state!.gates.G0.by).toBeNull()
        await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })

        // Plan: architect → G1.
        await reconcile(engine)
        state = (await source.readState(ref)).state
        expect(state!.phase).toBe('plan')
        await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })

        // Implement: seed → parallel implementers → review rounds → verifier → G2.
        await reconcile(engine)
        state = (await source.readState(ref)).state
        expect(state!.phase).toBe('implement')
        expect(state!.tasks.map((t) => `${t.id}:${t.status}:${t.review_rounds}`).sort()).toEqual([
          '01-core:review-approved:2',
          '02-cli:review-approved:1',
        ])
        await humanDecide(dir, { action: 'approve', gate: 'G2', burden: 'light-correction', notes: 'merged' })

        // Release: ops → G3 → done.
        await reconcile(engine)
        state = (await source.readState(ref)).state
        expect(state!.phase).toBe('release')
        await humanDecide(dir, { action: 'approve', gate: 'G3', burden: 'confirmation' })
        await reconcile(engine)
        state = (await source.readState(ref)).state
        expect(state!.phase).toBe('done')

        // The ledger populated automatically: one closed entry per dispatch,
        // cost_spent_usd the derived sum. 10 dispatches: analyst, architect,
        // implementer×3 (01 r1, 01 r2, 02 r1), reviewer×3, verifier, ops.
        const ledger = parseLedger(state)
        expect(ledger).toHaveLength(10)
        expect(ledger.every((e) => e.cost_usd === 1.25 && !e.failed)).toBe(true)
        expect(ledger.every((e) => e.adapter === 'fake' && e.model !== null)).toBe(true)
        expect(state!.budget!.cost_spent_usd).toBeCloseTo(10 * 1.25, 5)

        // Provenance: gates carry only the human's name; every state commit
        // that is not an agent artifact or a human decision is the bot's, and
        // the bot never uses the human decision grammar.
        for (const gate of ['G0', 'G1', 'G2', 'G3'] as const) expect(state!.gates[gate].by).toBe('Toy Operator')
        const commits = log(dir)
        const botCommits = commits.filter((line) => line.startsWith(`${BOT.name}|`))
        expect(botCommits.length).toBeGreaterThanOrEqual(20) // 10 dispatched + 10 metered (dispatch sets may share a commit)
        expect(botCommits.some((line) => /G[0-3] (approved|declined)/.test(line))).toBe(false)
        expect(botCommits.every((line) => /\|state\(toy\): (dispatched|bounced|advanced|escalated|paused|metered|harvested)/.test(line))).toBe(true)

        // The state file's contract comments survived every machine edit.
        const finalState = execFileSync('git', ['-C', dir, 'show', 'run/toy:runs/toy/state.yaml'], { encoding: 'utf8' })
        expect(finalState).toContain('# a gate entry is written ONLY by the named human')
        expect(finalState).toContain('# exhaustion pauses the run')
      } finally {
        await removeRunCheckout(dir, 'run/toy')
      }
    },
  )

  it('honors a mid-run human pause: no new dispatches while paused', async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(pipelineScript(dir, clock))
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine) // analyst done, resting at G0
      const before = dispatcher.calls.length
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await humanDecide(dir, { action: 'pause', pauseReason: 'escalation' })
      await reconcile(engine)
      expect(dispatcher.calls.length).toBe(before) // paused: the architect never launched
      await humanDecide(dir, { action: 'resume' })
      await reconcile(engine)
      expect(dispatcher.calls.length).toBe(before + 1) // resumed: architect dispatched
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('guards duplicate dispatch: two engines, one CAS winner, one open entry', async () => {
    const { dir, clock } = makeToyRepo()
    const d1 = new FakeDispatcher(pipelineScript(dir, clock))
    const d2 = new FakeDispatcher(pipelineScript(dir, clock))
    const e1 = makeEngine(dir, d1)
    const e2 = makeEngine(dir, d2)
    const source = new LocalGitSource('check', dir)
    try {
      await Promise.all([e1.tick(), e2.tick()])
      await Promise.all([e1.drain(), e2.drain()])
      const { state } = await source.readState(toyRef(dir))
      const ledger = parseLedger(state)
      expect(ledger.filter((e) => e.role === 'analyst')).toHaveLength(1)
      expect(log(dir).filter((l) => l.includes('state(toy): dispatched analyst'))).toHaveLength(1)
      expect(d1.calls.length + d2.calls.length).toBe(1)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('pauses budget-exhausted before dispatching past the cap', async () => {
    const { dir, clock } = makeToyRepo({ budget: 1 }) // analyst estimate 2 > 1
    const dispatcher = new FakeDispatcher(pipelineScript(dir, clock))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    await reconcile(engine)
    expect(dispatcher.calls).toHaveLength(0) // pre-flight refused the launch
    const { state } = await source.readState(toyRef(dir))
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe('budget-exhausted')
    expect(state!.escalations).toHaveLength(1)
    expect(state!.escalations[0]!.from_role).toBe('orchestrator')
  })

  it('retries a failed dispatch once, then escalates and pauses', async () => {
    const { dir } = makeToyRepo()
    const dispatcher = new FakeDispatcher(() => ({ ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'model outage' }))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await reconcile(engine)
      const { state } = await source.readState(toyRef(dir))
      const failures = parseLedger(state).filter((e) => e.role === 'analyst' && e.failed)
      expect(failures).toHaveLength(2) // the original and its one retry
      // Failed dispatches are metered conservatively at the static estimate.
      expect(failures.every((e) => e.cost_usd === TEST_REGISTRY.estimates.analyst)).toBe(true)
      expect(state!.phase).toBe('paused')
      expect(state!.paused_reason).toBe('escalation')
      expect(state!.escalations[0]!.reason).toContain('failed twice')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('a failed implementer frees its task for the one retry instead of stranding it at dispatched', { timeout: 60_000 }, async () => {
    // The fleetview-design task-11 stall: a failed close left the task at
    // `dispatched`, which D12 reads as in-flight forever — no retry, and the
    // second-failure escalation unreachable.
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
              'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py'),
              'runs/toy/tasks/02-cli.yaml': taskYaml('02-cli', 'src/cli.py'),
            },
            'toy: plan and task breakdown',
          )
          return {}
        case 'implementer':
          return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'harness timed out after 30min wall clock — process group killed (SIGKILL)' }
        default:
          throw new Error(`unscripted role ${req.role}`)
      }
    })
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
      await reconcile(engine)
      const { state } = await source.readState(toyRef(dir))
      // Each task got its original dispatch and exactly one retry — the
      // failed close handed the task back to derivation as `pending`.
      const failures = parseLedger(state).filter((e) => e.role === 'implementer' && e.failed)
      expect(failures.filter((e) => e.task === '01-core')).toHaveLength(2)
      expect(failures.filter((e) => e.task === '02-cli')).toHaveLength(2)
      expect(state!.phase).toBe('paused')
      expect(state!.paused_reason).toBe('escalation')
      expect(state!.escalations.some((e) => e.reason.includes('failed twice'))).toBe(true)
      // On escalation the task is marked failed — a status nothing reads as
      // in-flight (#147); D20 returns it to pending once a human resolves
      // the naming escalation.
      expect(state!.tasks.every((t) => t.status === 'failed')).toBe(true)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('D20 recovery: resolving the failed-twice escalation returns the task to pending, no hand edit needed', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    let implementerCalls = 0
    const dispatcher = new FakeDispatcher((req) => {
      switch (req.role) {
        case 'analyst':
          agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
          return {}
        case 'architect':
          agentCommit(
            req.cwd,
            clock,
            { 'runs/toy/plan.md': PLAN, 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py') },
            'toy: plan and task breakdown',
          )
          return {}
        case 'implementer':
          implementerCalls++
          if (implementerCalls <= 2) return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'model outage' }
          agentCommit(req.cwd, clock, { 'src/core.py': 'print("core")\n' }, 'toy: 01-core')
          return {}
        default:
          throw new Error(`unscripted role ${req.role}`)
      }
    })
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
      await reconcile(engine) // two failures → task failed, run paused on the escalation
      let { state } = await source.readState(toyRef(dir))
      expect(state!.tasks[0]!.status).toBe('failed')
      expect(state!.phase).toBe('paused')

      // The human resolves the escalation and resumes — the task status is
      // untouched: D20 owns the recovery.
      const human = new LocalGitSource('human', dir, { identity: HUMAN })
      const idx = state!.escalations.findIndex((e) => !e.resolved)
      const write = await human.writeState(
        toyRef(dir),
        (doc) => {
          doc.setIn(['escalations', idx, 'resolved'], true)
          doc.setIn(['escalations', idx, 'resolved_by'], HUMAN.name)
          doc.setIn(['escalations', idx, 'resolved_at'], new Date().toISOString())
          doc.setIn(['phase'], 'implement')
          doc.setIn(['paused_reason'], null)
        },
        'state(toy): resolved the implementer failure and resumed',
      )
      expect(write.ok).toBe(true)

      await engine.tick()
      await engine.drain() // D20 — record failed → pending
      ;({ state } = await source.readState(toyRef(dir)))
      expect(state!.tasks[0]!.status).toBe('pending')

      await engine.tick()
      await engine.drain() // D11 — fresh dispatch; this attempt lands
      ;({ state } = await source.readState(toyRef(dir)))
      expect(implementerCalls).toBe(3)
      expect(state!.tasks[0]!.status).toBe('in-review')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('decline recovery: resume re-opens the gate and re-dispatches with the decline notes', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(pipelineScript(dir, clock))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await reconcile(engine) // spec landed, resting at G0
      await humanDecide(dir, { action: 'decline', gate: 'G0', notes: 'R1 must cover unicode input' })
      await reconcile(engine) // paused gate-declined: rest
      let { state } = await source.readState(toyRef(dir))
      expect(state!.phase).toBe('paused')
      const before = dispatcher.calls.length

      await humanDecide(dir, { action: 'resume' }) // re-opens G0 (core)
      await reconcile(engine)
      expect(dispatcher.calls.length).toBe(before + 1)
      const redo = dispatcher.calls[dispatcher.calls.length - 1]!
      expect(redo.role).toBe('analyst')
      expect(redo.body).toContain('declined')
      expect(redo.body).toContain('R1 must cover unicode input')

      state = (await source.readState(toyRef(dir))).state
      expect(state!.gates.G0.by).toBeNull() // re-opened, decidable again
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'heavy-correction' })
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('ensures a draft PR once per observed branch tip, re-ensuring after the run commits; a skipped ensure never affects the tick outcome (#118, AC8.1 engine half, AC8.2, #208)', async () => {
    // engine.ts memoizes ensureDraftPr in a module-level, per-process Map
    // keyed by slug -> branch tip (ADR-5, #208). Every other test in this file
    // also dispatches for slug `toy` against the same statically-imported
    // Engine module, so a fresh module instance is the only way to observe a
    // genuinely first-ever ensure attempt here, independent of test order.
    vi.resetModules()
    const { Engine: FreshEngine } = await import('../src/engine.ts')
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(pipelineScript(dir, clock))
    const logs: string[] = []
    const engine = new FreshEngine({
      repoDir: dir,
      identity: BOT,
      dispatcher,
      registry: TEST_REGISTRY,
      staleMs: 10 * 60 * 1000,
      log: (line: string) => logs.push(line),
    })
    const ensureLines = () => logs.filter((l) => l.includes('draft PR ensure'))
    try {
      // First dispatching tick (analyst, D6). makeToyRepo's scratch repo
      // never configures a remote, so the ensure call degrades to AC8.2's
      // `skipped` path — never fatal — while the tick still dispatches and
      // rests normally.
      await reconcile(engine) // analyst done, resting at G0
      expect(ensureLines()).toHaveLength(1)
      expect(ensureLines()[0]).toMatch(/skipped/)
      let state = (await new LocalGitSource('check', dir).readState(toyRef(dir))).state
      expect(state!.phase).toBe('spec')
      expect(state!.gates.G0.by).toBeNull()

      // Second dispatching tick for the same slug (the architect, once G0 is
      // approved). The branch has moved since the last ensure — spec.md
      // landed and the gate was signed — so the description gets a chance to
      // catch up with the artifacts (#208). Before that fix a slug-keyed memo
      // froze the description here for the life of the process.
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await reconcile(engine)
      state = (await new LocalGitSource('check', dir).readState(toyRef(dir))).state
      expect(state!.phase).toBe('plan') // unaffected by the ensure: architect ran, resting at G1
      expect(ensureLines()).toHaveLength(2)
      expect(ensureLines()[1]).toMatch(/skipped/) // still the no-remote path: never fatal

      // Resting ticks do not ensure at all — the call lives inside the
      // dispatch branch, so an idle run costs no `gh` round-trip no matter
      // how many times it is reconciled.
      await engine.tick()
      await engine.tick()
      expect(ensureLines()).toHaveLength(2)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('usage parsing (seam)', () => {
  it('reads the claude-code manifest shape from real JSON output', async () => {
    const { parseJsonOutput } = await import('../src/seam.ts')
    const { dig } = await import('../src/manifest.ts')
    const stdout = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.0421,
      usage: { input_tokens: 1200, output_tokens: 340 },
    })
    const parsed = parseJsonOutput(stdout)
    expect(dig(parsed, 'total_cost_usd')).toBe(0.0421)
    expect(dig(parsed, 'usage.input_tokens')).toBe(1200)
    expect(dig(parsed, 'is_error')).toBe(false)
  })

  it('loads both real adapter manifests', async () => {
    const { loadHeadlessManifest } = await import('../src/manifest.ts')
    const { fileURLToPath } = await import('node:url')
    const repoRoot = join(fileURLToPath(import.meta.url), '../../../../..')
    const cc = await loadHeadlessManifest(repoRoot, 'claude-code')
    expect(cc.command[0]).toBe('claude')
    expect(cc.usage.format).toBe('json-stdout')
    expect(cc.usage.fields?.cost_usd).toBe('total_cost_usd')
    const copilot = await loadHeadlessManifest(repoRoot, 'copilot-cli')
    expect(copilot.command[0]).toBe('copilot')
    expect(copilot.usage.format).toBe('static-estimate')
  })
})
