// The runner agent's poll/claim/report surface (ORCHESTRATOR.md / TOPOLOGY.md
// §3.3, run "runner-agent" R6): a workstation agent authenticates with a
// service token and polls for dispatch intents, claims one, executes it, and
// reports the outcome back. Mirrors `webhook.ts`'s config-gated shape —
// `buildRunnerApi` returns undefined when `RUNNER_TOKEN` is unset, so the
// route never exists unsigned (AC6.1).
//
// This file never imports from `@agentic/orchestrator`: `PendingIntent`,
// `DispatchOutcome`, and `RunnerCallback` below are structural mirrors of
// `runner-dispatcher.ts` (task 02) and `seam.ts`'s shapes, kept in lockstep
// by convention rather than a package dependency, so the server package
// carries no edge to the orchestrator package. `RunnerCallback.pendingIntents`
// is deliberately zero-argument here: the caller that supplies the reference
// (task 05's orchestrator wiring, which does have engine/ledger access) is
// responsible for adapting `RemoteDispatcher.pendingIntents(openEntries)`
// into this shape — this file, and the tests that stub it, never need to
// know how open ledger entries are gathered.
import { execFile } from 'node:child_process'

/** Mirrors runner-dispatcher.ts's `PendingIntent` (task 02). */
export interface PendingIntent {
  key: string
  slug: string
  branch: string
  role: string
  task: string | null
  round: number | null
  body: string
  timeoutMs: number
  /** The commit the engine armed this dispatch at (ADR-2's pin). Left
   *  undefined by `RemoteDispatcher` (it never touches the repo); `listIntents`
   *  below augments it from `repoDir` before the intent reaches the wire
   *  (ADR-7 / review-02.md F3). */
  baseOid?: string
}

/** Mirrors seam.ts's `DispatchOutcome`. */
export interface DispatchOutcome {
  ok: boolean
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  error: string | null
  fatal?: boolean
}

/**
 * The server-facing half of the relay (runner-dispatcher.ts's own
 * `RunnerCallback`, task 02) — narrowed to the zero-argument shape this route
 * needs. `RemoteDispatcher` satisfies it once its own `pendingIntents` is
 * partially applied over the current open ledger entries by whoever wires it
 * in (task 05).
 */
export interface RunnerCallback {
  /** Every intent this callback currently holds a pending dispatch for,
   *  ready for a workstation to claim. Pure/idempotent: polling again before
   *  `resolveOutcome` returns the same intents, keyed the same way. */
  pendingIntents(): PendingIntent[]
  /** Resolves the pending dispatch matching `key` with the workstation's
   *  reported outcome. Returns false when no pending dispatch matches — the
   *  key names a dispatch already resolved, timed out, or never issued. */
  resolveOutcome(key: string, outcome: DispatchOutcome): boolean
}

/** What `createApp` (app.ts) actually calls per request — the token gate
 *  lives here so app.ts stays a thin route layer, matching webhook.ts. */
export interface RunnerApi {
  token: string
  /** Open dispatch intents, each augmented with its base OID when `repoDir`
   *  was configured (ADR-2, review-02.md F3). */
  listIntents(): Promise<PendingIntent[]>
  /** Atomically claims an intent by key. False when already claimed. */
  claim(key: string): boolean
  /** Resolves the dispatcher's pending promise for `key` with `outcome`. */
  report(key: string, outcome: DispatchOutcome): boolean
}

/** `git -C repoDir rev-parse branch`, tolerant of a missing/unresolvable ref
 *  (returns null rather than throwing) — an intent missing a base OID is
 *  still servable, just not pinnable yet. */
function resolveOid(repoDir: string, branch: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoDir, 'rev-parse', branch], { encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim())
    })
  })
}

/**
 * Wire the runner-agent poll/claim/report surface. Returns undefined when no
 * token is configured (or no callback is wired to serve it) — the routes
 * then never exist; an unauthenticated poll surface would let anyone who can
 * reach the port claim and report dispatch work.
 */
export function buildRunnerApi(opts: {
  token: string | undefined
  callback: RunnerCallback | undefined
  /** Repo whose branches the intents reference, for base-OID augmentation
   *  (ADR-2). Optional: without it, intents are served with `baseOid` left
   *  as the callback provided (normally undefined). */
  repoDir?: string
  log: (line: string) => void
}): RunnerApi | undefined {
  if (!opts.token || !opts.callback) return undefined
  const token = opts.token
  const callback = opts.callback
  const repoDir = opts.repoDir
  const claimed = new Set<string>()

  return {
    token,
    async listIntents(): Promise<PendingIntent[]> {
      const intents = callback.pendingIntents()
      if (!repoDir) return intents
      return Promise.all(
        intents.map(async (intent) => {
          if (intent.baseOid) return intent
          const baseOid = await resolveOid(repoDir, intent.branch)
          return baseOid ? { ...intent, baseOid } : intent
        }),
      )
    },
    claim(key: string): boolean {
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    },
    report(key: string, outcome: DispatchOutcome): boolean {
      claimed.delete(key)
      const resolved = callback.resolveOutcome(key, outcome)
      if (!resolved) opts.log(`runner-api: report for unknown/already-resolved key "${key}" ignored`)
      return resolved
    },
  }
}
