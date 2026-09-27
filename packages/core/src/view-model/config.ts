// The operator's configuration: ~/.config/gateline/config.yaml lists the
// repositories one deployment serves, each with its mode, plus the machine's
// limits and engine defaults (docs/MULTI-REPO.md §7). No config file → the
// current repository, zero setup (plan §2.2).
//
// The file is the only place anything about the set is stored (§5, rule 2).
// `gateline repo add|remove|list` edit and print it through the functions at
// the end of this module, which keep its comments and ordering.
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Document, isMap, isNode, isScalar, isSeq, parseDocument, parse as parseYaml, type YAMLMap, type YAMLSeq } from 'yaml'
import { z } from 'zod'
import { checkFramework, type FrameworkCheck } from '../sources/framework-check.ts'
import { Git } from '../sources/git.ts'
import { LocalGitSource, readFileIfExists, repoToplevel } from '../sources/local-source.ts'
import {
  type DerivedRepositoryId,
  deriveRepositoryId,
  directoryBasename,
  lastIdSegment,
  RepositoryIdError,
  repositoryIdKey,
} from '../sources/repository-id.ts'
import type { RepositoryMode, RunSource } from '../sources/source.ts'
import { LocalOnlyPushConflictError, REPOSITORY_MODES } from '../sources/source.ts'

// Re-exported from its original home so `@gateline/core/view-model` and the
// root export keep the same surface; the class itself now sits in the sources
// layer, where push mode is decided (#132).
export { LocalOnlyPushConflictError }

/**
 * The config file cannot be used as written: it fails to parse, breaks a rule
 * of §7 (an entry with no `mode`, both `repositories:` and `sources:`, an
 * unknown key, a repository limit above the machine's), or lists a repository
 * that does not carry the framework. A startup error, like `RepositoryIdError`:
 * serving a guess at what the operator meant would be worse than refusing.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const MODE_LIST = REPOSITORY_MODES.join(', ')
const MODE_HELP = '`mode: view` (read only), `mode: decide` (also record decisions) or `mode: dispatch` (also run an engine under `up`)'

const repositoryLimitsSchema = z
  .object({
    /** This repository's own spend ceiling, beneath the machine's (§7.4, P3). */
    spend_limit_usd: z.number().nonnegative().optional(),
  })
  .strict()

const repositoryEntrySchema = z
  .object({
    /**
     * The display name (#494). For a repository with an origin it is
     * presentation only; for one without, it also forms the id `local/<name>`.
     * Before #494 this was the id itself, which is why it stays a redirect alias.
     */
    name: z.string().min(1).optional(),
    path: z.string(),
    /** What this deployment may do here (§7.3, R3): required, and checked before the schema runs. */
    mode: z.enum(REPOSITORY_MODES),
    /** States the id outright, where deriving it from the origin would be wrong (an ssh host alias, say). */
    id: z.string().optional(),
    /** Ids this repository had before; links made under them keep redirecting (§6.3). */
    former_ids: z.array(z.string()).optional(),
    // No zod default: unset must stay distinguishable from explicit `false` so
    // the mode-resolution table (below) can tell "no opinion" from "no-push
    // ceiling" — resolveMode applies the table's default itself.
    push: z.boolean().optional(),
    /** Explicit local-only designator, mirroring `push`'s two explicit tiers (ADR-1/ADR-2). */
    local_only: z.boolean().optional(),
    /** Seconds between `git fetch`es of origin; unset = never poll. */
    fetch_interval: z.number().positive().optional(),
    /**
     * Where the framework lock lives when this repository was integrated with
     * a custom `gateline init --prefix` (#94); `.gateline` otherwise. The
     * framework check (§7.2) and the source's own reads both use it.
     */
    gateline_prefix: z.string().min(1).optional(),
    limits: repositoryLimitsSchema.optional(),
  })
  .strict()

const limitsSchema = z
  .object({
    /** Most dispatches running at once across every repository; 0 disables the cap (as `--max-concurrent-dispatches`). */
    max_concurrent_dispatches: z.number().int().nonnegative().optional(),
    /** Projected spend across every `dispatch` repository, per window (as `--spend-limit-usd`). */
    spend_limit_usd: z.number().nonnegative().optional(),
    /** The rolling window the spend limit measures over, in hours (as `--spend-window`). */
    spend_window_hours: z.number().positive().optional(),
  })
  .strict()

