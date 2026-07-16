// Regression for #95: the orchestrator must dispatch correctly against a
// host integrated via `integrate.py init --layout prefixed` (the tool's own
// default) — registry, adapter manifests, run state, and prompt text all
// have to agree on where the framework actually lives, not assume repo root.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Git } from '@agentic/core'
import { Engine } from '../src/engine.ts'
import { loadHeadlessManifest } from '../src/manifest.ts'
import { loadRegistry } from '../src/registry.ts'
import { Scheduler, sweepSlug } from '../src/schedule.ts'
import { agentCommit, Clock, FakeDispatcher, makeToyRepo, reconcile, toyRef, humanDecide, TEST_REGISTRY, SPEC } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

const MODELS_YAML = `
profiles:
  balanced:
    default: anthropic/claude-sonnet-5
    alternates: []
bindings:
  analyst: {profile: balanced}
pricing:
  anthropic/claude-sonnet-5: {usd_per_mtok_in: 3, usd_per_mtok_out: 15}
dispatch_estimates_usd:
  analyst: 2
`

describe('loadRegistry against a prefixed host', () => {
  it('reads registry/models.yaml from under the metadata prefix', async () => {
    const { dir, clock } = makeToyRepo({ layout: 'prefixed' })
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])
    agentCommit(dir, clock, { '.agentic/registry/models.yaml': MODELS_YAML }, 'seed registry')
    const git = new Git(dir)
    const registry = await loadRegistry(git, await git.defaultBranch())
    expect(registry?.bindings.analyst).toEqual({ profile: 'balanced' })
    expect(registry?.pricing['anthropic/claude-sonnet-5']).toEqual({ usd_per_mtok_in: 3, usd_per_mtok_out: 15 })
  })
})

describe('loadHeadlessManifest against a prefixed host', () => {
  it('reads adapters/<name>/manifest.json from under the metadata prefix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentic-manifest-'))
    mkdirSync(join(dir, '.agentic', 'adapters', 'fake'), { recursive: true })
    writeFileSync(
      join(dir, '.agentic', 'framework-lock.json'),
      JSON.stringify({ layout: 'prefixed', prefix: '.agentic' }),
    )
    writeFileSync(
      join(dir, '.agentic', 'adapters', 'fake', 'manifest.json'),
      JSON.stringify({
        headless: { command: ['fake', '{prompt}'], usage_report: { format: 'static-estimate' } },
      }),
    )
    const manifest = await loadHeadlessManifest(dir, 'fake')
    expect(manifest.command).toEqual(['fake', '{prompt}'])
    expect(manifest.usage.format).toBe('static-estimate')
  })
})

describe('Engine against a prefixed host (#95)', () => {
  it('dispatches the analyst, meters, and reaches G0 with runs/contracts under .agentic', async () => {
    const { dir, clock } = makeToyRepo({ layout: 'prefixed' })
    const dispatcher = new FakeDispatcher((req) => {
      expect(req.role).toBe('analyst')
      // The prompt must point the agent at its real, prefixed run directory.
      expect(req.body).toContain('.agentic/runs/toy')
      agentCommit(req.cwd, clock, { '.agentic/runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = new Engine({
      repoDir: dir,
      identity: BOT,
      dispatcher,
      registry: TEST_REGISTRY,
      staleMs: 600_000,
    })
    await reconcile(engine)
    expect(dispatcher.calls).toHaveLength(1)

    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })

    const { LocalGitSource } = await import('@agentic/core')
    const check = new LocalGitSource('check', dir)
    const { state } = await check.readState(toyRef(dir))
    expect(state?.gates.G0.approved).toBe(true)
    const spec = await check.readArtifact(toyRef(dir), 'spec.md')
    expect(spec).toBe(SPEC)
  }, 30_000)
})

describe('Scheduler against a prefixed host (#95)', () => {
  it('sweeps under .agentic/runs and dispatches with .agentic/contracts in the prompt', async () => {
    const { dir, clock } = makeToyRepo({ layout: 'prefixed' })
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])
    agentCommit(dir, clock, { 'orchestrator.yaml': 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 5\n' }, 'seed orchestrator.yaml')
    const registry = { ...TEST_REGISTRY, estimates: { ...TEST_REGISTRY.estimates, historian: 1 } }
    const dispatcher = new FakeDispatcher((req) => {
      expect(req.body).toContain('.agentic/contracts/docs-delta.md')
      agentCommit(req.cwd, clock, { [`.agentic/runs/${sweepSlug('historian', new Date())}/docs-delta.md`]: '# Docs Delta: sweep\n' }, 'docs delta')
      return { costUsd: 0.42 }
    })
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher, registry })

    const [outcome] = await scheduler.tick()
    expect(outcome).toMatchObject({ role: 'historian', kind: 'dispatched', rule: 'S4' })
    await scheduler.drain()

    const slug = outcome!.slug!
    const marker = execFileSync('git', ['-C', dir, 'show', `run/${slug}:.agentic/runs/${slug}/sweep.yaml`], { encoding: 'utf8' })
    expect(marker).toContain('role: historian')
    expect(marker).toContain('cost_usd: 0.42')

    // Merge and confirm the next tick reads dueness from the prefixed runs/ tree (S2/S3).
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])
    execFileSync('git', ['-C', dir, 'merge', '-q', '--no-ff', '-m', `merge run/${slug}`, `run/${slug}`])
    expect(await scheduler.tick()).toMatchObject([{ kind: 'rest', rule: expect.stringMatching(/S2|S3/) }])
  }, 30_000)
})
