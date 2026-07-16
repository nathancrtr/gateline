// LocalGitSource: reads a clone without touching its checkout (all reads
// address refs), writes through plumbing with CAS (plan §3).
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { Git, type CommitInfo } from './git.ts'
import { memoizedFrameworkRoots, type FrameworkRoots } from './framework-roots.ts'
import { parseRunState } from './schema.ts'
import type { ContractTemplates } from './validate.ts'
import type { Identity, RunRef, RunSource, StateCommit, StateDocMutation, WriteResult } from './source.ts'

const RUN_BRANCH_PREFIX = 'run/'
const ZERO_OID = '0'.repeat(40)

export class LocalGitSource implements RunSource {
  readonly id: string
  readonly dir: string
  readonly git: Git
  readonly templates: ContractTemplates
  private readonly options: { push?: boolean; identity?: Identity; fetchIntervalSeconds?: number; frameworkPrefix?: string }
  /**
   * Resolved core-layer roots, cached for the life of this source and
   * shared with any other consumer resolving paths against this same repo
   * (the orchestrator's Engine, #95) so the layout is probed once.
   */
  readonly frameworkRoots: () => Promise<FrameworkRoots>

  /**
   * `options.identity` pins the author of every write from this source —
   * the v1 orchestrator's bot identity (ORCHESTRATOR.md §4.3). Human
   * surfaces omit it and write as `git config user.name/email`, so machine
   * bookkeeping and human decisions stay distinguishable at a glance.
   *
   * `options.frameworkPrefix` overrides the default `.agentic` probe location
   * for a host integrated with a custom `integrate.py --prefix` (#94).
   */
  constructor(
    id: string,
    dir: string,
    options: { push?: boolean; identity?: Identity; fetchIntervalSeconds?: number; frameworkPrefix?: string } = {},
  ) {
    this.id = id
    this.dir = dir
    this.options = options
    this.git = new Git(dir)
    const git = this.git
    this.frameworkRoots = memoizedFrameworkRoots(git, options.frameworkPrefix)
    const roots = this.frameworkRoots
    this.templates = {
      async read(name: string): Promise<string | null> {
        const defaultBranch = await git.defaultBranch()
        const { contracts } = await roots()
        return git.show(defaultBranch, `${contracts}/${name}`)
      },
    }
  }

  private async runDir(slug: string): Promise<string> {
    const { runs } = await this.frameworkRoots()
    return `${runs}/${slug}`
  }

  /** Seconds between remote syncs, when this source is configured to poll. */
  get fetchIntervalSeconds(): number | undefined {
    return this.options.fetchIntervalSeconds
  }

  /**
   * Pull remote state into this clone. Remote-tracking refs always update
   * (listRuns already reads refs/remotes/*); existing local branches are
   * fast-forwarded only when the same branch exists on origin, so a branch
   * holding an unpushed decision commit is never clobbered — the decision's
   * own push reconciles it. New remote branches are not materialized locally;
   * writeState does that lazily on the first decision.
   */
  async syncFromRemote(): Promise<void> {
    await this.git.run(['fetch', '--prune', 'origin'])
    // Prefix patterns (no glob): `*` in for-each-ref doesn't cross `/`, and
    // run branches live at refs/heads/run/<slug>.
    const remoteBranches = new Set(
      (await this.git.forEachRef(['refs/remotes/origin'])).map((r) => r.ref.replace('refs/remotes/origin/', '')),
    )
    const specs = (await this.git.forEachRef(['refs/heads']))
      .map((l) => l.ref.replace('refs/heads/', ''))
      .filter((b) => remoteBranches.has(b))
      .map((b) => `refs/heads/${b}:refs/heads/${b}`)
    if (specs.length === 0) return
    try {
      await this.git.run(['fetch', 'origin', ...specs])
    } catch {
      // Expected refusals: non-fast-forward (local unpushed work) and the
      // checked-out branch. The remote-tracking refs above carry the news.
    }
  }

