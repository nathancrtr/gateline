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
   *  (ADR-7 / review-02.md F3).
   *
   *  Best-effort, not a captured pin (review-03.md F5): `listIntents` resolves
   *  this as `<branch>`'s tip *at poll time*, not the commit that was actually
   *  armed when the dispatch was issued. Between arm and poll, a sibling
   *  dispatch's bookkeeping commit on the same branch can move the tip past
   *  the armed commit, and a commit made locally but not yet pushed can
   *  resolve to an OID the workstation's clone from origin cannot fetch. A
   *  true per-dispatch pin has to be captured at arm/dispatch time, where the
   *  engine (not this route) knows the exact commit — that capture is task
   *  05's wiring to add if the drift proves material in practice; this route
   *  only has read access to the repo's current ref state at poll time. */
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
  /** The repo's `origin` remote URL, when `repoDir` is configured and the
   *  remote resolves (review-03.md F6) — task 04's workstation agent clones
   *  from this rather than requiring `--repo-url` on every invocation. Null
   *  when unconfigured or unresolvable; the agent's `--repo-url` flag is the
   *  documented fallback for that case. */
  repoUrl(): Promise<string | null>
  /** Atomically claims an intent by key. False when already claimed or when
   *  the previous claim of the same key has not yet expired (review-03.md
   *  F1). */
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

/** `git -C repoDir remote get-url origin`, tolerant of a missing/unconfigured
 *  remote (returns null rather than throwing) — mirrors webhook.ts's own
 *  `originUrl` helper (review-03.md F6), kept local here since this file
 *  carries no dependency on webhook.ts. */
function resolveRepoUrl(repoDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim())
    })
  })
}

/** A claim with no fallback default, used when the claimed key names no
 *  intent this callback currently knows about (already resolved, or never
 *  issued by this process) — still claimable/expirable, just without a
 *  `timeoutMs` to size the TTL from. Generous on purpose: an unknown-key
 *  claim is not the common "worker crashed mid-dispatch" path this TTL
 *  exists for. */
const DEFAULT_CLAIM_TTL_MS = 10 * 60_000

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
   *  (ADR-2) and origin-URL resolution (review-03.md F6). Optional: without
   *  it, intents are served with `baseOid` left as the callback provided
   *  (normally undefined), and `repoUrl()` resolves to null. */
  repoDir?: string
  log: (line: string) => void
  /** Injectable clock for deterministic claim-TTL tests (review-03.md F1);
   *  defaults to `Date.now`. Production callers never pass this. */
  now?: () => number
}): RunnerApi | undefined {
  if (!opts.token || !opts.callback) return undefined
  const token = opts.token
  const callback = opts.callback
  const repoDir = opts.repoDir
  const now = opts.now ?? Date.now
  // key -> the timestamp (per `now`) at which the claim expires and the key
  // becomes claimable again. A claim with no report by then is treated as a
  // crashed/abandoned worker (review-03.md F1): without this, a worker that
  // claims and dies before reporting poisons the key forever — every
  // re-dispatch of the same task/round is byte-identical, so the engine's
  // retry livelocks against a claim nobody will ever release. Sized to the
  // intent's own `timeoutMs` so the claim frees up around the same time the
  // dispatcher's own promise times out and the engine re-dispatches — no
  // sooner (which would let two workers race the same live claim) and no
  // much later (which would extend the livelock window past the timeout
  // that already exists for this exact reason).
  const claims = new Map<string, number>()
  let repoUrlPromise: Promise<string | null> | undefined

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
    repoUrl(): Promise<string | null> {
      if (!repoDir) return Promise.resolve(null)
      // Memoized: the origin remote does not change across the process's
      // lifetime, so there is no reason to shell out to git on every poll
      // the way baseOid resolution (necessarily) does per intent.
      if (!repoUrlPromise) repoUrlPromise = resolveRepoUrl(repoDir)
      return repoUrlPromise
    },
    claim(key: string): boolean {
      const expiresAt = claims.get(key)
      if (expiresAt !== undefined && expiresAt > now()) return false
      const intent = callback.pendingIntents().find((i) => i.key === key)
      const ttlMs = intent?.timeoutMs ?? DEFAULT_CLAIM_TTL_MS
      claims.set(key, now() + ttlMs)
      return true
    },
    report(key: string, outcome: DispatchOutcome): boolean {
      claims.delete(key)
      const resolved = callback.resolveOutcome(key, outcome)
      if (!resolved) opts.log(`runner-api: report for unknown/already-resolved key "${key}" ignored`)
      return resolved
    },
  }
}
