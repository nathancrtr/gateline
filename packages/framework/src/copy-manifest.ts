// The copy manifest (docs/INTEGRATION.md §2): the list of core-layer files a
// release offers a host, and the menu `--take` selects from. Which files are
// core-layer is judgement the tool has to own — hand-integrating meant deciding
// it file by file, which is how the second integration's lock came to disagree
// with the first's.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FrameworkError } from './role.ts'

export interface CopyManifest {
  version: number
  /** Travels with every take. */
  always: string[]
  /** The menu `--take <group>` selects from. */
  groups: Record<string, string[]>
}

export async function loadCopyManifest(frameworkRoot: string): Promise<CopyManifest> {
  const path = join(frameworkRoot, 'scripts', 'copy-manifest.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new FrameworkError(`no copy manifest at ${path} — is this a framework release?`)
  }
  return JSON.parse(raw) as CopyManifest
}

/** Everything a release offers, `always` first, then each group by name. */
export function offered(manifest: CopyManifest): string[] {
  const all = [...manifest.always]
  for (const group of Object.keys(manifest.groups).sort()) {
    for (const item of manifest.groups[group]!) if (!all.includes(item)) all.push(item)
  }
  return all
}

/** Resolve `--take` into the ordered list of core-layer files to copy. */
export function resolveTake(manifest: CopyManifest, take: string): string[] {
  const all = offered(manifest)
  if (take === 'all') return all
  const group = manifest.groups[take]
  if (group) return [...manifest.always, ...group.filter((f) => !manifest.always.includes(f))]
  const explicit = take
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const unknown = explicit.filter((f) => !all.includes(f))
  if (unknown.length) {
    throw new FrameworkError(`not in the copy manifest: ${unknown.join(', ')}\n(offered: ${all.join(', ')})`)
  }
  return [...manifest.always, ...explicit.filter((f) => !manifest.always.includes(f))]
}
