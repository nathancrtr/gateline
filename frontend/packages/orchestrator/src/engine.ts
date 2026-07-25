// The tick's execute half (ORCHESTRATOR.md §4): read state at the run branch
// tip → derive (derive.ts) → execute → record with a CAS commit → done. At
// most one state transition per run per tick; a transition may carry several
// dispatches. Every write follows the co-writer contract (§7): CAS ref
// updates, comment-preserving YAML, the orchestrator's own commit verbs
// (dispatched | bounced | advanced | escalated | paused | metered | harvested),
// a bot identity, and — structurally — no code path that writes gates.*.
import { ensureDraftPr, Git, LocalGitSource, type Identity, type RunRef, type WriteResult } from '@agentic/core'
import type { Document } from 'yaml'
import { hasShell, loadRoleCapabilities } from './capabilities.ts'
import { deriveAction, DEFAULT_ESTIMATE_USD, type Bookkeeping, type DerivedAction, type DispatchIntent } from './derive.ts'
import { harvestPathspecs } from './harvest.ts'
import { observeRun, parseLedger, type RunObservation } from './observe.ts'
import { promptBody } from './prompts.ts'
import { resolveModel, type Registry } from './registry.ts'
import type { Dispatcher, DispatchOutcome } from './seam.ts'
import { ensureRunCheckout, ensureTaskCheckout, foldHarvestBranch, foldTaskBranch, removeRunCheckout, type TaskCheckout } from './workspace.ts'

export interface EngineConfig {
  repoDir: string
  identity: Identity
  dispatcher: Dispatcher
  registry: Registry | null
  /**
   * Override the `.agentic` default when this repo was integrated with a
   * custom `integrate.py --prefix` (#95) — otherwise auto-detected.
   */
  frameworkPrefix?: string
  /** Dispatch wall clock per role before the job is killed (default 30 min). */
  roleTimeoutMs?: number
  /** Age at which an open ledger entry with no live job is declared lost (default 5 min). */
  staleMs?: number
  /** Push every orchestrator commit to origin (hosted mode): the machine is disposable, origin is not. */
  push?: boolean
  /**
   * Local-only mode (mirrors the core resolution table, AC2.2/AC2.4): forces
   * the engine's LocalGitSource to skip origin fetch on heartbeat sync, and
   * suppresses the first-dispatch draft-PR ensure.
   */
  localOnly?: boolean
  /**
   * Host-wide ceiling (hosted mode): refuse new dispatches when projected
   * spend across every active run exceeds this, escalating like DB does.
   * Per-run cost_limit_usd still applies; this bounds their sum.
   */
  spendLimitUsd?: number | null
  /** Refuse dispatch on a run missing budget.cost_limit_usd (hosted mode): unattended dispatch needs a ceiling. */
  requireBudget?: boolean
  /**
   * Master switch for budget *enforcement* (#109): false disables the DB, RB,
   * and HB pauses (spendLimitUsd/requireBudget become no-ops) for operators
   * whose harness bills flat-rate. Metering — the ledger, cost_spent_usd,
   * token counts — is unconditional and unaffected. Default true.
   */
  budgetEnforcement?: boolean
  now?: () => Date
  log?: (line: string) => void
}

export interface TickOutcome {
  slug: string
  action: DerivedAction
  wrote: boolean
  launched: number
  detail: string
}

const DEFAULT_ROLE_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_STALE_MS = 5 * 60 * 1000

/**
 * Slugs whose draft PR has already been ensured this process (ADR-5, R8):
 * `ensureDraftPr` is idempotent regardless, so this memo exists only to skip
 * the `gh` round-trip on every subsequent dispatching tick — a fresh process
 * (restart) re-ensures once, which is harmless (list-then-create).
 */
const ensuredDraftPrs = new Set<string>()

/** One in-flight dispatch, as reported to the operator during drain (#150). */
export interface InFlightJob {
  slug: string
  role: string
  task: string | null
  round: number | null
  /** Epoch ms the dispatch launched. */
  startedAt: number
}

export class Engine {
  readonly source: LocalGitSource
  private readonly cfg: EngineConfig
  /** In-flight jobs, keyed slug|role|task|round — host ephemera, never committed (§4.4). */
  private readonly jobs = new Map<string, Promise<void>>()
  /** Same keys as `jobs`: what each in-flight dispatch is, for drain reporting (#150). */
  private readonly jobMeta = new Map<string, InFlightJob>()
  /**
   * Per-run write serialization. CAS protects against *other* writers; this
   * protects the engine against itself — concurrent closing commits (two
   * jobs finishing together) would otherwise race the worktree-fallback
   * write path, which git cannot CAS.
   */
  private readonly writeLocks = new Map<string, Promise<unknown>>()
  /** Fired each time a dispatch job settles — the completion trigger. */
  onSettled: (() => void) | null = null

