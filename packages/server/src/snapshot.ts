#!/usr/bin/env node
// The static demo snapshot generator (R1, ADR-6): drives `createApp`'s own
// routes in-process — no port, no listener — and writes every response body
// to a file tree a plain static host can serve. Nothing here may import
// `./main.ts` or `@hono/node-server`, and nothing here binds a port: that is
// what keeps this a script rather than a second server (R4).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalGitSource, parseRunState, type RunRef, type RunSource } from '@gateline/core'
import { generateFixtureRepo } from '@gateline/fixtures'
import type { Hono } from 'hono'
import { createApp } from './app.ts'
import { FIXTURE_SOURCE_ID, type RunDetailResponse, type RunsResponse } from './contract.ts'

/**
 * A `RunSource` over a `LocalGitSource` that lists only the runs whose
 * `state.yaml`, read at the *default branch*, parses with `phase: 'done'`
 * (ADR-3). Reading the default branch rather than walking every run branch
 * is deliberate: the requirement (R2) names the copy on the default branch,
 * and a branch that moved after its merge would otherwise be served at a
 * stale tip. Every member this class does not need to change simply
 * delegates to the inner source, so the wrapper cannot drift from whatever
 * `LocalGitSource` does elsewhere.
 */
export class DoneOnDefaultBranchSource implements RunSource {
  readonly id: string
  readonly templates: RunSource['templates']
  private readonly inner: LocalGitSource

  constructor(inner: LocalGitSource) {
    this.inner = inner
    this.id = inner.id
    this.templates = inner.templates
  }

  /**
   * Walks the default branch's `runs/` directory once, classifying every
   * slug found there as included (phase exactly `'done'`) or excluded (any
   * other phase, a `state.yaml` that fails the schema, or one that is
   * missing outright). Logged rather than silently dropped — an omission
   * from the demo is a fact worth seeing (ADR-3's consequence).
   */
  async survey(): Promise<{ included: string[]; excluded: { slug: string; reason: string }[] }> {
    const defaultBranch = await this.inner.git.defaultBranch()
    const { runs: runsRoot } = await this.inner.frameworkRoots()
    const slugs = await this.inner.git.lsTreeDirs(defaultBranch, runsRoot)

    const included: string[] = []
    const excluded: { slug: string; reason: string }[] = []
    for (const slug of slugs) {
      const raw = await this.inner.git.show(defaultBranch, `${runsRoot}/${slug}/state.yaml`)
      if (raw === null) {
        excluded.push({ slug, reason: 'no state.yaml' })
        continue
      }
      const { state, error } = parseRunState(raw)
      if (!state) {
        excluded.push({ slug, reason: `state.yaml unreadable: ${error}` })
        continue
      }
      if (state.phase !== 'done') {
        excluded.push({ slug, reason: `phase ${state.phase}` })
        continue
      }
      included.push(slug)
    }
    return { included, excluded }
  }

  async listRuns(): Promise<RunRef[]> {
    const { included } = await this.survey()
    const defaultBranch = await this.inner.git.defaultBranch()
    return included
      .map((slug): RunRef => ({ source: this.id, slug, ref: defaultBranch, kind: 'default', branch: `run/${slug}` }))
      .sort((a, b) => a.slug.localeCompare(b.slug))
  }

  // Everything below is a straight pass-through — the wrapper's only
  // opinion is which runs `listRuns`/`survey` name. Deliberately no `dir`
  // property: `/api/engine-health` skips any source without one, and this
  // wrapper has no local-only-safe engine heartbeat to report anyway.

  readState(ref: RunRef) {
    return this.inner.readState(ref)
  }

  listArtifacts(ref: RunRef): Promise<string[]> {
    return this.inner.listArtifacts(ref)
  }

  readArtifact(ref: RunRef, path: string): Promise<string | null> {
    return this.inner.readArtifact(ref, path)
  }

  readDiff(ref: RunRef): Promise<string> {
    return this.inner.readDiff(ref)
  }

  stateHistory(ref: RunRef) {
    return this.inner.stateHistory(ref)
  }

  runHistory(ref: RunRef) {
    return this.inner.runHistory(ref)
  }

