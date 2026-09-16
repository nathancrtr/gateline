// Vendored-copy integration of the framework into a host repository: the
// mechanical half of docs/INTEGRATION.md.
//
// `init` copies the taken subset of the copy manifest into a host, seeds the
// project-owned layers, writes the lockfile, renders the adapter agents, and
// wires the render-staleness CI check. `validate` re-proves the static
// integration invariants. `fork` records a deliberate divergence of a core file
// before you edit it.
//
// What travels into a host is content — role specs, contracts, manifests — and
// never an executable. The tooling runs from the framework checkout the lock
// pins, which is the two-channel model of INTEGRATION.md §3.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { type CopyManifest, loadCopyManifest, offered, resolveTake } from './copy-manifest.ts'
import {
  type FrameworkLock,
  type Layout,
  LOCK_REQUIRED_FIELDS,
  type LockSource,
  lockPath,
  type ProvenanceMode,
  readLock,
  serialiseLock,
} from './lock.ts'
import { renderAll } from './render.ts'
import { FrameworkError } from './role.ts'
import { DEFAULT_FRAMEWORK_PREFIX } from './roots.ts'

const exec = promisify(execFile)

export const TOOL_VERSION = '0.2'
export const PROVENANCE_START = '<!-- gateline-framework-provenance:start -->'
export const PROVENANCE_END = '<!-- gateline-framework-provenance:end -->'
/** Where a host's CI checks out the framework to run the renderer. */
export const CI_FRAMEWORK_PATH = '.gateline-framework'
export const CI_WORKFLOW = '.github/workflows/gateline-render-check.yml'
const UPSTREAM_SLUG = 'nathancrtr/gateline'

/** The framework checkout this module is running from. */
export function frameworkRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Which runners the host already has. `--adapters` overrides; a host with none
 * detected is told what it defaulted to rather than left guessing.
 */
export async function detectAdapters(target: string): Promise<string[]> {
  const adapters: string[] = []
  const anyOf = async (...paths: string[]) => {
    for (const path of paths) if (await exists(join(target, path))) return true
    return false
  }
  if (await anyOf('.claude', 'CLAUDE.md')) adapters.push('claude-code')
  if (await anyOf(join('.github', 'agents'), join('.github', 'copilot-instructions.md'))) adapters.push('copilot-cli')
  return adapters
}

/** Pin the source: git metadata when available, placeholders otherwise. */
export async function sourceInfo(root: string): Promise<LockSource> {
  const info: LockSource = { repo: null, ref: 'unknown', version: 'unreleased' }
  const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args])).stdout.trim()
  try {
    info.ref = await git('rev-parse', 'HEAD')
  } catch {
    return info
  }
  try {
    const remote = await git('remote', 'get-url', 'origin')
    if (remote) info.repo = remote
  } catch {
    // no origin configured
  }
  try {
    const tag = await git('describe', '--tags', '--exact-match')
    if (tag) {
      info.ref = tag
      info.version = tag.replace(/^v/, '')
    }
  } catch {
    // not on a tag
  }
  return info
}

/** `owner/repo` for a GitHub remote in either URL form. */
export function repoSlug(remote: string | null): string {
  if (!remote) return UPSTREAM_SLUG
  const match = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(remote.trim())
  return match ? match[1]! : UPSTREAM_SLUG
}

function rolesIn(taken: string[]): string[] {
  return taken.filter((f) => f.startsWith('roles/')).map((f) => f.slice('roles/'.length).replace(/\.md$/, ''))
}

/**
 * Provenance in two modes (INTEGRATION.md §5). The managed NOTICE section is
 * idempotent: rewritten between its markers on every init, so a host that
 * re-inits does not accumulate stale copies.
 */
export async function writeProvenance(target: string, prefix: string, mode: ProvenanceMode, lockRel: string): Promise<void> {
  const prefixDir = join(target, prefix)
  const license = join(frameworkRoot(), 'LICENSE.md')
  if (await exists(license)) await copyFile(license, join(prefixDir, 'LICENSE.framework.md'))
  const section =
    mode === 'redistribute'
      ? `This repository includes files derived from the gateline framework,\n` +
        `licensed under the Apache License 2.0. The framework license text is\n` +
        `kept at ${prefix}/LICENSE.framework.md; the derived files are enumerated\n` +
        `in ${lockRel}.`
      : `This repository is private and does not redistribute. It contains\n` +
        `framework-derived files enumerated in ${lockRel}, used under the Apache\n` +
        `License 2.0; the framework license text is kept at\n` +
        `${prefix}/LICENSE.framework.md. No repo-root license applies to these files.`
  const block = `${PROVENANCE_START}\n${section}\n${PROVENANCE_END}`
  const noticePath = join(target, 'NOTICE.md')
  let text: string
  const current = await readFile(noticePath, 'utf8').catch(() => null)
  if (current === null) {
    text = `# NOTICE\n\n${block}\n`
  } else if (current.includes(PROVENANCE_START) && current.includes(PROVENANCE_END)) {
    const head = current.slice(0, current.indexOf(PROVENANCE_START))
    const tail = current.slice(current.indexOf(PROVENANCE_END) + PROVENANCE_END.length)
    text = head + block + tail
  } else {
    text = `${current.replace(/\s+$/, '')}\n\n${block}\n`
  }
  await writeFile(noticePath, text, 'utf8')
}