  async listRuns(): Promise<RunRef[]> {
    const defaultBranch = await this.git.defaultBranch()
    const { runs: runsRoot } = await this.frameworkRoots()
    const bySlug = new Map<string, RunRef>()

    // Local run branches win; remote-only branches next.
    const locals = await this.git.forEachRef([`refs/heads/${RUN_BRANCH_PREFIX}*`])
    const remotes = await this.git.forEachRef([`refs/remotes/*/${RUN_BRANCH_PREFIX}*`])

    for (const { ref } of locals) {
      const branch = ref.replace('refs/heads/', '')
      const slug = branch.slice(RUN_BRANCH_PREFIX.length)
      bySlug.set(slug, { source: this.id, slug, ref: branch, kind: 'branch', branch })
    }
    for (const { ref } of remotes) {
      const short = ref.replace('refs/remotes/', '')
      const slug = short.split(`${RUN_BRANCH_PREFIX}`)[1]
      if (!slug || bySlug.has(slug)) continue
      bySlug.set(slug, { source: this.id, slug, ref: short, kind: 'remote', branch: `${RUN_BRANCH_PREFIX}${slug}` })
    }

    // A branch fully merged into the default branch is historical there; the
    // default-branch copy is the durable record and the branch may be stale.
    const defaultTip = await this.git.revParse(defaultBranch)
    for (const [slug, runRef] of bySlug) {
      if (defaultTip && (await this.git.isAncestor(runRef.ref, defaultBranch))) {
        const onDefault = await this.git.show(defaultBranch, `${await this.runDir(slug)}/state.yaml`)
        if (onDefault !== null) {
          bySlug.set(slug, { source: this.id, slug, ref: defaultBranch, kind: 'default', branch: runRef.branch })
        }
      }
    }

    // Runs that live only on the default branch (merged, branch deleted).
    for (const slug of await this.git.lsTreeDirs(defaultBranch, runsRoot)) {
      if (bySlug.has(slug)) continue
      const state = await this.git.show(defaultBranch, `${await this.runDir(slug)}/state.yaml`)
      if (state === null) continue
      bySlug.set(slug, {
        source: this.id,
        slug,
        ref: defaultBranch,
        kind: 'default',
        branch: `${RUN_BRANCH_PREFIX}${slug}`,
      })
    }

    // Drop branch candidates that don't actually carry a run directory.
    const result: RunRef[] = []
    for (const runRef of bySlug.values()) {
      if (runRef.kind !== 'default') {
        const state = await this.git.show(runRef.ref, `${await this.runDir(runRef.slug)}/state.yaml`)
        if (state === null) continue
      }
      result.push(runRef)
    }
    return result.sort((a, b) => a.slug.localeCompare(b.slug))
  }

  async readState(ref: RunRef) {
    const raw = await this.git.show(ref.ref, `${await this.runDir(ref.slug)}/state.yaml`)
    if (raw === null) return { raw, state: null, error: 'state.yaml missing' }
    return { raw, ...parseRunState(raw) }
  }

  async listArtifacts(ref: RunRef): Promise<string[]> {
    return this.git.lsTree(ref.ref, await this.runDir(ref.slug))
  }

  async readArtifact(ref: RunRef, path: string): Promise<string | null> {
    if (path.includes('..')) return null
    return this.git.show(ref.ref, `${await this.runDir(ref.slug)}/${path}`)
  }

  async readDiff(ref: RunRef): Promise<string> {
    const defaultBranch = await this.git.defaultBranch()
    if (ref.kind === 'default') return '' // merged: the run's diff is history now
    // The reviewable change is the code; run artifacts render separately.
    const { runs: runsRoot } = await this.frameworkRoots()
    return this.git.diff(defaultBranch, ref.ref, [`:(exclude)${runsRoot}`])
  }

  async stateHistory(ref: RunRef): Promise<StateCommit[]> {
    const path = `${await this.runDir(ref.slug)}/state.yaml`
    const commits = await this.git.log(ref.ref, [path])
    const result: StateCommit[] = []
    for (const c of commits) {
      const raw = await this.git.show(c.oid, path)
      result.push({ ...c, state: raw === null ? null : parseRunState(raw).state })
    }
    return result
  }

  async lastTouched(ref: RunRef, paths: string[]): Promise<CommitInfo | null> {
    const runDir = await this.runDir(ref.slug)
    return this.git.lastTouched(
      ref.ref,
      paths.map((p) => `${runDir}/${p}`),
    )
  }

  async identity(): Promise<Identity | null> {
    if (this.options.identity) return this.options.identity
    const name = await this.git.configGet('user.name')
    const email = await this.git.configGet('user.email')
    if (!name || !email) return null
    return { name, email }
  }

