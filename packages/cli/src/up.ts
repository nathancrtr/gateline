// `gateline up`: Gatehouse and one engine for each `dispatch` repository in
// the set, in one process, under one governor (docs/MULTI-REPO.md §8, D3;
// #502). The command in main.ts parses flags and hands this module the real
// process; tests hand it a fake dispatcher, a throwaway code checkout and a
// recording `exit`, so the whole startup runs with nothing dispatched.
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import {
  ConfigError,
  defaultConfigPath,
  displayNameOf,
  type LoadedConfig,
  LocalOnlyPushConflictError,
  loadSources,
  RepositoryIdError,
  type RepositorySettings,
  ROLE_TIMEOUT_MS,
  repoToplevel,
  SUPERSEDE_EXIT_CODE,
} from '@gateline/core'
import {
  assembleOrchestrators,
  DEFAULT_MAX_CONCURRENT_DISPATCHES,
  DEFAULT_SPEND_WINDOW_MS,
  type Dispatcher,
  DuplicateRepositoryError,
  engineNameProblem,
  type OrchestratorsHandle,
  type RepositoryEngineConfig,
  stagedShutdown,
} from '@gateline/orchestrator'

/** The engine heartbeat when neither `--heartbeat` nor the config's `engine.heartbeat_seconds` says (as the standalone binary's). */
export const DEFAULT_HEARTBEAT_SECONDS = 180
/** The adapter an engine runs when neither `--adapter` nor the config's `engine.adapters` names one. */
export const DEFAULT_ADAPTERS = ['claude-code']

/** `up`'s flags, as the command line gave them. Absent means not given. */
export interface UpFlags {
  /** The global `--repo` paths, in order; empty when none was given. */
  repo: string[]
  port: number
  host: string
  open: boolean
  /** `--adapter`, repeatable; empty when none was given. */
  adapter: string[]
  spendLimitUsd?: number
  spendWindow?: number
  /** True when `--no-budget-enforcement` was given. */
  noBudgetEnforcement?: boolean
  /** `true` for `--push`, `false` for `--no-push`, absent for neither. */
  push?: boolean
  localOnly?: boolean
  heartbeat?: number
  roleTimeout?: number
  maxConcurrentDispatches?: number
  engineName?: string
}

/** What `up` is handed from outside: the real process in main.ts, fakes in a test. */
export interface UpDeps {
  log(line: string): void
  error(line: string): void
  /** Ends the process: `process.exit`. Called at most once. */
  exit(code: number): void
  /** Installs the staged-shutdown handler for SIGINT and SIGTERM. */
  onSignal(handler: () => void): void
  /** The config file (default: `~/.config/gateline/config.yaml`, under `$XDG_CONFIG_HOME` when set). */
  configPath?: string
  /** The working directory (default: `process.cwd()`). */
  cwd?: string
  /** A dispatcher for a repository, in place of the headless ones its manifests describe (tests). */
  dispatcher?(repositoryId: string): Dispatcher | undefined
  /** The code checkout the code-tree monitor watches: absent, this module's own; null, none (tests). */
  codeRepo?: string | null
  /** See `OrchestratorsOptions.stopWaitMs` and `startupTimeoutMs` (tests). */
  stopWaitMs?: number
  startupTimeoutMs?: number
}

/** A running `up`: its engines, its server, and the shutdown paths the command wires to signals. */
export interface UpRunning {
  ok: true
  orchestrators: OrchestratorsHandle
  server: { url: string; close(): void }
  /** The staged-shutdown handler installed for SIGINT and SIGTERM. */
  onSignal: () => void
  /** Drain every engine, close the server and exit with `code`: the supersede's path. */
  stop(code: number): Promise<void>
}

export type UpOutcome = UpRunning | { ok: false; code: 1 }

/**
 * Resolves `up`'s `--repo` to its work-tree toplevel — the same normalization
 * `loadSources` already applies to `--repo` and config entries (#493, the
 * engine-side half of #83). The engine reads by pathspec (`ls-tree`/`log --
 * <path>`), which resolves relative to the cwd's prefix inside a work tree,
 * unlike `show(ref:path)` — a subdirectory `repoDir` would dispatch against an
 * engine that lists no artifacts and misses default-branch runs, with no
 * warning.
 */
