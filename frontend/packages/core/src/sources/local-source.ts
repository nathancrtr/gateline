// LocalGitSource: reads a clone without touching its checkout (all reads
// address refs), writes through plumbing with CAS (plan §3).
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { Git, type CommitInfo } from './git.ts'
import { memoizedFrameworkRoots, type FrameworkRoots } from './framework-roots.ts'
import { parseRunState, STAGED_REASON } from '../record/schema.ts'
import { readIntake, type RunScaffold } from '../record/scaffold.ts'
import type { ContractTemplates } from '../record/validate.ts'
import type { Identity, RunRef, RunSource, StageOutcome, StateCommit, StateDocMutation, WriteResult } from './source.ts'

const RUN_BRANCH_PREFIX = 'run/'
const ZERO_OID = '0'.repeat(40)

export class LocalGitSource implements RunSource {
  readonly id: string
  readonly dir: string
  readonly git: Git
  readonly templates: ContractTemplates
  /**
   * True when this source is running in local-only mode — no push, no origin
   * fetch. A plain own field rather than a prototype accessor: `sync.ts`'s
   * `planSyncForSource` test (task 02) stubs a source via
   * `Object.assign(Object.create(getPrototypeOf(real)), real, { localOnly: true })`,
   * which throws against a getter-only prototype accessor (no setter) but
   * assigns cleanly onto a plain own data property.
   */
  readonly localOnly: boolean
  private readonly options: {
    push?: boolean
    localOnly?: boolean
    identity?: Identity
    fetchIntervalSeconds?: number
    frameworkPrefix?: string
  }
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
   *
   * `options.localOnly` forces push off (belt-and-braces — `loadSources`
   * already resolves `push: false` under local-only) and is what
   * `syncFromRemote` reads to skip fetching origin entirely. Direct
   * construction without this option behaves exactly as before it existed:
   * no source-level auto-detect.
   */
  constructor(
    id: string,
    dir: string,
    options: {
      push?: boolean
      localOnly?: boolean
      identity?: Identity
      fetchIntervalSeconds?: number
      frameworkPrefix?: string
    } = {},
  ) {
    this.id = id
    this.dir = dir
    this.localOnly = options.localOnly === true
    this.options = this.localOnly ? { ...options, push: false } : options
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
   *
   * Local-only mode (AC2.4) short-circuits before any git invocation — the
   * one guard covering both the engine's heartbeat sync and the server's
   * interval sync.
   */
  async syncFromRemote(): Promise<void> {
    if (this.localOnly) return
    await this.git.run(['fetch', '--prune', 'origin'])
    // Prefix patterns (no glob): `*` in for-each-ref doesn't cross `/`, and
    // run branches live at refs/heads/run/<slug>.
    const remoteBranches = new Set(
      (await this.git.forEachRef(['refs/remotes/origin'])).map((r) => r.ref.replace('refs/remotes/origin/', '')),
    )
    // Exclude branches checked out in any worktree: fetch refuses those with
    // a FATAL that aborts the whole batch — unlike non-fast-forward, which is
    // a per-ref refusal that leaves the other specs applied. With `main`
    // checked out (every real deployment), one fatal spec would silently
    // stop every run branch from fast-forwarding (#104). A checkout is
    // reconciled by its own writer, never behind its back.
    const checkedOut = new Set((await this.git.worktrees()).map((w) => w.branch))
    const specs = (await this.git.forEachRef(['refs/heads']))
      .filter((l) => !checkedOut.has(l.ref))
      .map((l) => l.ref.replace('refs/heads/', ''))
      .filter((b) => remoteBranches.has(b))
      .map((b) => `refs/heads/${b}:refs/heads/${b}`)
    if (specs.length === 0) return
    try {
      await this.git.run(['fetch', 'origin', ...specs])
    } catch {
      // Expected per-ref refusal: non-fast-forward (local unpushed work) —
      // the other specs still apply and the remote-tracking refs carry the news.
    }
  }

  async listRuns(): Promise<RunRef[]> {
    const defaultBranch = await this.git.defaultBranch()
    const { runs: runsRoot } = await this.frameworkRoots()
    const bySlug = new Map<string, RunRef>()

    // Local run branches win; remote-only branches next.
    const locals = await this.git.forEachRef([`refs/heads/${RUN_BRANCH_PREFIX}*`])
    const remotes = await this.git.forEachRef([`refs/remotes/*/${RUN_BRANCH_PREFIX}*`])

    for (const { ref, oid } of locals) {
      const branch = ref.replace('refs/heads/', '')
      const slug = branch.slice(RUN_BRANCH_PREFIX.length)
      // #99: a local branch pinned strictly behind its remote-tracking ref —
      // typically because it is checked out in a worktree, which
      // syncFromRemote deliberately never fast-forwards — must not freeze
      // observation at the stale tip. Strictly behind → serve the remote ref:
      // it carries everything local has and nothing unpushed is lost. Ahead
      // keeps local-wins (unpushed decisions). Diverged keeps local-wins too,
      // surfaced via aheadOfOrigin/behindOrigin rather than silently.
      const remoteRef = `refs/remotes/origin/${branch}`
      const remoteTip = await this.git.revParse(remoteRef)
      if (remoteTip && remoteTip !== oid && (await this.git.isAncestor(ref, remoteRef))) {
        bySlug.set(slug, { source: this.id, slug, ref: `origin/${branch}`, kind: 'remote', branch })
        continue
      }
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

  async lastTouchedExcept(ref: RunRef, excludePaths: string[]): Promise<CommitInfo | null> {
    const runDir = await this.runDir(ref.slug)
    return this.git.lastTouchedExcept(
      ref.ref,
      runDir,
      excludePaths.map((p) => `${runDir}/${p}`),
    )
  }

  async identity(): Promise<Identity | null> {
    if (this.options.identity) return this.options.identity
    const name = await this.git.configGet('user.name')
    const email = await this.git.configGet('user.email')
    if (!name || !email) return null
    return { name, email }
  }

  async aheadOfOrigin(ref: RunRef): Promise<number | null> {
    if (ref.kind !== 'branch') return null
    // No remote-tracking ref → the branch was never pushed (or there is no
    // origin): divergence is not knowable, which is not the same as zero.
    if (!(await this.git.revParse(`refs/remotes/origin/${ref.branch}`))) return null
    return this.git.revListCount(`refs/remotes/origin/${ref.branch}..refs/heads/${ref.branch}`)
  }

  async behindOrigin(ref: RunRef): Promise<number | null> {
    // Only meaningful for a locally-served branch: a strictly-behind local is
    // already served at its remote ref (#99), so a non-zero count here means
    // the branch is ahead too — genuinely diverged.
    if (ref.kind !== 'branch') return null
    if (!(await this.git.revParse(`refs/remotes/origin/${ref.branch}`))) return null
    return this.git.revListCount(`refs/heads/${ref.branch}..refs/remotes/origin/${ref.branch}`)
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
    } else {
      // #99 write-side: a decision must never build on a base strictly behind
      // origin — the commit would be rejected at push, and observation (which
      // now serves the remote tip for a behind local) would pin an expectedTip
      // this branch can never match. Fast-forward first; ahead and diverged
      // branches keep local as today.
      const remoteRef = `refs/remotes/origin/${ref.branch}`
      const remoteTip = await this.git.revParse(remoteRef)
      if (remoteTip && remoteTip !== tip && (await this.git.isAncestor(branchRef, remoteRef))) {
        const checkout = (await this.git.worktrees()).find((w) => w.branch === branchRef)
        if (checkout) {
          try {
            await new Git(checkout.path).run(['merge', '--ff-only', remoteTip])
          } catch {
            return {
              ok: false,
              reason: 'stale-checkout',
              message: `${ref.branch} is behind origin and its checkout at ${checkout.path} could not fast-forward — reconcile it first`,
            }
          }
        } else if (!(await this.git.updateRefCAS(branchRef, remoteTip, tip))) {
          return { ok: false, reason: 'ref-moved', message: `${ref.branch} moved while fast-forwarding — re-read and retry` }
        }
        tip = remoteTip
      }
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
    // (clean), or refuse (dirty) — unless the dirt is provably this engine's
    // own abandoned write (plan "Interface contracts": recovery predicate).
    const worktree = (await this.git.worktrees()).find((w) => w.branch === branchRef)
    if (worktree) {
      const wtGit = new Git(worktree.path)
      const intentRef = `refs/agentic/wip/${ref.branch}`
      const status = await wtGit.run(['status', '--porcelain', '--', statePath])
      if (status.trim() !== '') {
        if (!(await this.recoverIntent(wtGit, intentRef, tip, statePath, worktree.path)))
          return {
            ok: false,
            reason: 'dirty-worktree',
            message:
              `run ${ref.slug} refused: ${statePath} has uncommitted changes in the checkout at ${worktree.path} — ` +
              `commit or discard them first. Keep: git -C ${worktree.path} commit -m "state(${ref.slug}): manual recovery" -- ${statePath}. ` +
              `Discard: git -C ${worktree.path} checkout -- ${statePath}`,
          }
      }

      // Write-ahead intent: an ordinary commit object, held by a ref no
      // branch reaches, recording the tip this write built on and the exact
      // bytes it meant to write — so a later write killed between here and
      // the worktree commit can recognize and clean up its own abandoned
      // work (plan ADR-1).
      const intentBlob = await this.git.hashObject(updated)
      const intentTree = await this.git.writeTreeWithBlob(tip, statePath, intentBlob)
      const intentCommit = await this.git.commitTree(intentTree, tip, message, this.options.identity)
      await this.git.run(['update-ref', intentRef, intentCommit])

      await writeFile(join(worktree.path, statePath), updated, 'utf8')
      // Pathspec commit: records exactly this file, whatever else is staged.
      const id = this.options.identity
      await wtGit.run(['commit', '-m', message, '--', statePath], {
        env: id
          ? { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email }
          : undefined,
      })
      // Best-effort: the commit above landed, so the intent it recorded is
      // resolved. A missing ref (recovery already deleted it) is fine.
      try {
        await this.git.run(['update-ref', '-d', intentRef])
      } catch {
        // swallowed — see above
      }
      const oid = await wtGit.revParse('HEAD')
      // push follows every decision commit, whichever write path carried it —
      // a hosted source that only pushed the plumbing path would strand the
      // commits made while a checkout exists.
      if (this.options.push) {
        try {
          await this.git.run(['push', 'origin', `${ref.branch}:${ref.branch}`])
        } catch (e) {
          const msg = (e as Error).message
          return { ok: true, commit: oid ?? undefined, pushFailed: msg, message: `committed locally; push failed: ${msg}` }
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
        const msg = (e as Error).message
        return { ok: true, commit, pushFailed: msg, message: `committed locally; push failed: ${msg}` }
      }
    }
    return { ok: true, commit }
  }

  /**
   * Recovery predicate (plan "Interface contracts"): dirt found on a
   * checked-out branch's state file is provably this engine's own abandoned
   * write — and so safe to discard — only when every condition holds:
   *
   * 1. the dirt is a worktree-only modification of exactly the state file
   *    (nothing staged, untracked, or additional);
   * 2. `refs/agentic/wip/<branch>` resolves to a commit whose first parent is
   *    the current branch tip;
   * 3. the checkout's bytes for the state file equal that commit's copy.
   *
   * On a full match, the file is restored from HEAD, the intent ref is
   * deleted, and this returns true so the caller falls through to the
   * unchanged clean-path write (ADR-2: recovery discards and re-derives, it
   * never finishes the abandoned commit). Any miss returns false and leaves
   * the checkout untouched — the caller refuses with `dirty-worktree` (ADR-3).
   */
  private async recoverIntent(wtGit: Git, intentRef: string, tip: string, statePath: string, checkoutPath: string): Promise<boolean> {
    const status = await wtGit.run(['status', '--porcelain', '--', statePath])
    const lines = status.split('\n').filter(Boolean)
    if (lines.length !== 1 || lines[0]!.slice(0, 3) !== ' M ' || lines[0]!.slice(3) !== statePath) return false

    const intentOid = await this.git.revParse(intentRef)
    if (!intentOid) return false
    let parent: string
    try {
      parent = (await this.git.run(['rev-parse', `${intentOid}^1`])).trim()
    } catch {
      return false
    }
    if (parent !== tip) return false

    const intentContent = await this.git.show(intentOid, statePath)
    if (intentContent === null) return false
    const checkoutContent = await readFile(join(checkoutPath, statePath), 'utf8')
    if (checkoutContent !== intentContent) return false

    await wtGit.run(['checkout', '--', statePath])
    try {
      await this.git.run(['update-ref', '-d', intentRef])
    } catch {
      // best-effort — see the lifecycle comment at the call site
    }
    return true
  }

  /**
   * ADR-4's idempotency/collision decision table, applied by both the
   * pre-write scan and the post-CAS-loss re-derivation. Returns `exists`
   * (a replay), `refused: slug-taken` (an active/historical run under this
   * slug that is not this replay), or `null` when nothing conflicts and the
   * caller may proceed to write.
   */
  private async scanForExisting(scaffold: RunScaffold): Promise<StageOutcome | null> {
    const runs = await this.listRuns()

    // 1. Client-key replay wins regardless of slug — the same staging
    // request landing under a different slug is still "already staged".
    if (scaffold.clientKey) {
      for (const ref of runs) {
        const { state } = await this.readState(ref)
        if (state && readIntake(state)?.client_key === scaffold.clientKey)
          return { outcome: 'exists', slug: ref.slug, branch: ref.branch }
      }
    }

    // 2. Same slug already present: a replay only when that run is still in
    // the staged rest state and the client key (if any) agrees — an active
    // or historical run is never silently claimed as a replay.
    const existing = runs.find((r) => r.slug === scaffold.slug)
    if (!existing) return null
    const { state } = await this.readState(existing)
    const intake = state ? readIntake(state) : null
    const isStagedRest = state?.phase === 'paused' && state.paused_reason === STAGED_REASON
    const keyMatches = scaffold.clientKey === null || intake?.client_key === scaffold.clientKey
    if (isStagedRest && keyMatches) return { outcome: 'exists', slug: existing.slug, branch: existing.branch }
    return {
      outcome: 'refused',
      reason: 'slug-taken',
      message: `${existing.branch} already exists (phase: ${state?.phase ?? 'unreadable'}) — not a staged replay`,
    }
  }

  /**
   * The only branch-minting path (plan ADR-3, R1): sequence per plan §"sources
   * deltas" —
   *   1. identity precondition (before any git write)
   *   2. existence scan (ADR-4)
   *   3. genesis commit against the default branch tip, composing
   *      `writeTreeWithBlob` once per scaffold file
   *   4. create-only CAS landing, re-scanning on a lost race
   *   5. push when configured
   */
  async stageRun(scaffold: RunScaffold, who: Identity): Promise<StageOutcome> {
    if (!who?.name || !who?.email || !(await this.identity()))
      return {
        outcome: 'refused',
        reason: 'no-identity',
        message: 'git user.name/user.email are unset — staged runs must be attributable to a named human',
      }

    const preScan = await this.scanForExisting(scaffold)
    if (preScan) return preScan

    const defaultBranch = await this.git.defaultBranch()
    const tip = await this.git.revParse(defaultBranch)
    if (!tip) return { outcome: 'refused', reason: 'conflict', message: `default branch ${defaultBranch} has no commits to stage against` }

    const { runs: runsRoot } = await this.frameworkRoots()
    const runDir = `${runsRoot}/${scaffold.slug}`
    // Compose the genesis tree by writing one blob at a time: `read-tree`
    // accepts any tree-ish, so each call's returned tree OID is the next
    // call's base (plan ADR-3) — no new git.ts primitive needed.
    let treeIsh = tip
    for (const [path, content] of Object.entries(scaffold.files)) {
      const blob = await this.git.hashObject(content)
      treeIsh = await this.git.writeTreeWithBlob(treeIsh, `${runDir}/${path}`, blob)
    }
    // `who` explicitly — never `this.options.identity` — so a bot-pinned
    // source still stages as the human who called it.
    const commit = await this.git.commitTree(treeIsh, tip, scaffold.message, who)

    const branchRef = `refs/heads/${scaffold.branch}`
    if (!(await this.git.updateRefCAS(branchRef, commit, ZERO_OID))) {
      // Lost the race: re-scan and re-derive rather than blindly retrying.
      const rescanned = await this.scanForExisting(scaffold)
      if (rescanned?.outcome === 'exists') return rescanned
      return { outcome: 'refused', reason: 'conflict', message: `${scaffold.branch} appeared concurrently — re-check and retry` }
    }

    if (this.options.push) {
      try {
        await this.git.run(['push', 'origin', `${scaffold.branch}:${scaffold.branch}`])
      } catch (e) {
        const msg = (e as Error).message
        return { outcome: 'created', slug: scaffold.slug, branch: scaffold.branch, commit, pushFailed: msg }
      }
    }
    return { outcome: 'created', slug: scaffold.slug, branch: scaffold.branch, commit }
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
