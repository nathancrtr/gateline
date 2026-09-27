// Adapter `headless` manifest sections (ORCHESTRATOR.md §5.2): each adapter's
// manifest.json says how to invoke its harness non-interactively and how to
// read the usage its harness reports. The seam is generic over this — a new
// runner still costs one manifest, never orchestrator code.
//
// The engine reads a host's manifests through git at the default-branch tip
// (#500), as it reads the registry. `headless.command` is the argv the engine
// executes, so a branch that happens to be checked out must not be able to
// change it before it is merged.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type Git, resolveFrameworkRoots, resolveFrameworkRootsFromDisk } from '@gateline/core/sources'
import { parseAdapterManifest, readAdapterManifest } from '@gateline/framework'

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
  /**
   * Dotted path to the harness's own session id in its output (#181). The
   * seam records whatever it finds there on the dispatch's ledger entry; a
   * runner whose manifest omits this never reports a session.
   */
  sessionField?: string
  /**
   * argv fragment that makes this harness continue a prior session, with
   * `{session}` replaced by the recorded id. Absent → this runner never
   * resumes, and a retry is simply a fresh dispatch.
   */
  resumeArgs?: string[]
}

/**
 * Where an adapter's manifest lives at `rev`, relative to the repository root.
 * `prefixHint` overrides the default `.gateline` probe location for a host
 * integrated with a custom `gateline init --prefix` (#95); otherwise the
 * layout comes from the framework-lock.json committed at `rev`.
 */
export async function headlessManifestPathAt(git: Git, rev: string, adapter: string, prefixHint?: string): Promise<string> {
  const { adapters: adaptersRoot } = await resolveFrameworkRoots(git, rev, prefixHint)
  return `${adaptersRoot}/${adapter}/manifest.json`
}

/**
 * The engine's manifest read: the adapter's manifest as committed at `rev`,
 * which the caller passes as the default-branch tip (`git.defaultBranch()`,
 * a local ref, with no fetch). A manifest missing there is an error even when
 * the working tree has one, because falling back to the working tree would
 * let an unmerged adapter decide what the engine executes.
 */
export async function loadHeadlessManifestAt(git: Git, rev: string, adapter: string, prefixHint?: string): Promise<HeadlessManifest> {
  const path = await headlessManifestPathAt(git, rev, adapter, prefixHint)
  const text = await git.show(rev, path)
  if (text === null) {
    const inWorkingTree = await stat(join(git.dir, path)).then(
      () => true,
      () => false,
    )
    throw new Error(
      `adapter "${adapter}": no ${path} at ${rev}, the default-branch tip — the engine runs only an adapter merged there` +
        (inWorkingTree ? '; the working tree has one, which is not used until it is merged' : ''),
    )
  }
  const source = `${rev}:${path}`
  return toHeadlessManifest(parseAdapterManifest(text, source), adapter, source)
}

/**
 * The manifest as it stands in a checkout on disk. The engine never calls
 * this; it reads `loadHeadlessManifestAt` at the default-branch tip. This
 * serves the runner agent, which reads the manifest from the clone it makes
 * for one dispatch, and tests that borrow this repository's own adapters.
 */
export async function loadHeadlessManifest(repoDir: string, adapter: string, prefixHint?: string): Promise<HeadlessManifest> {
  const { adapters: adaptersRoot } = await resolveFrameworkRootsFromDisk(repoDir, prefixHint)
  const path = join(repoDir, adaptersRoot, adapter, 'manifest.json')
  return toHeadlessManifest(await readAdapterManifest(path), adapter, path)
}

/** Narrow a parsed manifest to what the seam uses; `source` names it in errors. */
function toHeadlessManifest(raw: Record<string, unknown>, adapter: string, source: string): HeadlessManifest {
  const headless = raw.headless as Record<string, unknown> | undefined
  if (!headless) throw new Error(`adapter "${adapter}" has no headless section in ${source} — it cannot be dispatched`)
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
    sessionField: typeof headless.session_field === 'string' ? headless.session_field : undefined,
    resumeArgs: Array.isArray(headless.resume_args) ? headless.resume_args.map(String) : undefined,
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
