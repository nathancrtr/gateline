// Adapter manifests: the per-runner mapping layer (tool aliases, model
// spellings, frontmatter shape). Policy never lives here — that is what
// `overlays/` is for — so this reader deliberately knows only about mapping.
//
// The `headless` section is read by the orchestrator's dispatch seam, not by
// the renderer, and is passed through untouched.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FrameworkError } from './role.ts'

export type ToolsStyle = 'comma' | 'flow-list' | 'permission-map'

export interface AdapterManifest {
  adapter: string
  /** Where rendered agents land, relative to the core-layer root. */
  output_dir: string
  /** Rendered filename template; `{role}` is substituted. */
  filename: string
  roles: string[]
  tools_style: ToolsStyle
  /** capability -> this runner's tool/permission keys. */
  tool_map: Record<string, string[]>
  /** capability profile -> this runner's model spelling. */
  model_map: Record<string, string>
  /** role -> spelling override (how the P5 vendor pins are implemented). */
  model_overrides?: Record<string, string>
  /** Extra frontmatter keys, serialised as JSON scalars. */
  extra_frontmatter?: Record<string, unknown>
}

export async function loadAdapterManifest(path: string): Promise<AdapterManifest> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
  } catch (e) {
    throw new FrameworkError(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const manifest = raw as Partial<AdapterManifest>
  for (const key of ['adapter', 'output_dir', 'filename', 'tools_style'] as const) {
    if (typeof manifest[key] !== 'string') throw new FrameworkError(`${path}: missing or non-string '${key}'`)
  }
  if (!Array.isArray(manifest.roles)) throw new FrameworkError(`${path}: 'roles' must be an array`)
  return manifest as AdapterManifest
}

/**
 * Every adapter in a core-layer tree, ordered by directory name so that
 * rendering and staleness reports are stable across machines.
 */
export async function listAdapters(coreRoot: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(join(coreRoot, 'adapters'))
  } catch {
    return []
  }
  const adapters: string[] = []
  for (const name of entries.sort()) {
    try {
      await readFile(join(coreRoot, 'adapters', name, 'manifest.json'))
      adapters.push(name)
    } catch {
      // not an adapter directory
    }
  }
  return adapters
}
