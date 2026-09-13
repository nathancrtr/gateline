// Multi-repo configuration: ~/.config/gateline/config.yaml lists sources;
// no config file → the current repo, zero setup (plan §2.2).
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { Git } from '../sources/git.ts'
import { LocalGitSource, readFileIfExists, repoToplevel } from '../sources/local-source.ts'
import type { RunSource } from '../sources/source.ts'
import { LocalOnlyPushConflictError } from '../sources/source.ts'

// Re-exported from its original home so `@gateline/core/view-model` and the
// root export keep the same surface; the class itself now sits in the sources
// layer, where push mode is decided (#132).
export { LocalOnlyPushConflictError }

const sourceEntrySchema = z.object({
  name: z.string().optional(),
  path: z.string(),
  // No zod default: unset must stay distinguishable from explicit `false` so
  // the mode-resolution table (below) can tell "no opinion" from "no-push
  // ceiling" — resolveMode applies `?? false` itself where the table calls
  // for that default.
  push: z.boolean().optional(),
  /** Explicit local-only designator, mirroring `push`'s two explicit tiers (ADR-1/ADR-2). */
  local_only: z.boolean().optional(),
  /** Seconds between `git fetch`es of origin; unset = never poll. */
  fetch_interval: z.number().positive().optional(),
  /**
   * Override the `.gateline` default when this source was integrated with a
   * custom `integrate.py --prefix` (#94) — otherwise auto-detected.
   */
  gateline_prefix: z.string().optional(),
})

const configSchema = z.object({
  sources: z.array(sourceEntrySchema).default([]),
})

export interface LoadedConfig {
  sources: RunSource[]
  /** Where the config was read from, or null when defaulted. */
  configPath: string | null
  warnings: string[]
}

export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'gateline', 'config.yaml')
}

function slugForPath(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || 'repo'
}

/**
 * Zero-config sources (--repo, cwd) push human writes when the repo has an
 * origin (#149): a decision that only lands locally waits on the engine's
 * next commit to reach origin, and an engine at rest never commits — the
 * viewer and origin then show different runs with no signal. Push failures
 * stay tolerated (`ok: true, pushFailed`), so a flaky or absent network
 * degrades to the old behavior, visibly. Config-file sources keep their
 * explicit `push` setting.
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
 * every source path (repoOverrides, config entries, fallbackToCwd):
 *
 * 1. Explicit local-only `true` AND explicit push `true` → conflict.
 * 2. `localOnly` := the explicit designator, if set; else `false` when push
 *    is explicitly `true`; else `true` when push is explicitly `false` **at
 *    the CLI tier only** (ADR-1); else `!originExists` (auto-detect, applies
 *    to config-tier sources too — ADR-2).
 * 3. `push` := `false` when `localOnly`; else the explicit push setting if
 *    any; else `originExists` for zero-config (CLI-tier) sources / `false`
 *    for config-file entries (existing defaults — AC1.3 regression surface).
 */
async function resolveMode(args: {
  source: string
  explicitLocalOnly?: boolean
  explicitPush?: boolean
  cliTier: boolean
  originExists: () => Promise<boolean>
}): Promise<{ push: boolean; localOnly: boolean }> {
  const { source, explicitLocalOnly, explicitPush, cliTier, originExists } = args
  if (explicitLocalOnly === true && explicitPush === true) throw new LocalOnlyPushConflictError(source)

  let localOnly: boolean
  if (explicitLocalOnly !== undefined) localOnly = explicitLocalOnly
  else if (explicitPush === true) localOnly = false
  else if (explicitPush === false && cliTier) localOnly = true
  else localOnly = !(await originExists())

  let push: boolean
  if (localOnly) push = false
  else if (explicitPush !== undefined) push = explicitPush
  else push = cliTier ? await originExists() : false

  return { push, localOnly }
}

/**
 * Resolve sources in precedence order: explicit --repo paths, then the config
 * file, then the cwd's repository.
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
}): Promise<LoadedConfig> {
  const warnings: string[] = []
  const cwd = opts.cwd ?? process.cwd()

  if (opts.repoOverrides?.length) {
    const sources: RunSource[] = []
    for (const raw of opts.repoOverrides) {
      const path = isAbsolute(raw) ? raw : resolve(cwd, raw)
      const top = await repoToplevel(path)
      if (top === null) {
        warnings.push(`--repo ${raw}: not a git repository, skipped`)
        continue
      }
      const id = slugForPath(top)
      const { push, localOnly } = await resolveMode({
        source: id,
        explicitLocalOnly: opts.localOnly,
        explicitPush: opts.push,
        cliTier: true,
        originExists: memoizedOriginExists(top),
      })
      sources.push(new LocalGitSource(id, top, { push, localOnly }))
    }
    return { sources, configPath: null, warnings }
  }

  const configPath = opts.configPath ?? defaultConfigPath()
  const text = await readFileIfExists(configPath)
  if (text !== null) {
    let parsed: z.infer<typeof configSchema>
    try {
      parsed = configSchema.parse(parseYaml(text))
    } catch (e) {
      warnings.push(`config at ${configPath} is invalid (${(e as Error).message}); falling back to current repo`)
      return fallbackToCwd(cwd, warnings, opts.push, opts.localOnly)
    }
    const sources: RunSource[] = []
    const seen = new Set<string>()
    for (const entry of parsed.sources) {
      const path = entry.path.startsWith('~') ? join(homedir(), entry.path.slice(1)) : resolve(entry.path)
      const top = await repoToplevel(path)
      if (top === null) {
        warnings.push(`source ${entry.name ?? entry.path}: ${path} is not a git repository, skipped`)
        continue
      }
      let id = entry.name ?? slugForPath(top)
      while (seen.has(id)) id = `${id}-2`
      seen.add(id)
      const { push, localOnly } = await resolveMode({
        source: id,
        explicitLocalOnly: entry.local_only,
        explicitPush: entry.push,
        cliTier: false,
        originExists: memoizedOriginExists(top),
      })
      if (localOnly && entry.fetch_interval !== undefined) {
        warnings.push(`source ${id}: fetch_interval ignored — local-only`)
      }
      sources.push(
        new LocalGitSource(id, path, {
          push,
          localOnly,
          fetchIntervalSeconds: entry.fetch_interval,
          frameworkPrefix: entry.gateline_prefix,
        }),
      )
    }
    if (sources.length === 0) {
      warnings.push(`config at ${configPath} yielded no usable sources; falling back to current repo`)
      return fallbackToCwd(cwd, warnings, opts.push, opts.localOnly)
    }
    return { sources, configPath, warnings }
  }

  return fallbackToCwd(cwd, warnings, opts.push, opts.localOnly)
}

async function fallbackToCwd(cwd: string, warnings: string[], push?: boolean, localOnly?: boolean): Promise<LoadedConfig> {
  const top = await repoToplevel(cwd)
  if (top !== null) {
    const id = slugForPath(top)
    const resolved = await resolveMode({
      source: id,
      explicitLocalOnly: localOnly,
      explicitPush: push,
      cliTier: true,
      originExists: memoizedOriginExists(top),
    })
    return {
      sources: [new LocalGitSource(id, top, { push: resolved.push, localOnly: resolved.localOnly })],
      configPath: null,
      warnings,
    }
  }
  warnings.push(`${cwd} is not a git repository and no config exists at ${defaultConfigPath()}`)
  return { sources: [], configPath: null, warnings }
}
