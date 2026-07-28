// Run checkouts for dispatched agents. Agents work in a real checkout of the
// run branch; the orchestrator keeps those checkouts in per-run git worktrees
// under the OS temp dir — host-specific ephemera, like job handles (§4.4):
// losing them costs a re-checkout, never state, because agents commit to the
// run branch and git is the only store.
import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Git } from '@agentic/core'

// Parallel dispatches for one run share its checkout; single-flight the
// worktree creation so concurrent jobs don't race `git worktree add`.
const inFlight = new Map<string, Promise<string>>()

export function ensureRunCheckout(repoDir: string, branch: string): Promise<string> {
  const key = `${repoDir}\0${branch}`
  let pending = inFlight.get(key)
  if (!pending) {
    pending = createRunCheckout(repoDir, branch).finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }
  return pending
}

async function createRunCheckout(repoDir: string, branch: string): Promise<string> {
  const git = new Git(repoDir)
  const repoKey = createHash('sha256').update(repoDir).digest('hex').slice(0, 12)
  const path = join(tmpdir(), 'agentic-orchestrator', repoKey, branch.replace(/\//g, '-'))

  const worktrees = await git.worktrees()
  const existing = worktrees.find((w) => w.branch === `refs/heads/${branch}`)
  if (existing) {
    // Ours (this process or a crashed predecessor) — adopt it. Compare by
    // the marker directory, not exact path: macOS tmpdir() says /var/…
    // while git reports the resolved /private/var/….
    if (existing.path.includes('agentic-orchestrator')) return existing.path
    // The branch is checked out somewhere the orchestrator does not own —
    // likely a human's working copy. Dispatching an agent into it would race
    // their edits; refuse and let the failure surface as an escalation.
    throw new Error(
      `run branch ${branch} is checked out at ${existing.path}, which the orchestrator does not manage — close that checkout or run the agent by hand`,
    )
  }

  try {
    await access(path)
    // Directory exists but is no longer a registered worktree (e.g. a crashed
    // host cleaned .git but left files): prune and re-add.
    await git.run(['worktree', 'prune'])
  } catch {
    /* fresh path */
  }
  await git.run(['worktree', 'add', path, branch])
  return path
}

/** Best-effort cleanup after a run completes; state lives in git, not here. */
export async function removeRunCheckout(repoDir: string, branch: string): Promise<void> {
  const git = new Git(repoDir)
  const worktrees = await git.worktrees()
  const mine = worktrees.find((w) => w.branch === `refs/heads/${branch}` && w.path.includes('agentic-orchestrator'))
  if (mine) await git.run(['worktree', 'remove', '--force', mine.path]).catch(() => {})
}

/**
 * Per-task isolation (ORCHESTRATOR.md §5.3, the wordfreq retro fix: task 03
 * observed task 02's mid-flight broken state in the shared tree). Each
 * parallel implementer works its task on a private branch in a private
 * worktree, both derived from the run branch tip; the orchestrator folds
 * results back into the run branch serially with `foldTaskBranch`.
 */
export interface TaskCheckout {
  path: string
  branch: string
}

const taskBranchName = (runBranch: string, task: string) => `${runBranch}--task/${task}`

export async function ensureTaskCheckout(repoDir: string, runBranch: string, task: string): Promise<TaskCheckout> {
  const git = new Git(repoDir)
  const branch = taskBranchName(runBranch, task)
  const repoKey = createHash('sha256').update(repoDir).digest('hex').slice(0, 12)
  const path = join(tmpdir(), 'agentic-orchestrator', repoKey, branch.replace(/\//g, '-'))

  // A leftover branch from a crashed dispatch is stale by definition — the
  // heartbeat re-dispatches from the current run tip, never resumes it.
  const existing = (await git.worktrees()).find((w) => w.branch === `refs/heads/${branch}`)
  if (existing) await git.run(['worktree', 'remove', '--force', existing.path]).catch(() => {})
  await git.run(['worktree', 'prune'])
  if (await git.revParse(`refs/heads/${branch}`)) await git.run(['branch', '-D', branch])

  await git.run(['worktree', 'add', '-b', branch, path, runBranch])
  return { path, branch }
}

/**
 * Why a fold did not land (#223). The old shape was a single `conflict`
 * boolean, which made "overlapping file-contact surfaces, a plan defect" the
 * diagnosis for every way a rebase can fail — including ones the architecture
 * rules out. Only `conflict` is a plan defect, and only a plan defect is fatal.
 */
export type FoldFailure =
  /** Genuine content conflict: the surfaces the Architect declared disjoint were not. */
  | 'conflict'
  /** Uncommitted tracked changes stopped the rebase before it compared anything. */
  | 'dirty'
  /** The run branch kept moving under us; nothing is wrong with the work. */
  | 'contention'
  /** Missing ref, unreadable head, git invocation failure. */
  | 'infra'

export interface FoldResult {
  ok: boolean
  /** Null on success. */
  cause: FoldFailure | null
  message: string
  /** Branch kept for inspection because the fold did not land (#225); null when nothing was retained. */
  retained: string | null
  /** Uncommitted tracked paths discarded to let the rebase start (#224); never silently dropped. */
  discarded: string[]
}

/** Only a plan defect is worth burning a human's escalation review on; everything else is retryable. */
export const isPlanDefect = (fold: FoldResult): boolean => fold.cause === 'conflict'

/**
 * Reads a git failure's own words rather than assuming (#223). `git rebase`
 * distinguishes these cases clearly, and the run's fate differs by case: a
 * content conflict escalates as a plan defect, everything else is retried.
 */
function classifyRebaseFailure(message: string): FoldFailure {
  if (/CONFLICT|could not apply|Merge conflict|fix conflicts/i.test(message)) return 'conflict'
  if (/cannot rebase|unstaged changes|uncommitted changes|would be overwritten|please commit or stash/i.test(message)) return 'dirty'
  return 'infra'
}

/**
 * Uncommitted *tracked* paths in a worktree — what makes `git rebase` refuse to
 * start. Untracked files are deliberately not listed: they do not block a
 * rebase (established in #223) and may be scratch the agent still wants.
 */
async function dirtyTrackedPaths(wtGit: Git): Promise<string[]> {
  const out = await wtGit.run(['status', '--porcelain']).catch(() => '')
  return out
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

/**
 * Serial fold-back: rebase the task branch onto the current run tip, then
 * CAS the run branch to the rebased head. Mechanical while file-contact
 * surfaces are disjoint (the Architect guarantees this); a genuine content
 * conflict is a plan defect and escalates. Call under the engine's per-run
 * write lock.
 *
 * Two things happen around the rebase that the failure record depends on.
 * Uncommitted tracked changes are cleared first (#224): an implementer that
 * runs the suite in a fresh worktree must `npm install` to do it, which
 * rewrites the lockfile — a file in no task's contact surface, so an obedient
 * implementer leaves it uncommitted and its own work becomes unfoldable. What
 * it *did* produce it committed, so what is left over is by definition not the
 * task's product; it is discarded and every path named in the result. And the
 * task branch now survives a failed fold (#225), matching the position
 * `foldHarvestBranch` has held since review-04.md round-2 F9.
 */
export async function foldTaskBranch(repoDir: string, runBranch: string, checkout: TaskCheckout): Promise<FoldResult> {
  const git = new Git(repoDir)
  const wtGit = new Git(checkout.path)
  const retained = checkout.branch
  const discarded = await dirtyTrackedPaths(wtGit)
  if (discarded.length > 0) await wtGit.run(['reset', '--hard', 'HEAD']).catch(() => {})

  const attempt = async (): Promise<FoldResult> => {
    const dirt = discarded.length > 0 ? ` (discarded uncommitted: ${discarded.join(', ')})` : ''
    for (let i = 0; i < 3; i++) {
      const runTip = await git.revParse(`refs/heads/${runBranch}`)
      if (!runTip) return { ok: false, cause: 'infra', message: `${runBranch} disappeared mid-fold`, retained, discarded }
      try {
        await wtGit.run(['rebase', runTip])
      } catch (e) {
        await wtGit.run(['rebase', '--abort']).catch(() => {})
        const raw = (e as Error).message
        const cause = classifyRebaseFailure(raw)
        const why =
          cause === 'conflict'
            ? `conflicted — overlapping file-contact surfaces, a plan defect`
            : cause === 'dirty'
              ? `could not start — the worktree still has uncommitted tracked changes`
              : `failed for a reason that is neither a conflict nor a dirty worktree`
        return { ok: false, cause, message: `rebase of ${checkout.branch} onto ${runBranch} ${why}${dirt}: ${raw}`, retained, discarded }
      }
      const folded = await wtGit.revParse('HEAD')
      if (!folded) return { ok: false, cause: 'infra', message: 'rebased head unreadable', retained, discarded }
      if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
        return { ok: true, cause: null, message: `folded ${checkout.branch} into ${runBranch}${dirt}`, retained: null, discarded }
      }
      // The run branch moved (another fold, a human decision): rebase again.
    }
    return { ok: false, cause: 'contention', message: 'fold lost CAS 3× — will re-derive', retained, discarded }
  }

  let result: FoldResult
  try {
    result = await attempt()
  } catch (e) {
    result = { ok: false, cause: 'infra', message: `fold of ${checkout.branch} failed: ${(e as Error).message}`, retained, discarded }
  } finally {
    // The worktree always goes: it holds a lock and a tmpdir path, and its
    // commits live on the branch regardless. The branch goes only once the
    // fold has landed — on failure it is the sole surviving copy of a
    // dispatch that was paid for, and the escalated human has nothing else
    // to inspect (#225).
    await git.run(['worktree', 'remove', '--force', checkout.path]).catch(() => {})
  }
  if (result.ok) await git.run(['branch', '-D', checkout.branch]).catch(() => {})
  else result.message += ` — task branch ${checkout.branch} kept for inspection`
  return result
}

/**
 * Deletes task branches left behind by failed folds for a finished run (#225).
 * Retention buys the escalated human a diff to inspect; it must not accrue
 * local refs forever. A re-dispatch of the same task already reaps its own
 * branch in `ensureTaskCheckout`, so this covers the other end: a run that has
 * reached a terminal state and will dispatch nothing further.
 */
export async function reapTaskBranches(repoDir: string, runBranch: string): Promise<string[]> {
  const git = new Git(repoDir)
  const prefix = `${runBranch}--task/`
  const out = await git.run(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}*`]).catch(() => '')
  const branches = out.split('\n').map((l) => l.trim()).filter(Boolean)
  const reaped: string[] = []
  for (const branch of branches) {
    // -D, not -d: a retained branch is unmerged by definition — that is why it was kept.
    if (await git.run(['branch', '-D', branch]).then(() => true).catch(() => false)) reaped.push(branch)
  }
  return reaped
}

/**
 * Fold a worker-pushed harvest branch into the run branch as the sole writer
 * (run "runner-agent" ADR-3/ADR-4): fetch the branch the remote worker pushed
 * to origin, rebase its commit(s) — `harvest.base` is the recorded parent,
 * the run tip the dispatch was armed at — onto the current run tip, CAS the
 * run branch ref, then delete both the local and origin harvest-branch refs.
 * A rebase conflict means overlapping file-contact surfaces — a plan defect
 * — and returns `conflict: true` so the caller escalates, exactly as
 * `foldTaskBranch`'s conflict path does. The origin harvest branch is
 * deleted only once the fold actually lands (review-04.md round-2 F9): on a
 * conflict or CAS exhaustion, the pushed work is the only surviving copy of
 * a paid dispatch and stays on origin for the escalated human to recover,
 * rather than being deleted alongside the failure. Call under the engine's
 * per-run write lock.
 */
export async function foldHarvestBranch(
  repoDir: string,
  runBranch: string,
  harvest: { branch: string; base: string },
): Promise<FoldResult> {
  const git = new Git(repoDir)
  const repoKey = createHash('sha256').update(repoDir).digest('hex').slice(0, 12)
  const localBranch = `harvest-${harvest.branch.replace(/\//g, '-')}`
  const fetchRef = `refs/agentic-harvest/${localBranch}`
  const path = join(tmpdir(), 'agentic-orchestrator', repoKey, localBranch)

  // The origin branch is this fold's retained copy on every failure path: it
  // is what the escalated human recovers from (F9), so name it in the result.
  const retained = harvest.branch
  try {
    await git.run(['fetch', 'origin', `+refs/heads/${harvest.branch}:${fetchRef}`])
  } catch (e) {
    return { ok: false, cause: 'infra', message: `fetch of harvest branch ${harvest.branch} failed: ${(e as Error).message}`, retained, discarded: [] }
  }
  const fetchedTip = await git.revParse(fetchRef)
  if (!fetchedTip) return { ok: false, cause: 'infra', message: `harvest branch ${harvest.branch} not found on origin after fetch`, retained, discarded: [] }

  if (await git.revParse(`refs/heads/${localBranch}`)) await git.run(['branch', '-D', localBranch]).catch(() => {})
  await git.run(['worktree', 'prune']).catch(() => {})
  await git.run(['worktree', 'add', '-b', localBranch, path, fetchedTip])
  const wtGit = new Git(path)

  let result: FoldResult
  try {
    result = await (async (): Promise<FoldResult> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const runTip = await git.revParse(`refs/heads/${runBranch}`)
        if (!runTip) return { ok: false, cause: 'infra', message: `${runBranch} disappeared mid-fold`, retained, discarded: [] }
        try {
          // Explicit --onto (rather than foldTaskBranch's single-arg rebase):
          // the harvest branch's real parent (harvest.base) is known exactly,
          // so replay precisely base..HEAD onto the current tip rather than
          // relying on merge-base to rediscover it.
          await wtGit.run(['rebase', '--onto', runTip, harvest.base])
        } catch (e) {
          await wtGit.run(['rebase', '--abort']).catch(() => {})
          const raw = (e as Error).message
          // Same classification as the local fold (#223). This worktree is
          // built fresh from the fetched tip, so `dirty` is not expected here
          // — but asserting a plan defect for, say, a missing base ref was
          // exactly the bug, and the fix is to stop asserting either way.
          const cause = classifyRebaseFailure(raw)
          const why = cause === 'conflict' ? 'conflicted — overlapping file-contact surfaces, a plan defect' : 'failed'
          return {
            ok: false,
            cause,
            message: `rebase of harvest branch ${harvest.branch} onto ${runBranch} ${why}: ${raw}`,
            retained,
            discarded: [],
          }
        }
        const folded = await wtGit.revParse('HEAD')
        if (!folded) return { ok: false, cause: 'infra', message: 'rebased head unreadable', retained, discarded: [] }
        if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
          return { ok: true, cause: null, message: `folded harvest branch ${harvest.branch} into ${runBranch}`, retained: null, discarded: [] }
        }
        // The run branch moved (another fold, a human decision): rebase again.
      }
      return { ok: false, cause: 'contention', message: 'fold lost CAS 3× — will re-derive', retained, discarded: [] }
    })()
  } finally {
    await git.run(['worktree', 'remove', '--force', path]).catch(() => {})
    await git.run(['branch', '-D', localBranch]).catch(() => {})
    await git.run(['update-ref', '-d', fetchRef]).catch(() => {})
  }
  // Only a landed fold retires the origin branch (F9) — a conflict or CAS
  // exhaustion leaves it as the sole surviving copy of the paid work, for
  // the escalated human to recover.
  if (result.ok) await git.run(['push', 'origin', '--delete', harvest.branch]).catch(() => {})
  return result
}
