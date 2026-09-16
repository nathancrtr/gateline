// Render adapter agent files from the runtime-neutral role specs.
//
// Source of truth: roles/<role>.md (frontmatter + body).
// Per-adapter mapping: adapters/<adapter>/manifest.json.
// Project policy: overlays/_all.md + overlays/<role>.md, spliced after the body.
// Output: the agent files each runner loads (.claude/agents/, .github/agents/, …).
//
// Rendered files are generated: CI fails any change that leaves them stale,
// and every one carries a do-not-edit header naming the source role spec.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { type AdapterManifest, listAdapters, loadAdapterManifest } from './adapter.ts'
import { FrameworkError, parseList, parseRole, requireFrontmatter } from './role.ts'

export function renderHeader(role: string): string {
  return `<!-- RENDERED from roles/${role}.md by gateline render - DO NOT EDIT.\n     Edit the role spec, then run: gateline render -->`
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g

/**
 * The project policy layer (docs/INTEGRATION.md §4): `overlays/_all.md` is
 * spliced into every agent, `overlays/<role>.md` into that role's agent. A
 * stub that is only HTML comments splices nothing, so a freshly scaffolded
 * host renders exactly as this repository does.
 */
export async function overlaysFor(coreRoot: string, role: string): Promise<string[]> {
  const parts: string[] = []
  for (const name of ['_all', role]) {
    let text: string
    try {
      text = await readFile(join(coreRoot, 'overlays', `${name}.md`), 'utf8')
    } catch {
      continue
    }
    if (!text.replace(HTML_COMMENT, '').trim()) continue
    parts.push(`<!-- OVERLAY from overlays/${name}.md - project policy layer -->\n\n${text.trim()}`)
  }
  return parts
}

/** Capability keys resolved to this runner's tool keys, in order, deduped. */
export function mergeTools(capabilities: string[], manifest: AdapterManifest): string[] {
  const tools: string[] = []
  for (const capability of capabilities) {
    const mapped = manifest.tool_map[capability]
    if (!mapped) throw new FrameworkError(`${manifest.adapter}: capability '${capability}' missing from tool_map`)
    for (const tool of mapped) if (!tools.includes(tool)) tools.push(tool)
  }
  return tools
}

function renderTools(capabilities: string[], manifest: AdapterManifest): string {
  const tools = mergeTools(capabilities, manifest)
  return manifest.tools_style === 'comma' ? tools.join(', ') : `[${tools.join(', ')}]`
}

/**
 * opencode-style scoping: agents carry a permission map (allow/deny), not a
 * tool list. Deny-by-default plus explicit allows keeps the adapter rule
 * (narrow, never widen) a rendered property, and new harness tools stay denied
 * until a capability grants them.
 */
function renderPermissionMap(capabilities: string[], manifest: AdapterManifest): string[] {
  const lines = ['permission:', '  "*": deny']
  for (const key of mergeTools(capabilities, manifest)) lines.push(`  ${key}: allow`)
  return lines
}

export async function renderAgent(coreRoot: string, role: string, manifest: AdapterManifest): Promise<string> {
  const label = `roles/${role}.md`
  const spec = parseRole(await readFile(join(coreRoot, 'roles', `${role}.md`), 'utf8'), label)
  requireFrontmatter(spec, label, ['dispatch', 'capabilities', 'capability_profile'])
  const profile = spec.frontmatter.capability_profile!
  const model = manifest.model_overrides?.[role] ?? manifest.model_map[profile]
  if (model === undefined) throw new FrameworkError(`${manifest.adapter}: no model for profile '${profile}' (role ${role})`)

  const lines = ['---', `name: ${role}`, `description: ${spec.frontmatter.dispatch}`]
  const capabilities = parseList(spec.frontmatter.capabilities!)
  if (manifest.tools_style === 'permission-map') lines.push(...renderPermissionMap(capabilities, manifest))
  else lines.push(`tools: ${renderTools(capabilities, manifest)}`)
  lines.push(`model: ${model}`)
  for (const [key, value] of Object.entries(manifest.extra_frontmatter ?? {})) lines.push(`${key}: ${JSON.stringify(value)}`)
  lines.push('---', '', renderHeader(role), '', spec.body.replace(/\s+$/, ''))
  for (const overlay of await overlaysFor(coreRoot, role)) lines.push('', overlay.replace(/\s+$/, ''))
  return `${lines.join('\n')}\n`
}

export interface RenderResult {
  /** Repository-relative paths written (empty when `check` is set). */
  written: string[]
  /** Repository-relative paths whose content does not match the sources. */
  stale: string[]
}

/**
 * Render every adapter's agent files. With `check`, nothing is written and
 * the mismatches are reported instead — the check CI runs on every push.
 */
export async function renderAll(coreRoot: string, options: { check?: boolean } = {}): Promise<RenderResult> {
  const result: RenderResult = { written: [], stale: [] }
  for (const adapter of await listAdapters(coreRoot)) {
    const manifest = await loadAdapterManifest(join(coreRoot, 'adapters', adapter, 'manifest.json'))
    const outDir = join(coreRoot, manifest.output_dir)
    if (!options.check) await mkdir(outDir, { recursive: true })
    for (const role of manifest.roles) {
      const rendered = await renderAgent(coreRoot, role, manifest)
      const outPath = join(outDir, manifest.filename.replace('{role}', role))
      let current: string | null = null
      try {
        current = await readFile(outPath, 'utf8')
      } catch {
        current = null
      }
      if (current === rendered) continue
      if (options.check) {
        result.stale.push(relative(coreRoot, outPath))
        continue
      }
      await writeFile(outPath, rendered, 'utf8')
      result.written.push(relative(coreRoot, outPath))
    }
  }
  return result
}
