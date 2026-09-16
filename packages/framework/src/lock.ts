// framework-lock.json — the authoritative record of what a host repository
// took from the framework, at which version, and what it has since diverged on
// (docs/INTEGRATION.md §3). The schema is normative there and ships as
// scripts/framework-lock.schema.json; this module is what writes conforming
// files and reads back the ones two hand-built hosts wrote before the tool
// existed.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FrameworkError } from './role.ts'

export type ProvenanceMode = 'redistribute' | 'private'
export type Layout = 'prefixed' | 'root'

export interface LockSource {
  /** Framework repo URL or slug; null when init ran with no git metadata. */
  repo: string | null
  /** Pinned ref: a release tag once releases exist, a bare commit before. */
  ref: string
  /** Framework version string; 'unreleased' before the first tag. */
  version: string
}

export interface LockFork {
  base_sha256: string
  reason: string
  review_at_upgrade: boolean
}

export interface FrameworkLock {
  source: LockSource
  integrated_at: string
  method: string
  adapters_rendered: string[]
  /** The copy-manifest subset this host adopted, manifest-relative. */
  taken: string[]
  /** sha256 of every taken core-layer file, keyed host-relative. */
  files: Record<string, string>
  forks: Record<string, LockFork>
  instance_layer: string[]
  provenance_mode: ProvenanceMode
  layout: Layout
  prefix: string
}

export const LOCK_FILENAME = 'framework-lock.json'

export function lockPath(target: string, prefix: string): string {
  return join(target, prefix, LOCK_FILENAME)
}

export async function readLock(path: string): Promise<FrameworkLock | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw) as FrameworkLock
  } catch (e) {
    throw new FrameworkError(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function serialiseLock(lock: FrameworkLock): string {
  // Key order is the schema's field order, so a lock diffs cleanly across
  // versions of the tool rather than reshuffling on every write.
  const ordered: FrameworkLock = {
    source: lock.source,
    integrated_at: lock.integrated_at,
    method: lock.method,
    adapters_rendered: lock.adapters_rendered,
    taken: lock.taken,
    files: lock.files,
    forks: lock.forks,
    instance_layer: lock.instance_layer,
    provenance_mode: lock.provenance_mode,
    layout: lock.layout,
    prefix: lock.prefix,
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/**
 * The fields every conforming lock carries. Kept beside the type rather than
 * read out of the JSON Schema at runtime: the schema is the normative document
 * for readers, this is the check, and the test holds them to each other.
 */
export const LOCK_REQUIRED_FIELDS = [
  'source',
  'integrated_at',
  'method',
  'adapters_rendered',
  'taken',
  'files',
  'forks',
  'instance_layer',
  'provenance_mode',
  'layout',
  'prefix',
] as const