export async function resolveUpRepoDir(raw: string): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
  const dir = await repoToplevel(raw)
  if (dir === null) return { ok: false, error: `${raw} is not a git repository — \`up\` needs one writable clone (pass --repo)` }
  return { ok: true, dir }
}

/**
 * The startup marker for one engine's push and local-only (TOPOLOGY.md §3.6):
 * which way it went, and why, in the words `loadSources` recorded. For a
 * repository given by `--repo` or the working directory these are the five
 * markers `up` has always printed: `local-only (--local-only)`,
 * `local-only (--no-push)`, `local-only (no origin remote)`,
 * `pushing to origin (--push)`, `pushing to origin (origin auto-detected)`.
 */
export function pushMarker(settings: Pick<RepositorySettings, 'push' | 'localOnly' | 'pushBecause'>): string {
  if (settings.localOnly) return `local-only (${settings.pushBecause})`
  if (settings.push) return `pushing to origin (${settings.pushBecause})`
  return `not pushing to origin (${settings.pushBecause})`
}

function isStartupError(e: unknown): e is Error {
  return (
    e instanceof LocalOnlyPushConflictError || e instanceof RepositoryIdError || e instanceof ConfigError || e instanceof DuplicateRepositoryError
  )
}

/** A value and where it came from, for the startup log. */
interface Sourced<T> {
  value: T
  from: string
}

/** A flag over the config over a default, saying which one won and what it overrode. */
function pick<T>(flag: T | undefined, flagName: string, config: T | undefined, configKey: string, fallback: T): Sourced<T> {
  if (flag !== undefined)
    return { value: flag, from: config !== undefined && config !== flag ? `${flagName}, over the config's ${configKey}: ${String(config)}` : flagName }
  if (config !== undefined) return { value: config, from: `config ${configKey}` }
  return { value: fallback, from: 'default' }
}

const usd = (n: number) => `$${n}`
const hours = (h: number) => `${h} h`

/** A number a flag gave, checked: the config's values are checked by its loader, and a flag's must not be weaker. */
function flagProblem(name: string, value: number | undefined, rule: 'nonnegative' | 'positive' | 'count'): string | null {
  if (value === undefined) return null
  if (!Number.isFinite(value)) return `${name} must be a number`
  if (rule === 'positive' && value <= 0) return `${name} must be greater than 0 (got ${value})`
  if (rule !== 'positive' && value < 0) return `${name} must not be negative (got ${value})`
  if (rule === 'count' && !Number.isInteger(value)) return `${name} must be a whole number (got ${value})`
  return null
}

/**
 * `gateline up`, from flags to a running process: resolve the set, refuse
 * anything that cannot start, print what will be allowed to spend money,
 * then start the server over the whole set and one engine per `dispatch`
 * repository. A refusal prints its message and returns `{ ok: false }` with
 * nothing started.
 */
