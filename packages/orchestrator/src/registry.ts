// The registry (registry/models.yaml) is the only file where model IDs and
// their prices exist (P2). The orchestrator reads it for three things: the
// role → profile → model resolution, the P5 avoid_vendor_of pins it must
// enforce at dispatch time, and the pricing/estimate maps that drive metering
// and the pre-flight budget check.

import { type Git, resolveFrameworkRoots } from '@gateline/core/sources'
import { parse as parseYaml } from 'yaml'
import type { HeadlessManifest } from './manifest.ts'

export interface RegistryProfile {
  default: string
  alternates: string[]
}

export interface RegistryBinding {
  profile: string
  avoid_vendor_of?: string
}

export interface ModelPrice {
  usd_per_mtok_in: number
  usd_per_mtok_out: number
}

export interface Registry {
  profiles: Record<string, RegistryProfile>
  bindings: Record<string, RegistryBinding>
  pricing: Record<string, ModelPrice>
  /** Static per-role pre-flight estimates (resolved question 2). */
  estimates: Record<string, number>
}

/** `anthropic/claude-sonnet-5` → `anthropic`. */
export function vendorOf(modelId: string): string {
  return modelId.split('/')[0] ?? modelId
}

/**
 * The concrete model a role resolves to, before any P5 constraint. The
 * registry stays the authority for role → profile (P2: roles/contracts never
 * name vendors); a dispatch's adapter manifest may still spell that profile's
 * model differently — this mirrors the render-time rule
 * (packages/framework/src/render.ts: `model_overrides[role] ?? model_map[profile]`)
 * so the ledger's `model` field and computeCost()'s pricing lookup key on
 * what actually ran, not on the registry's own illustrative default. Falls
 * back to that default when `manifest` is omitted or has no entry for the
 * role or profile — a dispatcher that carries no manifest (RemoteDispatcher,
 * a test double) resolves exactly as before this adapter-aware form existed.
 */
export function resolveModel(registry: Registry, role: string, manifest?: HeadlessManifest): string | null {
  const binding = registry.bindings[role]
  if (!binding) return null
  const spelling = manifest?.modelOverrides[role] ?? manifest?.modelMap[binding.profile]
  return spelling ?? registry.profiles[binding.profile]?.default ?? null
}

export function parseRegistry(text: string): Registry {
  const raw = parseYaml(text) as Record<string, unknown> | null
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

  const profiles: Record<string, RegistryProfile> = {}
  for (const [name, p] of Object.entries(obj(raw?.profiles))) {
    const prof = obj(p)
    if (typeof prof.default === 'string')
      profiles[name] = { default: prof.default, alternates: Array.isArray(prof.alternates) ? prof.alternates.map(String) : [] }
  }

  const bindings: Record<string, RegistryBinding> = {}
  for (const [role, b] of Object.entries(obj(raw?.bindings))) {
    const bind = obj(b)
    if (typeof bind.profile === 'string')
      bindings[role] = {
        profile: bind.profile,
        ...(typeof bind.avoid_vendor_of === 'string' ? { avoid_vendor_of: bind.avoid_vendor_of } : {}),
      }
  }

  const pricing: Record<string, ModelPrice> = {}
  for (const [model, p] of Object.entries(obj(raw?.pricing))) {
    const price = obj(p)
    if (typeof price.usd_per_mtok_in === 'number' && typeof price.usd_per_mtok_out === 'number')
      pricing[model] = { usd_per_mtok_in: price.usd_per_mtok_in, usd_per_mtok_out: price.usd_per_mtok_out }
  }

  const estimates: Record<string, number> = {}
  for (const [role, v] of Object.entries(obj(raw?.dispatch_estimates_usd))) {
    if (typeof v === 'number') estimates[role] = v
  }

  return { profiles, bindings, pricing, estimates }
}

/**
 * Registry at a rev (default branch normally) — null when the repo has none.
 * `prefixHint` overrides the default `.gateline` probe location for a host
 * integrated with a custom `gateline init --prefix` (#95).
 */
export async function loadRegistry(git: Git, rev: string, prefixHint?: string): Promise<Registry | null> {
  const { registry: registryRoot } = await resolveFrameworkRoots(git, rev, prefixHint)
  const text = await git.show(rev, `${registryRoot}/models.yaml`)
  if (text === null) return null
  try {
    return parseRegistry(text)
  } catch {
    return null
  }
}