const engineSchema = z
  .object({
    /** Headless adapters every `dispatch` repository may run; the first is the default (as `--adapter`). */
    adapters: z.array(z.string().min(1)).min(1).optional(),
    /** Wall clock per dispatched role, in seconds (as `--role-timeout`). */
    role_timeout_seconds: z.number().positive().optional(),
    /** Engine heartbeat interval, in seconds (as `--heartbeat`). */
    heartbeat_seconds: z.number().positive().optional(),
  })
  .strict()

const configSchema = z
  .object({
    repositories: z.array(repositoryEntrySchema).nullish(),
    /** The key's name before §7: read as an alias of `repositories`. */
    sources: z.array(repositoryEntrySchema).nullish(),
    limits: limitsSchema.nullish(),
    engine: engineSchema.nullish(),
  })
  .strict()

export type RepositoryEntry = z.infer<typeof repositoryEntrySchema>

/** The machine's limits (§7.4): parsed and checked here, and not yet consumed — the governor (#501, #502) takes them. */
export interface OperatorLimits {
  maxConcurrentDispatches?: number
  spendLimitUsd?: number
  spendWindowHours?: number
}

/** Engine defaults for every `dispatch` repository (§7.4): parsed and checked here, not yet consumed (#502). */
export interface EngineDefaults {
  adapters?: string[]
  roleTimeoutSeconds?: number
  heartbeatSeconds?: number
}

export interface LoadedConfig {
  sources: RunSource[]
  /** Where the config was read from, or null when defaulted. */
  configPath: string | null
  warnings: string[]
  /** The config file's `limits:`; empty when no config file was read (`--repo`, the working directory). */
  limits: OperatorLimits
  /** The config file's `engine:`; empty when no config file was read. */
  engine: EngineDefaults
  /** Each listed repository's own `limits:`, by source id; a repository with none is absent. */
  repositoryLimits: Record<string, { spendLimitUsd?: number }>
}

export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'gateline', 'config.yaml')
}

/** A config path as written (`~/repos/billing`, relative, absolute) made absolute. */
function expandPath(path: string, cwd = process.cwd()): string {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1))
  return isAbsolute(path) ? path : resolve(cwd, path)
}

// --- Reading and checking the file --------------------------------------------

interface ParsedConfig {
  /** Which key holds the list in the file, or null when neither appears. */
  key: 'repositories' | 'sources' | null
  entries: RepositoryEntry[]
  limits: OperatorLimits
  engine: EngineDefaults
}

/** `repositories[1] (~/repos/billing)`: where in the file a problem is, in the file's own words. */
function entryLabel(key: string, index: number, raw: unknown): string {
  const path = raw && typeof raw === 'object' && typeof (raw as { path?: unknown }).path === 'string' ? (raw as { path: string }).path : null
  return `${key}[${index}]${path ? ` (${path})` : ''}`
}

function issueWhere(key: string | null, path: PropertyKey[], doc: Record<string, unknown>): string {
  if (path.length === 0) return 'the top level'
  const [first, second, ...rest] = path
  if ((first === 'repositories' || first === 'sources') && typeof second === 'number') {
    const list = doc[first] as unknown[]
    const label = entryLabel(String(first), second, list[second])
    return rest.length ? `${label}, ${rest.join('.')}` : label
  }
  return path.map(String).join('.') || (key ?? 'the top level')
}

/**
 * Parse and check the config text against §7: the schema, `mode` on every
 * entry (R3), one list key, no unknown keys, and no repository limit above
 * the machine's. Throws `ConfigError`, prefixed with the file's path.
 */
