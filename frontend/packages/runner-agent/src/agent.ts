// The workstation agent's poll/claim/execute/report loop (ORCHESTRATOR.md /
// TOPOLOGY.md §3.3, run "runner-agent" — R3/R4/R5/R8): a standalone process
// that authenticates with a service token, polls the control plane
// (frontend/packages/server/src/runner-api.ts) for dispatch intents, claims
// one, executes it in a disposable workspace (workspace.ts), and reports the
// outcome back. It never opens a listening port (R3 — outbound HTTP only)
// and never writes state.yaml, gates.*, or any git ref (R5) — the control
// plane remains the sole writer; this file has no code path that pushes, or
// even commits, anything.
//
// Adapter-generic by construction (R8): the command this file runs and how
// it parses that command's stdout both come entirely from the target repo's
// own adapter manifest (loadHeadlessManifest, @agentic/orchestrator) plus
// the intent's own data (role, body) — nothing below names a role or a
// harness/vendor outside of that manifest-driven data. `buildCommand` and
// `computeOutcome` mirror seam.ts's `HeadlessDispatcher.dispatch()` exactly
// (same substitution order, same three usage_report branches) so a dispatch
// run through this remote path produces a `DispatchOutcome` equivalent in
// shape to one `HeadlessDispatcher` would have produced locally (AC3.2).
import { spawn } from 'node:child_process'
import {
  BOT_IDENTITY,
  dig,
  harvestPathspecs,
  loadHeadlessManifest,
  matchesLineFilter,
  parseJsonOutput,
  parseNdjson,
  resolveFrameworkRootsFromDisk,
  sumField,
  type HeadlessManifest,
} from '@agentic/orchestrator'
import { createWorkspace, getHead, harvestAndPush, type CreateWorkspaceOptions, type HarvestResult, type Workspace } from './workspace.ts'

/** Mirrors runner-api.ts's `PendingIntent` (server side of this relay). */
export interface PendingIntent {
  key: string
  slug: string
  branch: string
  role: string
  task: string | null
  round: number | null
  body: string
  timeoutMs: number
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
  /** Present when this dispatch harvested its work to a branch for the
   *  control plane to fold (ADR-3/ADR-4). */
  harvest?: { branch: string; base: string } | null
}

type FetchImpl = typeof fetch

/** Thin outbound HTTP client for the three routes runner-api.ts (server)
 *  exposes. Every call here is a client-initiated request — this process
 *  never listens on a socket (R3, AC3.1). */
export class ControlPlaneClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: FetchImpl

  constructor(baseUrl: string, token: string, fetchImpl: FetchImpl = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
    this.fetchImpl = fetchImpl
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${this.token}` }
    if (json) h['content-type'] = 'application/json'
    return h
  }

  private getIntentsRaw(): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}/api/runner/intents`, { headers: this.headers() })
  }

  /** Startup check (scope step 2): confirms the control plane is reachable
   *  and the token is accepted before the poll loop starts, rather than
   *  discovering a bad token only after the first silently-failing poll. */
  async validate(): Promise<void> {
    let res: Response
    try {
      res = await this.getIntentsRaw()
    } catch (e) {
      throw new Error(`control plane at ${this.baseUrl} is unreachable: ${(e as Error).message}`)
    }
    if (res.status === 401) throw new Error(`control plane rejected the runner token (401 Unauthorized) at ${this.baseUrl}`)
    if (res.status === 404) throw new Error(`control plane has no runner API mounted (404 Not Found) at ${this.baseUrl} — is RUNNER_TOKEN configured there?`)
    if (!res.ok) throw new Error(`control plane at ${this.baseUrl} returned ${res.status} ${res.statusText}`)
  }

  async fetchIntents(): Promise<{ intents: PendingIntent[]; repoUrl: string | null }> {
    const res = await this.getIntentsRaw()
    if (!res.ok) throw new Error(`GET /api/runner/intents failed: ${res.status} ${res.statusText}`)
    return (await res.json()) as { intents: PendingIntent[]; repoUrl: string | null }
  }

  async claim(key: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/runner/claim`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ key }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { claimed: boolean }
    return body.claimed
  }

  async report(key: string, outcome: DispatchOutcome): Promise<boolean> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/runner/report`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ key, outcome }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { resolved: boolean }
    return body.resolved
  }
}

