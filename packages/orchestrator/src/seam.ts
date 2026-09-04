// The dispatch seam (ORCHESTRATOR.md §5.1): nothing above this interface
// knows which harness ran — the seam is to runtimes what the registry is to
// models. Every model invocation in v1 flows through dispatch(), which is
// what makes the seam the single metering point (§6).
import { spawn } from 'node:child_process'
import { dig, type HeadlessManifest } from './manifest.ts'

export interface DispatchRequest {
  /** Working directory the harness runs in: a checkout of the run branch. */
  cwd: string
  role: string
  /** Run-specific prompt body; the adapter's template wraps it. */
  body: string
  timeoutMs: number
  /** Run identity (optional): the engine always sets these; HeadlessDispatcher ignores them. */
  slug?: string
  branch?: string
  /** Task/round identity (optional, task-scoped roles only): the engine always sets these
   *  from the dispatch intent (null for non-task-scoped roles); HeadlessDispatcher ignores
   *  them. RemoteDispatcher (runner-dispatcher.ts) keys its pending map directly from these
   *  fields, so a parallel same-role dispatch (e.g. two implementers on distinct tasks)
   *  correlates on the request itself rather than on dispatch or poll order (ADR-7). */
  task?: string | null
  round?: number | null
}

export interface DispatchOutcome {
  ok: boolean
  /** Reported by the harness, when its manifest says how to read it. */
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  error: string | null
  /** Retrying cannot help (e.g. a fold conflict = plan defect): escalate now. */
  fatal?: boolean
  /**
   * No process was ever spawned (#155): the dispatch was refused before the
   * harness ran — a held checkout, a preflight error. True cost is zero and
   * the ledger says so; the entry is neither a failure nor a retry spent,
   * because the agent never got to try.
   */
  refused?: boolean
  /** Present when the dispatcher harvested the agent's work to a branch the
   *  engine folds (the remote runner, run "runner-agent" ADR-3/ADR-4). `base`
   *  is the commit the harvest branch was committed on top of (the dispatch's
   *  pinned base OID) — what the fold rebases onto the run tip. Null/unset
   *  for the local headless dispatcher, which leaves working-tree changes for
   *  the engine's own local checkout to carry directly on the run branch. */
  harvest?: { branch: string; base: string } | null
}

export interface Dispatcher {
  readonly adapter: string
  /** True when this dispatcher creates its own workspace and harvests its own work (the
   *  remote runner). The engine then creates no local checkout and, on a harvest handoff,
   *  folds the harvested branch instead of running its own local harvest(). Unset for
   *  HeadlessDispatcher (local checkout, local harvest). */
  readonly managesOwnWorkspace?: boolean
  /** The adapter that would run this role (routing dispatchers differ per role). */
  adapterFor?(role: string): string
  dispatch(req: DispatchRequest): Promise<DispatchOutcome>
  /**
   * Operator force-drain (#150): SIGKILL every live harness process group.
   * Each aborted dispatch resolves through the normal failure path, so its
   * closing commit lands and the task is freed for a retry — killed work,
   * closed books. Returns how many groups were signalled.
   */
  abortAll?(): number
}

/**
 * Generic harness runner driven entirely by an adapter's headless manifest —
 * claude-code and copilot-cli differ only in the JSON they parse, which the
 * manifest describes. A new runner costs one manifest, zero code here.
 */
export class HeadlessDispatcher implements Dispatcher {
  readonly adapter: string
  private readonly manifest: HeadlessManifest
  /** Live harness process-group leader pids, for operator force-drain (#150). */
  private readonly live = new Set<number>()
  private readonly abortedPids = new Set<number>()

  constructor(manifest: HeadlessManifest) {
    this.adapter = manifest.adapter
    this.manifest = manifest
  }