function parseConfigText(text: string, configPath: string): ParsedConfig {
  const fail = (problem: string): never => {
    throw new ConfigError(`config at ${configPath}: ${problem}`)
  }
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    return fail(`not valid YAML (${(e as Error).message})`)
  }
  if (raw === null || raw === undefined) return { key: null, entries: [], limits: {}, engine: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('the file must be a mapping with a `repositories:` list')
  const doc = raw as Record<string, unknown>
  if ('repositories' in doc && 'sources' in doc)
    fail('both `repositories:` and `sources:` appear. `sources:` is the older name of the same list; move its entries under `repositories:` and delete it')
  const key = 'repositories' in doc ? 'repositories' : 'sources' in doc ? 'sources' : null

  // R3 before the schema, so a missing mode is named as that and not as a
  // generic type error: the message is the migration note for an old file.
  const list = key ? doc[key] : null
  if (Array.isArray(list)) {
    list.forEach((entry, i) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const mode = (entry as { mode?: unknown }).mode
        if (mode === undefined || mode === null)
          fail(`${entryLabel(key!, i, entry)} states no mode. Every entry needs one: add ${MODE_HELP}`)
        if (typeof mode !== 'string' || !(REPOSITORY_MODES as readonly string[]).includes(mode))
          fail(`${entryLabel(key!, i, entry)}: mode ${JSON.stringify(mode)} is not one of ${MODE_LIST}`)
      }
    })
  }

  const parsed = configSchema.safeParse(doc)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const where = issueWhere(key, issue.path, doc)
      if (issue.code === 'unrecognized_keys') return `${where}: unknown key ${issue.keys.map((k) => `"${k}"`).join(', ')}`
      return `${where}: ${issue.message}`
    })
    fail(problems.join('; '))
  }
  const config = parsed.data!
  const entries = (key ? config[key] : null) ?? []
  const limits: OperatorLimits = {}
  if (config.limits?.max_concurrent_dispatches !== undefined) limits.maxConcurrentDispatches = config.limits.max_concurrent_dispatches
  if (config.limits?.spend_limit_usd !== undefined) limits.spendLimitUsd = config.limits.spend_limit_usd
  if (config.limits?.spend_window_hours !== undefined) limits.spendWindowHours = config.limits.spend_window_hours
  const engine: EngineDefaults = {}
  if (config.engine?.adapters !== undefined) engine.adapters = config.engine.adapters
  if (config.engine?.role_timeout_seconds !== undefined) engine.roleTimeoutSeconds = config.engine.role_timeout_seconds
  if (config.engine?.heartbeat_seconds !== undefined) engine.heartbeatSeconds = config.engine.heartbeat_seconds

  // P3: the operator's limit is a ceiling. A repository may set a lower one,
  // never a higher; with no machine limit there is nothing to exceed.
  entries.forEach((entry, i) => {
    const own = entry.limits?.spend_limit_usd
    if (own !== undefined && limits.spendLimitUsd !== undefined && own > limits.spendLimitUsd)
      fail(
        `${entryLabel(key!, i, entry)}: limits.spend_limit_usd ${own} is above the machine's limits.spend_limit_usd ${limits.spendLimitUsd}. ` +
          "The machine's limit is the ceiling; a repository may only set a lower one",
      )
  })
  return { key, entries, limits, engine }
}

// --- Naming a repository ----------------------------------------------------------

/**
 * Everything `loadSources` learns about one repository before it builds the
 * source: where it is, what it is called, and what it used to be called.
 */
interface Named {
  top: string
  id: string
  from: DerivedRepositoryId['from']
  displayName: string
  formerIds: string[]
  /** What `git remote get-url origin` printed, or null. */
  origin: string | null
}

/**
 * Name one repository (§6): read its origin, derive the id, pick the display
 * name, and list the names old links may carry for it — the config `name`
 * and the basename, each also with the `-2` suffix the retired collision rule
 * used to add, and the config's `former_ids:`.
 */
async function nameRepository(top: string, entry: { name?: string; id?: string; former_ids?: string[] } = {}): Promise<Named> {
  const origin = await new Git(top).remoteUrl('origin')
  const { id, from } = deriveRepositoryId({ origin, explicitId: entry.id, name: entry.name, dir: top })
  const legacy = [entry.name, directoryBasename(top)].filter((n): n is string => !!n)
  const formerIds = [...new Set([...legacy, ...legacy.map((n) => `${n}-2`), ...(entry.former_ids ?? [])])]
  return { top, id, from, displayName: entry.name ?? lastIdSegment(id), formerIds, origin }
}

/**
 * The set's uniqueness rules (§6.2), checked before any source is built: no
 * repository is listed twice, no two repositories share an id (compared
 * without case), and no two share a display name. Each is a startup error. The `-2` suffix that used to
 * paper over a clash is retired, because it made names and URLs collide and
 * could put two authorities over one set of runs.
 */
