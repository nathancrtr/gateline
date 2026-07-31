// Scheduled roles (docs/ORCHESTRATOR.md §4.6): periodic dispatches that are
// not tied to a pipeline run — the Historian's documentation sweep is the
// first. Schedules live in orchestrator.yaml at the default-branch tip (read
// like the registry, never from a checkout), and every fact the scheduler
// needs is derivable from committed files, so a sweep survives restarts the
// same way a run does.
//
// One rule per row; each row has a test in test/schedule.test.ts:
//
//   S0  schedule disabled                              → rest
//   S1  a sweep branch for this role is open (unmerged) → rest (one in flight / awaiting review per role)
//   S2  interval since the last merged sweep not elapsed → rest
//   S3  today's sweep branch already exists             → rest (duplicate guard; sub-daily intervals clamp to daily)
//   SB  role estimate exceeds the schedule's cost cap   → skip + warn (a config defect, not a dispatch)
//   S4  otherwise                                       → dispatch the sweep
//
// A sweep is a mini-run: runs/<role>-<date>/ on branch run/<role>-<date>,
// seeded with a sweep.yaml marker by commit-then-launch (branch creation from
// ZERO_OID is the CAS duplicate-dispatch guard). It carries no state.yaml on
// purpose — the gate engine and frontend recognize runs by state.yaml, so
// sweeps stay out of the derivation table entirely. The human surface is the
// branch itself: review the docs-delta and doc edits, merge to approve (P4).
import { Git, memoizedFrameworkRoots, type FrameworkRoots, type Identity } from '@gateline/core'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_ESTIMATE_USD } from './derive.ts'
import { resolveModel, type Registry } from './registry.ts'
import type { Dispatcher } from './seam.ts'
import { ensureRunCheckout, removeRunCheckout } from './workspace.ts'

const ZERO_OID = '0'.repeat(40)
const DEFAULT_SWEEP_TIMEOUT_MS = 30 * 60 * 1000

export interface ScheduleEntry {
  role: string
  everyMs: number
  costLimitUsd: number | null
  enabled: boolean
  /** The `every:` spelling as written, for markers and messages. */
  every: string
}

export interface ScheduleConfig {
  schedules: ScheduleEntry[]
  /** Entries that failed to parse — logged, never guessed at (the bounce rule applied to config). */
  errors: string[]
}

/** `7d` | `12h` | `30m` → milliseconds; null when unparseable. */
export function parseEvery(value: string): number | null {
  const m = /^(\d+)([dhm])$/.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n <= 0) return null
  const unit = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000, m: 60 * 1000 }[m[2] as 'd' | 'h' | 'm']
  return n * unit
}

export function parseScheduleConfig(text: string): ScheduleConfig {
  const errors: string[] = []
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    return { schedules: [], errors: [`orchestrator.yaml is not valid YAML: ${(e as Error).message}`] }
  }
  const schedulesRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).schedules : undefined
  if (schedulesRaw === undefined || schedulesRaw === null) return { schedules: [], errors }
  if (typeof schedulesRaw !== 'object' || Array.isArray(schedulesRaw))
    return { schedules: [], errors: ['orchestrator.yaml: `schedules` must be a map of role → entry'] }

  const schedules: ScheduleEntry[] = []
  for (const [role, entryRaw] of Object.entries(schedulesRaw as Record<string, unknown>)) {
    const entry = entryRaw && typeof entryRaw === 'object' ? (entryRaw as Record<string, unknown>) : {}
    const every = typeof entry.every === 'string' ? entry.every : null
    const everyMs = every ? parseEvery(every) : null
    if (!every || everyMs === null) {
      errors.push(`schedules.${role}: \`every\` must be <n>d | <n>h | <n>m (got ${JSON.stringify(entry.every ?? null)})`)
      continue
    }
    schedules.push({
      role,
      everyMs,
      every,
      costLimitUsd: typeof entry.cost_limit_usd === 'number' ? entry.cost_limit_usd : null,
      enabled: entry.enabled !== false,
    })
  }
  return { schedules, errors }
}

/** Everything the sweep decision needs, gathered from committed files. */
export interface SweepFacts {
  now: Date
  entry: ScheduleEntry
  /** `at` of the newest merged sweep marker for this role, ISO; null when none. */
  lastSweptAt: string | null
  /** Branch name of an unmerged sweep for this role, when one exists. */
  openSweep: string | null
  /** run/<role>-<today> already exists (merged same day, or another instance won). */
  slugTaken: boolean
  /** Registry pre-flight estimate for the role. */
  estimateUsd: number
}

export type SweepDecision =
  | { kind: 'rest'; rule: string; why: string }
  | { kind: 'skip'; rule: string; why: string }
  | { kind: 'dispatch'; rule: string; why: string }

