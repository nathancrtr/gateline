// Same-round retry resume (#181): a retry of the same role+task+round is the
// same attempt at the same work, so it continues the harness session the first
// attempt opened instead of re-deriving everything from nothing (the
// runs/runner-agent incident: an architect redispatched 10+ times, each one
// re-reading dozens of the same files). A new round starts fresh, and a resume
// the harness will not take costs a fresh dispatch and nothing else.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalGitSource } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { type HeadlessManifest, loadHeadlessManifest } from '../src/manifest.ts'
import { parseLedger } from '../src/observe.ts'
import { HeadlessDispatcher } from '../src/seam.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import {
  agentCommit,
  appendToFile,
  FakeDispatcher,
  humanDecide,
  makeToyRepo,
  PLAN,
  REVIEW,
  reconcile,
  SPEC,
  TEST_REGISTRY,
  taskYaml,
  toyRef,
} from './engine.helper.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

/**
 * A toy ndjson runner. `probe` is `$0`, so anything the seam appended for a
 * resume lands in `"$@"` and the script can both see it and record it.
 */
const toyManifest = (script: string, over: Partial<HeadlessManifest> = {}): HeadlessManifest => ({
  adapter: 'toy-ndjson',
  command: ['sh', '-c', script, 'probe'],
  dispatchPrompt: '{body}',
  usage: {
    format: 'ndjson-sum',
    lineFilter: { type: 'step_finish' },
    fields: { cost_usd: 'part.cost', tokens_in: 'part.tokens.input', tokens_out: 'part.tokens.output' },
  },
  modelMap: {},
  modelOverrides: {},
  modelVendors: {},
  sessionField: 'sessionID',
  resumeArgs: ['--session', '{session}'],
  ...over,
})

const req = { cwd: tmpdir(), role: 'implementer', body: 'x', timeoutMs: 30_000 }

/** One `step_finish` line, as opencode's `--format json` spells one. */
const finishLine = (session: string) =>
  `'{"type":"step_finish","sessionID":"${session}","part":{"cost":0.5,"tokens":{"input":10,"output":5}}}'`

describe('the seam records the harness session (#181)', () => {
  it('reads the session id off the event stream at the path the manifest names', async () => {
    const dispatcher = new HeadlessDispatcher(toyManifest(`printf '%s\\n' '{"type":"step_start","sessionID":"ses_abc"}' ${finishLine('ses_abc')}`))
    const outcome = await dispatcher.dispatch(req)
    expect(outcome.ok).toBe(true)
    expect(outcome.session).toBe('ses_abc')
  })

  it('reports no session for a runner whose manifest names no path', async () => {
    const manifest = toyManifest(`printf '%s\\n' ${finishLine('ses_abc')}`, { sessionField: undefined })
    const outcome = await new HeadlessDispatcher(manifest).dispatch(req)
    expect(outcome.ok).toBe(true)
    expect(outcome.session).toBeNull()
  })
})

describe("the seam passes the adapter's resume flags (#181)", () => {
  /** A script that records the argv it was appended, then reports a session. */
  const probeScript = (file: string, session = 'ses_new') => `echo "$@" > ${file}; printf '%s\\n' ${finishLine(session)}`

  it('appends the manifest template, with {session} filled in, when the engine supplies one', async () => {
    const probe = join(mkdtempSync(join(tmpdir(), 'gateline-resume-')), 'argv')
    const dispatcher = new HeadlessDispatcher(toyManifest(probeScript(probe)))
    await dispatcher.dispatch({ ...req, resumeSession: 'ses_abc' })
    expect(readFileSync(probe, 'utf8').trim()).toBe('--session ses_abc')
  })

  it('appends nothing when there is no prior session — a first dispatch, or a new round', async () => {
    const probe = join(mkdtempSync(join(tmpdir(), 'gateline-resume-')), 'argv')
    const dispatcher = new HeadlessDispatcher(toyManifest(probeScript(probe)))
    await dispatcher.dispatch(req)
    expect(readFileSync(probe, 'utf8').trim()).toBe('')
  })

  it('appends nothing for a runner that declares no resume_args, whatever the ledger carries', async () => {
    const probe = join(mkdtempSync(join(tmpdir(), 'gateline-resume-')), 'argv')
    const manifest = toyManifest(probeScript(probe), { resumeArgs: undefined })
    await new HeadlessDispatcher(manifest).dispatch({ ...req, resumeSession: 'ses_abc' })
    expect(readFileSync(probe, 'utf8').trim()).toBe('')
  })
})