  abortAll(): number {
    let signalled = 0
    for (const pid of this.live) {
      this.abortedPids.add(pid)
      try {
        process.kill(-pid, 'SIGKILL') // negative pid = the group (POSIX)
        signalled++
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
          signalled++
        } catch {
          /* already gone */
        }
      }
    }
    return signalled
  }

  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    const prompt = this.manifest.dispatchPrompt.replaceAll('{role}', req.role).replaceAll('{body}', req.body)
    const argv = this.manifest.command.map((a) => a.replaceAll('{prompt}', prompt).replaceAll('{role}', req.role))
    const [cmd, ...args] = argv

    const { stdout, error, timedOut, aborted } = await runHarness(cmd!, args, req.cwd, req.timeoutMs, this.live, this.abortedPids)
    // execFile's generic "Command failed: <argv>" hides what actually
    // happened; a timeout or an operator abort is a failure the seam itself
    // caused, so name it — the ledger and the escalation both carry this
    // string.
    const failure = aborted
      ? 'dispatch aborted by the operator during drain — process group killed (SIGKILL); the task is freed for a retry'
      : timedOut
        ? `harness timed out after ${Math.round(req.timeoutMs / 60000)}min wall clock — process group killed (SIGKILL)`
        : error
          ? error.message
          : null

    if (this.manifest.usage.format === 'static-estimate') {
      // No per-invocation usage from this harness (yet): the engine meters
      // this dispatch at the registry's static estimate, tokens null.
      return { ok: !error && !timedOut && !aborted, costUsd: null, tokensIn: null, tokensOut: null, error: failure }
    }

    if (this.manifest.usage.format === 'ndjson-sum') {
      const events = parseNdjson(stdout)
      if (events.length === 0) {
        return {
          ok: false,
          costUsd: null,
          tokensIn: null,
          tokensOut: null,
          error: failure ?? 'harness produced no parseable JSON output',
        }
      }
      const matching = events.filter((e) => matchesLineFilter(e, this.manifest.usage.lineFilter))
      const fields = this.manifest.usage.fields ?? {}
      const last = events[events.length - 1]
      const harnessError = this.manifest.usage.errorField ? dig(last, this.manifest.usage.errorField) === true : false
      const resultText = this.manifest.usage.resultField ? dig(last, this.manifest.usage.resultField) : null
      return {
        ok: !error && !timedOut && !aborted && !harnessError,
        costUsd: sumField(matching, fields.cost_usd),
        tokensIn: sumField(matching, fields.tokens_in),
        tokensOut: sumField(matching, fields.tokens_out),
        error: failure ?? (harnessError ? String(resultText ?? 'harness reported an error') : null),
      }
    }

    const parsed = parseJsonOutput(stdout)
    if (!parsed) {
      return {
        ok: false,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        error: failure ?? 'harness produced no parseable JSON output',
      }
    }
    const fields = this.manifest.usage.fields ?? {}
    const num = (path?: string) => {
      if (!path) return null
      const v = dig(parsed, path)
      return typeof v === 'number' ? v : null
    }
    const harnessError = this.manifest.usage.errorField ? dig(parsed, this.manifest.usage.errorField) === true : false
    const resultText = this.manifest.usage.resultField ? dig(parsed, this.manifest.usage.resultField) : null
    return {
      ok: !error && !timedOut && !aborted && !harnessError,
      costUsd: num(fields.cost_usd),
      tokensIn: num(fields.tokens_in),
      tokensOut: num(fields.tokens_out),
      error: failure ?? (harnessError ? String(resultText ?? 'harness reported an error') : null),
    }
  }
}

/**
 * Run the harness under a wall-clock ceiling, killing its whole process
 * group on timeout. execFile's built-in timeout signals only the direct
 * child: a harness's own children (tool shells, MCP servers) survive the
 * kill, keep spending, and hold the stdio pipes open — the callback (and so
 * the closing commit) then waits on them, minutes after the kill.
 */
const MAX_CAPTURE = 64 * 1024 * 1024

function runHarness(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  live?: Set<number>,
  abortedPids?: Set<number>,
): Promise<{ stdout: string; error: Error | null; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.pid !== undefined) live?.add(child.pid)
    const settle = (error: Error | null) => {
      const aborted = child.pid !== undefined && (abortedPids?.delete(child.pid) ?? false)
      if (child.pid !== undefined) live?.delete(child.pid)
      resolve({ stdout, error, timedOut, aborted })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL') // negative pid = the group (POSIX)
      } catch {
        child.kill('SIGKILL') // no group to kill (already gone, or not POSIX)
      }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      settle(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const error =
        code === 0
          ? null
          : new Error(
              `Command failed${signal ? ` (${signal})` : code !== null ? ` (exit ${code})` : ''}: ${cmd} ${args.join(' ')}${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
            )
      settle(error)
    })
  })
}

/** The whole stdout is one JSON document in print mode; tolerate stray lines. */
export function parseJsonOutput(stdout: string): unknown | null {
  const text = stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    /* fall through to line scan */
  }
  for (const line of text.split('\n').reverse()) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t)
    } catch {
      /* keep scanning */
    }
  }
  return null
}

/**
 * Newline-delimited JSON, in emission order: one event per agent turn
 * (opencode's `--format json` shape). Malformed or non-object lines are
 * skipped rather than failing the whole parse — a harness's stderr chatter
 * or a truncated final line shouldn't cost the events already captured.
 */
export function parseNdjson(stdout: string): unknown[] {
  const events: unknown[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      events.push(JSON.parse(t))
    } catch {
      /* skip malformed line */
    }
  }
  return events
}

/** True iff every dotted-path field in `filter` matches that event (string-compared). No filter matches everything. */
export function matchesLineFilter(event: unknown, filter?: Record<string, string>): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([path, want]) => String(dig(event, path)) === want)
}

/**
 * Sums a numeric dotted-path field across events — e.g. opencode emits one
 * `step_finish` per agent turn, each carrying that turn's own cost/tokens,
 * not a running total, so a multi-turn dispatch (any real tool use) needs
 * every matching line added together. Returns `null` iff the path itself
 * is unset, or no event had a numeric value there — distinct from a real
 * measured 0.
 */
export function sumField(events: unknown[], path?: string): number | null {
  if (!path) return null
  let sum = 0
  let found = false
  for (const event of events) {
    const v = dig(event, path)
    if (typeof v === 'number') {
      sum += v
      found = true
    }
  }
  return found ? sum : null
}
