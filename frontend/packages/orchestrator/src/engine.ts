// The tick's execute half (ORCHESTRATOR.md §4): read state at the run branch
// tip → derive (derive.ts) → execute → record with a CAS commit → done. At
// most one state transition per run per tick; a transition may carry several
// dispatches. Every write follows the co-writer contract (§7): CAS ref
// updates, comment-preserving YAML, the orchestrator's own commit verbs
// (dispatched | bounced | advanced | escalated | paused | metered), a bot
// identity, and — structurally — no code path that writes gates.*.
import { LocalGitSource, type Identity, type RunRef, type WriteResult } from '@agentic/core'
import type { Document } from 'yaml'
import { deriveAction, DEFAULT_ESTIMATE_USD, type Bookkeeping, type DerivedAction, type DispatchIntent } from './derive.ts'
import { observeRun, parseLedger, type RunObservation } from './observe.ts'
import { promptBody } from './prompts.ts'
import { resolveModel, type Registry } from './registry.ts'
import type { Dispatcher, DispatchOutcome } from './seam.ts'
import { ensureRunCheckout, ensureTaskCheckout, foldTaskBranch, removeRunCheckout, type TaskCheckout } from './workspace.ts'

export interface EngineConfig {
  repoDir: string
  identity: Identity
  dispatcher: Dispatcher
  registry: Registry | null
  /** Dispatch wall clock per role before the job is killed (default 30 min). */
  roleTimeoutMs?: number
  /** Age at which an open ledger entry with no live job is declared lost (default 5 min). */
  staleMs?: number
  /** Push every orchestrator commit to origin (hosted mode): the machine is disposable, origin is not. */
  push?: boolean
  /**
   * Host-wide ceiling (hosted mode): refuse new dispatches when projected
   * spend across every active run exceeds this, escalating like DB does.
   * Per-run cost_limit_usd still applies; this bounds their sum.
   */
  spendLimitUsd?: number | null
  /** Refuse dispatch on a run missing budget.cost_limit_usd (hosted mode): unattended dispatch needs a ceiling. */
  requireBudget?: boolean
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

export class Engine {
  readonly source: LocalGitSource
  private readonly cfg: EngineConfig
  /** In-flight jobs, keyed slug|role|task|round — host ephemera, never committed (§4.4). */
  private readonly jobs = new Map<string, Promise<void>>()
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
    this.source = new LocalGitSource('orchestrator', cfg.repoDir, { identity: cfg.identity, push: cfg.push })
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
    const host = this.cfg.spendLimitUsd != null ? { projected: await this.hostProjectedUsd(refs) } : null
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

        for (const intent of action.dispatches) this.launch(ref, obs, intent, at)
        return { ...base, wrote: true, launched: action.dispatches.length }
      }
    }
  }

  private launch(ref: RunRef, obs: RunObservation, intent: DispatchIntent, openedAt: string): void {
    const key = jobKey(ref.slug, intent.role, intent.task, intent.round)
    // Implementers get per-task isolation (§5.3): a private branch and
    // worktree off the run tip, folded back serially on success — parallel
    // implementers never observe each other's mid-flight state.
    const isolate = intent.role === 'implementer' && intent.task !== null
    const job = (async () => {
      let outcome: DispatchOutcome
      try {
        const checkout = isolate
          ? await ensureTaskCheckout(this.cfg.repoDir, ref.branch, intent.task!)
          : { path: await ensureRunCheckout(this.cfg.repoDir, ref.branch), branch: ref.branch }
        const taskPath = intent.task ? (obs.taskFiles.get(intent.task)?.path ?? null) : null
        outcome = await this.cfg.dispatcher.dispatch({
          cwd: checkout.path,
          role: intent.role,
          body: promptBody(ref.slug, intent, taskPath),
          timeoutMs: this.cfg.roleTimeoutMs ?? DEFAULT_ROLE_TIMEOUT_MS,
        })
        if (isolate) {
          const fold = await this.withLock(ref.slug, () => foldTaskBranch(this.cfg.repoDir, ref.branch, checkout as TaskCheckout))
          if (outcome.ok && !fold.ok) {
            outcome = { ok: false, costUsd: outcome.costUsd, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, error: fold.message, fatal: fold.conflict }
          }
          // The fold moves the run ref outside writeState; push it explicitly
          // so agent work reaches origin even if the closing commit fails.
          if (fold.ok) await this.pushBranch(ref.branch)
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
        // Last job out releases the run's checkout, so subsequent state
        // writes go through plumbing + CAS instead of the worktree fallback.
        if (![...this.jobs.keys()].some((k) => k.startsWith(`${ref.slug}|`))) {
          await removeRunCheckout(this.cfg.repoDir, ref.branch)
        }
        this.onSettled?.()
      }),
    )
  }

  /**
   * Closing bookkeeping (§4.4 step 3): the agent's artifacts are already on
   * the run branch (it commits its own work); this commit closes the ledger
   * entry with real usage, keeps cost_spent_usd the derived sum, and flips an
   * implementer's task to in-review. Everything else re-derives next tick.
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
      if (result.ok) {
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

  /** Best-effort push (hosted mode): a failed push is a warning, never a stop — the next write retries. */
  private async pushBranch(branch: string): Promise<void> {
    if (!this.cfg.push) return
    try {
      await this.source.git.run(['push', 'origin', `${branch}:${branch}`])
    } catch (e) {
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
function setTaskFieldByDoc(doc: Document, taskId: string, field: string, value: unknown): void {
  const tasks = doc.getIn(['tasks'])
  const js = tasks && typeof (tasks as { toJSON?: unknown }).toJSON === 'function' ? (tasks as { toJSON(): unknown[] }).toJSON() : []
  const index = Array.isArray(js) ? js.findIndex((t) => t && typeof t === 'object' && (t as { id?: string }).id === taskId) : -1
  if (index >= 0) doc.setIn(['tasks', index, field], value)
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
