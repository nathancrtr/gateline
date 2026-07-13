// Multi-repo configuration: ~/.config/agentic/config.yaml lists sources;
// no config file → the current repo, zero setup (plan §2.2).
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { LocalGitSource, readFileIfExists, repoToplevel } from './local-source.ts'
import type { RunSource } from './source.ts'

const sourceEntrySchema = z.object({
  name: z.string().optional(),
  path: z.string(),
  push: z.boolean().optional().default(false),
  fetch_interval: z.number().optional(),
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
 * Resolve sources in precedence order: explicit --repo paths, then the config
 * file, then the cwd's repository.
 */
export async function loadSources(opts: {
  repoOverrides?: string[]
  configPath?: string
  cwd?: string
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
      sources.push(new LocalGitSource(slugForPath(top), top))
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
      return fallbackToCwd(cwd, warnings)
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
      sources.push(new LocalGitSource(id, top, { push: entry.push }))
    }
    if (sources.length === 0) {
      warnings.push(`config at ${configPath} yielded no usable sources; falling back to current repo`)
      return fallbackToCwd(cwd, warnings)
    }
    return { sources, configPath, warnings }
  }

  return fallbackToCwd(cwd, warnings)
}

async function fallbackToCwd(cwd: string, warnings: string[]): Promise<LoadedConfig> {
  const top = await repoToplevel(cwd)
  if (top !== null) {
    return { sources: [new LocalGitSource(slugForPath(top), top)], configPath: null, warnings }
  }
  warnings.push(`${cwd} is not a git repository and no config exists at ${defaultConfigPath()}`)
  return { sources: [], configPath: null, warnings }
}