async function writePrefixReadme(prefixDir: string, source: LockSource): Promise<void> {
  const body =
    `# Framework metadata\n\n` +
    `This directory pins this repository's integration of the gateline\n` +
    `framework (source: ${source.repo ?? '<framework repo>'}, ref ${source.ref.slice(0, 12)}).\n` +
    `\`framework-lock.json\` is the authoritative record of what is framework core\n` +
    `versus instance-local; \`upstream/\` retains the pristine base of any recorded\n` +
    `fork. Do not edit core-layer copies in place — extend via \`overlays/\` or\n` +
    `record a fork: \`gateline fork <file> --reason "..."\`.\n\n` +
    `The framework's own tooling is not vendored here. Re-render with\n` +
    `\`gateline render\` from the framework checkout this lock pins\n` +
    `(INTEGRATION.md §3, the two-channel model).\n`
  await writeFile(join(prefixDir, 'README.md'), body, 'utf8')
}

/**
 * The host's render-staleness check. It pins the framework ref the lock
 * records and runs the renderer straight from that checkout, so the host needs
 * no install and no vendored executable. Managed: re-running init rewrites it,
 * because the ref it pins moves.
 */
export function renderCheckWorkflow(slug: string, ref: string, prefix: string): string {
  return (
    `name: gateline-render-check\n\n` +
    `# Managed by \`gateline init\` — re-running init rewrites this file, including\n` +
    `# the framework ref it pins below. Record changes in ${prefix}/framework-lock.json,\n` +
    `# not here. No install step: the renderer has no dependencies, by design\n` +
    `# (docs/INTEGRATION.md §8).\n\n` +
    `on: [push, pull_request]\n\n` +
    `jobs:\n` +
    `  render-check:\n` +
    `    runs-on: ubuntu-latest\n` +
    `    steps:\n` +
    `      - uses: actions/checkout@v4\n` +
    `      - uses: actions/checkout@v4\n` +
    `        with:\n` +
    `          repository: ${slug}\n` +
    `          ref: ${ref}\n` +
    `          path: ${CI_FRAMEWORK_PATH}\n` +
    `      - uses: actions/setup-node@v4\n` +
    `        with:\n` +
    `          node-version: 24\n` +
    `      - run: node ${CI_FRAMEWORK_PATH}/packages/framework/src/main.ts render --check .\n`
  )
}

export interface InitOptions {
  target: string
  provenance: ProvenanceMode
  take?: string
  layout?: Layout
  prefix?: string
  /** 'auto' probes the host; otherwise a comma-separated list. */
  adapters?: string
}

export interface InitResult {
  lock: FrameworkLock
  adapters: string[]
  /** Taken entries a newer manifest no longer offers; pruned from the lock. */
  retired: string[]
  notes: string[]
}