export function deriveSweep(f: SweepFacts): SweepDecision {
  const { entry } = f
  if (!entry.enabled) return { kind: 'rest', rule: 'S0', why: `${entry.role} schedule disabled` }
  if (f.openSweep)
    return {
      kind: 'rest',
      rule: 'S1',
      why: `sweep ${f.openSweep} is open — in flight or awaiting human review; one sweep per role at a time`,
    }
  if (f.lastSweptAt !== null) {
    const last = Date.parse(f.lastSweptAt)
    if (!Number.isNaN(last) && f.now.getTime() - last < entry.everyMs)
      return { kind: 'rest', rule: 'S2', why: `last ${entry.role} sweep ${f.lastSweptAt} is within \`every: ${entry.every}\`` }
  }
  if (f.slugTaken)
    return { kind: 'rest', rule: 'S3', why: `run/${sweepSlug(entry.role, f.now)} already exists — one sweep per day` }
  if (entry.costLimitUsd !== null && f.estimateUsd > entry.costLimitUsd)
    return {
      kind: 'skip',
      rule: 'SB',
      why: `${entry.role} estimate $${f.estimateUsd} exceeds the schedule's cost_limit_usd $${entry.costLimitUsd} — fix orchestrator.yaml or the registry estimate`,
    }
  return { kind: 'dispatch', rule: 'S4', why: `${entry.role} sweep due (last: ${f.lastSweptAt ?? 'never'})` }
}

/** UTC date-grained slug: historian-2026-07-11. */
export function sweepSlug(role: string, now: Date): string {
  return `${role}-${now.toISOString().slice(0, 10)}`
}

/** The run-specific dispatch prompt (§5.4: a template, not a composition). */
export function sweepPromptBody(slug: string, coveringSince: string | null, runsRoot = 'runs', contractsRoot = 'contracts'): string {
  const interval = coveringSince
    ? `the interval since ${coveringSince} (the previous sweep's cutoff)`
    : 'the full history of the repository (this is the first sweep)'
  return [
    `for sweep \`${runsRoot}/${slug}\`, covering ${interval}.`,
    `Reconcile documentation and tracker surfaces with the run artifacts and merges landed on the default branch in that interval.`,
    `Produce \`${runsRoot}/${slug}/docs-delta.md\` per \`${contractsRoot}/docs-delta.md\` and apply the documentation fixes it records on the current branch.`,
    `No authenticated tracker CLI is assumed: leave tracker mutations as proposed actions in the delta unless one is available in your tools.`,
    `When your work is complete, commit it on the current branch (git add the files you produced or changed) with a message starting "${slug}: docs delta".`,
  ].join(' ')
}

export interface SweepOutcome {
  role: string
  slug: string | null
  kind: 'rest' | 'skip' | 'dispatched' | 'lost-cas' | 'error'
  rule: string | null
  detail: string
}

export interface SchedulerConfig {
  repoDir: string
  identity: Identity
  dispatcher: Dispatcher
  registry: Registry | null
  /**
   * Override the `.gateline` default when this repo was integrated with a
   * custom `integrate.py --prefix` (#95) — otherwise auto-detected.
   */
  frameworkPrefix?: string
  /** Dispatch wall clock before the sweep job is killed (default 30 min). */
  sweepTimeoutMs?: number
  /** Push every sweep commit to origin (hosted mode). */
  push?: boolean
  now?: () => Date
  log?: (line: string) => void
}

/**
 * The scheduler mirrors the engine's shape at sweep scale: observe committed
 * files → derive (deriveSweep) → execute with commit-then-launch → close the
 * marker with real usage. It shares the engine's dispatcher, so sweeps flow
 * through the same metered seam as every other model invocation (§6) — the
 * marker file (sweep.yaml) is the sweep's one-entry ledger.
 */
export class Scheduler {
  private readonly cfg: SchedulerConfig
  private readonly git: Git
  private readonly frameworkRoots: () => Promise<FrameworkRoots>
  /** In-flight sweep jobs by slug — host ephemera; a crash costs a stale open branch a human prunes. */
  private readonly jobs = new Map<string, Promise<void>>()
  /** Fired each time a sweep job settles. */
  onSettled: (() => void) | null = null

  constructor(cfg: SchedulerConfig) {
    this.cfg = cfg
    this.git = new Git(cfg.repoDir)
    this.frameworkRoots = memoizedFrameworkRoots(this.git, cfg.frameworkPrefix)
  }

  private now(): Date {
    return this.cfg.now?.() ?? new Date()
  }

  private log(line: string): void {
    this.cfg.log?.(line)
  }

  inFlight(): number {
    return this.jobs.size
  }

  async drain(): Promise<void> {
    while (this.jobs.size > 0) await Promise.allSettled([...this.jobs.values()])
  }

