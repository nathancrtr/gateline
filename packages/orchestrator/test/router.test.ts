// M3: dispatch-time P5 enforcement over the real adapter manifests. With
// copilot-cli configured alongside claude-code, a run's Reviewer and
// Verifier demonstrably execute on a different vendor than its Implementer;
// with claude-code alone the pin is unsatisfiable and stays advisory.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { type HeadlessManifest, loadHeadlessManifest } from '../src/manifest.ts'
import { adapterVendor, RoutingDispatcher, VendorPinError } from '../src/router.ts'
import type { Dispatcher, DispatchOutcome, DispatchRequest } from '../src/seam.ts'
import { TEST_REGISTRY } from './engine.helper.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

class RecordingDispatcher implements Dispatcher {
  readonly adapter: string
  readonly roles: string[] = []
  constructor(adapter: string) {
    this.adapter = adapter
  }
  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    this.roles.push(req.role)
    return { ok: true, costUsd: 1, tokensIn: 1, tokensOut: 1, error: null }
  }
}

let claudeCode: HeadlessManifest
let copilot: HeadlessManifest

beforeAll(async () => {
  claudeCode = await loadHeadlessManifest(repoRoot, 'claude-code')
  copilot = await loadHeadlessManifest(repoRoot, 'copilot-cli')
})

describe('adapter vendor resolution (real manifests)', () => {
  it('claude-code runs every role on one vendor', () => {
    for (const role of ['implementer', 'reviewer', 'verifier']) {
      expect(adapterVendor(claudeCode, TEST_REGISTRY, role)).toBe('anthropic')
    }
  })

  it('copilot-cli decorrelates reviewer and verifier via model_overrides', () => {
    expect(adapterVendor(copilot, TEST_REGISTRY, 'implementer')).toBe('anthropic')
    expect(adapterVendor(copilot, TEST_REGISTRY, 'reviewer')).toBe('openai')
    expect(adapterVendor(copilot, TEST_REGISTRY, 'verifier')).toBe('google')
  })
})

describe('RoutingDispatcher (P5 at dispatch time)', () => {
  it('routes pinned roles off the implementer vendor when a second adapter is live', async () => {
    const cc = new RecordingDispatcher('claude-code')
    const cp = new RecordingDispatcher('copilot-cli')
    const router = new RoutingDispatcher(
      [
        { manifest: claudeCode, dispatcher: cc },
        { manifest: copilot, dispatcher: cp },
      ],
      TEST_REGISTRY,
    )
    // Unpinned roles ride the default adapter.
    expect(router.adapterFor('implementer')).toBe('claude-code')
    expect(router.adapterFor('analyst')).toBe('claude-code')
    // Pinned roles are refused the implementer's vendor and land on copilot.
    expect(router.route('reviewer')).toMatchObject({ adapter: 'copilot-cli', vendor: 'openai', advisory: null })
    expect(router.route('verifier')).toMatchObject({ adapter: 'copilot-cli', vendor: 'google', advisory: null })

    const req = { cwd: '/tmp', body: 'x', timeoutMs: 1000 }
    await router.dispatch({ ...req, role: 'implementer' })
    await router.dispatch({ ...req, role: 'reviewer' })
    await router.dispatch({ ...req, role: 'verifier' })
    expect(cc.roles).toEqual(['implementer'])
    expect(cp.roles).toEqual(['reviewer', 'verifier'])
  })

  it('single single-vendor adapter: the pin is advisory, logged once, never fatal', async () => {
    const cc = new RecordingDispatcher('claude-code')
    const lines: string[] = []
    const router = new RoutingDispatcher([{ manifest: claudeCode, dispatcher: cc }], TEST_REGISTRY, (l) => lines.push(l))
    const decision = router.route('reviewer')
    expect(decision.adapter).toBe('claude-code')
    expect(decision.advisory).toContain('P5 advisory')
    await router.dispatch({ cwd: '/tmp', role: 'reviewer', body: 'x', timeoutMs: 1000 })
    await router.dispatch({ cwd: '/tmp', role: 'reviewer', body: 'x', timeoutMs: 1000 })
    expect(cc.roles).toEqual(['reviewer', 'reviewer'])
    expect(lines.filter((l) => l.includes('P5 advisory'))).toHaveLength(1)
  })

  it('a run’s ledger records reviewer/verifier on the second adapter (M3 exit)', async () => {
    const { makeToyRepo, FakeDispatcher, humanDecide, reconcile, toyRef, agentCommit, SPEC, PLAN, REVIEW, VERIFICATION, taskYaml } =
      await import('./engine.helper.ts')
    const { Engine } = await import('../src/engine.ts')
    const { parseLedger } = await import('../src/observe.ts')
    const { LocalGitSource } = await import('@gateline/core')

    const { dir, clock } = makeToyRepo()
    const script = (adapter: string) => (req: { cwd: string; role: string; body: string }) => {
      switch (req.role) {
        case 'analyst':
          agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
          return {}
        case 'architect':
          agentCommit(req.cwd, clock, { 'runs/toy/plan.md': PLAN, 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py') }, 'toy: plan')
          return {}
        case 'implementer':
          agentCommit(req.cwd, clock, { 'src/core.py': '# ok\n', 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py', [], 'done') }, 'toy: task 01-core r1')
          return {}
        case 'reviewer':
          agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': REVIEW('01-core', 'approve', 1) }, `toy: review (${adapter})`)
          return {}
        case 'verifier':
          agentCommit(req.cwd, clock, { 'runs/toy/verification-report.md': VERIFICATION }, `toy: verification (${adapter})`)
          return {}
        default:
          return {}
      }
    }
    const router = new RoutingDispatcher(
      [
        { manifest: claudeCode, dispatcher: new FakeDispatcher(script('claude-code')) },
        { manifest: copilot, dispatcher: new FakeDispatcher(script('copilot-cli')) },
      ],
      TEST_REGISTRY,
    )
    const engine = new Engine({
      repoDir: dir,
      identity: { name: 'gateline-orchestrator', email: 'o@x.invalid' },
      dispatcher: router,
      registry: TEST_REGISTRY,
      staleMs: 600_000,
    })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    await reconcile(engine)
    await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
    await reconcile(engine)

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    const byRole = Object.fromEntries(parseLedger(state).map((e) => [e.role + (e.round ?? ''), e.adapter]))
    expect(byRole.implementer1).toBe('claude-code')
    expect(byRole.reviewer1).toBe('copilot-cli')
    expect(byRole.verifier).toBe('copilot-cli')
  }, 60_000)

  it('refuses when two adapters are live but neither can satisfy the pin', () => {
    // A hypothetical second adapter that also runs everything on anthropic.
    const sameVendor: HeadlessManifest = {
      ...copilot,
      adapter: 'other-anthropic',
      modelOverrides: {},
      modelVendors: { 'claude-fable-5': 'anthropic', 'claude-sonnet-5': 'anthropic' },
    }
    const router = new RoutingDispatcher(
      [
        { manifest: claudeCode, dispatcher: new RecordingDispatcher('claude-code') },
        { manifest: sameVendor, dispatcher: new RecordingDispatcher('other-anthropic') },
      ],
      TEST_REGISTRY,
    )
    expect(() => router.route('reviewer')).toThrow(VendorPinError)
  })
})