export async function init(options: InitOptions): Promise<InitResult> {
  const target = resolve(options.target)
  const layout: Layout = options.layout ?? 'prefixed'
  const prefix = options.prefix ?? DEFAULT_FRAMEWORK_PREFIX
  const source = frameworkRoot()
  const notes: string[] = []

  if (!(await isDirectory(target))) throw new FrameworkError(`target ${target} is not a directory`)
  if (!(await exists(join(target, '.git')))) notes.push(`${target} is not a git repository; proceeding anyway`)

  const prefixDir = join(target, prefix)
  const lockFile = lockPath(target, prefix)
  const oldLock = await readLock(lockFile)
  if (oldLock) {
    for (const key of ['layout', 'prefix'] as const) {
      const wanted = key === 'layout' ? layout : prefix
      if (oldLock[key] !== wanted) {
        throw new FrameworkError(
          `existing lock records ${key}=${oldLock[key]}; re-run with the same value or remove the lock deliberately`,
        )
      }
    }
  }

  const manifest = await loadCopyManifest(source)
  // A re-init keeps the subset this host chose; only a fresh one reads --take.
  let taken = oldLock ? oldLock.taken : resolveTake(manifest, options.take ?? 'all')
  const retired = taken.filter((rel) => !offered(manifest).includes(rel))
  if (retired.length) taken = taken.filter((rel) => !retired.includes(rel))
  const forks = oldLock ? oldLock.forks : {}
  const coreRoot = layout === 'prefixed' ? prefixDir : target

  const adapters = await resolveAdapters(options.adapters ?? 'auto', target, source, notes)

  await mkdir(prefixDir, { recursive: true })
  const { files, drifted } = await copyCore({ taken, coreRoot, target, source, oldLock, forks })
  if (drifted.length) {
    throw new FrameworkError(
      `core-layer files edited in place (lock checksum mismatch):\n  ${drifted.join('\n  ')}\n` +
        `Move the change to overlays/, or record each as a fork:\n` +
        `  gateline fork <file> --reason "..."\nthen re-run init.`,
    )
  }

  await seedProjectLayers({ coreRoot, source, adapters, taken, layout })
  await mkdir(join(coreRoot, 'runs', '000-integration'), { recursive: true })

  const info = await sourceInfo(source)
  await writeProvenance(target, prefix, options.provenance, posix.join(prefix, 'framework-lock.json'))
  await writePrefixReadme(prefixDir, info)
  const workflow = join(target, CI_WORKFLOW)
  await mkdir(dirname(workflow), { recursive: true })
  await writeFile(workflow, renderCheckWorkflow(repoSlug(info.repo), info.ref, prefix), 'utf8')

  await renderAll(coreRoot)

  const lock: FrameworkLock = {
    source: info,
    integrated_at: new Date().toISOString().slice(0, 10),
    method: `gateline v${TOOL_VERSION}`,
    adapters_rendered: adapters,
    taken,
    files,
    forks,
    instance_layer: oldLock ? oldLock.instance_layer : [],
    provenance_mode: options.provenance,
    layout,
    prefix,
  }
  await writeFile(lockFile, serialiseLock(lock), 'utf8')
  return { lock, adapters, retired, notes }
}

async function resolveAdapters(spec: string, target: string, source: string, notes: string[]): Promise<string[]> {
  let adapters =
    spec === 'auto'
      ? await detectAdapters(target)
      : spec
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
  if (!adapters.length) {
    adapters = ['claude-code']
    notes.push('no runner detected; defaulting to the claude-code adapter')
  }
  for (const adapter of adapters) {
    if (!(await exists(join(source, 'adapters', adapter, 'manifest.json')))) {
      throw new FrameworkError(`unknown adapter '${adapter}'`)
    }
  }
  return adapters
}

/**
 * The core layer: copy the taken subset. A drifted unforked copy is an error,
 * never silently clobbered; a recorded fork is never touched.
 */
async function copyCore(args: {
  taken: string[]
  coreRoot: string
  target: string
  source: string
  oldLock: FrameworkLock | null
  forks: Record<string, unknown>
}): Promise<{ files: Record<string, string>; drifted: string[] }> {
  const { taken, coreRoot, target, source, oldLock, forks } = args
  const files: Record<string, string> = {}
  const drifted: string[] = []
  for (const rel of taken) {
    const dest = join(coreRoot, rel)
    const hostRel = relative(target, dest).split(/[\\/]/).join('/')
    if (hostRel in forks) {
      files[hostRel] = oldLock?.files[hostRel] ?? ''
      continue
    }
    const recorded = oldLock?.files[hostRel]
    if (recorded && (await exists(dest)) && (await sha256(dest)) !== recorded) {
      drifted.push(hostRel)
      continue
    }
    await mkdir(dirname(dest), { recursive: true })
    const src = join(source, rel)
    if (resolve(src) !== resolve(dest)) await copyFile(src, dest)
    files[hostRel] = await sha256(dest)
  }
  return { files, drifted }
}