/** Builds the argv for one dispatch from the adapter manifest, the intent's
 *  role, and its body — the exact substitution order
 *  `HeadlessDispatcher.dispatch()` (seam.ts) uses: `{role}`/`{body}` into
 *  the manifest's dispatch prompt template, then `{prompt}`/`{role}` into
 *  the manifest's command template. Two different manifests (two different
 *  adapters) produce two different argvs from this one function with zero
 *  branching on adapter identity (AC8.2). */
export function buildCommand(manifest: HeadlessManifest, role: string, body: string): string[] {
  const prompt = manifest.dispatchPrompt.replaceAll('{role}', role).replaceAll('{body}', body)
  return manifest.command.map((a) => a.replaceAll('{prompt}', prompt).replaceAll('{role}', role))
}

interface RunResult {
  stdout: string
  error: Error | null
  timedOut: boolean
}

const MAX_CAPTURE = 64 * 1024 * 1024

/** Runs the dispatched command under a wall-clock ceiling, killing its whole
 *  process group on timeout — mirrors seam.ts's `runHarness`: a harness's
 *  own children (tool shells, MCP servers) can outlive a kill of only the
 *  direct child and hold stdio open indefinitely, so the group is what gets
 *  signalled. This workstation process has no drain/abort feature of its
 *  own (that lives in the orchestrator, not here), so unlike seam.ts there
 *  is no live-pid bookkeeping to support it. */
