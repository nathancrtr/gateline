// The P5-enforcing router (ORCHESTRATOR.md §5.3): with two vendors live, the
// registry's avoid_vendor_of pins stop being advisory — the seam *refuses*
// to bind Reviewer or Verifier to the Implementer's vendor. With a single
// single-vendor adapter, the pin is unsatisfiable and remains advisory (the
// claude-code README's documented "P5 only partially honored" state); the
// router says so once instead of failing every run.

import type { HeadlessManifest } from './manifest.ts'
import type { Registry } from './registry.ts'
import type { Dispatcher, DispatchOutcome, DispatchRequest } from './seam.ts'

export interface RoutedAdapter {
  manifest: HeadlessManifest
  dispatcher: Dispatcher
}

export interface RouteDecision {
  adapter: string
  vendor: string | null
  /** Set when a pin exists but no configured adapter can satisfy it. */
  advisory: string | null
}

/** The vendor an adapter would run a role on, from its own spelling maps. */
export function adapterVendor(manifest: HeadlessManifest, registry: Registry, role: string): string | null {
  const spelling = manifest.modelOverrides[role] ?? manifest.modelMap[registry.bindings[role]?.profile ?? '']
  if (!spelling) return null
  return manifest.modelVendors[spelling] ?? null
}

export class VendorPinError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VendorPinError'
  }
}

/**
 * Routes each role to an adapter honoring the registry's avoid_vendor_of
 * pins. Selection is static per configuration: the first adapter is the
 * default (it runs the Implementer and every unpinned role); pinned roles
 * take the first adapter whose vendor differs from the Implementer's.
 */
export class RoutingDispatcher implements Dispatcher {
  readonly adapters: RoutedAdapter[]
  private readonly registry: Registry
  private readonly warned = new Set<string>()
  private readonly log: (line: string) => void

  constructor(adapters: RoutedAdapter[], registry: Registry, log: (line: string) => void = () => {}) {
    if (adapters.length === 0) throw new Error('RoutingDispatcher needs at least one adapter')
    this.adapters = adapters
    this.registry = registry
    this.log = log
  }

  /** The ledger's adapter field is per-role now; expose the default for the interface. */
  get adapter(): string {
    return this.adapters[0]!.manifest.adapter
  }

  abortAll(): number {
    return this.adapters.reduce((n, a) => n + (a.dispatcher.abortAll?.() ?? 0), 0)
  }

  route(role: string): RouteDecision {
    const dflt = this.adapters[0]!
    const pin = this.registry.bindings[role]?.avoid_vendor_of
    if (!pin) return { adapter: dflt.manifest.adapter, vendor: adapterVendor(dflt.manifest, this.registry, role), advisory: null }

    // The pinned-against role runs on the default adapter by construction.
    const avoid = adapterVendor(dflt.manifest, this.registry, pin)
    for (const candidate of this.adapters) {
      const vendor = adapterVendor(candidate.manifest, this.registry, role)
      if (vendor !== null && avoid !== null && vendor !== avoid)
        return { adapter: candidate.manifest.adapter, vendor, advisory: null }
    }

    if (this.adapters.length > 1)
      throw new VendorPinError(
        `avoid_vendor_of unsatisfiable: every configured adapter runs ${role} on ${avoid ?? 'an unknown vendor'}, the same vendor as ${pin} — fix an adapter's model_overrides or the registry pin`,
      )
    // One adapter, one vendor: enforcement is impossible, not violated-by-choice.
    const advisory = `P5 advisory: ${role} runs on ${pin}'s vendor (${avoid ?? 'unknown'}) — a single-vendor install cannot satisfy avoid_vendor_of; add a second adapter (M3) to enforce it`
    return { adapter: dflt.manifest.adapter, vendor: avoid, advisory }
  }

  adapterFor(role: string): string {
    return this.route(role).adapter
  }

  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    const decision = this.route(req.role) // throws VendorPinError when unsatisfiable with 2+ adapters
    if (decision.advisory && !this.warned.has(req.role)) {
      this.warned.add(req.role)
      this.log(decision.advisory)
    }
    const routed = this.adapters.find((a) => a.manifest.adapter === decision.adapter)!
    return routed.dispatcher.dispatch(req)
  }
}
