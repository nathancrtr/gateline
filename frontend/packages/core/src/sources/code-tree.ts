// Self-supersede (#141): a drift monitor over the *code tree* — the repo
// that owns the running process's own source, resolved from
// `import.meta.url`, not from any configured RunSource. Under the co-located
// deployment default they coincide; under a host-repo setup they may not,
// and it is the code tree whose staleness matters here (a `git pull` in the
// checkout that supplies the running JS, not a run branch moving).
//
// `CodeTreeMonitor` is a pure check-on-demand state machine: it never calls
// `process.exit` and holds no timers. Callers (the orchestrator loop,
// `agentic up`) decide what a state transition means operationally; this
// module only observes and debounces.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Git } from './git.ts'

/**
 * Exit code `agentic up` (and `agentic-orchestrator watch`) use once they
 * have drained and stopped in response to a confirmed supersede, so a
 * supervisor restarts them on fresh code. 75 is EX_TEMPFAIL from
 * `<sysexits.h>` — "temporary failure, please retry" — chosen because it
 * plays well with launchd's `KeepAlive` and systemd's
 * `RestartForceExitStatus=75`.
 */
export const SUPERSEDE_EXIT_CODE = 75

/**
 * Resolve the git checkout that owns the module at `fromFileUrl` (pass the
 * caller's own `import.meta.url`). Returns the toplevel directory, or null
 * when the module isn't inside a git checkout at all (e.g. installed from a
 * published package with no `.git` above it) — in which case there is
 * nothing for a drift monitor to watch.
 */
export function resolveCodeRepo(fromFileUrl: string): string | null {
  const dir = dirname(fileURLToPath(fromFileUrl))
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

export type CodeTreeState = 'fresh' | 'superseded-pending' | 'supersede-confirmed' | 'paused'

export interface CodeTreeStatus {
  state: CodeTreeState
  /** The commit the process started on (immutable for the monitor's life). */
  startHead: string
  /** The code tree's on-disk HEAD as of this check. */
  codeHead: string
  /** Human-readable cause, set only when `state === 'paused'`. */
  reason?: string
}

/** Git-dir markers that mean "a rebase or merge is mid-flight". */
const IN_PROGRESS_MARKERS = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD']

/**
 * Drift state machine over one code tree (D2, #141). Construction is async
 * (it has to read HEAD), hence the `create` factory rather than a
 * constructor. `check()` recomputes state from the working tree every call —
 * the only state carried between calls is the supersede debounce (the
 * codeHead most recently observed as a clean fast-forward, and whether it
 * has since been confirmed).
 */
export class CodeTreeMonitor {
  private readonly git: Git
  private readonly _startHead: string
  private pendingHead: string | null = null
  private confirmedHead: string | null = null

  private constructor(git: Git, startHead: string) {
    this.git = git
    this._startHead = startHead
  }

  static async create(dir: string): Promise<CodeTreeMonitor> {
    const git = new Git(dir)
    const head = await git.revParse('HEAD')
    if (!head) throw new Error(`code-tree monitor: cannot resolve HEAD in ${dir}`)
    return new CodeTreeMonitor(git, head)
  }

  get startHead(): string {
    return this._startHead
  }

  async check(): Promise<CodeTreeStatus> {
    const codeHead = await this.requireHead()

    if (await this.isDirty()) {
      return this.pause(codeHead, 'the working tree has uncommitted local changes')
    }
    if (await this.isRebaseOrMergeInProgress()) {
      return this.pause(codeHead, 'a rebase or merge is in progress')
    }
    if (codeHead === this._startHead) {
      // Clean and back on the commit we started on: fresh, whatever branch
      // state got us here. Clears any in-flight debounce (recovery, D2).
      this.resetDebounce()
      return { state: 'fresh', startHead: this._startHead, codeHead }
    }

    const branch = await this.currentBranch()
    const defaultBranch = await this.git.defaultBranch()
    if (branch === null) {
      return this.pause(codeHead, `checkout is on a detached HEAD, not the default branch (${defaultBranch})`)
    }
    if (branch !== defaultBranch) {
      return this.pause(codeHead, `checkout is on branch '${branch}', not the default branch (${defaultBranch})`)
    }
    if (!(await this.git.isAncestor(this._startHead, codeHead))) {
      return this.pause(codeHead, `HEAD moved from ${this._startHead} to ${codeHead}, which is not a fast-forward`)
    }

    // Clean fast-forward of the default branch: debounce before declaring
    // supersede confirmed, so a heartbeat racing a still-in-progress `git
    // pull` doesn't fire on a half-updated tree.
    if (this.confirmedHead === codeHead) {
      return { state: 'supersede-confirmed', startHead: this._startHead, codeHead }
    }
    if (this.pendingHead === codeHead) {
      this.confirmedHead = codeHead
      this.pendingHead = null
      return { state: 'supersede-confirmed', startHead: this._startHead, codeHead }
    }
    this.pendingHead = codeHead
    this.confirmedHead = null
    return { state: 'superseded-pending', startHead: this._startHead, codeHead }
  }

  private pause(codeHead: string, reason: string): CodeTreeStatus {
    // Any paused observation invalidates an in-flight debounce (D2): once
    // the tree goes clean-ff again, pending/confirmed starts over.
    this.resetDebounce()
    return { state: 'paused', startHead: this._startHead, codeHead, reason }
  }

  private resetDebounce(): void {
    this.pendingHead = null
    this.confirmedHead = null
  }

  private async requireHead(): Promise<string> {
    const head = await this.git.revParse('HEAD')
    if (!head) throw new Error(`code-tree monitor: cannot resolve HEAD in ${this.git.dir}`)
    return head
  }

  private async isDirty(): Promise<boolean> {
    return (await this.git.run(['status', '--porcelain'])).trim().length > 0
  }

  private async isRebaseOrMergeInProgress(): Promise<boolean> {
    for (const marker of IN_PROGRESS_MARKERS) {
      const path = (await this.git.run(['rev-parse', '--path-format=absolute', '--git-path', marker])).trim()
      if (path && existsSync(path)) return true
    }
    return false
  }

  private async currentBranch(): Promise<string | null> {
    try {
      const out = (await this.git.run(['symbolic-ref', '--short', '-q', 'HEAD'])).trim()
      return out || null
    } catch {
      return null
    }
  }
}