describe('a refused resume never costs the dispatch (#181)', () => {
  const runsIn = (dir: string) => readFileSync(join(dir, 'runs'), 'utf8').split('\n').filter(Boolean).length

  it('re-dispatches fresh when the harness rejects the session, and says so', async () => {
    // opencode's own refusal: a session it no longer holds exits 1 with
    // "Session not found" and no JSON at all.
    const dir = mkdtempSync(join(tmpdir(), 'gateline-resume-'))
    writeFileSync(join(dir, 'runs'), '')
    const script = `echo run >> ${join(dir, 'runs')}; if [ "$1" = "--session" ]; then echo "Session not found" >&2; exit 1; fi; printf '%s\\n' ${finishLine('ses_fresh')}`
    const outcome = await new HeadlessDispatcher(toyManifest(script)).dispatch({ ...req, resumeSession: 'ses_gone' })
    expect(outcome.ok).toBe(true)
    expect(outcome.resumeRefused).toBe(true)
    expect(outcome.session).toBe('ses_fresh')
    expect(outcome.costUsd).toBe(0.5) // the fresh attempt's usage, whole
    expect(runsIn(dir)).toBe(2)
  })

  it('does not re-run a resumed dispatch that failed after the session was established', async () => {
    // The agent got its session and then the work failed: that is the run's
    // own failure, to be metered and retried by the engine's rules — not a
    // second harness launch on the seam's initiative.
    const dir = mkdtempSync(join(tmpdir(), 'gateline-resume-'))
    writeFileSync(join(dir, 'runs'), '')
    const script = `echo run >> ${join(dir, 'runs')}; printf '%s\\n' ${finishLine('ses_abc')}; exit 3`
    const outcome = await new HeadlessDispatcher(toyManifest(script)).dispatch({ ...req, resumeSession: 'ses_abc' })
    expect(outcome.ok).toBe(false)
    expect(outcome.resumeRefused).toBeUndefined()
    expect(runsIn(dir)).toBe(1)
  })
})

describe('the opencode adapter declares the resume it supports (#181)', () => {
  it('carries a session path and a flag template the seam can fill', async () => {
    const manifest = await loadHeadlessManifest(repoRoot, 'opencode')
    expect(manifest.sessionField).toBe('sessionID')
    expect(manifest.resumeArgs).toEqual(['--session', '{session}'])
  })

  it('leaves the other adapters alone — no key, no resume', async () => {
    for (const adapter of ['claude-code', 'copilot-cli']) {
      const manifest = await loadHeadlessManifest(repoRoot, adapter)
      expect(manifest.sessionField).toBeUndefined()
      expect(manifest.resumeArgs).toBeUndefined()
    }
  })
})

describe('the engine keys the resume on role+task+round (#181)', () => {
  it('records the session on the ledger entry and resumes it on the retry of that same dispatch', async () => {
    const { dir } = makeToyRepo()
    let attempts = 0
    // The analyst fails every time: dispatch, one retry, then the §11
    // escalation — two attempts at one (role, task, round).
    const dispatcher = new FakeDispatcher(() => ({ ok: false, error: 'model outage', session: `ses-${++attempts}` }))
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
    const source = new LocalGitSource('check', dir)
    try {
      await reconcile(engine)
      const calls = dispatcher.calls.filter((c) => c.role === 'analyst')
      expect(calls).toHaveLength(2)
      expect(calls[0]!.resumeSession).toBeFalsy() // nothing to resume on a first attempt
      expect(calls[1]!.resumeSession).toBe('ses-1') // the retry continues it
      const { state } = await source.readState(toyRef(dir))
      expect(parseLedger(state).map((e) => e.session)).toEqual(['ses-1', 'ses-2'])
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('a new round starts fresh — round 2 is a new attempt with new input', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    let reviewer01Calls = 0
    const dispatcher = new FakeDispatcher((req) => {
      switch (req.role) {
        case 'analyst':
          agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
          return { session: 'ses-analyst' }
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
          return { session: 'ses-architect' }
        case 'implementer': {
          const task = req.body.includes('01-core') ? '01-core' : '02-cli'
          const file = task === '01-core' ? 'src/core.py' : 'src/cli.py'
          agentCommit(
            req.cwd,
            clock,
            { [file]: `# ${task} round ${req.round}\n`, [`runs/toy/tasks/${task}.yaml`]: taskYaml(task, file, [], `round ${req.round} done`) },
            `toy: task ${task} round ${req.round}`,
          )
          return { session: `ses-${task}-r${req.round}` }
        }
        case 'reviewer': {
          const task = req.body.includes('01-core') ? '01-core' : '02-cli'
          if (task === '02-cli') {
            agentCommit(req.cwd, clock, { 'runs/toy/review-02.md': REVIEW('02-cli', 'approve', 1) }, 'toy: review 02 round 1')
          } else if (++reviewer01Calls === 1) {
            agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': REVIEW('01-core', 'request-changes', 1) }, 'toy: review 01 round 1')
          } else {
            const appended = appendToFile(req.cwd, 'runs/toy/review-01.md', '\n# Round 2\n\n**Verdict:** approve\n\n## Findings\nResolved.\n')
            agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': appended }, 'toy: review 01 round 2')
          }
          return { session: `ses-review-${task}-r${req.round}` }
        }
        default:
          return {}
      }
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
      await reconcile(engine)
      const implementers = dispatcher.calls.filter((c) => c.role === 'implementer' && c.task === '01-core')
      expect(implementers.map((c) => c.round)).toEqual([1, 2])
      // Round 2 carries the reviewer's findings — different input, different
      // attempt. Resuming round 1's session would hand the agent back the
      // reasoning the review just argued with.
      expect(implementers[1]!.resumeSession).toBeNull()
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})
