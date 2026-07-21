// Multi-repo configuration: ~/.config/agentic/config.yaml lists sources;
// no config file → the current repo, zero setup (plan §2.2).
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { Git } from '../sources/git.ts'
import { LocalGitSource, readFileIfExists, repoToplevel } from '../sources/local-source.ts'
import type { RunSource } from '../sources/source.ts'

const sourceEntrySchema = z.object({
  name: z.string().optional(),
  path: z.string(),
  push: z.boolean().optional().default(false),
  /** Seconds between `git fetch`es of origin; unset = never poll. */
  fetch_interval: z.number().positive().optional(),
  /**
   * Override the `.agentic` default when this source was integrated with a
   * custom `integrate.py --prefix` (#94) — otherwise auto-detected.
   */
  agentic_prefix: z.string().optional(),
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
  return join(base, 'agentic', 'config.yaml')
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
   * — `false` honors an operator's explicit no-push ceiling (`agentic up
   * --no-push`). Config-file sources always keep their own `push` entry.
   */
  push?: boolean
}): Promise<LoadedConfig> {
  const warnings: string[] = []
  const cwd = opts.cwd ?? process.cwd()
  const pushFor = async (top: string) => opts.push ?? (await pushWhenOriginExists(top))

  if (opts.repoOverrides?.length) {
    const sources: RunSource[] = []
    for (const raw of opts.repoOverrides) {
      const path = isAbsolute(raw) ? raw : resolve(cwd, raw)
      const top = await repoToplevel(path)
      if (top === null) {
        warnings.push(`--repo ${raw}: not a git repository, skipped`)
        continue
      }
      sources.push(new LocalGitSource(slugForPath(top), top, { push: await pushFor(top) }))
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
      return fallbackToCwd(cwd, warnings, opts.push)
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
      sources.push(
        new LocalGitSource(id, path, {
          push: entry.push,
          fetchIntervalSeconds: entry.fetch_interval,
          frameworkPrefix: entry.agentic_prefix,
        }),
      )
    }
    if (sources.length === 0) {
      warnings.push(`config at ${configPath} yielded no usable sources; falling back to current repo`)
      return fallbackToCwd(cwd, warnings, opts.push)
    }
    return { sources, configPath, warnings }
  }

  return fallbackToCwd(cwd, warnings, opts.push)
}

async function fallbackToCwd(cwd: string, warnings: string[], push?: boolean): Promise<LoadedConfig> {
  const top = await repoToplevel(cwd)
  if (top !== null) {
    return {
      sources: [new LocalGitSource(slugForPath(top), top, { push: push ?? (await pushWhenOriginExists(top)) })],
      configPath: null,
      warnings,
    }
  }
  warnings.push(`${cwd} is not a git repository and no config exists at ${defaultConfigPath()}`)
  return { sources: [], configPath: null, warnings }
}