export function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let timedOut = false
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
      resolve({ stdout, error: err, timedOut })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const error =
        code === 0
          ? null
          : new Error(
              `Command failed${signal ? ` (${signal})` : code !== null ? ` (exit ${code})` : ''}: ${cmd} ${args.join(' ')}${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
            )
      resolve({ stdout, error, timedOut })
    })
  })
}

/** Turns a completed run into a `DispatchOutcome` per the manifest's
 *  `usage_report` format — a direct port of the three branches in
 *  `HeadlessDispatcher.dispatch()` (seam.ts), built on the same imported
 *  parsing utilities, so a dispatch run through this remote path produces
 *  an outcome equivalent in shape to a local `HeadlessDispatcher` one
 *  (AC3.2). */
export function computeOutcome(manifest: HeadlessManifest, run: RunResult, timeoutMs: number): DispatchOutcome {
  const failure = run.timedOut
    ? `harness timed out after ${Math.round(timeoutMs / 60000)}min wall clock — process group killed (SIGKILL)`
    : run.error
      ? run.error.message
      : null

  if (manifest.usage.format === 'static-estimate') {
    return { ok: !run.error && !run.timedOut, costUsd: null, tokensIn: null, tokensOut: null, error: failure }
  }

  if (manifest.usage.format === 'ndjson-sum') {
    const events = parseNdjson(run.stdout)
    if (events.length === 0) {
      return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: failure ?? 'harness produced no parseable JSON output' }
    }
    const matching = events.filter((e) => matchesLineFilter(e, manifest.usage.lineFilter))
    const fields = manifest.usage.fields ?? {}
    const last = events[events.length - 1]
    const harnessError = manifest.usage.errorField ? dig(last, manifest.usage.errorField) === true : false
    const resultText = manifest.usage.resultField ? dig(last, manifest.usage.resultField) : null
    return {
      ok: !run.error && !run.timedOut && !harnessError,
      costUsd: sumField(matching, fields.cost_usd),
      tokensIn: sumField(matching, fields.tokens_in),
      tokensOut: sumField(matching, fields.tokens_out),
      error: failure ?? (harnessError ? String(resultText ?? 'harness reported an error') : null),
    }
  }

  const parsed = parseJsonOutput(run.stdout)
  if (!parsed) {
    return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: failure ?? 'harness produced no parseable JSON output' }
  }
  const fields = manifest.usage.fields ?? {}
  const num = (path?: string) => {
    if (!path) return null
    const v = dig(parsed, path)
    return typeof v === 'number' ? v : null
  }
  const harnessError = manifest.usage.errorField ? dig(parsed, manifest.usage.errorField) === true : false
  const resultText = manifest.usage.resultField ? dig(parsed, manifest.usage.resultField) : null
  return {
    ok: !run.error && !run.timedOut && !harnessError,
    costUsd: num(fields.cost_usd),
    tokensIn: num(fields.tokens_in),
    tokensOut: num(fields.tokens_out),
    error: failure ?? (harnessError ? String(resultText ?? 'harness reported an error') : null),
  }
}

export interface ExecuteIntentOptions {
  intent: PendingIntent
  repoUrl: string
  adapter: string
  workDir: string
  /** Framework-metadata prefix override, forwarded to `loadHeadlessManifest`
   *  (integrate.py --prefix hosts, #95); undefined auto-detects. */
  prefixHint?: string
  /** Injection seams for tests — production callers never set these. */
  createWorkspaceImpl?: (opts: CreateWorkspaceOptions) => Promise<Workspace>
  runCommandImpl?: (cmd: string, args: string[], cwd: string, timeoutMs: number) => Promise<RunResult>
  manifestLoaderImpl?: (repoDir: string, adapter: string, prefixHint?: string) => Promise<HeadlessManifest>
  harvestAndPushImpl?: typeof harvestAndPush
  resolveFrameworkRootsImpl?: typeof resolveFrameworkRootsFromDisk
  getHeadImpl?: typeof getHead
}

/** One full dispatch: clone → read the manifest from the clone (so the
 *  clone's own adapter config governs, not the workstation's) → spawn its
 *  command → parse the outcome → harvest-then-dispose (ADR-3).
 *
 *  A command failure, a timeout, or a manifest that could not be read
 *  produced nothing to harvest — the workspace is removed immediately
 *  (AC4.1/AC4.2). A successful command harvests the role's own pathspecs
 *  (harvestPathspecs) to a branch and pushes it to origin — including
 *  whatever the harness itself already committed (review-04.md round-2 F8:
 *  every dispatch prompt instructs the harness to commit its own work, so
 *  `base` is captured *before* the harness runs, not after, or a committing
 *  harness's work is silently dropped exactly like the original defect).
 *  Disposal is gated on that push landing, never on the harness returning
 *  — a failed push keeps the workspace and reports failure instead, so the
 *  control plane retries rather than silently losing paid, completed work. */
export async function executeIntent(opts: ExecuteIntentOptions): Promise<DispatchOutcome> {
  const create = opts.createWorkspaceImpl ?? createWorkspace
  const run = opts.runCommandImpl ?? runCommand
  const loadManifest = opts.manifestLoaderImpl ?? loadHeadlessManifest
  const harvest = opts.harvestAndPushImpl ?? harvestAndPush
  const resolveRoots = opts.resolveFrameworkRootsImpl ?? resolveFrameworkRootsFromDisk
  const getWorkspaceHead = opts.getHeadImpl ?? getHead

  const ws = await create({
    workDir: opts.workDir,
    slug: opts.intent.slug,
    branch: opts.intent.branch,
    repoUrl: opts.repoUrl,
    baseOid: opts.intent.baseOid,
  })
  // Captured before the harness runs (F8) — this is what the control
  // plane's fold rebases onto, and what determines whether the harness (or
  // the post-harness sweep) changed anything at all.
  const base = await getWorkspaceHead(ws)

  let outcome: DispatchOutcome
  try {
    const manifest = await loadManifest(ws.path, opts.adapter, opts.prefixHint)
    const argv = buildCommand(manifest, opts.intent.role, opts.intent.body)
    const [cmd, ...args] = argv
    if (!cmd) {
      outcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'adapter manifest command is empty', fatal: true }
    } else {
      const result = await run(cmd, args, ws.path, opts.intent.timeoutMs)
      outcome = computeOutcome(manifest, result, opts.intent.timeoutMs)
    }
  } catch (e) {
    outcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: (e as Error).message }
  }

  if (!outcome.ok) {
    await ws.remove()
    return outcome
  }

  let harvestResult: HarvestResult
  try {
    const { runs: runsRoot } = await resolveRoots(ws.path, opts.prefixHint)
    const pathspecs = harvestPathspecs(runsRoot, opts.intent.slug, opts.intent.role, opts.intent.task)
    const dispatchId = `${opts.intent.role}${opts.intent.task ? `-${opts.intent.task}` : ''}${opts.intent.round ? `-r${opts.intent.round}` : ''}-${Date.now()}`
    const branch = `${opts.intent.branch}--harvest/${dispatchId}`
    harvestResult = await harvest(ws, branch, pathspecs, base, BOT_IDENTITY, opts.intent.slug, opts.intent.role)
  } catch (e) {
    // Retain the workspace: the harvest commit (if it made it that far) is
    // still on disk even though the push failed, and disposing of it now
    // would repeat exactly the defect this ordering exists to prevent.
    return { ok: false, costUsd: outcome.costUsd, tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, error: `harvest push failed: ${(e as Error).message}` }
  }

  await ws.remove()
  if (!harvestResult.pushed) return outcome // nothing to harvest — not a failure
  return { ...outcome, harvest: { branch: harvestResult.branch, base: harvestResult.base } }
}

export interface AgentOptions {
  controlPlane: string
  token: string
  /** Which adapter's manifest.json governs the command this agent runs —
   *  the sole source of adapter identity (R8, AC8.2): pointing this option
   *  at a different adapter changes what command runs with zero code
   *  changes here. */
  adapter: string
  workDir: string
  pollIntervalMs: number
  /** Fallback remote URL, used only when the control plane's own
   *  `repoUrl` (served alongside intents) is null. */
  repoUrl?: string
  prefixHint?: string
  log?: (line: string) => void
  /** Injection seams for tests — production callers never set these. */
  fetchImpl?: FetchImpl
  createWorkspaceImpl?: ExecuteIntentOptions['createWorkspaceImpl']
  runCommandImpl?: ExecuteIntentOptions['runCommandImpl']
  manifestLoaderImpl?: ExecuteIntentOptions['manifestLoaderImpl']
  harvestAndPushImpl?: ExecuteIntentOptions['harvestAndPushImpl']
  resolveFrameworkRootsImpl?: ExecuteIntentOptions['resolveFrameworkRootsImpl']
  getHeadImpl?: ExecuteIntentOptions['getHeadImpl']
  /** Stop after this many poll cycles instead of running forever (tests only). */
  maxCycles?: number
  /** Poll-interval sleep, overridable so tests need no real timers. */
  sleep?: (ms: number) => Promise<void>
}

/** The resident loop (scope steps 2–7): validate, then poll → claim →
 *  execute → report, forever (or `maxCycles` times, for tests). Every
 *  connection this makes is outbound (R3, AC3.1) — this file opens no
 *  socket of its own to accept inbound connections on. */
export async function runAgent(opts: AgentOptions): Promise<void> {
  const log = opts.log ?? (() => {})
  const client = new ControlPlaneClient(opts.controlPlane, opts.token, opts.fetchImpl)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  await client.validate()
  log(`runner-agent: control plane ${opts.controlPlane} reachable, token accepted (adapter: ${opts.adapter})`)

  for (let cycle = 0; opts.maxCycles === undefined || cycle < opts.maxCycles; cycle++) {
    try {
      const { intents, repoUrl } = await client.fetchIntents()
      const effectiveRepoUrl = repoUrl ?? opts.repoUrl
      for (const intent of intents) {
        if (!effectiveRepoUrl) {
          log(`runner-agent: no repo URL available for intent ${intent.key} (control plane reported none and --repo-url is unset) — skipping`)
          continue
        }
        const claimed = await client.claim(intent.key)
        if (!claimed) continue
        log(`runner-agent: claimed ${intent.key} (role=${intent.role} branch=${intent.branch})`)
        const outcome = await executeIntent({
          intent,
          repoUrl: effectiveRepoUrl,
          adapter: opts.adapter,
          workDir: opts.workDir,
          prefixHint: opts.prefixHint,
          createWorkspaceImpl: opts.createWorkspaceImpl,
          runCommandImpl: opts.runCommandImpl,
          manifestLoaderImpl: opts.manifestLoaderImpl,
          harvestAndPushImpl: opts.harvestAndPushImpl,
          resolveFrameworkRootsImpl: opts.resolveFrameworkRootsImpl,
          getHeadImpl: opts.getHeadImpl,
        })
        const resolved = await client.report(intent.key, outcome)
        log(`runner-agent: reported ${intent.key} ok=${outcome.ok} resolved=${resolved}`)
      }
    } catch (e) {
      // A single failed poll cycle (transient network blip, control plane
      // restart) does not end the process — it just tries again next
      // interval, same as any long-lived poller.
      log(`runner-agent: poll cycle failed: ${(e as Error).message}`)
    }
    if (opts.maxCycles === undefined || cycle < opts.maxCycles - 1) await sleep(opts.pollIntervalMs)
  }
}
