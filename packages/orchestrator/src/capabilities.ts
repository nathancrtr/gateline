// Role capability reader (#182): whether a role has a shell lives only in
// `roles/<role>.md` frontmatter — there is no adapter-side signal for it, so
// the engine reads the role specs directly to decide who can commit their
// own work and who needs a harvest. Lenient by design: a missing roles dir,
// an unreadable file, or an absent `capabilities:` line yields no entry, and
// callers treat an unknown role as shell-ful — the conservative default,
// since promising a harvest for a role the engine can't scope correctly
// would be worse than just leaving the (harmless, for a shell-ful role)
// commit instruction in place.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveFrameworkRootsFromDisk } from '@agentic/core'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/
const CAPABILITIES_RE = /^capabilities:\s*\[([^\]]*)\]/m

export async function loadRoleCapabilities(repoDir: string, prefixHint?: string): Promise<Map<string, Set<string>>> {
  const caps = new Map<string, Set<string>>()
  let rolesDir: string
  let files: string[]
  try {
    const { roles: rolesRoot } = await resolveFrameworkRootsFromDisk(repoDir, prefixHint)
    rolesDir = join(repoDir, rolesRoot)
    files = (await readdir(rolesDir)).filter((f) => f.endsWith('.md'))
  } catch {
    return caps // no roles dir at this layout — every role defaults shell-ful
  }
  for (const file of files) {
    const role = file.slice(0, -'.md'.length)
    try {
      const raw = await readFile(join(rolesDir, file), 'utf8')
      const frontmatter = FRONTMATTER_RE.exec(raw)
      if (!frontmatter) continue
      const line = CAPABILITIES_RE.exec(frontmatter[1]!)
      if (!line) continue
      const list = line[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      caps.set(role, new Set(list))
    } catch {
      // unreadable file: no entry, hasShell() defaults it shell-ful
    }
  }
  return caps
}

export function hasShell(caps: Map<string, Set<string>>, role: string): boolean {
  return caps.get(role)?.has('shell') ?? true
}