function checkUnique(named: Named[], hint: string): void {
  const byTop = new Map<string, Named>()
  const byId = new Map<string, Named>()
  const byName = new Map<string, Named>()
  for (const n of named) {
    // One repository listed twice under two names would get two ids when it
    // has no origin (local/<name>), and so slip past the id rule below.
    const sameTop = byTop.get(n.top)
    if (sameTop) throw new RepositoryIdError(`${n.top} is listed twice, as ${sameTop.id} and ${n.id}. List each repository once`)
    byTop.set(n.top, n)
    const idKey = repositoryIdKey(n.id)
    const sameId = byId.get(idKey)
    if (sameId) {
      const how = n.from === 'local' ? 'neither has an origin, and their names match' : n.from === 'origin' ? 'they have the same origin' : 'the config states that id for both'
      throw new RepositoryIdError(
        `two repositories resolve to the id ${sameId.id}: ${sameId.top} and ${n.top} (${how}). ` +
          `List each repository once; if these are different repositories, ${hint}`,
      )
    }
    byId.set(idKey, n)
    const nameKey = n.displayName.toLowerCase()
    const sameName = byName.get(nameKey)
    if (sameName) {
      throw new RepositoryIdError(
        `two repositories have the display name "${n.displayName}": ${sameName.top} (${sameName.id}) and ${n.top} (${n.id}). ` +
          'Give one of them a `name` in the config',
      )
    }
    byName.set(nameKey, n)
  }
}

const CLI_HINT = 'list them in the config file, giving one an `id:` or a `name`'
const CONFIG_HINT = 'give one of them an `id:` (or, with no origin, a different `name`)'

// --- Push and local-only ----------------------------------------------------------

/**
 * Zero-config sources (--repo, cwd) push human writes when the repo has an
 * origin (#149): a decision that only lands locally waits on the engine's
 * next commit to reach origin, and an engine at rest never commits — the
 * viewer and origin then show different runs with no signal. Push failures
 * stay tolerated (`ok: true, pushFailed`), so a flaky or absent network
 * degrades to the old behavior, visibly. A `dispatch` config entry does the
 * same (R2); `view` and `decide` entries keep their explicit `push` setting.
 */
async function pushWhenOriginExists(top: string): Promise<boolean> {
  return (await new Git(top).configGet('remote.origin.url')) !== null
}

/** Caches one `git config` read per source: `resolveMode` may consult origin-exists twice (rules 2d and 3). */
function memoizedOriginExists(top: string): () => Promise<boolean> {
  let cached: Promise<boolean> | null = null
  return () => {
    cached ??= pushWhenOriginExists(top)
    return cached
  }
}

/**
 * The plan's normative mode-resolution table, implemented once and shared by
 * every source path (repoOverrides, config entries, fallbackToCwd), and
 * restated in TOPOLOGY.md §3.6:
 *
 * 1. Explicit local-only `true` AND explicit push `true` → conflict.
 * 2. `localOnly` := the explicit designator, if set; else `false` when push
 *    is explicitly `true`; else `true` when push is explicitly `false` **at
 *    the CLI tier only** (ADR-1); else `!originExists` (auto-detect, applies
 *    to config-tier sources too — ADR-2).
 * 3. `push` := `false` when `localOnly`; else the explicit push setting if
 *    any; else `originExists` for zero-config (CLI-tier) sources and for
 *    config entries in `dispatch` mode (R2, MULTI-REPO.md §7.3: an engine
 *    that commits without pushing is the split state TOPOLOGY.md §3.2
 *    exists to prevent); else `false` for `view` and `decide` config entries
 *    (the config file's existing default — AC1.3 regression surface).
 *
 * A config entry's push follows its declared mode, whether or not this
 * process runs an engine: a `dispatch` entry served by `ui` pushes as it
 * would under `up`.
 */
