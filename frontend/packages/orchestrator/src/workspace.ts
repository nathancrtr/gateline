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
    if (existing.path === path) return path
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
