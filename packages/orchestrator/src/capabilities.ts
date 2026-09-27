// Role capability reader (#182): whether a role has a shell lives only in
// `roles/<role>.md` frontmatter — there is no adapter-side signal for it, so
// the engine reads the role specs directly to decide who can commit their
// own work and who needs a harvest.
//
// The specs are read through git at the default-branch tip (#500), as the
// registry is, never from the working tree: a branch that happens to be
// checked out must not change how the engine treats a role before it is
// merged.
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
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type Git, resolveFrameworkRoots } from '@gateline/core/sources'
import { parseList, parseRole } from '@gateline/framework'

export interface LoadRoleCapabilitiesOptions {
  /**
   * Framework-metadata prefix of a `gateline init --prefix` host (#95);
   * otherwise the layout comes from the lock committed at `rev`.
   */
  prefixHint?: string
  /**
   * Told about each role spec that is in the working tree but not at `rev`.
   * Its capabilities are not read, so that role defaults shell-ful until the
   * spec is merged, and this is how the operator finds out.
   */
  log?: (line: string) => void
}

/**
 * Capabilities declared by the role specs committed at `rev`, which the engine
 * passes as the default-branch tip (`git.defaultBranch()`, a local ref, with
 * no fetch).
 */
export async function loadRoleCapabilities(git: Git, rev: string, opts: LoadRoleCapabilitiesOptions = {}): Promise<Map<string, Set<string>>> {
  const caps = new Map<string, Set<string>>()
  const { roles: rolesRoot } = await resolveFrameworkRoots(git, rev, opts.prefixHint)
  // lsTree is recursive and empty when the directory is missing at `rev`;
  // role specs are the directory's own `.md` files, not anything nested.
  const files = (await git.lsTree(rev, rolesRoot)).filter((f) => !f.includes('/') && f.endsWith('.md'))
  for (const file of files) {
    const role = file.slice(0, -'.md'.length)
    const label = `${rev}:${rolesRoot}/${file}`
    try {
      const text = await git.show(rev, `${rolesRoot}/${file}`)
      if (text === null) continue
      const { frontmatter } = parseRole(text, label)
      const declared = frontmatter.capabilities
      if (declared === undefined) continue
      caps.set(role, new Set(parseList(declared)))
    } catch {
      // unreadable or malformed: no entry, hasShell() defaults it shell-ful
    }
  }
  if (opts.log) {
    const merged = new Set(files)
    const onDisk = await readdir(join(git.dir, rolesRoot)).catch(() => [] as string[])
    for (const file of onDisk.filter((f) => f.endsWith('.md') && !merged.has(f)).sort()) {
      opts.log(
        `role spec ${rolesRoot}/${file} is in the working tree but not at ${rev}, the default-branch tip — ` +
          `its capabilities are not read until it is merged, and "${file.slice(0, -'.md'.length)}" defaults shell-ful`,
      )
    }
  }
  return caps
}

export function hasShell(caps: Map<string, Set<string>>, role: string): boolean {
  return caps.get(role)?.has('shell') ?? true
}