  constructor(cfg: EngineConfig) {
    this.cfg = cfg
    this.source = new LocalGitSource('orchestrator', cfg.repoDir, {
      identity: cfg.identity,
      push: cfg.push,
      localOnly: cfg.localOnly,
      frameworkPrefix: cfg.frameworkPrefix,
    })
  }

  private nowIso(): string {
    return (this.cfg.now?.() ?? new Date()).toISOString()
  }

  private log(line: string): void {
    this.cfg.log?.(line)
  }

  private estimates(): Record<string, number> {
    return this.cfg.registry?.estimates ?? {}
  }

  private enforcing(): boolean {
    return this.cfg.budgetEnforcement !== false
  }

  /** Loaded once per process (roles/ doesn't change mid-run); a failed read just leaves every role shell-ful. */
  private capsPromise: Promise<Map<string, Set<string>>> | null = null
  private capabilities(): Promise<Map<string, Set<string>>> {
    if (!this.capsPromise) {
      this.capsPromise = loadRoleCapabilities(this.cfg.repoDir, this.cfg.frameworkPrefix).catch((e) => {
        this.log(`failed to load role capabilities: ${(e as Error).message} — every role defaults shell-ful`)
        return new Map()
      })
    }
    return this.capsPromise
  }

  private withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeLocks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.writeLocks.set(
      slug,
      next.catch(() => {}),
    )
    return next
  }

  inFlight(): number {
    return this.jobs.size
  }

  /** What is currently dispatched, for drain reporting (#150). */
  inFlightDetail(): InFlightJob[] {
    return [...this.jobMeta.values()]
  }

  /**
   * Operator force-drain (#150): SIGKILL every live harness process group.
   * Aborted dispatches resolve through the normal failure path — closing
   * commits land and tasks are freed for retry — so `drain()` completes
   * shortly after. Returns how many groups were signalled.
   */
  abortInFlight(): number {
    return this.cfg.dispatcher.abortAll?.() ?? 0
  }

  /**
   * Fast-forward local run branches from origin before deriving (#104). A
   * standalone orchestrator has no co-located server fetch loop to lean on,
   * and an engine reading a materialized local branch never sees remote
   * decisions otherwise — it re-derives yesterday's state forever. ff-only
   * and idempotent (LocalGitSource.syncFromRemote): a diverged branch is
   * refused and left for a human, never resolved silently. Failure is
   * tolerated — a clone with no origin is a legal dev/test topology.
   *
   * Callers choose when: the run loop syncs on heartbeat/startup ticks only,
   * because our own fetch touches FETCH_HEAD under the watched .git dir and
   * a sync inside every refs-triggered tick would re-trigger itself.
   */
  async syncFromRemote(): Promise<void> {
    try {
      await this.source.syncFromRemote()
    } catch (e) {
      this.log(`sync from origin failed: ${(e as Error).message}`)
    }
  }

  /** Consecutive rejected pushes per branch — cleared by any accepted write.
   *  Read by callers (and eventually the frontend, #100) as push health. */
  private readonly pushRejections = new Map<string, number>()

  pushHealth(): ReadonlyMap<string, number> {
    return this.pushRejections
  }

  /**
   * Push-then-launch's recovery half (#103): origin rejecting our push means
   * another writer moved the branch past the tip this commit was derived
   * from — origin is the linearization point, and this commit lost its CAS
   * there. The commit is the engine's own bookkeeping, not yet acted on
   * (CAS guarantees it is the local tip), so drop it, sync, and let the
   * next derivation start from origin's truth.
   *
   * When a run checkout holds the branch (jobs in flight), the ref cannot be
   * moved behind the worktree's back — the commit stays local and unpushed;
   * the open ledger entry it carries is self-healing via stale-aging, and a
   * later accepted push carries or supersedes it. Returns true when the
   * commit was dropped.
   */
  private async recoverRejectedPush(ref: RunRef, commit: string | undefined, why: string): Promise<boolean> {
    const n = (this.pushRejections.get(ref.branch) ?? 0) + 1
    this.pushRejections.set(ref.branch, n)
    const prefix = `${ref.slug}: push rejected (${n}× consecutive) — ${truncate(why, 100)}`
    let dropped = false
    if (commit) {
      const branchRef = `refs/heads/${ref.branch}`
      const held = (await this.source.git.worktrees()).some((w) => w.branch === branchRef)
      const parent = held ? null : await this.source.git.revParse(`${commit}^`)
      if (parent) dropped = await this.source.git.updateRefCAS(branchRef, parent, commit)
      this.log(
        dropped
          ? `${prefix}; dropped the stale commit and syncing from origin`
          : `${prefix}; commit stays local (${held ? 'branch held by a checkout' : 'ref moved'}) — stale-aging self-heals`,
      )
    } else {
      this.log(prefix)
    }
    await this.syncFromRemote()
    if (n >= 2)
      this.log(
        `${ref.slug}: ${n} consecutive rejected pushes — another writer is actively holding origin; a human should look (see #103)`,
      )
    return dropped
  }

  private notePushAccepted(branch: string): void {
    this.pushRejections.delete(branch)
  }

  /**
   * Rejection classes (#103): non-fast-forward means origin moved past the
   * observed tip — the derivation behind the commit is stale and must not be
   * acted on. Anything else (unreachable remote, auth) leaves this clone
   * merely *ahead* of origin: keep the commit, warn, count it against push
   * health, and let a later accepted push carry it — dropping bookkeeping
   * over a network blip would lose real usage data.
   */
  private stalePush(msg: string): boolean {
    return /non-fast-forward|fetch first/i.test(msg)
  }

  private notePushFailure(ref: RunRef, why: string): void {
    const n = (this.pushRejections.get(ref.branch) ?? 0) + 1
    this.pushRejections.set(ref.branch, n)
    this.log(`${ref.slug}: push failed (${n}× consecutive) — ${truncate(why, 100)} — commits stay local until the next accepted push`)
  }

  /** Await every in-flight job (their closing commits included). */
  async drain(): Promise<void> {
    while (this.jobs.size > 0) await Promise.allSettled([...this.jobs.values()])
  }

  /** One reconcile pass over every active run. Idempotent to re-run. */
  async tick(): Promise<TickOutcome[]> {
    const outcomes: TickOutcome[] = []
    const refs = (await this.source.listRuns()).filter((r) => r.kind !== 'default') // merged runs are historical records
    // The host ceiling is measured once per tick across every active run's
    // ledger; dispatches granted within the tick add their estimates.
    const host = this.enforcing() && this.cfg.spendLimitUsd != null ? { projected: await this.hostProjectedUsd(refs) } : null
    for (const ref of refs) {
      await this.sweepStale(ref)
      // Pin the tip: observe at this exact commit and CAS every write against
      // it, so nothing decided from a stale read can land (§4.4's guard,
      // stretched over the whole derive-then-write span). A hosted clone sees
      // a new run only as a remote-tracking ref until the first write
      // materializes the local branch (LocalGitSource.syncFromRemote), so
      // resolve the tip where listRuns actually found the run — pinning only
      // refs/heads would silently skip every not-yet-written remote run.
      const tip =
        ref.kind === 'remote'
          ? await this.source.git.revParse(ref.ref)
          : await this.source.git.revParse(`refs/heads/${ref.branch}`)
      if (!tip) continue
      const pinned = { ...ref, ref: tip }
      const obs = await observeRun(this.source, pinned, {
        estimates: this.estimates(),
        enforceBudget: this.enforcing(),
        isAncestor: (a, b) => this.source.git.isAncestor(a, b),
      })
      const action = deriveAction(obs)
      outcomes.push(await this.execute(ref, tip, obs, this.hostGuards(obs, action, host)))
    }
    return outcomes
  }

  /**
   * Hosted-mode guards wrapping the per-run derivation (§6's DB, lifted to
   * the host): a dispatch is downgraded to an escalation when the run has no
   * budget ceiling (RB) or the host-wide projection would exceed the global
   * cap (HB). Pause rather than degrade, same as DB.
   */
  private hostGuards(obs: RunObservation, action: DerivedAction, host: { projected: number } | null): DerivedAction {
    if (action.kind !== 'dispatch') return action
    if (!this.enforcing()) return action // #109: enforcement off — meter, never pause
    if (this.cfg.requireBudget && (obs.state?.budget?.cost_limit_usd ?? null) === null) {
      const reason = 'no cost_limit_usd set — this orchestrator requires a per-run budget cap before dispatch (--require-budget)'
      return { kind: 'escalate', rule: 'RB', reason, pause: 'budget-exhausted', why: reason }
    }
    if (host && this.cfg.spendLimitUsd != null) {
      const add = action.dispatches.reduce((sum, d) => sum + (this.estimates()[d.role] ?? DEFAULT_ESTIMATE_USD), 0)
      if (host.projected + add > this.cfg.spendLimitUsd) {
        const reason = `projected host spend $${(host.projected + add).toFixed(2)} across active runs exceeds --spend-limit-usd $${this.cfg.spendLimitUsd} — pausing rather than degrading`
        return { kind: 'escalate', rule: 'HB', reason, pause: 'budget-exhausted', why: reason }
      }
      host.projected += add
    }
    return action
  }

  /** Spend committed or in flight across the given runs: closed ledger costs plus estimates for open entries. */
  private async hostProjectedUsd(refs: RunRef[]): Promise<number> {
    let total = 0
    for (const ref of refs) {
      const { state } = await this.source.readState(ref)
      if (!state) continue
      for (const entry of parseLedger(state)) {
        total += entry.cost_usd ?? (entry.failed ? 0 : (this.estimates()[entry.role] ?? DEFAULT_ESTIMATE_USD))
      }
    }
    return total
  }

  /**
   * Crash recovery (§4.4): an open ledger entry with no living job and no
   * artifact is exactly the signature of a dispatch lost between commit and
   * completion. Age it out: close it as failed (metered at the conservative
   * static estimate); the next derivation re-dispatches — a lost dispatch
   * costs a retry, never corruption.
   */
  private async sweepStale(ref: RunRef): Promise<void> {
    const { state } = await this.source.readState(ref)
    if (!state) return
    const staleMs = this.cfg.staleMs ?? DEFAULT_STALE_MS
    const now = (this.cfg.now?.() ?? new Date()).getTime()
    for (const entry of parseLedger(state)) {
      if (entry.cost_usd !== null || entry.failed) continue
      const key = jobKey(ref.slug, entry.role, entry.task, entry.round)
      if (this.jobs.has(key)) continue // alive here; not stale
      const openedAt = entry.at ? Date.parse(entry.at) : NaN
      if (Number.isNaN(openedAt) || now - openedAt < staleMs) continue
      this.log(`${ref.slug}: aging stale dispatch ${entry.role}${entry.task ? `(${entry.task})` : ''} — no live job`)
      await this.closeDispatch(ref, { role: entry.role, task: entry.task, round: entry.round }, {
        ok: false,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        error: 'dispatch lost (orchestrator restart or crash) — aged out by the heartbeat',
      })
    }
  }

  private async execute(ref: RunRef, tip: string, obs: RunObservation, action: DerivedAction): Promise<TickOutcome> {
    const base: TickOutcome = { slug: ref.slug, action, wrote: false, launched: 0, detail: action.why }
    const cas = { expectedTip: tip }
    switch (action.kind) {
      case 'rest':
        return base

      case 'record': {
        const result = await this.withLock(ref.slug, () =>
          this.source.writeState(
            ref,
            (doc) => applyBookkeeping(doc, action.updates),
            `state(${ref.slug}): advanced — ${describeUpdates(action.updates)}`,
            cas,
          ),
        )
        if (result.ok && result.pushFailed) {
          if (this.stalePush(result.pushFailed)) {
            const dropped = await this.recoverRejectedPush(ref, result.commit, result.pushFailed)
            return { ...base, wrote: !dropped, detail: 'push rejected — origin moved; synced, re-derive next tick' }
          }
          this.notePushFailure(ref, result.pushFailed)
        } else if (result.ok) this.notePushAccepted(ref.branch)
        return { ...base, wrote: result.ok, detail: writeDetail(result, action.why) }
      }

      case 'escalate': {
        const at = this.nowIso()
        const result = await this.withLock(ref.slug, () =>
          this.source.writeState(
            ref,
            (doc) => {
              const count = countSeq(doc, ['escalations'])
              doc.setIn(['escalations', count], { at, from_role: 'orchestrator', reason: action.reason, resolved: false })
              if (action.pause) {
                doc.setIn(['phase'], 'paused')
                doc.setIn(['paused_reason'], action.pause)
              }
            },
            `state(${ref.slug}): escalated${action.pause ? ` (paused: ${action.pause})` : ''} — ${truncate(action.reason, 80)}`,
            cas,
          ),
        )
        if (result.ok && result.pushFailed) {
          if (this.stalePush(result.pushFailed)) {
            const dropped = await this.recoverRejectedPush(ref, result.commit, result.pushFailed)
            return { ...base, wrote: !dropped, detail: 'push rejected — origin moved; synced, re-derive next tick' }
          }
          this.notePushFailure(ref, result.pushFailed)
        } else if (result.ok) this.notePushAccepted(ref.branch)
        return { ...base, wrote: result.ok, detail: writeDetail(result, action.reason) }
      }

      case 'dispatch': {
        // Commit-then-launch (§4.4): the intent is a CAS commit against the
        // observed tip — the duplicate-dispatch guard. Losing the CAS means
        // someone else acted on this state; rest and re-derive next tick.
        const at = this.nowIso()
        const result = await this.withLock(ref.slug, () =>
          this.source.writeState(
            ref,
            (doc) => {
              for (const intent of action.dispatches) {
                const count = countSeq(doc, ['budget', 'ledger'])
                doc.setIn(['budget', 'ledger', count], {
                  at,
                  role: intent.role,
                  task: intent.task,
                  round: intent.round,
                  adapter: this.cfg.dispatcher.adapterFor?.(intent.role) ?? this.cfg.dispatcher.adapter,
                  model: this.cfg.registry ? resolveModel(this.cfg.registry, intent.role) : null,
                  tokens_in: null,
                  tokens_out: null,
                  cost_usd: null,
                })
                if (intent.role === 'implementer' && intent.task) setTaskField(doc, obs, intent.task, 'status', 'dispatched')
              }
            },
            dispatchMessage(ref.slug, action.dispatches),
            cas,
          ),
        )
        if (!result.ok) return { ...base, detail: writeDetail(result, 'intent commit lost CAS — re-derive next tick') }
        // Push-then-launch (#103): origin accepting the intent commit is what
        // arms the dispatch. A rejected push means another writer moved the
        // branch past the tip this derivation observed — launching now would
        // act on state that is already history. Drop the stale intent (or
        // leave it to stale-aging when a checkout holds the branch), sync,
        // and re-derive from origin's truth next tick.
        if (result.pushFailed && this.stalePush(result.pushFailed)) {
          const dropped = await this.recoverRejectedPush(ref, result.commit, result.pushFailed)
          return {
            ...base,
            wrote: !dropped,
            detail: `intent push rejected — origin moved past the observed tip; ${dropped ? 'intent dropped' : 'intent kept local (stale-aging closes it)'}, nothing launched`,
          }
        }
        // An unreachable origin doesn't invalidate the derivation — this
        // clone is merely ahead. Launch (the pre-#103 posture), and let a
        // later accepted push carry the intent commit.
        if (result.pushFailed) this.notePushFailure(ref, result.pushFailed)
        else this.notePushAccepted(ref.branch)

        // Draft-PR ensure (#118, ADR-5, R8): the first dispatch a fresh
        // process observes for this run is as good a "first arm/dispatch"
        // moment as any to guarantee a reviewable PR exists, regardless of
        // how the branch was made (hand, CLI, or a future driver). Never
        // fatal — ensureDraftPr itself never throws, and its result never
        // touches the tick outcome.
        if (!ensuredDraftPrs.has(ref.slug)) {
          ensuredDraftPrs.add(ref.slug)
          const ensured = await ensureDraftPr(this.cfg.repoDir, ref.branch, ref.slug, { localOnly: this.cfg.localOnly })
          this.log(`${ref.slug}: draft PR ensure — ${ensured.status}: ${ensured.note}`)
        }

        for (const intent of action.dispatches) this.launch(ref, obs, intent, at)
        return { ...base, wrote: true, launched: action.dispatches.length }
      }
    }
  }

  private launch(ref: RunRef, obs: RunObservation, intent: DispatchIntent, openedAt: string): void {
    const key = jobKey(ref.slug, intent.role, intent.task, intent.round)
    this.jobMeta.set(key, { slug: ref.slug, role: intent.role, task: intent.task, round: intent.round, startedAt: Date.now() })
    // A dispatcher with managesOwnWorkspace (the remote runner, run
    // "runner-agent" ADR-3) creates and harvests its own checkout — the
    // engine creates no local checkout for it and folds a harvest branch in
    // place of the local per-task fold. Implementers otherwise get per-task
    // isolation (§5.3): a private branch and worktree off the run tip,
    // folded back serially on success — parallel implementers never observe
    // each other's mid-flight state.
    const managesOwnWorkspace = this.cfg.dispatcher.managesOwnWorkspace === true
    const isolate = !managesOwnWorkspace && intent.role === 'implementer' && intent.task !== null
    const job = (async () => {
      let outcome: DispatchOutcome
      try {
        const checkout = managesOwnWorkspace
          ? null
          : isolate
            ? await ensureTaskCheckout(this.cfg.repoDir, ref.branch, intent.task!)
            : { path: await ensureRunCheckout(this.cfg.repoDir, ref.branch), branch: ref.branch }
        const taskPath = intent.task ? (obs.taskFiles.get(intent.task)?.path ?? null) : null
        const { runs: runsRoot } = await this.source.frameworkRoots()
        const caps = await this.capabilities()
        outcome = await this.cfg.dispatcher.dispatch({
          // managesOwnWorkspace dispatchers never read cwd (they check out
          // their own workspace on the workstation) — repoDir is a harmless
          // placeholder to satisfy the required field.
          cwd: checkout?.path ?? this.cfg.repoDir,
          role: intent.role,
          body: promptBody(ref.slug, intent, taskPath, runsRoot, obs.state?.profile ?? 'full', hasShell(caps, intent.role)),
          timeoutMs: this.cfg.roleTimeoutMs ?? DEFAULT_ROLE_TIMEOUT_MS,
          slug: ref.slug,
          branch: ref.branch,
          task: intent.task,
          round: intent.round,
        })
        if (isolate) {
          const fold = await this.withLock(ref.slug, () => foldTaskBranch(this.cfg.repoDir, ref.branch, checkout as TaskCheckout))
          if (outcome.ok && !fold.ok) {
            outcome = { ok: false, costUsd: outcome.costUsd, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, error: fold.message, fatal: fold.conflict }
          }
          // The fold moves the run ref outside writeState; push it explicitly
          // so agent work reaches origin even if the closing commit fails.
          if (fold.ok) await this.pushBranch(ref.branch)
        } else if (managesOwnWorkspace && outcome.harvest) {
          // The remote runner's own harvest-then-dispose (run "runner-agent"
          // ADR-3/ADR-4): the worker already committed and pushed its
          // harvest branch, so folding it — not a local harvest-commit,
          // there is no local checkout to harvest from — is what lands it.
          const harvest = outcome.harvest
          const fold = await this.withLock(ref.slug, () => foldHarvestBranch(this.cfg.repoDir, ref.branch, harvest))
          if (outcome.ok && !fold.ok) {
            outcome = { ok: false, costUsd: outcome.costUsd, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, error: fold.message, fatal: fold.conflict }
          }
          if (fold.ok) await this.pushBranch(ref.branch)
        } else if (checkout && outcome.ok) {
          // Harvest-commit (#182): a shell-less role (analyst, architect) has
          // no way to commit its own artifacts, and even a shell-ful role may
          // simply not have (the harvest is a defense-in-depth backstop for
          // those). Scoped to this role's own outputs so a peer reviewer
          // sharing the checkout is never swept into a torn commit. Runs
          // under the run's write lock — the same lock serializing the
          // worktree-fallback state writes — and, crucially, before
          // `removeRunCheckout` force-removes this checkout in `finally`
          // below: this is what rescues the work from that force-remove.
          // Guarded on `checkout` (never null here — only managesOwnWorkspace
          // leaves it null, and that branch is handled above): a
          // managesOwnWorkspace dispatcher has no local checkout to harvest.
          const harvest = await this.withLock(ref.slug, () => this.harvest(ref, checkout.path, runsRoot, intent))
          if (!harvest.ok) {
            outcome = { ok: false, costUsd: outcome.costUsd, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, error: harvest.error }
          }
        }
      } catch (e) {
        outcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: (e as Error).message }
      }
      await this.closeDispatch(ref, intent, outcome, openedAt)
    })()
    this.jobs.set(
      key,
      job.finally(async () => {
        this.jobs.delete(key)
        this.jobMeta.delete(key)
        // Last job out releases the run's checkout, so subsequent state
        // writes go through plumbing + CAS instead of the worktree fallback.
        // Nothing to release for a managesOwnWorkspace dispatcher — it never
        // had a local checkout to begin with.
        if (!managesOwnWorkspace && ![...this.jobs.keys()].some((k) => k.startsWith(`${ref.slug}|`))) {
          await removeRunCheckout(this.cfg.repoDir, ref.branch)
        }
        this.onSettled?.()
      }),
    )
  }

  /**
   * Closing bookkeeping (§4.4 step 3): the agent's artifacts are already on
   * the run branch (it commits its own work, or the engine harvested it —
   * §4.4); this commit closes the ledger entry with real usage, keeps
   * cost_spent_usd the derived sum, and flips an implementer's task to
   * in-review. Everything else re-derives next tick.
   */
  private async closeDispatch(
    ref: RunRef,
    intent: { role: string; task: string | null; round: number | null },
    outcome: DispatchOutcome,
    openedAt?: string,
  ): Promise<void> {
    const estimate = this.estimates()[intent.role] ?? DEFAULT_ESTIMATE_USD
    const cost = outcome.costUsd ?? this.computeCost(intent.role, outcome) ?? estimate

    // Read-and-write under the run's write lock, so two jobs finishing
    // together serialize; retry only on a CAS refusal from another writer.
    const attemptOnce = async (): Promise<'done' | 'retry'> => {
      const fresh = await this.source.readState(ref)
      if (!fresh.state) return 'done'
      const ledger = parseLedger(fresh.state)
      const index = ledger.findIndex(
        (e) =>
          e.role === intent.role &&
          e.task === (intent.task ?? null) &&
          e.round === (intent.round ?? null) &&
          e.cost_usd === null &&
          !e.failed &&
          (openedAt === undefined || e.at === openedAt),
      )
      if (index < 0) return 'done' // already closed (another instance, or a re-run)

      const priorFailures = ledger.filter(
        (e) => e.failed && e.role === intent.role && e.task === (intent.task ?? null),
      ).length
      const escalateNow = !outcome.ok && (outcome.fatal === true || priorFailures >= 1) // one retry, then a human (§11); fatal skips the retry

      const result = await this.source.writeState(
        ref,
        (doc) => {
          doc.setIn(['budget', 'ledger', index, 'tokens_in'], outcome.tokensIn)
          doc.setIn(['budget', 'ledger', index, 'tokens_out'], outcome.tokensOut)
          doc.setIn(['budget', 'ledger', index, 'cost_usd'], cost)
          if (!outcome.ok) doc.setIn(['budget', 'ledger', index, 'failed'], true)
          const spent = ledger.reduce((sum, e, i) => sum + (i === index ? cost : (e.cost_usd ?? 0)), 0)
          doc.setIn(['budget', 'cost_spent_usd'], round2(spent))
          if (outcome.ok && intent.role === 'implementer' && intent.task) {
            setTaskFieldByDoc(doc, intent.task, 'status', 'in-review')
          }
          // A failed implementer left its task stranded at `dispatched`,
          // which D12 reads as in-flight forever — no retry, and the
          // second-failure escalation below becomes unreachable. Hand the
          // task back to derivation for the one retry §11 promises. On
          // escalation mark it `failed` — a status nothing reads as
          // in-flight (#147); D20 returns it to pending once a human
          // resolves the escalation, so a fresh round supersedes the
          // failure without a hand edit.
          if (!outcome.ok && intent.role === 'implementer' && intent.task) {
            if (getTaskFieldByDoc(doc, intent.task, 'status') === 'dispatched') {
              setTaskFieldByDoc(doc, intent.task, 'status', escalateNow ? 'failed' : 'pending')
            }
          }
          if (escalateNow) {
            const count = countSeq(doc, ['escalations'])
            doc.setIn(['escalations', count], {
              at: this.nowIso(),
              from_role: 'orchestrator',
              reason: `${intent.role}${intent.task ? ` (${intent.task})` : ''} failed twice: ${truncate(outcome.error ?? 'unknown error', 120)}`,
              resolved: false,
            })
            doc.setIn(['phase'], 'paused')
            doc.setIn(['paused_reason'], 'escalation')
          }
        },
        `state(${ref.slug}): metered ${intent.role}${intent.task ? `(${intent.task}${intent.round ? ` r${intent.round}` : ''})` : ''} $${cost.toFixed(2)}${outcome.ok ? '' : ` — failed: ${truncate(outcome.error ?? 'unknown', 60)}`}`,
      )
      if (result.ok && result.pushFailed && this.stalePush(result.pushFailed)) {
        // #103: the closing commit carries real usage — never discard it
        // outright. Dropped (plumbing path): re-read the synced state and
        // re-close on origin's tip. Kept (a checkout holds the branch):
        // it stays local and a later accepted push carries it — retrying
        // here would only stack more diverged commits.
        const dropped = await this.recoverRejectedPush(ref, result.commit, result.pushFailed)
        return dropped ? 'retry' : 'done'
      }
      if (result.ok) {
        if (result.pushFailed) this.notePushFailure(ref, result.pushFailed)
        else this.notePushAccepted(ref.branch)
        this.log(`${ref.slug}: metered ${intent.role} $${cost.toFixed(2)} ${outcome.ok ? 'ok' : `FAILED (${outcome.error})`}`)
        return 'done'
      }
      if (result.reason !== 'ref-moved') {
        this.log(`${ref.slug}: closing commit failed (${result.message ?? result.reason}) — heartbeat will age the entry`)
        return 'done'
      }
      return 'retry' // an agent or human committed mid-close; re-read and retry
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await this.withLock(ref.slug, attemptOnce)) === 'done') return
    }
    this.log(`${ref.slug}: closing commit lost CAS 5×; the heartbeat will age the open entry`)
  }

  /**
   * Harvest-commit (#182, ORCHESTRATOR.md §4.4): a non-isolated dispatch may
   * leave its artifacts uncommitted — the only path for a shell-less role,
   * and possible for a shell-ful one too. Scoped to this role's own outputs
   * (`harvestPathspecs`) so a peer sharing the run checkout is never swept
   * into a torn commit. `git status` first: the normal case (a shell-ful
   * role already committed) must be a clean no-op. Each pathspec is `git
   * add`ed independently (run "runner-agent" review-04.md round-2 F10): a
   * single combined `git add -A -- a b` is all-or-nothing, so one pathspec
   * matching nothing (e.g. architect's `tasks/` before any task file
   * exists) would silently drop a pathspec that did match alongside it.
   * Bot-identity commit via `-c`, since this is a real working-tree commit
   * (`git add` + `git commit`), not the plumbing path `LocalGitSource` uses
   * for state.yaml.
   */
  private async harvest(
    ref: RunRef,
    cwd: string,
    runsRoot: string,
    intent: { role: string; task: string | null; round: number | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pathspecs = harvestPathspecs(runsRoot, ref.slug, intent.role, intent.task)
    const git = new Git(cwd)
    try {
      const status = await git.run(['status', '--porcelain', '--', ...pathspecs])
      if (!status.trim()) return { ok: true } // nothing uncommitted in scope — the normal case for a shell-ful role
      for (const pathspec of pathspecs) {
        try {
          await git.run(['add', '-A', '--', pathspec])
        } catch {
          /* pathspec matched nothing — not an error, nothing to add for it */
        }
      }
      const what = `${intent.role}${intent.task ? `(${intent.task}${intent.round ? ` r${intent.round}` : ''})` : ''}`
      await git.run([
        '-c',
        `user.name=${this.cfg.identity.name}`,
        '-c',
        `user.email=${this.cfg.identity.email}`,
        'commit',
        '-m',
        `state(${ref.slug}): harvested ${what} artifacts`,
      ])
      await this.pushBranch(ref.branch)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /**
   * Push of agent work after a fold: these are real commits that can never
   * be dropped, so a rejection here only counts against push health (#103)
   * and warns — a later accepted push of the branch carries them.
   */
  private async pushBranch(branch: string): Promise<void> {
    if (!this.cfg.push) return
    try {
      await this.source.git.run(['push', 'origin', `${branch}:${branch}`])
      this.notePushAccepted(branch)
    } catch (e) {
      this.pushRejections.set(branch, (this.pushRejections.get(branch) ?? 0) + 1)
      this.log(`push of ${branch} failed: ${(e as Error).message} — commits stay local until the next push`)
    }
  }

  private computeCost(role: string, outcome: DispatchOutcome): number | null {
    if (outcome.tokensIn === null || outcome.tokensOut === null || !this.cfg.registry) return null
    const model = resolveModel(this.cfg.registry, role)
    const price = model ? this.cfg.registry.pricing[model] : undefined
    if (!price) return null
    return round2((outcome.tokensIn / 1e6) * price.usd_per_mtok_in + (outcome.tokensOut / 1e6) * price.usd_per_mtok_out)
  }
}

function jobKey(slug: string, role: string, task: string | null, round: number | null): string {
  return `${slug}|${role}|${task ?? ''}|${round ?? ''}`
}

const round2 = (n: number) => Math.round(n * 100) / 100

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function countSeq(doc: Document, path: (string | number)[]): number {
  const value = doc.getIn(path)
  const js = value && typeof (value as { toJSON?: unknown }).toJSON === 'function' ? (value as { toJSON(): unknown }).toJSON() : value
  return Array.isArray(js) ? js.length : 0
}

/** Task index resolved against the observation (indices mirror the doc). */
function setTaskField(doc: Document, obs: RunObservation, taskId: string, field: string, value: unknown): void {
  const index = (obs.state?.tasks ?? []).findIndex((t) => t.id === taskId)
  if (index >= 0) doc.setIn(['tasks', index, field], value)
}

/** Task index resolved against the doc itself (for closing commits, which re-read). */
function taskIndexByDoc(doc: Document, taskId: string): number {
  const tasks = doc.getIn(['tasks'])
  const js = tasks && typeof (tasks as { toJSON?: unknown }).toJSON === 'function' ? (tasks as { toJSON(): unknown[] }).toJSON() : []
  return Array.isArray(js) ? js.findIndex((t) => t && typeof t === 'object' && (t as { id?: string }).id === taskId) : -1
}

function setTaskFieldByDoc(doc: Document, taskId: string, field: string, value: unknown): void {
  const index = taskIndexByDoc(doc, taskId)
  if (index >= 0) doc.setIn(['tasks', index, field], value)
}

function getTaskFieldByDoc(doc: Document, taskId: string, field: string): unknown {
  const index = taskIndexByDoc(doc, taskId)
  if (index < 0) return undefined
  const value = doc.getIn(['tasks', index, field])
  return value && typeof (value as { toJSON?: unknown }).toJSON === 'function' ? (value as { toJSON(): unknown }).toJSON() : value
}

function applyBookkeeping(doc: Document, updates: Bookkeeping[]): void {
  for (const u of updates) {
    if (u.field === 'phase') {
      doc.setIn(['phase'], u.to)
      doc.setIn(['paused_reason'], null)
    } else if (u.field === 'task-status') {
      setTaskFieldByDoc(doc, u.task, 'status', u.to)
    } else if (u.field === 'review-rounds') {
      setTaskFieldByDoc(doc, u.task, 'review_rounds', u.to)
    } else {
      const offset = countSeq(doc, ['tasks'])
      u.ids.forEach((id, i) => doc.setIn(['tasks', offset + i], { id, status: 'pending', review_rounds: 0 }))
    }
  }
}

function describeUpdates(updates: Bookkeeping[]): string {
  return updates
    .map((u) =>
      u.field === 'phase'
        ? `phase → ${u.to}`
        : u.field === 'task-status'
          ? `${u.task} → ${u.to}`
          : u.field === 'review-rounds'
            ? `${u.task} rounds → ${u.to}`
            : `seeded tasks [${u.ids.join(', ')}]`,
    )
    .join(', ')
}

function dispatchMessage(slug: string, dispatches: DispatchIntent[]): string {
  const bounce = dispatches.find((d) => d.bounce?.kind === 'malformed')
  if (bounce && bounce.bounce?.kind === 'malformed') {
    return `state(${slug}): bounced ${bounce.bounce.artifact} — re-dispatching ${bounce.role} (missing: ${bounce.bounce.missing.join(', ')})`
  }
  const what = dispatches
    .map((d) => `${d.role}${d.task ? `(${d.task}${d.round ? ` r${d.round}` : ''})` : ''}`)
    .join(' + ')
  return `state(${slug}): dispatched ${what}`
}

function writeDetail(result: WriteResult, fallback: string): string {
  return result.ok ? fallback : `write refused (${result.reason}): ${result.message ?? ''} — re-derive next tick`
}
