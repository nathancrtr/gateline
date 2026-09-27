// Role capability reader (#182): whether a role has a shell lives only in
// `roles/<role>.md` frontmatter — there is no adapter-side signal for it, so
// the engine reads the role specs directly to decide who can commit their
// own work and who needs a harvest.
//
// The specs are read through git at the local default-branch ref (#500), as
// the registry is, never from the working tree: a branch that happens to be
// checked out must not change how the engine treats a role.
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
  /** Names `rev` in messages (the engine passes the branch name; `rev` is its commit id). */
  refName?: string
  /**
   * Told about each role spec that is malformed at `rev`, and each one that is
   * in the working tree but not at `rev`. Neither is read, so that role
   * defaults shell-ful, and this is how the operator finds out.
   */
  log?: (line: string) => void
}

/**
 * Capabilities declared by the role specs committed at `rev`, which the engine
 * passes as `resolveHostTip(git).commit` (the local default-branch ref,
 * resolved once, with no fetch).
 */
export async function loadRoleCapabilities(git: Git, rev: string, opts: LoadRoleCapabilitiesOptions = {}): Promise<Map<string, Set<string>>> {
  const caps = new Map<string, Set<string>>()
  const refName = opts.refName ?? rev
  const { roles: rolesRoot } = await resolveFrameworkRoots(git, rev, opts.prefixHint)
  const files = await roleSpecsAt(git, rev, rolesRoot)
  for (const file of files) {
    const role = file.slice(0, -'.md'.length)
    try {
      const text = await git.show(rev, `${rolesRoot}/${file}`)
      if (text === null) continue
      const { frontmatter } = parseRole(text, `${refName}:${rolesRoot}/${file}`)
      const declared = frontmatter.capabilities
      if (declared === undefined) continue
      caps.set(role, new Set(parseList(declared)))
    } catch (e) {
      // no entry, so hasShell() defaults it shell-ful; say why
      opts.log?.(`role spec ${rolesRoot}/${file} at ${refName} could not be read (${(e as Error).message}) — "${role}" defaults shell-ful`)
    }
  }
  if (opts.log) {
    const merged = new Set(files.map((f) => f.normalize('NFC')))
    const onDisk = await readdir(join(git.dir, rolesRoot)).catch(() => [] as string[])
    for (const file of onDisk.filter((f) => f.endsWith('.md') && !merged.has(f.normalize('NFC'))).sort()) {
      opts.log(
        `role spec ${rolesRoot}/${file} is in the working tree but not at ${refName}, the default-branch tip — ` +
          `its capabilities are not read until it is merged, and "${file.slice(0, -'.md'.length)}" defaults shell-ful`,
      )
    }
  }
  return caps
}

/**
 * The `.md` blobs directly under `dir` at `rev`. Core's `Git.lsTree` prints
 * names without `-z`, so git C-quotes any non-ASCII path (`"roles/r\303\264le.md"`)
 * and the name no longer matches the file. This lists with `-z` instead, which
 * never quotes, and keeps only blobs, so a directory named `x.md` is not a spec.
 * A directory missing at `rev` lists nothing.
 */
async function roleSpecsAt(git: Git, rev: string, dir: string): Promise<string[]> {
  const prefix = `${dir}/`
  const out = await git.run(['ls-tree', '-z', rev, '--', prefix])
  const files: string[] = []
  for (const entry of out.split('\0')) {
    // `<mode> SP <type> SP <oid> TAB <path>`
    const tab = entry.indexOf('\t')
    if (tab === -1) continue
    const [, type] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (type !== 'blob' || !path.startsWith(prefix) || !path.endsWith('.md')) continue
    const name = path.slice(prefix.length)
    if (!name.includes('/')) files.push(name)
  }
  return files
}

export function hasShell(caps: Map<string, Set<string>>, role: string): boolean {
  return caps.get(role)?.has('shell') ?? true
}
