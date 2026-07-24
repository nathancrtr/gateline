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

export interface FoldResult {
  ok: boolean
  /** True when the rebase hit a conflict — a plan defect (overlapping surfaces). */
  conflict: boolean
  message: string
}

/**
 * Serial fold-back: rebase the task branch onto the current run tip, then
 * CAS the run branch to the rebased head. Mechanical while file-contact
 * surfaces are disjoint (the Architect guarantees this); a conflict is a
 * plan defect and escalates. Call under the engine's per-run write lock.
 */
export async function foldTaskBranch(repoDir: string, runBranch: string, checkout: TaskCheckout): Promise<FoldResult> {
  const git = new Git(repoDir)
  const wtGit = new Git(checkout.path)
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const runTip = await git.revParse(`refs/heads/${runBranch}`)
      if (!runTip) return { ok: false, conflict: false, message: `${runBranch} disappeared mid-fold` }
      try {
        await wtGit.run(['rebase', runTip])
      } catch (e) {
        await wtGit.run(['rebase', '--abort']).catch(() => {})
        return {
          ok: false,
          conflict: true,
          message: `rebase of ${checkout.branch} onto ${runBranch} conflicted — overlapping file-contact surfaces, a plan defect: ${(e as Error).message}`,
        }
      }
      const folded = await wtGit.revParse('HEAD')
      if (!folded) return { ok: false, conflict: false, message: 'rebased head unreadable' }
      if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
        return { ok: true, conflict: false, message: `folded ${checkout.branch} into ${runBranch}` }
      }
      // The run branch moved (another fold, a human decision): rebase again.
    }
    return { ok: false, conflict: false, message: 'fold lost CAS 3× — will re-derive' }
  } finally {
    await git.run(['worktree', 'remove', '--force', checkout.path]).catch(() => {})
    await git.run(['branch', '-D', checkout.branch]).catch(() => {})
  }
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

  try {
    await git.run(['fetch', 'origin', `+refs/heads/${harvest.branch}:${fetchRef}`])
  } catch (e) {
    return { ok: false, conflict: false, message: `fetch of harvest branch ${harvest.branch} failed: ${(e as Error).message}` }
  }
  const fetchedTip = await git.revParse(fetchRef)
  if (!fetchedTip) return { ok: false, conflict: false, message: `harvest branch ${harvest.branch} not found on origin after fetch` }

  if (await git.revParse(`refs/heads/${localBranch}`)) await git.run(['branch', '-D', localBranch]).catch(() => {})
  await git.run(['worktree', 'prune']).catch(() => {})
  await git.run(['worktree', 'add', '-b', localBranch, path, fetchedTip])
  const wtGit = new Git(path)

  let result: FoldResult
  try {
    result = await (async (): Promise<FoldResult> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const runTip = await git.revParse(`refs/heads/${runBranch}`)
        if (!runTip) return { ok: false, conflict: false, message: `${runBranch} disappeared mid-fold` }
        try {
          // Explicit --onto (rather than foldTaskBranch's single-arg rebase):
          // the harvest branch's real parent (harvest.base) is known exactly,
          // so replay precisely base..HEAD onto the current tip rather than
          // relying on merge-base to rediscover it.
          await wtGit.run(['rebase', '--onto', runTip, harvest.base])
        } catch (e) {
          await wtGit.run(['rebase', '--abort']).catch(() => {})
          return {
            ok: false,
            conflict: true,
            message: `rebase of harvest branch ${harvest.branch} onto ${runBranch} conflicted — overlapping file-contact surfaces, a plan defect: ${(e as Error).message}`,
          }
        }
        const folded = await wtGit.revParse('HEAD')
        if (!folded) return { ok: false, conflict: false, message: 'rebased head unreadable' }
        if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
          return { ok: true, conflict: false, message: `folded harvest branch ${harvest.branch} into ${runBranch}` }
        }
        // The run branch moved (another fold, a human decision): rebase again.
      }
      return { ok: false, conflict: false, message: 'fold lost CAS 3× — will re-derive' }
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