  /** One pass over every schedule. `force` bypasses S2 dueness for one role (the CLI's `sweep`). */
  async tick(opts: { force?: string } = {}): Promise<SweepOutcome[]> {
    const defaultBranch = await this.git.defaultBranch()
    const text = await this.git.show(defaultBranch, 'orchestrator.yaml')
    if (text === null) return []
    const { schedules, errors } = parseScheduleConfig(text)
    for (const e of errors) this.log(`orchestrator.yaml: ${e}`)

    const outcomes: SweepOutcome[] = []
    for (const entry of schedules) {
      try {
        outcomes.push(await this.tickOne(entry, defaultBranch, opts.force === entry.role))
      } catch (e) {
        outcomes.push({ role: entry.role, slug: null, kind: 'error', rule: null, detail: (e as Error).message })
      }
    }
    return outcomes
  }

  private async tickOne(entry: ScheduleEntry, defaultBranch: string, force: boolean): Promise<SweepOutcome> {
    const now = this.now()
    const slug = sweepSlug(entry.role, now)

    // Open sweeps: run/<role>-* branches not yet merged into the default branch.
    let openSweep: string | null = null
    for (const { ref } of await this.git.forEachRef([`refs/heads/run/${entry.role}-*`])) {
      const branch = ref.replace('refs/heads/', '')
      if (!(await this.git.isAncestor(ref, defaultBranch))) {
        openSweep = branch
        break
      }
    }

    // Last merged sweep: the newest marker under runs/<role>-*/ at the default tip.
    const { runs: runsRoot } = await this.frameworkRoots()
    let lastSweptAt: string | null = null
    for (const dir of await this.git.lsTreeDirs(defaultBranch, runsRoot)) {
      if (!dir.startsWith(`${entry.role}-`)) continue
      const marker = await this.git.show(defaultBranch, `${runsRoot}/${dir}/sweep.yaml`)
      const at = marker ? markerAt(marker) : null
      const candidate = at ?? isoFromSlugDate(dir.slice(entry.role.length + 1))
      if (candidate && (!lastSweptAt || candidate > lastSweptAt)) lastSweptAt = candidate
    }

    const decision = deriveSweep({
      now,
      entry,
      lastSweptAt: force ? null : lastSweptAt,
      openSweep,
      slugTaken: (await this.git.revParse(`refs/heads/run/${slug}`)) !== null,
      estimateUsd: this.cfg.registry?.estimates[entry.role] ?? DEFAULT_ESTIMATE_USD,
    })
    if (decision.kind !== 'dispatch')
      return { role: entry.role, slug: null, kind: decision.kind, rule: decision.rule, detail: decision.why }

    return this.launch(entry, defaultBranch, slug, lastSweptAt, now)
  }