export async function runUp(flags: UpFlags, deps: UpDeps): Promise<UpOutcome> {
  const refuse = (message: string): UpOutcome => {
    deps.error(message)
    return { ok: false, code: 1 }
  }

  // Numbers from the command line are checked before anything is read: a
  // spend limit that is not a number would admit every dispatch.
  for (const problem of [
    flagProblem('--spend-limit-usd', flags.spendLimitUsd, 'nonnegative'),
    flagProblem('--spend-window', flags.spendWindow, 'positive'),
    flagProblem('--max-concurrent-dispatches', flags.maxConcurrentDispatches, 'count'),
    flagProblem('--heartbeat', flags.heartbeat, 'positive'),
    flagProblem('--role-timeout', flags.roleTimeout, 'positive'),
  ])
    if (problem) return refuse(problem)
  if (flags.engineName !== undefined) {
    const problem = engineNameProblem(flags.engineName)
    if (problem) return refuse(`--engine-name: ${problem}`)
  }

  // Each --repo must be a repository: `up` serves what it was told to, and a
  // path it would skip is one engine the operator expects and does not get.
  const repoOverrides: string[] = []
  for (const raw of flags.repo) {
    const resolved = await resolveUpRepoDir(raw)
    if (!resolved.ok) return refuse(resolved.error)
    repoOverrides.push(resolved.dir)
  }

  // The set, in `loadSources`' precedence: --repo paths, else the config
  // file, else the working directory. A repository with no config entry is
  // `dispatch` under `up` (R3). Push and local-only are resolved here, once,
  // for the server and the engines alike (R2): the command line's --push,
  // --no-push and --local-only reach only a repository with no config entry.
  let loaded: LoadedConfig
  try {
    loaded = await loadSources({
      repoOverrides: repoOverrides.length ? repoOverrides : undefined,
      configPath: deps.configPath,
      cwd: deps.cwd,
      push: flags.push,
      localOnly: flags.localOnly || undefined,
      engine: true,
    })
  } catch (e) {
    if (isStartupError(e)) return refuse(e.message)
    throw e
  }
  for (const w of loaded.warnings) deps.error(`warning: ${w}`)
  // --repo replaces the config file whole, its limits with its list: said,
  // because a machine limit an operator wrote there does not hold this time.
  const configFile = deps.configPath ?? defaultConfigPath()
  if (repoOverrides.length && existsSync(configFile))
    deps.error(`warning: --repo given, so ${configFile} is not read: its repositories, limits: and engine: do not apply to this run`)
  const { sources, configPath } = loaded
  if (sources.length === 0)
    return refuse('`up` has no repository to serve — run inside a repository, pass --repo <path>, or list repositories in the config file (`gateline repo add`)')

  if (configPath !== null) {
    const given = [flags.push === true ? '--push' : null, flags.push === false ? '--no-push' : null, flags.localOnly ? '--local-only' : null].filter(
      (f): f is string => f !== null,
    )
    // The same conflict a repository with no entry is refused for: the command line contradicts itself.
    if (flags.localOnly && flags.push === true)
      return refuse(`--local-only and --push: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one`)
    if (given.length)
      deps.error(
        `warning: ${given.join(' and ')} ${given.length === 1 ? 'applies' : 'apply'} only to a repository given by --repo or the working directory; ` +
          `every repository here is listed in ${configPath} and keeps its own push and local_only settings (docs/TOPOLOGY.md §3.6)`,
      )
  }

  const engineName =
    flags.engineName !== undefined
      ? { value: flags.engineName, from: '--engine-name' }
      : loaded.engine.name !== undefined
        ? { value: loaded.engine.name, from: 'config engine.name' }
        : null
  if (engineName?.from === 'config engine.name') {
    const problem = engineNameProblem(engineName.value)
    if (problem) return refuse(`config at ${configPath}: engine.name: ${problem}`)
  }

  // One engine per `dispatch` repository; `view` and `decide` repositories
  // are served and get none (§7.3).
  const dispatching = sources.filter((s) => s.mode === 'dispatch')
  if (dispatching.length === 0) {
    const listed = sources.map((s) => `${s.id} (${s.mode})`).join(', ')
    return refuse(
      `no repository in the set is in dispatch mode, so \`up\` has no engine to run: ${listed}. ` +
        '`gateline ui` serves a set with no engine. To run an engine in a repository, set `mode: dispatch` on its entry in ' +
        `${configPath ?? 'the config file'}`,
    )
  }

  // The machine's limits and every engine's defaults: a flag over the
  // config's `limits:` and `engine:`, over the default (P3).
  const maxConcurrent = pick(
    flags.maxConcurrentDispatches,
    '--max-concurrent-dispatches',
    loaded.limits.maxConcurrentDispatches,
    'limits.max_concurrent_dispatches',
    DEFAULT_MAX_CONCURRENT_DISPATCHES,
  )
  const spendLimit = pick<number | null>(flags.spendLimitUsd, '--spend-limit-usd', loaded.limits.spendLimitUsd, 'limits.spend_limit_usd', null)
  const spendWindow = pick(flags.spendWindow, '--spend-window', loaded.limits.spendWindowHours, 'limits.spend_window_hours', DEFAULT_SPEND_WINDOW_MS / 3_600_000)
  const enforcement = pick(
    flags.noBudgetEnforcement ? false : undefined,
    '--no-budget-enforcement',
    loaded.engine.budgetEnforcement,
    'engine.budget_enforcement',
    true,
  )
  const adapters = pick(flags.adapter.length ? flags.adapter : undefined, '--adapter', loaded.engine.adapters, 'engine.adapters', DEFAULT_ADAPTERS)
  const roleTimeout = pick(flags.roleTimeout, '--role-timeout', loaded.engine.roleTimeoutSeconds, 'engine.role_timeout_seconds', ROLE_TIMEOUT_MS / 1000)
  const heartbeat = pick(flags.heartbeat, '--heartbeat', loaded.engine.heartbeatSeconds, 'engine.heartbeat_seconds', DEFAULT_HEARTBEAT_SECONDS)
  const enforced = enforcement.value

  const repositories: RepositoryEngineConfig[] = []
  const markers = new Map<string, string>()
  for (const source of dispatching) {
    const repoDir = source.workingDirectory?.()
    if (repoDir === undefined) return refuse(`${displayNameOf(source)} (${source.id}) has no local clone, so no engine can run in it`)
    const settings = loaded.repositorySettings[source.id]
    if (!settings) throw new Error(`internal: loadSources resolved no push setting for ${source.id}`)
    markers.set(source.id, pushMarker(settings))
    repositories.push({
      repoDir,
      repositoryId: source.id,
      displayName: displayNameOf(source),
      spendLimitUsd: loaded.repositoryLimits[source.id]?.spendLimitUsd ?? null,
      push: settings.push,
      localOnly: settings.localOnly,
      frameworkPrefix: settings.frameworkPrefix,
      adapters: adapters.value,
      // With enforcement off, requiring a per-run cap would be requiring a
      // number nothing reads (#109).
      requireBudget: enforced,
      roleTimeoutSeconds: roleTimeout.value,
      dispatcher: deps.dispatcher?.(source.id),
    })
  }

  // What will be allowed to spend money, said before anything starts.
  const from = configPath !== null ? `from ${configPath}` : repoOverrides.length ? 'from --repo' : 'from the working directory'
  deps.log(
    `up: ${sources.length} ${sources.length === 1 ? 'repository' : 'repositories'} ${from}; ` +
      `an engine in ${dispatching.length === sources.length ? (sources.length === 1 ? 'it' : 'each') : `${dispatching.length} of them`}`,
  )
  deps.log(
    maxConcurrent.value === 0
      ? `limits: no limit on dispatches at once (${maxConcurrent.from})`
      : `limits: at most ${maxConcurrent.value} ${maxConcurrent.value === 1 ? 'dispatch' : 'dispatches'} at once across every repository (${maxConcurrent.from})`,
  )
  deps.log(
    spendLimit.value === null
      ? `limits: no machine spend limit (${spendLimit.from})`
      : `limits: machine spend limit ${usd(spendLimit.value)} per ${hours(spendWindow.value)} across every dispatch repository (${spendLimit.from}; window: ${spendWindow.from})` +
          (enforced ? '' : ' — not enforced'),
  )
  deps.log(
    enforced
      ? `limits: budget enforcement on (${enforcement.from})`
      : `limits: budget enforcement OFF (${enforcement.from}) — spend is metered, and no spend limit, ceiling or per-run cap holds a dispatch back; the concurrency limit still does`,
  )
  deps.log(
    engineName
      ? `engine name: ${engineName.value} (${engineName.from})`
      : `engine name: ${hostname()} (this machine's hostname; set engine.name in the config or --engine-name to choose another)`,
  )
  deps.log(
    `engine: adapters ${adapters.value.join(', ')} (${adapters.from}); role timeout ${roleTimeout.value} s (${roleTimeout.from}); heartbeat ${heartbeat.value} s (${heartbeat.from})`,
  )
  const byId = new Map(repositories.map((r) => [r.repositoryId, r]))
  for (const source of sources) {
    const engine = byId.get(source.id)
    const head = `repository ${source.id} (${displayNameOf(source)}): ${source.mode}`
    if (!engine) {
      deps.log(`${head}, no engine`)
      continue
    }
    const ceiling = engine.spendLimitUsd
    const ceilingWords =
      ceiling === null || ceiling === undefined
        ? 'no spend ceiling of its own'
        : `spend ceiling ${usd(ceiling)} per ${hours(spendWindow.value)} (config limits.spend_limit_usd)` +
          (spendLimit.value !== null && ceiling > spendLimit.value ? `, above the machine's ${usd(spendLimit.value)}, which binds first` : '') +
          (enforced ? '' : ' — not enforced')
    const prefix = engine.frameworkPrefix !== undefined ? `; framework prefix ${engine.frameworkPrefix}` : ''
    deps.log(`${head}, engine; ${markers.get(source.id)}; ${ceilingWords}${prefix}`)
  }

  // One drain for the process, whatever asks for it: a supersede and the
  // operator's ^C ladder share one idempotent promise, so neither drains
  // twice, and the process exits once. It waits for the engines to be
  // running, so a supersede can never arrive before there is a drain to run.
  let exited = false
  const exitOnce = (code: number) => {
    if (exited) return
    exited = true
    deps.exit(code)
  }
  const live: { engines: Promise<OrchestratorsHandle | null>; server: { close(): void } | null } = { engines: Promise.resolve(null), server: null }
  let drained: Promise<void> | null = null
  const drain = () =>
    (drained ??= (async () => {
      await (await live.engines)?.stop()
      live.server?.close()
    })())
  const stop = async (code: number) => {
    deps.log('draining in-flight dispatches…')
    await drain()
    exitOnce(code)
  }

  // Assembled before the server starts, so a repository that cannot be
  // assembled (a manifest missing at its default-branch tip, two entries
  // naming one repository) is refused with nothing listening.
  let set: Awaited<ReturnType<typeof assembleOrchestrators>>
  try {
    set = await assembleOrchestrators({
      repositories,
      limits: {
        maxConcurrentDispatches: maxConcurrent.value,
        spendLimitUsd: spendLimit.value,
        spendWindowHours: spendWindow.value,
        budgetEnforcement: enforced,
      },
      heartbeatSeconds: heartbeat.value,
      codeRepo: deps.codeRepo,
      log: (line) => deps.log(line),
      onSupersede: (status) => {
        deps.log(`code tree moved ${status.startHead.slice(0, 10)}..${status.codeHead.slice(0, 10)} — superseding, restart to load fresh code`)
        void stop(SUPERSEDE_EXIT_CODE)
      },
      engineName: engineName?.value,
      stopWaitMs: deps.stopWaitMs,
      startupTimeoutMs: deps.startupTimeoutMs,
    })
  } catch (e) {
    // Every assembly failure is a refusal: the library's message, exit 1.
    return refuse((e as Error).message)
  }

  const { startServer } = await import('@gateline/server/main')
  const server = await startServer({ port: flags.port, host: flags.host, open: flags.open, resolved: { sources, configPath } })
  live.server = server

  const starting = set.start()
  live.engines = starting.catch(() => null)
  let orchestrators: OrchestratorsHandle
  try {
    orchestrators = await starting
  } catch (e) {
    server.close()
    return refuse((e as Error).message)
  }
  // Installed as soon as the engines are running: `start()` returns once
  // every engine has seeded, before the startup passes finish (#502).
  const onSignal = stagedShutdown({
    inFlight: () => orchestrators.inFlightDetail(),
    drain,
    abort: () => orchestrators.abortInFlight(),
    log: (line) => deps.log(line),
    exit: exitOnce,
  })
  deps.onSignal(onSignal)
  for (const r of repositories) deps.log(`engine watching ${r.repoDir} (heartbeat ${heartbeat.value}s, ${markers.get(r.repositoryId)}) — ^C to stop`)
  return { ok: true, orchestrators, server, onSignal, stop }
}
