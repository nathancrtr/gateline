// Run checkouts for dispatched agents. Agents work in a real checkout of the
// run branch; the orchestrator keeps those checkouts in per-run git worktrees
// under the OS temp dir — host-specific ephemera, like job handles (§4.4):
// losing them costs a re-checkout, never state, because agents commit to the
// run branch and git is the only store.
import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Identity } from '@gateline/core/record'
import { Git } from '@gateline/core/sources'

// Parallel dispatches for one run share its checkout; single-flight the
// worktree creation so concurrent jobs don't race `git worktree add`.
const inFlight = new Map<string, Promise<string>>()

/** The marker every orchestrator-owned worktree path carries; anything else holding a run branch is someone's. */
const OWN_MARKER = 'gateline-orchestrator'

/**
 * The run branch is checked out somewhere the orchestrator does not own — a
 * human's working copy, most likely (#154). Dispatching an agent into it would
 * race their edits, so the checkout is refused. Typed, because the engine has
 * to tell this apart from an agent that failed: it is a standing condition of
 * the host, cleared by the human closing that checkout, and a retry against
 * it cannot succeed — so it must neither burn the one retry nor read as the
 * role being broken.
 */
export class CheckoutHeldError extends Error {
  readonly path: string
  constructor(branch: string, path: string) {
    super(checkoutHeldReason(branch, path))
    this.name = 'CheckoutHeldError'
    this.path = path
  }
}

/** The condition in its own words, remedy first — the old message truncated to exactly the part without one. */
export function checkoutHeldReason(branch: string, path: string): string {
  return (
    `run branch ${branch} is held by a checkout the orchestrator does not manage at ${path} — ` +
    `close it (git worktree remove, or switch that checkout to another branch) or run the agent by hand`
  )
}

/**
 * Where `branch` is checked out outside the orchestrator's own worktrees, or
 * null when it is free (#154). The engine probes this before committing a
 * dispatch intent, so a held branch defers the dispatch — nothing written, no
 * ledger entry, no retry spent — instead of failing it after the fact.
 */