  lastTouched(ref: RunRef, paths: string[]) {
    return this.inner.lastTouched(ref, paths)
  }

  lastTouchedExcept(ref: RunRef, excludePaths: string[]) {
    return this.inner.lastTouchedExcept(ref, excludePaths)
  }

  identity() {
    return this.inner.identity()
  }

  aheadOfOrigin(ref: RunRef) {
    return this.inner.aheadOfOrigin(ref)
  }

  behindOrigin(ref: RunRef) {
    return this.inner.behindOrigin(ref)
  }

  originUrl() {
    return this.inner.originUrl()
  }

  writeState(...args: Parameters<RunSource['writeState']>) {
    return this.inner.writeState(...args)
  }

  stageRun(...args: Parameters<RunSource['stageRun']>) {
    return this.inner.stageRun(...args)
  }
}

/** Global (run-independent) routes the demo snapshot writes (plan "Snapshot generator"). */
export const SNAPSHOT_GLOBAL_ROUTES = ['/api/health', '/api/engine-health', '/api/inbox', '/api/runs', '/api/staging', '/api/metrics'] as const

/** Per-run route suffixes, appended to `/api/runs/<src>/<slug>`. `''` is the detail route itself. */
export const SNAPSHOT_RUN_ROUTES = ['', '/lexicon', '/evidence', '/g1', '/reviews', '/decisions', '/diff'] as const

/** Route shells that get their own `index.html` copy, beside one per run at `runs/<src>/<slug>` (plan "Demo tree layout"). */
export const ROUTE_SHELLS = ['', 'portfolio', 'portfolio/new', 'metrics'] as const

export interface SnapshotReport {
  /** Every API route written, as the live path (no `.json` suffix, no leading `<outDir>`). */
  routes: string[]
  runs: { source: string; slug: string }[]
  /** Every shell path written (no trailing `/index.html`); `''` is the top-level shell. */
  shells: string[]
  excluded: { slug: string; reason: string }[]
}

/**
 * Builds the two sources the demo mounts (ADR-3, ADR-5): the real repo,
 * wrapped so only `done` runs on its default branch are visible, and a
 * freshly generated fixture repo, named by the shared `FIXTURE_SOURCE_ID`
 * the web client keys its "fixture data" label on. Both are `localOnly`
 * (plan "Snapshot generator") — this script never fetches or pushes.
 */
export async function buildDemoSources(opts: {
  repo: string
  repoId: string
}): Promise<{ sources: RunSource[]; fixtureDir: string; real: DoneOnDefaultBranchSource }> {
  const real = new DoneOnDefaultBranchSource(new LocalGitSource(opts.repoId, opts.repo, { localOnly: true }))
  const fixture = generateFixtureRepo()
  const fixtureSource = new LocalGitSource(FIXTURE_SOURCE_ID, fixture.dir, { localOnly: true })
  return { sources: [real, fixtureSource], fixtureDir: fixture.dir, real }
}

async function writeJson(outDir: string, route: string, text: string): Promise<void> {
  const filePath = join(outDir, `${route}.json`)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, text, 'utf8')
}

async function writeShell(outDir: string, shell: string, html: string): Promise<void> {
  const filePath = join(outDir, shell, 'index.html')
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, html, 'utf8')
}

/**
 * Dispatches every GET the demo needs through `app.request` (in-process — no
 * port, R1) and writes the whole static tree (plan "Demo tree layout"):
 * global routes, every run's detail + suffix routes, one file per artifact
 * that run's own detail response lists, the copied web bundle, and one
 * `index.html` shell per route so a fresh deep link resolves on a plain
 * static host (R6).
 */
