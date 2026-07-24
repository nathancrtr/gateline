// Disposable per-dispatch workspace (R4 — CI-runner semantics): a throwaway
// git clone the workstation agent executes exactly one dispatch in, then
// deletes. Never a persistent checkout left mounted/reused/updated in place
// between dispatches — each dispatch gets its own directory (AC4.2), and it
// stops existing once the dispatch is done (AC4.1).
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Workspace {
  /** The clone's root directory — cwd for the dispatched command. */
  path: string
  /** Removes the workspace directory (`rm -rf`), best-effort. */
  remove(): Promise<void>
}

export interface CreateWorkspaceOptions {
  /** Parent directory disposable workspaces are created under. */
  workDir: string
  slug: string
  branch: string
  repoUrl: string
  /** The commit the control plane armed this dispatch at (ADR-2's pin,
   *  best-effort per the server's own doc comment — review-03.md F5: this is
   *  the branch tip at poll time, not a guaranteed captured pin). When
   *  given, checked out after the clone; a failed checkout (the OID drifted
   *  past what origin now has, or was never pushed) is tolerated, not
   *  fatal — the branch-tip clone is still a usable workspace. */
  baseOid?: string
}

export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<Workspace> {
  await mkdir(opts.workDir, { recursive: true })
  // slug + timestamp + a random suffix (AC4.2): two dispatches issued for
  // the same slug in the same millisecond must still land in independent,
  // never-colliding directories.
  const path = join(opts.workDir, `${opts.slug}-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await execFileAsync('git', ['clone', '--single-branch', '--branch', opts.branch, opts.repoUrl, path])
  if (opts.baseOid) {
    try {
      await execFileAsync('git', ['-C', path, 'checkout', opts.baseOid])
    } catch {
      /* best-effort pin (review-03.md F5) — the branch-tip clone remains usable */
    }
  }
  return {
    path,
    remove: () => rm(path, { recursive: true, force: true }),
  }
}
