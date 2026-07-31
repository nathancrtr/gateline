// Adapter `headless` manifest sections (ORCHESTRATOR.md §5.2): each adapter's
// manifest.json says how to invoke its harness non-interactively and how to
// read the usage its harness reports. The seam is generic over this — a new
// runner still costs one manifest, never orchestrator code.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveFrameworkRootsFromDisk } from '@gateline/core'

// Re-exported so a working-tree-only consumer (runner-agent/src/agent.ts,
// which never imports @gateline/core directly) can resolve its own clone's
// runsRoot for harvestPathspecs without a new package dependency.
export { resolveFrameworkRootsFromDisk }

export type UsageFormat = 'json-stdout' | 'static-estimate' | 'ndjson-sum'

export interface HeadlessManifest {
  adapter: string
  /** argv template; `{prompt}` is replaced with the rendered dispatch prompt. */
  command: string[]
  /** Prompt template; `{role}` and `{body}` are replaced per dispatch. */
  dispatchPrompt: string
  usage: {
    format: UsageFormat
    /**
     * Dotted paths into the harness's JSON output. For json-stdout, read
     * from the one parsed object. For ndjson-sum, summed across every
     * line matching lineFilter (a harness that streams one JSON event per
     * agent turn — e.g. opencode's `step_finish` — reports cost/tokens
     * per turn, not as a single running total).
     */
    fields?: { cost_usd?: string; tokens_in?: string; tokens_out?: string }
    /** ndjson-sum only: a line is summed iff every dotted-path field here matches (as a string). */
    lineFilter?: Record<string, string>
    errorField?: string
    resultField?: string
  }
  /** profile → this runner's model spelling (the manifest's model_map). */
  modelMap: Record<string, string>
  /** role → spelling overrides (how copilot-cli implements the P5 pins). */
  modelOverrides: Record<string, string>
  /** spelling → vendor, for the dispatch-time avoid_vendor_of check. */
  modelVendors: Record<string, string>
}

/**
 * `prefixHint` overrides the default `.gateline` probe location for a host
 * integrated with a custom `integrate.py --prefix` (#95); auto-detected from
 * the checkout's own framework-lock.json otherwise.
 */
export async function headlessManifestPath(repoDir: string, adapter: string, prefixHint?: string): Promise<string> {
  const { adapters: adaptersRoot } = await resolveFrameworkRootsFromDisk(repoDir, prefixHint)
  return join(repoDir, adaptersRoot, adapter, 'manifest.json')
}

export async function loadHeadlessManifest(repoDir: string, adapter: string, prefixHint?: string): Promise<HeadlessManifest> {
  const path = await headlessManifestPath(repoDir, adapter, prefixHint)
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const headless = raw.headless as Record<string, unknown> | undefined
  if (!headless) throw new Error(`adapter "${adapter}" has no headless section in ${path} — it cannot be dispatched`)
  const usage = (headless.usage_report ?? {}) as Record<string, unknown>
  const format = usage.format as UsageFormat
  if (format !== 'json-stdout' && format !== 'static-estimate' && format !== 'ndjson-sum')
    throw new Error(`adapter "${adapter}": unknown usage_report.format "${String(usage.format)}"`)
  if (!Array.isArray(headless.command) || headless.command.length === 0)
    throw new Error(`adapter "${adapter}": headless.command must be a non-empty argv array`)
  const strMap = (v: unknown): Record<string, string> => {
    if (!v || typeof v !== 'object') return {}
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string>
  }
  return {
    adapter,
    command: headless.command.map(String),
    dispatchPrompt: typeof headless.dispatch_prompt === 'string' ? headless.dispatch_prompt : '{body}',
    usage: {
      format,
      fields: (usage.fields ?? undefined) as HeadlessManifest['usage']['fields'],
      lineFilter: usage.line_filter && typeof usage.line_filter === 'object' ? strMap(usage.line_filter) : undefined,
      errorField: typeof usage.error_field === 'string' ? usage.error_field : undefined,
      resultField: typeof usage.result_field === 'string' ? usage.result_field : undefined,
    },
    modelMap: strMap(raw.model_map),
    modelOverrides: strMap(raw.model_overrides),
    modelVendors: strMap(raw.model_vendors),
  }
}

/** Follow a dotted path (`usage.input_tokens`) into parsed JSON. */
export function dig(value: unknown, path: string): unknown {
  let cur = value
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}