export async function writeSnapshot(
  app: Hono,
  opts: { outDir: string; webDist?: string; excluded?: SnapshotReport['excluded'] },
): Promise<SnapshotReport> {
  const routes: string[] = []
  const runs: { source: string; slug: string }[] = []
  const shells: string[] = []

  const fetchRoute = async (route: string) => {
    const res = await app.request(route)
    if (!res.ok) throw new Error(`${route} → ${res.status}`)
    return res.text()
  }

  const writeRoute = async (route: string): Promise<string> => {
    const text = await fetchRoute(route)
    await writeJson(opts.outDir, route, text)
    routes.push(route)
    return text
  }

  let runsBody: RunsResponse | null = null
  for (const route of SNAPSHOT_GLOBAL_ROUTES) {
    const text = await writeRoute(route)
    if (route === '/api/runs') runsBody = JSON.parse(text) as RunsResponse
  }
  if (!runsBody) throw new Error('/api/runs → no body (unreachable: it is in SNAPSHOT_GLOBAL_ROUTES)')

  for (const run of runsBody.runs) {
    runs.push({ source: run.source, slug: run.slug })
    let detail: RunDetailResponse | null = null
    for (const suffix of SNAPSHOT_RUN_ROUTES) {
      const route = `/api/runs/${run.source}/${run.slug}${suffix}`
      const text = await writeRoute(route)
      if (suffix === '') detail = JSON.parse(text) as RunDetailResponse
    }
    if (!detail) throw new Error(`unreachable: '' is in SNAPSHOT_RUN_ROUTES for ${run.source}/${run.slug}`)

    // The path form of the artifact route (ADR-2): the request encodes each
    // path segment (so a path holding `/`, `?`, or other reserved bytes still
    // resolves), while the file the artifact lands at keeps the literal,
    // decoded run-relative path — matching the demo tree layout and the
    // artifact's own identity, not its URL encoding.
    for (const path of detail.artifacts) {
      const encoded = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const text = await fetchRoute(`/api/runs/${run.source}/${run.slug}/artifact/${encoded}`)
      const fileRoute = `/api/runs/${run.source}/${run.slug}/artifact/${path}`
      await writeJson(opts.outDir, fileRoute, text)
      routes.push(fileRoute)
    }
  }

  if (opts.webDist) {
    await cp(opts.webDist, opts.outDir, { recursive: true })
    const indexHtml = await readFile(join(opts.webDist, 'index.html'), 'utf8')
    // The copy above already covers the empty shell (`<outDir>/index.html`).
    shells.push('')
    for (const shell of ROUTE_SHELLS) {
      if (shell === '') continue
      await writeShell(opts.outDir, shell, indexHtml)
      shells.push(shell)
    }
    for (const run of runsBody.runs) {
      const shell = `runs/${run.source}/${run.slug}`
      await writeShell(opts.outDir, shell, indexHtml)
      shells.push(shell)
    }
  }

  return { routes, runs, shells, excluded: opts.excluded ?? [] }
}

// Direct invocation: node src/snapshot.ts --repo <path> --out <dir> [--repo-id gateline] [--web-dist <dir>]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const usage = 'usage: node src/snapshot.ts --repo <path> --out <dir> [--repo-id gateline] [--web-dist <dir>]'

  const run = async () => {
    let repo: string | undefined
    let out: string | undefined
    let repoId = 'gateline'
    let webDist: string | undefined
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!
      // A flag with no following argument (a trailing `--repo-id`, say) must
      // fail here, not construct a source with `id === undefined` and fail a
      // minute later on an unrelated route (review-02 F3) — same for a flag
      // this parser has never heard of.
      const value = (): string => {
        const v = args[++i]
        if (v === undefined) throw new Error(usage)
        return v
      }
      if (a === '--repo') repo = value()
      else if (a === '--out') out = value()
      else if (a === '--repo-id') repoId = value()
      else if (a === '--web-dist') webDist = value()
      else throw new Error(usage)
    }
    if (!repo || !out) throw new Error(usage)
    const { sources, fixtureDir, real } = await buildDemoSources({ repo, repoId })
    try {
      const app = createApp({ sources })
      const { excluded } = await real.survey()
      const report = await writeSnapshot(app, { outDir: out, webDist, excluded })
      for (const { slug, reason } of report.excluded) console.error(`excluded ${slug}: ${reason}`)
      const bySource = new Map<string, number>()
      for (const r of report.runs) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
      const runsSummary = [...bySource.entries()].map(([source, count]) => `${source}: ${count}`).join(', ')
      console.log(`snapshot: ${report.routes.length} routes, ${report.runs.length} runs (${runsSummary}), ${report.shells.length} shells`)
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  }

  run().catch((e) => {
    console.error((e as Error).message)
    process.exit(1)
  })
}