/** Seeded (template on first init, project-owned after) and project layers. */
async function seedProjectLayers(args: {
  coreRoot: string
  source: string
  adapters: string[]
  taken: string[]
  layout: Layout
}): Promise<void> {
  const { coreRoot, source, adapters, taken, layout } = args
  const registry = join(coreRoot, 'registry', 'models.yaml')
  if (!(await exists(registry))) {
    await mkdir(dirname(registry), { recursive: true })
    await copyFile(join(source, 'registry', 'models.yaml'), registry)
  }
  const roles = rolesIn(taken)
  for (const adapter of adapters) {
    const dest = join(coreRoot, 'adapters', adapter, 'manifest.json')
    if (await exists(dest)) continue
    await mkdir(dirname(dest), { recursive: true })
    // Parsed raw, not through the typed reader: the seeded copy must keep every
    // key the upstream manifest carries — `headless`, the `_comment_*` notes —
    // and only narrow `roles` to what this host took.
    const manifest = JSON.parse(await readFile(join(source, 'adapters', adapter, 'manifest.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const taken = (manifest.roles as string[]).filter((r) => roles.includes(r))
    if (roles.includes('integrator') && !taken.includes('integrator')) taken.push('integrator')
    manifest.roles = taken
    if (layout === 'prefixed') manifest.output_dir = `../${manifest.output_dir as string}`
    await writeFile(dest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }

  const overlays = join(coreRoot, 'overlays')
  await mkdir(overlays, { recursive: true })
  const stub = (who: string) =>
    `<!-- Project policy overlay. Non-comment content here is spliced into\n` +
    `     ${who} rendered agent(s) by the renderer. This is the ONLY writable\n` +
    `     policy surface: never edit core role copies in place. -->\n`
  for (const [name, who] of [['_all', 'every'], ...roles.map((r) => [r, `the ${r}`])] as [string, string][]) {
    const path = join(overlays, `${name}.md`)
    if (!(await exists(path))) await writeFile(path, stub(who), 'utf8')
  }
}

export interface ValidateResult {
  failures: string[]
  lock: FrameworkLock
}

export async function validate(targetDir: string, prefixHint?: string): Promise<ValidateResult> {
  const target = resolve(targetDir)
  const prefix = prefixHint ?? DEFAULT_FRAMEWORK_PREFIX
  const path = lockPath(target, prefix)
  const lock = await readLock(path)
  if (!lock) throw new FrameworkError(`no lock at ${path} — run init first (or pass the host repo path)`)
  const failures: string[] = []

  for (const key of LOCK_REQUIRED_FIELDS) {
    if (!(key in lock)) failures.push(`lock: missing required field '${key}'`)
  }
  if (lock.provenance_mode !== 'redistribute' && lock.provenance_mode !== 'private') {
    failures.push('lock: provenance_mode must be redistribute|private')
  }

  const prefixDir = join(target, lock.prefix ?? prefix)
  for (const [hostRel, checksum] of Object.entries(lock.files ?? {})) {
    if (lock.forks && hostRel in lock.forks) continue
    const file = join(target, hostRel)
    if (!(await exists(file))) failures.push(`missing core file: ${hostRel}`)
    else if ((await sha256(file)) !== checksum) failures.push(`edited in place: ${hostRel} (move to overlays/ or record a fork)`)
  }
  for (const [hostRel, fork] of Object.entries(lock.forks ?? {})) {
    const base = join(prefixDir, 'upstream', hostRel)
    if (!(await exists(base))) {
      failures.push(`fork ${hostRel}: retained upstream copy missing at ${relative(target, base).split(/[\\/]/).join('/')}`)
    } else if ((await sha256(base)) !== fork.base_sha256) {
      failures.push(`fork ${hostRel}: retained upstream copy no longer matches its recorded base`)
    }
  }

  const coreRoot = lock.layout === 'prefixed' ? prefixDir : target
  const { stale } = await renderAll(coreRoot, { check: true })
  if (stale.length) failures.push(`stale rendered agents (run: gateline render ${target})`)

  const notice = await readFile(join(target, 'NOTICE.md'), 'utf8').catch(() => null)
  if (notice === null || !notice.includes(PROVENANCE_START)) failures.push('provenance: NOTICE.md missing its framework section')
  if (!(await exists(join(prefixDir, 'LICENSE.framework.md')))) {
    failures.push(`provenance: ${lock.prefix ?? prefix}/LICENSE.framework.md missing`)
  }

  for (const role of rolesIn(lock.taken ?? [])) {
    const stub = await readFile(join(coreRoot, 'overlays', `${role}.md`), 'utf8').catch(() => null)
    if (stub === null || !stub.trim()) failures.push(`overlay stub missing or empty: overlays/${role}.md`)
  }

  return { failures, lock }
}

export async function fork(args: { target: string; file: string; reason: string; prefix?: string }): Promise<string> {
  const target = resolve(args.target)
  const prefix = args.prefix ?? DEFAULT_FRAMEWORK_PREFIX
  const path = lockPath(target, prefix)
  const lock = await readLock(path)
  if (!lock) throw new FrameworkError(`no lock at ${path} — run init first (or pass the host repo path)`)
  const hostRel = args.file
  if (!(hostRel in lock.files)) throw new FrameworkError(`${hostRel} is not a taken core-layer file in the lock`)
  if (hostRel in lock.forks) throw new FrameworkError(`${hostRel} is already recorded as a fork`)
  const file = join(target, hostRel)
  if ((await sha256(file)) !== lock.files[hostRel]) {
    throw new FrameworkError(`${hostRel} has already been edited; restore the pristine copy first, then fork, then re-apply your edit`)
  }
  const base = join(target, lock.prefix, 'upstream', hostRel)
  await mkdir(dirname(base), { recursive: true })
  await copyFile(file, base)
  lock.forks[hostRel] = { base_sha256: lock.files[hostRel]!, reason: args.reason, review_at_upgrade: true }
  await writeFile(path, serialiseLock(lock), 'utf8')
  return relative(target, base).split(/[\\/]/).join('/')
}

export type { CopyManifest }
