// Role capability reader (#182): whether a role has a shell lives only in
// `roles/<role>.md` frontmatter — there is no adapter-side signal for it, so
// the engine reads the role specs directly to decide who can commit their
// own work and who needs a harvest.
//
// The parse itself belongs to @gateline/framework, which is the same reader the
// renderer uses. That matters more than the few lines it saves: a role spec the
// renderer understands is now, by construction, one the engine understands, so
// the two cannot disagree about what a frontmatter block says.
//
// Lenient by design: a missing roles dir, an unreadable or malformed file, or an
// absent `capabilities:` line yields no entry, and callers treat an unknown role
// as shell-ful — the conservative default, since promising a harvest for a role
// the engine can't scope correctly would be worse than just leaving the
// (harmless, for a shell-ful role) commit instruction in place.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveFrameworkRootsFromDisk } from '@gateline/core/sources'
import { parseList, parseRole } from '@gateline/framework'

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
      const { frontmatter } = parseRole(await readFile(join(rolesDir, file), 'utf8'), `roles/${file}`)
      const declared = frontmatter.capabilities
      if (declared === undefined) continue
      caps.set(role, new Set(parseList(declared)))
    } catch {
      // unreadable or malformed: no entry, hasShell() defaults it shell-ful
    }
  }
  return caps
}

export function hasShell(caps: Map<string, Set<string>>, role: string): boolean {
  return caps.get(role)?.has('shell') ?? true
}
