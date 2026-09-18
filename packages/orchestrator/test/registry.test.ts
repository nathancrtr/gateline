// resolveModel() (#359): the registry stays the authority for role -> profile
// (P2), but a dispatch's adapter manifest may spell that profile's model
// differently — and when it does, the resolved id must be the adapter's
// spelling, not the registry's own illustrative default, so the ledger's
// `model` field and computeCost()'s pricing lookup key on what actually ran.
// Mirrors the render-time rule (packages/framework/src/render.ts):
// model_overrides[role] ?? model_map[profile].
import { describe, expect, it } from 'vitest'
import type { HeadlessManifest } from '../src/manifest.ts'
import { type Registry, resolveModel } from '../src/registry.ts'
import type { Dispatcher } from '../src/seam.ts'
import { TEST_REGISTRY } from './engine.helper.ts'

const manifest = (over: Partial<HeadlessManifest> = {}): HeadlessManifest => ({
  adapter: 'toy',
  command: ['true'],
  dispatchPrompt: '{body}',
  usage: { format: 'static-estimate' },
  modelMap: {},
  modelOverrides: {},
  modelVendors: {},
  ...over,
})

describe('resolveModel', () => {
  it('falls back to the registry default with no manifest', () => {
    expect(resolveModel(TEST_REGISTRY, 'analyst')).toBe('anthropic/claude-sonnet-5')
    expect(resolveModel(TEST_REGISTRY, 'architect')).toBe('anthropic/claude-fable-5')
  })

  it('an unbound role resolves to null regardless of manifest', () => {
    expect(resolveModel(TEST_REGISTRY, 'nonexistent-role', manifest({ modelMap: { balanced: 'x' } }))).toBeNull()
  })

  it('an adapter with a model_map entry resolves to that spelling, not the registry default', () => {
    const m = manifest({ modelMap: { balanced: 'sonnet', 'frontier-reasoning': 'fable' } })
    expect(resolveModel(TEST_REGISTRY, 'analyst', m)).toBe('sonnet') // analyst binds to 'balanced'
    expect(resolveModel(TEST_REGISTRY, 'architect', m)).toBe('fable') // architect binds to 'frontier-reasoning'
  })

  it('an adapter with no model_map entry for the bound profile falls back to the registry default', () => {
    const m = manifest({ modelMap: { 'frontier-reasoning': 'fable' } }) // no 'balanced' entry
    expect(resolveModel(TEST_REGISTRY, 'analyst', m)).toBe('anthropic/claude-sonnet-5')
    expect(resolveModel(TEST_REGISTRY, 'architect', m)).toBe('fable')
  })

  it('model_overrides[role] wins over model_map[profile]', () => {
    const m = manifest({
      modelMap: { balanced: 'claude-sonnet-5' },
      modelOverrides: { reviewer: 'gpt-5.4' },
    })
    // reviewer binds to 'frontier-reasoning' (no model_map entry) but has an override.
    expect(resolveModel(TEST_REGISTRY, 'reviewer', m)).toBe('gpt-5.4')
    expect(resolveModel(TEST_REGISTRY, 'analyst', m)).toBe('claude-sonnet-5')
  })

  it('feeds computeCost()-style pricing lookups keyed on the adapter spelling', () => {
    const registry: Registry = {
      ...TEST_REGISTRY,
      pricing: { ...TEST_REGISTRY.pricing, 'openrouter/deepseek/deepseek-v4-pro': { usd_per_mtok_in: 0.435, usd_per_mtok_out: 0.87 } },
    }
    const m = manifest({ modelMap: { balanced: 'openrouter/deepseek/deepseek-v4-pro' } })
    const model = resolveModel(registry, 'analyst', m)
    expect(model).toBe('openrouter/deepseek/deepseek-v4-pro')
    expect(registry.pricing[model!]).toEqual({ usd_per_mtok_in: 0.435, usd_per_mtok_out: 0.87 })
  })
})

describe('resolveModel wired through the engine (end-to-end)', () => {
  it("a dispatcher's manifest, not the registry default, decides the ledger's model and the metered cost", async () => {
    const { makeToyRepo, FakeDispatcher, reconcile, toyRef, SPEC } = await import('./engine.helper.ts')
    const { Engine } = await import('../src/engine.ts')
    const { parseLedger } = await import('../src/observe.ts')
    const { LocalGitSource } = await import('@gateline/core')

    const { dir, clock } = makeToyRepo()
    const { agentCommit } = await import('./engine.helper.ts')
    const fake = new FakeDispatcher((req) => {
      if (req.role === 'analyst') {
        agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
        return { costUsd: null, tokensIn: 1_000_000, tokensOut: 500_000 } // forces computeCost()'s pricing lookup
      }
      return {}
    })
    const registry: Registry = {
      ...TEST_REGISTRY,
      pricing: { ...TEST_REGISTRY.pricing, 'openrouter/deepseek/deepseek-v4-pro': { usd_per_mtok_in: 0.435, usd_per_mtok_out: 0.87 } },
    }
    // A dispatcher whose adapter spells 'balanced' differently than the
    // registry's own default (anthropic/claude-sonnet-5) — the shape of a
    // real opencode-style adapter (adapters/opencode/manifest.json).
    const dispatcher: Dispatcher = {
      adapter: 'toy-opencode',
      manifestFor: () => manifest({ modelMap: { balanced: 'openrouter/deepseek/deepseek-v4-pro' } }),
      dispatch: (req) => fake.dispatch(req),
    }
    const engine = new Engine({
      repoDir: dir,
      identity: { name: 'gateline-orchestrator', email: 'o@x.invalid' },
      dispatcher,
      registry,
      staleMs: 600_000,
    })
    await reconcile(engine)

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    const [entry] = parseLedger(state).filter((e) => e.role === 'analyst')
    expect(entry?.model).toBe('openrouter/deepseek/deepseek-v4-pro')
    expect(entry?.cost_usd).toBeCloseTo((1_000_000 / 1e6) * 0.435 + (500_000 / 1e6) * 0.87, 5)
  })
})