async function resolveMode(args: {
  source: string
  explicitLocalOnly?: boolean
  explicitPush?: boolean
  cliTier: boolean
  /** The config entry's declared mode; unused at the CLI tier. */
  mode?: RepositoryMode
  originExists: () => Promise<boolean>
}): Promise<{ push: boolean; localOnly: boolean }> {
  const { source, explicitLocalOnly, explicitPush, cliTier, mode, originExists } = args
  if (explicitLocalOnly === true && explicitPush === true) throw new LocalOnlyPushConflictError(source)

  let localOnly: boolean
  if (explicitLocalOnly !== undefined) localOnly = explicitLocalOnly
  else if (explicitPush === true) localOnly = false
  else if (explicitPush === false && cliTier) localOnly = true
  else localOnly = !(await originExists())

  let push: boolean
  if (localOnly) push = false
  else if (explicitPush !== undefined) push = explicitPush
  else push = cliTier || mode === 'dispatch' ? await originExists() : false

  return { push, localOnly }
}

/**
 * A mode as this process can honour it (§7.3): under `ui` and the CLI no
 * engine runs, so a `dispatch` entry behaves as `decide`.
 */
function effectiveMode(declared: RepositoryMode, engine: boolean): RepositoryMode {
  return declared === 'dispatch' && !engine ? 'decide' : declared
}

// --- Loading the set ----------------------------------------------------------------

/**
 * Resolve sources in precedence order: explicit --repo paths, then the config
 * file, then the cwd's repository.
 *
 * Each source is named by `nameRepository` (§6). Throws `RepositoryIdError`
 * when an id is unusable, or when two repositories share an id or a display
 * name; throws `ConfigError` when the config file breaks a rule of §7 or lists
 * a repository that does not carry the framework (§7.2). Both are startup
 * errors, since serving either reading of a clash would be a guess.
 *
 * The framework check applies to config entries only. A repository given by
 * `--repo` or the working directory is served as before, unchecked.
 */
export async function loadSources(opts: {
  repoOverrides?: string[]
  configPath?: string
  cwd?: string
  /**
   * Overrides the origin-exists push auto-detection for zero-config sources
   * — `false` honors an operator's explicit no-push ceiling (`gateline up
   * --no-push`), which at this CLI tier also implies local-only (ADR-1)
   * unless `localOnly` says otherwise. Config-file sources always keep their
   * own `push`/`local_only` entries.
   */
  push?: boolean
  /** Explicit local-only designator for zero-config (CLI-tier) sources — `gateline up --local-only`. */
  localOnly?: boolean
  /**
   * Whether this process runs an engine (`up`). It decides the mode of a
   * repository with no config entry (`dispatch` under `up`, `decide`
   * otherwise), and whether a `dispatch` entry keeps that mode or behaves as
   * `decide` (§7.3, R3).
   */
  engine?: boolean
}): Promise<LoadedConfig> {
  const warnings: string[] = []
  const cwd = opts.cwd ?? process.cwd()
  const engine = opts.engine === true
  const zeroConfigMode: RepositoryMode = engine ? 'dispatch' : 'decide'
  const none = { limits: {}, engine: {}, repositoryLimits: {} }

  if (opts.repoOverrides?.length) {
    const named: Named[] = []
    for (const raw of opts.repoOverrides) {
      const path = isAbsolute(raw) ? raw : resolve(cwd, raw)
      const top = await repoToplevel(path)
      if (top === null) {
        warnings.push(`--repo ${raw}: not a git repository, skipped`)
        continue
      }
      named.push(await nameRepository(top))
    }
    checkUnique(named, CLI_HINT)
    const sources: RunSource[] = []
    for (const n of named) {
      const { push, localOnly } = await resolveMode({
        source: n.id,
        explicitLocalOnly: opts.localOnly,
        explicitPush: opts.push,
        cliTier: true,
        originExists: memoizedOriginExists(n.top),
      })
      sources.push(
        new LocalGitSource(n.id, n.top, { push, localOnly, displayName: n.displayName, formerIds: n.formerIds, mode: zeroConfigMode }),
      )
    }
    return { sources, configPath: null, warnings, ...none }
  }

  const configPath = opts.configPath ?? defaultConfigPath()
  const text = await readFileIfExists(configPath)
  if (text !== null) {
    const parsed = parseConfigText(text, configPath)
    const named: { n: Named; entry: RepositoryEntry }[] = []
    for (const entry of parsed.entries) {
      const path = expandPath(entry.path)
      const top = await repoToplevel(path)
      if (top === null) {
        warnings.push(`source ${entry.name ?? entry.path}: ${path} is not a git repository, skipped`)
        continue
      }
      named.push({ n: await nameRepository(top, entry), entry })
    }
    checkUnique(
      named.map(({ n }) => n),
      CONFIG_HINT,
    )
    // D6's second key (§7.2): a listed repository must carry the framework.
    for (const { n, entry } of named) {
      const check = await checkFramework(new Git(n.top), { prefix: entry.gateline_prefix, label: n.top })
      if (!check.ok) throw new ConfigError(`config at ${configPath}: ${check.message}`)
    }
    const sources: RunSource[] = []
    const repositoryLimits: LoadedConfig['repositoryLimits'] = {}
    for (const { n, entry } of named) {
      const { push, localOnly } = await resolveMode({
        source: n.id,
        explicitLocalOnly: entry.local_only,
        explicitPush: entry.push,
        cliTier: false,
        mode: entry.mode,
        originExists: memoizedOriginExists(n.top),
      })
      if (localOnly && entry.fetch_interval !== undefined) {
        warnings.push(`source ${n.id}: fetch_interval ignored — local-only`)
      }
      if (entry.limits?.spend_limit_usd !== undefined) repositoryLimits[n.id] = { spendLimitUsd: entry.limits.spend_limit_usd }
      sources.push(
        new LocalGitSource(n.id, n.top, {
          push,
          localOnly,
          fetchIntervalSeconds: entry.fetch_interval,
          frameworkPrefix: entry.gateline_prefix,
          displayName: n.displayName,
          formerIds: n.formerIds,
          mode: effectiveMode(entry.mode, engine),
        }),
      )
    }
    if (sources.length === 0) {
      warnings.push(`config at ${configPath} yielded no usable sources; falling back to current repo`)
      return fallbackToCwd(cwd, warnings, zeroConfigMode, opts.push, opts.localOnly)
    }
    return { sources, configPath, warnings, limits: parsed.limits, engine: parsed.engine, repositoryLimits }
  }

  return fallbackToCwd(cwd, warnings, zeroConfigMode, opts.push, opts.localOnly)
}