  /**
   * Commit-then-launch at sweep scale (§4.4): the intent commit seeds the
   * sweep branch with its marker, created from ZERO_OID so two instances
   * racing the same schedule resolve at the ref — the loser rests.
   */
  private async launch(
    entry: ScheduleEntry,
    defaultBranch: string,
    slug: string,
    coveringSince: string | null,
    now: Date,
  ): Promise<SweepOutcome> {
    const tip = await this.git.revParse(defaultBranch)
    if (!tip) return { role: entry.role, slug, kind: 'error', rule: 'S4', detail: `${defaultBranch} has no tip` }
    const { runs: runsRoot, contracts: contractsRoot } = await this.frameworkRoots()

    const branch = `run/${slug}`
    const model = this.cfg.registry ? resolveModel(this.cfg.registry, entry.role) : null
    const marker = [
      `# Sweep dispatch marker — written by the orchestrator (schedule.ts); the`,
      `# sweep's one-entry ledger. Merging this branch is the human approval and`,
      `# makes this marker the next sweep's interval cutoff.`,
      `sweep: ${slug}`,
      `role: ${entry.role}`,
      `every: ${entry.every}`,
      `at: ${now.toISOString()}`,
      `covering_since: ${coveringSince ?? 'null'}`,
      `adapter: ${this.cfg.dispatcher.adapterFor?.(entry.role) ?? this.cfg.dispatcher.adapter}`,
      `model: ${model ?? 'null'}`,
      `cost_limit_usd: ${entry.costLimitUsd ?? 'null'}`,
      `tokens_in: null`,
      `tokens_out: null`,
      `cost_usd: null`,
      ``,
    ].join('\n')

    const blob = await this.git.hashObject(marker)
    const tree = await this.git.writeTreeWithBlob(tip, `${runsRoot}/${slug}/sweep.yaml`, blob)
    const commit = await this.git.commitTree(
      tree,
      tip,
      `sweep(${slug}): dispatched ${entry.role} — covering since ${coveringSince ?? 'repo start'}`,
      this.cfg.identity,
    )
    if (!(await this.git.updateRefCAS(`refs/heads/${branch}`, commit, ZERO_OID)))
      return { role: entry.role, slug, kind: 'lost-cas', rule: 'S4', detail: 'sweep branch appeared mid-tick — another instance won; rest' }
    await this.pushBranch(branch)

    const job = (async () => {
      let outcome: { ok: boolean; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; error: string | null }
      try {
        const cwd = await ensureRunCheckout(this.cfg.repoDir, branch)
        outcome = await this.cfg.dispatcher.dispatch({
          cwd,
          role: entry.role,
          body: sweepPromptBody(slug, coveringSince, runsRoot, contractsRoot),
          timeoutMs: this.cfg.sweepTimeoutMs ?? DEFAULT_SWEEP_TIMEOUT_MS,
        })
      } catch (e) {
        outcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: (e as Error).message }
      }
      await this.closeSweep(entry, branch, slug, outcome)
    })()
    this.jobs.set(
      slug,
      job.finally(async () => {
        this.jobs.delete(slug)
        await removeRunCheckout(this.cfg.repoDir, branch)
        this.onSettled?.()
      }),
    )
    this.log(`sweep(${slug}): dispatched ${entry.role} on ${branch}`)
    return { role: entry.role, slug, kind: 'dispatched', rule: 'S4', detail: `covering since ${coveringSince ?? 'repo start'}` }
  }

  /** The closing commit: real usage into the marker, on top of whatever the agent committed. */
  /** Best-effort push (hosted mode): a failed push is a warning; the closing commit's push retries. */
  private async pushBranch(branch: string): Promise<void> {
    if (!this.cfg.push) return
    try {
      await this.git.run(['push', 'origin', `${branch}:${branch}`])
    } catch (e) {
      this.log(`sweep push of ${branch} failed: ${(e as Error).message} — commits stay local until the next push`)
    }
  }

  private async closeSweep(
    entry: ScheduleEntry,
    branch: string,
    slug: string,
    outcome: { ok: boolean; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; error: string | null },
  ): Promise<void> {
    const estimate = this.cfg.registry?.estimates[entry.role] ?? DEFAULT_ESTIMATE_USD
    const cost = outcome.costUsd ?? estimate
    const { runs: runsRoot } = await this.frameworkRoots()
    for (let attempt = 0; attempt < 5; attempt++) {
      const tip = await this.git.revParse(`refs/heads/${branch}`)
      if (!tip) return // branch deleted under us — a human pruned it; nothing to record
      const current = await this.git.show(tip, `${runsRoot}/${slug}/sweep.yaml`)
      if (current === null) return
      const closed = current
        .replace(/^tokens_in: .*$/m, `tokens_in: ${outcome.tokensIn ?? 'null'}`)
        .replace(/^tokens_out: .*$/m, `tokens_out: ${outcome.tokensOut ?? 'null'}`)
        .replace(/^cost_usd: .*$/m, `cost_usd: ${cost}`)
        .concat(outcome.ok ? '' : `failed: ${JSON.stringify(truncate(outcome.error ?? 'unknown error', 200))}\n`)
      const blob = await this.git.hashObject(closed)
      const tree = await this.git.writeTreeWithBlob(tip, `${runsRoot}/${slug}/sweep.yaml`, blob)
      const commit = await this.git.commitTree(
        tree,
        tip,
        `sweep(${slug}): metered ${entry.role} $${cost.toFixed(2)}${outcome.ok ? '' : ` — failed: ${truncate(outcome.error ?? 'unknown', 60)}`}`,
        this.cfg.identity,
      )
      if (await this.git.updateRefCAS(`refs/heads/${branch}`, commit, tip)) {
        this.log(`sweep(${slug}): metered ${entry.role} $${cost.toFixed(2)} ${outcome.ok ? 'ok' : `FAILED (${outcome.error})`}`)
        await this.pushBranch(branch)
        return
      }
      // The agent (or a human) committed mid-close: re-read the tip and retry.
    }
    this.log(`sweep(${slug}): closing commit lost CAS 5× — usage unrecorded; the marker stays open on the branch`)
  }
}

/** `at:` from a sweep marker without a YAML parse dependency on its shape. */
function markerAt(marker: string): string | null {
  const raw = parseYaml(marker) as Record<string, unknown> | null
  const at = raw && typeof raw === 'object' ? raw.at : null
  if (typeof at === 'string') return at
  if (at instanceof Date) return at.toISOString()
  return null
}

/** `2026-07-11` → ISO midnight UTC; null when the slug tail is not a date. */
function isoFromSlugDate(tail: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(tail) ? `${tail}T00:00:00.000Z` : null
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