  async writeState(ref: RunRef, mutate: StateDocMutation, message: string, options: { expectedTip?: string } = {}): Promise<WriteResult> {
    if (!(await this.identity()))
      return { ok: false, reason: 'no-identity', message: 'git user.name/user.email are unset — decisions must be attributable to a named human' }

    const branchRef = `refs/heads/${ref.branch}`
    let tip = await this.git.revParse(branchRef)
    if (!tip) {
      // Remote-only branch: materialize a local branch at the remote tip.
      // This happens BEFORE the expectedTip CAS check — a caller that
      // observed the run at its remote-tracking ref (a hosted clone, where
      // new runs have no local branch until the first write) pins that tip,
      // and materialization is what makes the two comparable.
      const remotes = await this.git.forEachRef([`refs/remotes/*/${ref.branch}`])
      const remoteTip = remotes[0]?.oid
      if (!remoteTip)
        return {
          ok: false,
          reason: 'no-branch',
          message: `run branch ${ref.branch} does not exist locally or on any remote — for a merged run, edit state on the default branch via normal git`,
        }
      if (!(await this.git.updateRefCAS(branchRef, remoteTip, ZERO_OID)))
        return { ok: false, reason: 'ref-moved', message: 'branch appeared concurrently; re-read and retry' }
      tip = remoteTip
    }
    if (options.expectedTip && tip !== options.expectedTip)
      return { ok: false, reason: 'ref-moved', message: `${ref.branch} moved past the observed tip — re-derive and retry` }

    const statePath = `${await this.runDir(ref.slug)}/state.yaml`
    const current = await this.git.show(tip, statePath)
    if (current === null) return { ok: false, reason: 'error', message: `${statePath} missing at ${ref.branch} tip` }

    const doc = parseDocument(current)
    mutate(doc)
    const updated = doc.toString()

    // If the branch is checked out somewhere, an update-ref behind its back
    // would leave that checkout silently diverged. Commit through it instead
    // (clean), or refuse (dirty).
    const worktree = (await this.git.worktrees()).find((w) => w.branch === branchRef)
    if (worktree) {
      const wtGit = new Git(worktree.path)
      const status = await wtGit.run(['status', '--porcelain', '--', statePath])
      if (status.trim() !== '')
        return {
          ok: false,
          reason: 'dirty-worktree',
          message: `${statePath} has uncommitted changes in the checkout at ${worktree.path} — commit or discard them first`,
        }
      await writeFile(join(worktree.path, statePath), updated, 'utf8')
      // Pathspec commit: records exactly this file, whatever else is staged.
      const id = this.options.identity
      await wtGit.run(['commit', '-m', message, '--', statePath], {
        env: id
          ? { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email }
          : undefined,
      })
      const oid = await wtGit.revParse('HEAD')
      // push follows every decision commit, whichever write path carried it —
      // a hosted source that only pushed the plumbing path would strand the
      // commits made while a checkout exists.
      if (this.options.push) {
        try {
          await this.git.run(['push', 'origin', `${ref.branch}:${ref.branch}`])
        } catch (e) {
          return { ok: true, commit: oid ?? undefined, message: `committed locally; push failed: ${(e as Error).message}` }
        }
      }
      return { ok: true, commit: oid ?? undefined }
    }

    const blob = await this.git.hashObject(updated)
    const tree = await this.git.writeTreeWithBlob(tip, statePath, blob)
    const commit = await this.git.commitTree(tree, tip, message, this.options.identity)
    if (!(await this.git.updateRefCAS(branchRef, commit, tip)))
      return { ok: false, reason: 'ref-moved', message: `${ref.branch} moved while deciding — re-read and re-present` }

    if (this.options.push) {
      try {
        await this.git.run(['push', 'origin', `${ref.branch}:${ref.branch}`])
      } catch (e) {
        return { ok: true, commit, message: `committed locally; push failed: ${(e as Error).message}` }
      }
    }
    return { ok: true, commit }
  }
}

/** True when `dir` is (inside) a git repository. */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'), constants.F_OK)
    return true
  } catch {
    try {
      await new Git(dir).toplevel()
      return true
    } catch {
      return false
    }
  }
}

/**
 * The work-tree toplevel containing `dir`, or null when `dir` is not inside
 * one. Sources must be rooted here, never at a subdirectory: pathspec reads
 * (`ls-tree`/`log -- <path>`) resolve relative to the cwd's prefix inside a
 * work tree while `show(ref:path)` is root-relative, so a subdirectory
 * source lists no artifacts and silently empties the inbox (#83).
 */
export async function repoToplevel(dir: string): Promise<string | null> {
  try {
    return await new Git(dir).toplevel()
  } catch {
    return null
  }
}

export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