async function fallbackToCwd(
  cwd: string,
  warnings: string[],
  mode: RepositoryMode,
  push?: boolean,
  localOnly?: boolean,
): Promise<LoadedConfig> {
  const none = { limits: {}, engine: {}, repositoryLimits: {} }
  const top = await repoToplevel(cwd)
  if (top !== null) {
    const n = await nameRepository(top)
    const resolved = await resolveMode({
      source: n.id,
      explicitLocalOnly: localOnly,
      explicitPush: push,
      cliTier: true,
      originExists: memoizedOriginExists(top),
    })
    return {
      sources: [
        new LocalGitSource(n.id, top, {
          push: resolved.push,
          localOnly: resolved.localOnly,
          displayName: n.displayName,
          formerIds: n.formerIds,
          mode,
        }),
      ],
      configPath: null,
      warnings,
      ...none,
    }
  }
  warnings.push(`${cwd} is not a git repository and no config exists at ${defaultConfigPath()}`)
  return { sources: [], configPath: null, warnings, ...none }
}

// --- Editing the list: `gateline repo add|remove|list` (§7.1) -----------------------

/** One entry of the list as `repo list` prints it. */
export interface RepositoryListing {
  /** The entry's `path` as written. */
  path: string
  /** The repository's top, or null when the path is not a git repository. */
  top: string | null
  id: string | null
  /** What `git remote get-url origin` printed, or null when there is none. */
  origin: string | null
  displayName: string
  mode: RepositoryMode
  /** The framework check's result (§7.2), or null when the path is not a git repository. */
  framework: FrameworkCheck | null
}

export interface RepositoryList {
  configPath: string
  /** False when there is no config file: the set is then the working directory's repository, or `--repo`. */
  exists: boolean
  entries: RepositoryListing[]
}

/**
 * Read the list for `repo list`. The file must parse and pass §7's rules
 * (a `ConfigError` otherwise, saying what to fix); a repository that fails
 * the framework check, or a path that is no longer a repository, is listed
 * with that result rather than refused, so the operator can see it.
 */