export async function heldCheckout(repoDir: string, branch: string): Promise<string | null> {
  const worktrees = await new Git(repoDir).worktrees()
  const foreign = worktrees.find((w) => w.branch === `refs/heads/${branch}` && !w.path.includes(OWN_MARKER))
  return foreign?.path ?? null
}

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
  const path = join(tmpdir(), 'gateline-orchestrator', repoKey, branch.replace(/\//g, '-'))

  const worktrees = await git.worktrees()
  const existing = worktrees.find((w) => w.branch === `refs/heads/${branch}`)
  if (existing) {
    // Ours (this process or a crashed predecessor) — adopt it. Compare by
    // the marker directory, not exact path: macOS tmpdir() says /var/…
    // while git reports the resolved /private/var/….
    if (existing.path.includes(OWN_MARKER)) return existing.path
    // The branch is checked out somewhere the orchestrator does not own —
    // likely a human's working copy. The engine's checkout guard normally
    // catches this before an intent is committed; reaching here means the
    // checkout appeared in the gap, and the typed refusal lets the close
    // path meter nothing and count no failure (#154, #155).
    throw new CheckoutHeldError(branch, existing.path)
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
  const mine = worktrees.find((w) => w.branch === `refs/heads/${branch}` && w.path.includes(OWN_MARKER))
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
  const path = join(tmpdir(), 'gateline-orchestrator', repoKey, branch.replace(/\//g, '-'))

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
  /** Paths committed onto the task branch by the pre-fold surface harvest (#184). */
  harvested: string[]
  /** Untracked paths outside the surface that the worktree removal drops (#184); named, never harvested. */
  leftBehind: string[]
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
 * Untracked paths in a worktree, as git collapses them: an entirely untracked
 * directory is reported as the directory (`node_modules/`), not as its
 * thousands of files. That collapsing is why the default untracked mode is
 * used rather than `-uall` — this list goes into a human-read message.
 */
async function untrackedPaths(wtGit: Git): Promise<string[]> {
  const out = await wtGit.run(['status', '--porcelain']).catch(() => '')
  return out
    .split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

/**
 * What the pre-fold harvest needs to know about the dispatch it is rescuing
 * (#184): which files the task was allowed to touch, and who to commit as.
 * Optional on `foldTaskBranch` so a caller with no task context (the tests'
 * direct fold, a future non-task fold) still folds — it simply harvests
 * nothing.
 */
export interface TaskHarvest {
  slug: string
  task: string
  round: number | null
  /** The task's `file_contact_surface`, used verbatim as git pathspecs. */
  surface: string[]
  identity: Identity
}

/**
 * Commit everything uncommitted inside the task's declared file-contact
 * surface onto the task branch, before the fold discards anything and before
 * the `finally` force-removes the worktree (#184). This is `Engine.harvest`
 * (#182) applied to the isolated path: same bot identity, same `harvested`
 * verb, same commit-message shape, and the same per-pathspec `git add -A`
 * (run "runner-agent" review-04.md round-2 F10 — one combined add is
 * all-or-nothing, so a surface entry matching nothing would silently drop the
 * entries beside it). A surface entry that matches nothing is not an error:
 * entries are sometimes prose rather than paths.
 *
 * The index is emptied first so the harvest is exactly the surface. An
 * implementer may have staged out-of-surface changes without committing them,
 * and those are #224's business — discarded and named — not the harvest's.
 *
 * Returns the paths committed; empty when nothing in scope was uncommitted,
 * which is the normal case for an implementer that committed its own work.
 */
async function harvestSurface(wtGit: Git, harvest: TaskHarvest): Promise<string[]> {
  if (harvest.surface.length === 0) return []
  await wtGit.run(['reset', '-q']).catch(() => {})
  for (const pathspec of harvest.surface) {
    await wtGit.run(['add', '-A', '--', pathspec]).catch(() => {})
  }
  const staged = await wtGit.run(['diff', '--cached', '--name-only']).catch(() => '')
  const paths = staged.split('\n').map((l) => l.trim()).filter(Boolean)
  if (paths.length === 0) return []
  const what = `${harvest.task}${harvest.round ? ` r${harvest.round}` : ''}`
  await wtGit.run([
    '-c',
    `user.name=${harvest.identity.name}`,
    '-c',
    `user.email=${harvest.identity.email}`,
    'commit',
    '-m',
    `state(${harvest.slug}): harvested implementer(${what}) artifacts`,
  ])
  return paths
}

/**
 * Serial fold-back: rebase the task branch onto the current run tip, then
 * CAS the run branch to the rebased head. Mechanical while file-contact
 * surfaces are disjoint (the Architect guarantees this); a genuine content
 * conflict is a plan defect and escalates. Call under the engine's per-run
 * write lock.
 *
 * Three things happen around the rebase that the fold's record depends on.
 *
 * First, the surface harvest (#184). The worktree is force-removed in the
 * `finally` below, so anything the implementer left uncommitted dies there —
 * tracked or not. Whatever falls inside the task's declared file-contact
 * surface is the task's product by definition, so it is committed onto the
 * task branch under the bot identity before anything else runs, exactly as
 * `Engine.harvest` (#182) rescues a non-isolated dispatch from the same
 * teardown.
 *
 * Second, what the harvest did not take is cleared (#224). An implementer that
 * runs the suite in a fresh worktree must `npm install` to do it, which
 * rewrites the lockfile — a file in no task's contact surface, so an obedient
 * implementer leaves it uncommitted and its own work becomes unfoldable. Those
 * tracked paths are discarded so the rebase can start, and every one is named
 * in the result. Untracked paths outside the surface do not block a rebase and
 * are not harvested, but the worktree removal drops them too, so they are named
 * as well: nothing is destroyed without being said out loud.
 *
 * Third, the task branch survives a failed fold (#225), matching the position
 * `foldHarvestBranch` has held since review-04.md round-2 F9.
 *
 * Call under the engine's per-run write lock — the harvest commit runs under
 * that lock too.
 */
export async function foldTaskBranch(
  repoDir: string,
  runBranch: string,
  checkout: TaskCheckout,
  harvest?: TaskHarvest,
): Promise<FoldResult> {
  const git = new Git(repoDir)
  const wtGit = new Git(checkout.path)
  const retained = checkout.branch
  let harvested: string[] = []
  let discarded: string[] = []
  let leftBehind: string[] = []

  const attempt = async (): Promise<FoldResult> => {
    harvested = harvest ? await harvestSurface(wtGit, harvest) : []
    discarded = await dirtyTrackedPaths(wtGit)
    leftBehind = await untrackedPaths(wtGit)
    if (discarded.length > 0) await wtGit.run(['reset', '--hard', 'HEAD']).catch(() => {})

    const notes = [
      harvested.length > 0 ? `harvested in surface: ${harvested.join(', ')}` : null,
      discarded.length > 0 ? `discarded uncommitted: ${discarded.join(', ')}` : null,
      leftBehind.length > 0 ? `left behind (untracked, outside surface): ${leftBehind.join(', ')}` : null,
    ].filter((n): n is string => n !== null)
    const dirt = notes.length > 0 ? ` (${notes.join('; ')})` : ''
    for (let i = 0; i < 3; i++) {
      const runTip = await git.revParse(`refs/heads/${runBranch}`)
      if (!runTip) return { ok: false, cause: 'infra', message: `${runBranch} disappeared mid-fold`, retained, discarded, harvested, leftBehind }
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
        return {
          ok: false,
          cause,
          message: `rebase of ${checkout.branch} onto ${runBranch} ${why}${dirt}: ${raw}`,
          retained,
          discarded,
          harvested,
          leftBehind,
        }
      }
      const folded = await wtGit.revParse('HEAD')
      if (!folded) return { ok: false, cause: 'infra', message: 'rebased head unreadable', retained, discarded, harvested, leftBehind }
      if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
        return { ok: true, cause: null, message: `folded ${checkout.branch} into ${runBranch}${dirt}`, retained: null, discarded, harvested, leftBehind }
      }
      // The run branch moved (another fold, a human decision): rebase again.
    }
    return { ok: false, cause: 'contention', message: 'fold lost CAS 3× — will re-derive', retained, discarded, harvested, leftBehind }
  }

  let result: FoldResult
  try {
    result = await attempt()
  } catch (e) {
    result = { ok: false, cause: 'infra', message: `fold of ${checkout.branch} failed: ${(e as Error).message}`, retained, discarded, harvested, leftBehind }
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
  const fetchRef = `refs/gateline-harvest/${localBranch}`
  const path = join(tmpdir(), 'gateline-orchestrator', repoKey, localBranch)

  // The origin branch is this fold's retained copy on every failure path: it
  // is what the escalated human recovers from (F9), so name it in the result.
  const retained = harvest.branch
  try {
    await git.run(['fetch', 'origin', `+refs/heads/${harvest.branch}:${fetchRef}`])
  } catch (e) {
    return { ok: false, cause: 'infra', message: `fetch of harvest branch ${harvest.branch} failed: ${(e as Error).message}`, retained, discarded: [], harvested: [], leftBehind: [] }
  }
  const fetchedTip = await git.revParse(fetchRef)
  if (!fetchedTip) return { ok: false, cause: 'infra', message: `harvest branch ${harvest.branch} not found on origin after fetch`, retained, discarded: [], harvested: [], leftBehind: [] }

  if (await git.revParse(`refs/heads/${localBranch}`)) await git.run(['branch', '-D', localBranch]).catch(() => {})
  await git.run(['worktree', 'prune']).catch(() => {})
  await git.run(['worktree', 'add', '-b', localBranch, path, fetchedTip])
  const wtGit = new Git(path)

  let result: FoldResult
  try {
    result = await (async (): Promise<FoldResult> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const runTip = await git.revParse(`refs/heads/${runBranch}`)
        if (!runTip) return { ok: false, cause: 'infra', message: `${runBranch} disappeared mid-fold`, retained, discarded: [], harvested: [], leftBehind: [] }
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
            harvested: [],
            leftBehind: [],
          }
        }
        const folded = await wtGit.revParse('HEAD')
        if (!folded) return { ok: false, cause: 'infra', message: 'rebased head unreadable', retained, discarded: [], harvested: [], leftBehind: [] }
        if (await git.updateRefCAS(`refs/heads/${runBranch}`, folded, runTip)) {
          return { ok: true, cause: null, message: `folded harvest branch ${harvest.branch} into ${runBranch}`, retained: null, discarded: [], harvested: [], leftBehind: [] }
        }
        // The run branch moved (another fold, a human decision): rebase again.
      }
      return { ok: false, cause: 'contention', message: 'fold lost CAS 3× — will re-derive', retained, discarded: [], harvested: [], leftBehind: [] }
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
