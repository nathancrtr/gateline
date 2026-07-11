// Adapter `headless` manifest sections (ORCHESTRATOR.md §5.2): each adapter's
// manifest.json says how to invoke its harness non-interactively and how to
// read the usage its harness reports. The seam is generic over this — a new
// runner still costs one manifest, never orchestrator code.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type UsageFormat = 'json-stdout' | 'static-estimate'

export interface HeadlessManifest {
  adapter: string
  /** argv template; `{prompt}` is replaced with the rendered dispatch prompt. */
  command: string[]
  /** Prompt template; `{role}` and `{body}` are replaced per dispatch. */
  dispatchPrompt: string
  usage: {
    format: UsageFormat
    /** Dotted paths into the harness's JSON output, when format is json-stdout. */
    fields?: { cost_usd?: string; tokens_in?: string; tokens_out?: string }
    errorField?: string
    resultField?: string
  }
}

export async function loadHeadlessManifest(repoDir: string, adapter: string): Promise<HeadlessManifest> {
  const path = join(repoDir, 'adapters', adapter, 'manifest.json')
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const headless = raw.headless as Record<string, unknown> | undefined
  if (!headless) throw new Error(`adapter "${adapter}" has no headless section in ${path} — it cannot be dispatched`)
  const usage = (headless.usage_report ?? {}) as Record<string, unknown>
  const format = usage.format as UsageFormat
  if (format !== 'json-stdout' && format !== 'static-estimate')
    throw new Error(`adapter "${adapter}": unknown usage_report.format "${String(usage.format)}"`)
  if (!Array.isArray(headless.command) || headless.command.length === 0)
    throw new Error(`adapter "${adapter}": headless.command must be a non-empty argv array`)
  return {
    adapter,
    command: headless.command.map(String),
    dispatchPrompt: typeof headless.dispatch_prompt === 'string' ? headless.dispatch_prompt : '{body}',
    usage: {
      format,
      fields: (usage.fields ?? undefined) as HeadlessManifest['usage']['fields'],
      errorField: typeof usage.error_field === 'string' ? usage.error_field : undefined,
      resultField: typeof usage.result_field === 'string' ? usage.result_field : undefined,
    },
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