export async function listRepositories(opts: { configPath?: string } = {}): Promise<RepositoryList> {
  const configPath = opts.configPath ?? defaultConfigPath()
  const text = await readFileIfExists(configPath)
  if (text === null) return { configPath, exists: false, entries: [] }
  const parsed = parseConfigText(text, configPath)
  const entries: RepositoryListing[] = []
  for (const entry of parsed.entries) {
    const top = await repoToplevel(expandPath(entry.path))
    if (top === null) {
      entries.push({ path: entry.path, top, id: null, origin: null, displayName: entry.name ?? directoryBasename(entry.path), mode: entry.mode, framework: null })
      continue
    }
    const n = await nameRepository(top, entry)
    const framework = await checkFramework(new Git(top), { prefix: entry.gateline_prefix, label: top })
    entries.push({ path: entry.path, top, id: n.id, origin: n.origin, displayName: n.displayName, mode: entry.mode, framework })
  }
  return { configPath, exists: true, entries }
}

/** The editable document and its list, or a `ConfigError` naming what stops an edit. */
function editableList(text: string | null, configPath: string, create: boolean): { doc: Document; seq: YAMLSeq | null; key: string } {
  const doc = text === null ? new Document(null) : parseDocument(text)
  if (doc.errors.length) throw new ConfigError(`config at ${configPath}: not valid YAML (${doc.errors[0]!.message})`)
  if (doc.contents === null || doc.contents === undefined || (isScalar(doc.contents) && doc.contents.value === null)) {
    if (!create) return { doc, seq: null, key: 'repositories' }
    doc.contents = doc.createNode({}) as YAMLMap
  }
  if (!isMap(doc.contents)) throw new ConfigError(`config at ${configPath}: the file must be a mapping with a \`repositories:\` list`)
  const map = doc.contents
  const hasRepositories = map.has('repositories')
  const hasSources = map.has('sources')
  if (hasRepositories && hasSources)
    throw new ConfigError(
      `config at ${configPath}: both \`repositories:\` and \`sources:\` appear. \`sources:\` is the older name of the same list; move its entries under \`repositories:\` and delete it`,
    )
  const key = hasSources ? 'sources' : 'repositories'
  const node = map.get(key, true)
  if (node === undefined || node === null || (isSeq(node) && node.flow && node.items.length === 0) || (!isSeq(node) && (node as { value?: unknown }).value === null)) {
    if (!create) return { doc, seq: null, key }
    const seq = doc.createNode([]) as YAMLSeq
    map.set(key, seq)
    return { doc, seq, key }
  }
  if (!isSeq(node)) throw new ConfigError(`config at ${configPath}: \`${key}:\` must be a list`)
  return { doc, seq: node, key }
}

/** A list item as plain data. */
function plain(item: unknown): unknown {
  return isNode(item) ? item.toJSON() : item
}

/** What an existing entry is called, for duplicate checks and `repo remove`, read as leniently as the entry allows. */
async function nameEntry(raw: unknown): Promise<{ top: string | null; id: string | null; displayName: string | null; path: string | null }> {
  if (!raw || typeof raw !== 'object') return { top: null, id: null, displayName: null, path: null }
  const entry = raw as { path?: unknown; name?: unknown; id?: unknown; former_ids?: unknown }
  const path = typeof entry.path === 'string' ? entry.path : null
  const name = typeof entry.name === 'string' ? entry.name : undefined
  const id = typeof entry.id === 'string' ? entry.id : undefined
  const top = path ? await repoToplevel(expandPath(path)) : null
  if (top === null) return { top, id: id ?? (name ? `local/${name}` : null), displayName: name ?? (path ? directoryBasename(path) : null), path }
  try {
    const n = await nameRepository(top, { name, id })
    return { top, id: n.id, displayName: n.displayName, path }
  } catch {
    return { top, id: id ?? null, displayName: name ?? directoryBasename(top), path }
  }
}

export interface AddedRepository {
  configPath: string
  id: string
  displayName: string
  top: string
  mode: RepositoryMode
  framework: Extract<FrameworkCheck, { ok: true }>
  /**
   * Why the file as a whole still would not load after the edit — an older
   * entry with no `mode`, say. The edit is made; startup will refuse until
   * this is fixed.
   */
  stillInvalid: string | null
}

/**
 * `gateline repo add` (§7.1): resolve `path` to the repository's top, run the
 * framework check (§7.2), derive the id (§6), refuse an id or display name
 * already in the list (compared without case, as §6.2 has it), and append
 * the entry — keeping the file's comments and the order of what is there.
 */
export async function addRepository(opts: {
  configPath?: string
  path: string
  mode: string
  name?: string
  gatelinePrefix?: string
  cwd?: string
}): Promise<AddedRepository> {
  const configPath = opts.configPath ?? defaultConfigPath()
  if (!(REPOSITORY_MODES as readonly string[]).includes(opts.mode))
    throw new ConfigError(`--mode must be one of ${MODE_LIST} (got "${opts.mode}")`)
  const mode = opts.mode as RepositoryMode
  const absolute = expandPath(opts.path, opts.cwd)
  const top = await repoToplevel(absolute)
  if (top === null) throw new ConfigError(`${absolute} is not a git repository`)

  const framework = await checkFramework(new Git(top), { prefix: opts.gatelinePrefix, label: top })
  if (!framework.ok) throw new ConfigError(framework.message)
  const n = await nameRepository(top, { name: opts.name })

  const text = await readFileIfExists(configPath)
  const { doc, seq } = editableList(text, configPath, true)
  for (const item of seq!.items) {
    const existing = await nameEntry(plain(item))
    if (existing.top === top)
      throw new ConfigError(
        `${top} is already listed, as ${existing.displayName ?? existing.id}. ` +
          `List each repository once; to change its entry, \`gateline repo remove ${existing.displayName ?? existing.id}\` first`,
      )
    if (existing.id && repositoryIdKey(existing.id) === repositoryIdKey(n.id))
      throw new ConfigError(
        `${n.id} is already listed, as ${existing.displayName ?? existing.id} at ${existing.path}. ` +
          `List each repository once; to change its entry, \`gateline repo remove ${existing.displayName ?? existing.id}\` first`,
      )
    if (existing.displayName && existing.displayName.toLowerCase() === n.displayName.toLowerCase())
      throw new ConfigError(
        `the display name "${n.displayName}" is already taken by ${existing.id ?? existing.path}. Give this repository another with --name`,
      )
  }

  const entry: Record<string, string> = { path: top }
  if (opts.name !== undefined) entry.name = opts.name
  entry.mode = mode
  if (opts.gatelinePrefix !== undefined) entry.gateline_prefix = opts.gatelinePrefix
  seq!.add(doc.createNode(entry))

  const updated = doc.toString()
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, updated, 'utf8')

  let stillInvalid: string | null = null
  try {
    parseConfigText(updated, configPath)
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    stillInvalid = e.message
  }
  return { configPath, id: n.id, displayName: n.displayName, top, mode, framework, stillInvalid }
}

export interface RemovedRepository {
  configPath: string
  id: string | null
  displayName: string | null
  path: string | null
}

/**
 * `gateline repo remove` (§7.1): drop the entry whose id or display name is
 * `which` (compared without case), keeping the rest of the file as it was.
 * An entry whose path is no longer a repository can still be removed, by
 * its `name`, its `id:` or its path as written.
 */
export async function removeRepository(opts: { configPath?: string; which: string }): Promise<RemovedRepository> {
  const configPath = opts.configPath ?? defaultConfigPath()
  const text = await readFileIfExists(configPath)
  if (text === null) throw new ConfigError(`no config file at ${configPath}, so there is nothing to remove`)
  const { doc, seq } = editableList(text, configPath, false)
  const want = opts.which.toLowerCase()
  const matches: { index: number; named: Awaited<ReturnType<typeof nameEntry>> }[] = []
  for (const [index, item] of (seq?.items ?? []).entries()) {
    const named = await nameEntry(plain(item))
    if (
      (named.id && repositoryIdKey(named.id) === repositoryIdKey(opts.which)) ||
      named.displayName?.toLowerCase() === want ||
      named.path === opts.which
    )
      matches.push({ index, named })
  }
  if (matches.length === 0)
    throw new ConfigError(`no repository "${opts.which}" in ${configPath}; \`gateline repo list\` prints each one's id and display name`)
  if (matches.length > 1)
    throw new ConfigError(
      `"${opts.which}" names ${matches.length} entries in ${configPath} (${matches.map((m) => m.named.path).join(', ')}); remove one by its id`,
    )
  const { index, named } = matches[0]!
  seq!.items.splice(index, 1)
  await writeFile(configPath, doc.toString(), 'utf8')
  return { configPath, id: named.id, displayName: named.displayName, path: named.path }
}
