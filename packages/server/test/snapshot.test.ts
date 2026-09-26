// Snapshot generator tests (plan "Snapshot generator", ADR-1/ADR-3/ADR-6):
// exercised fixture-based, like app.test.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { FIXTURE_SOURCE_ID } from '../src/contract.ts'
import {
  buildDemoSources,
  DoneOnDefaultBranchSource,
  ROUTE_SHELLS,
  SNAPSHOT_GLOBAL_ROUTES,
  SNAPSHOT_RUN_ROUTES,
  type SnapshotReport,
  writeSnapshot,
} from '../src/snapshot.ts'

// The "real" repo the wrapper sits over — a fixture repo used as a stand-in
// for a real clone, since only its shape (one `done` run on `main`, plus
// branch-only runs at other phases) matters here, not its provenance.
let realRepo: FixtureRepo
// The fixture repo mounted as the `fixture` source, unwrapped — every run it
// produces should show up verbatim.
let demoFixture: FixtureRepo
let wrapped: DoneOnDefaultBranchSource
let fixtureSource: LocalGitSource
let app: Hono

let outDir: string
let webDist: string
let report: SnapshotReport
// Ad-hoc mkdtemp dirs individual `it`s create for a one-off writeSnapshot
// pass (not the shared `outDir`/`webDist` above) — swept in `afterAll` too.
const extraTempDirs: string[] = []

// Two full fixture repos plus a real writeSnapshot pass over every route of
// every run (16 runs × 7 suffixes, plus artifacts) is inherently a lot of git
// subprocesses — comfortably under the default 30s hookTimeout in isolation,
// but not when the suite's other files are sharing the same 4-fork pool
// (#227). An explicit timeout here, not a global config change, keeps that
// slack local to the one file that needs it.
beforeAll(async () => {
  realRepo = generateFixtureRepo()
  demoFixture = generateFixtureRepo()

  // The fixture repo's main carries exactly one run (`done-merged`), so the
  // phase filter the wrapper exists to enforce (R2/ADR-3) has nothing else to
  // discriminate against by default (review-02 F1). Commit four more run
  // directories straight onto the stand-in's main: a second schema-valid
  // `done` run, a schema-valid run at another phase, a `state.yaml` that
  // isn't valid YAML, and a run directory with no `state.yaml` at all — one
  // sibling per branch `survey()` classifies. Reusing `done-merged`'s own
  // state.yaml text for the two schema-valid siblings (rather than
  // hand-writing new documents) keeps every field but the ones under test
  // identical to what the wrapper already sees passing.
  const gitReal = (args: string[]) => execFileSync('git', ['-C', realRepo.dir, ...args], { encoding: 'utf8' })
  const writeReal = (relPath: string, content: string) => {
    mkdirSync(join(realRepo.dir, dirname(relPath)), { recursive: true })
    writeFileSync(join(realRepo.dir, relPath), content, 'utf8')
  }
  const doneState = readFileSync(join(realRepo.dir, 'runs/done-merged/state.yaml'), 'utf8')
  writeReal('runs/aaa-second-done/state.yaml', doneState.replaceAll('done-merged', 'aaa-second-done'))
  writeReal(
    'runs/zzz-wrong-phase/state.yaml',
    doneState.replaceAll('done-merged', 'zzz-wrong-phase').replace('phase: done ', 'phase: release '),
  )
  writeReal('runs/bad-yaml-state/state.yaml', 'phase: [unterminated\n')
  writeReal('runs/no-state-run/intent-brief.md', '# Intent Brief: no state.yaml here\n')
  // F5: a real artifact whose name needs percent-encoding, so the request's
  // encoded path segment and the file's decoded name can diverge in the
  // assertions below — every artifact `generateFixtureRepo()` ships otherwise
  // is plain ASCII with no byte `encodeURIComponent` touches.
  writeReal('runs/done-merged/notes with space #1.md', '# encoded-name artifact\n')
  gitReal(['add', '-A'])
  gitReal(['commit', '-q', '-m', 'test: add phase-classification and encoded-name fixtures'])

  wrapped = new DoneOnDefaultBranchSource(new LocalGitSource('gateline', realRepo.dir, { localOnly: true }))
  fixtureSource = new LocalGitSource(FIXTURE_SOURCE_ID, demoFixture.dir, { localOnly: true })
  app = createApp({ sources: [wrapped, fixtureSource] })

  outDir = mkdtempSync(join(tmpdir(), 'gateline-snapshot-out-'))
  webDist = mkdtempSync(join(tmpdir(), 'gateline-snapshot-webdist-'))
  writeFileSync(join(webDist, 'index.html'), '<html><body>demo shell</body></html>', 'utf8')
  await mkdir(join(webDist, 'assets'), { recursive: true })
  writeFileSync(join(webDist, 'assets', 'x.js'), 'console.log("demo")\n', 'utf8')

  report = await writeSnapshot(app, { outDir, webDist })
}, 180_000)

afterAll(async () => {
  await Promise.all(
    [realRepo?.dir, demoFixture?.dir, outDir, webDist, ...extraTempDirs]
      .filter((d): d is string => !!d)
      .map((d) => rm(d, { recursive: true, force: true })),
  )
})

describe('DoneOnDefaultBranchSource (ADR-3)', () => {
  it('lists exactly the done runs on the default branch, sorted by slug', async () => {
    const runs = await wrapped.listRuns()
    expect(runs.map((r) => r.slug)).toEqual(['aaa-second-done', 'done-merged'])
    expect(runs[0]).toMatchObject({ source: 'gateline', slug: 'aaa-second-done', ref: 'main', kind: 'default', branch: 'run/aaa-second-done' })
    expect(runs[1]).toMatchObject({ source: 'gateline', slug: 'done-merged', ref: 'main', kind: 'default', branch: 'run/done-merged' })
  })

  it('excludes a wrong-phase run, an unparseable state.yaml, and a run with no state.yaml — each with its own reason', async () => {
    const { included, excluded } = await wrapped.survey()
    expect(included).toEqual(['aaa-second-done', 'done-merged'])
    const reasonBySlug = Object.fromEntries(excluded.map((e) => [e.slug, e.reason]))
    expect(excluded).toHaveLength(3)
    expect(reasonBySlug).toEqual({
      'zzz-wrong-phase': 'phase release',
      'bad-yaml-state': expect.stringMatching(/^state\.yaml unreadable: /),
      'no-state-run': 'no state.yaml',
    })
  })

  it('delegates every other RunSource member to the inner source', async () => {
    const [ref] = await wrapped.listRuns()
    const { state } = await wrapped.readState(ref!)
    expect(state?.phase).toBe('done')
    expect(await wrapped.identity()).toEqual(await new LocalGitSource('gateline', realRepo.dir, { localOnly: true }).identity())
    // localOnly on the inner source means no origin, delegated verbatim.
    expect(await wrapped.originUrl?.()).toBeNull()
    expect(await wrapped.aheadOfOrigin?.(ref!)).toBeNull()
    expect(await wrapped.behindOrigin?.(ref!)).toBeNull()
  })

  it('exposes no dir property, so /api/engine-health skips it', () => {
    expect((wrapped as unknown as { dir?: string }).dir).toBeUndefined()
  })
})

describe('buildDemoSources', () => {
  it('wraps the real repo, names the fixture source FIXTURE_SOURCE_ID, and marks both local-only', async () => {
    const built = await buildDemoSources({ repo: realRepo.dir, repoId: 'gateline' })
    try {
      expect(built.real).toBeInstanceOf(DoneOnDefaultBranchSource)
      expect(built.sources.map((s) => s.id)).toEqual(['gateline', FIXTURE_SOURCE_ID])
      const fixtureRuns = await built.sources[1]!.listRuns()
      expect(fixtureRuns.length).toBeGreaterThan(0)
    } finally {
      await rm(built.fixtureDir, { recursive: true, force: true })
    }
  })
})

describe('route/shell constants match the plan’s "Snapshot generator" contract', () => {
  // Each asserted against the plan's own literal list, not against itself —
  // a route dropped from the export would otherwise pass every other test in
  // this file, since the loops below all iterate the export (review-02 F2).
  it('SNAPSHOT_GLOBAL_ROUTES is exactly the plan’s six global routes', () => {
    expect(SNAPSHOT_GLOBAL_ROUTES).toEqual(['/api/health', '/api/engine-health', '/api/inbox', '/api/runs', '/api/staging', '/api/metrics'])
  })

  it('SNAPSHOT_RUN_ROUTES is exactly the plan’s seven per-run suffixes', () => {
    expect(SNAPSHOT_RUN_ROUTES).toEqual(['', '/lexicon', '/evidence', '/g1', '/reviews', '/decisions', '/diff'])
  })

  it('ROUTE_SHELLS is exactly the plan’s four fixed shells', () => {
    expect(ROUTE_SHELLS).toEqual(['', 'portfolio', 'portfolio/new', 'metrics'])
  })
})

describe('writeSnapshot', () => {
  it('writes a file for every global route', () => {
    for (const route of SNAPSHOT_GLOBAL_ROUTES) {
      expect(existsSync(join(outDir, `${route}.json`))).toBe(true)
      const parsed = JSON.parse(readFileSync(join(outDir, `${route}.json`), 'utf8'))
      expect(parsed).toBeTruthy()
    }
  })

  it('runs.json lists exactly the wrapped source’s done runs plus every fixture run, and nothing else', () => {
    const runsJson = JSON.parse(readFileSync(join(outDir, 'api/runs.json'), 'utf8')) as { runs: { source: string; slug: string }[] }
    const actual = runsJson.runs.map((r) => `${r.source}/${r.slug}`).sort()
    const expected = [
      'gateline/aaa-second-done',
      'gateline/done-merged',
      ...demoFixture.runs.map((r) => `${FIXTURE_SOURCE_ID}/${r.slug}`),
    ].sort()
    expect(actual).toEqual(expected)
    expect(report.runs.map((r) => `${r.source}/${r.slug}`).sort()).toEqual(expected)
  })

  it('writes every per-run route for every run in runs.json, and it parses as JSON', () => {
    for (const run of report.runs) {
      for (const suffix of SNAPSHOT_RUN_ROUTES) {
        const path = join(outDir, `api/runs/${run.source}/${run.slug}${suffix}.json`)
        expect(existsSync(path)).toBe(true)
        const parsed = JSON.parse(readFileSync(path, 'utf8'))
        expect(parsed).toBeTruthy()
      }
    }
  })

  it('writes one artifact/<path>.json per artifact in the detail response, matching the live route body', async () => {
    const detail = JSON.parse(readFileSync(join(outDir, 'api/runs/gateline/done-merged.json'), 'utf8')) as { artifacts: string[] }
    expect(detail.artifacts.length).toBeGreaterThan(0)
    for (const path of detail.artifacts) {
      const filePath = join(outDir, `api/runs/gateline/done-merged/artifact/${path}.json`)
      expect(existsSync(filePath)).toBe(true)
      const written = JSON.parse(readFileSync(filePath, 'utf8'))
      const encoded = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const live = await app.request(`/api/runs/gateline/done-merged/artifact/${encoded}`)
      expect(live.status).toBe(200)
      expect(await live.json()).toEqual(written)
    }
  })

  it('writes one artifact/<path>.json for every artifact of a fixture run too', async () => {
    const detail = JSON.parse(readFileSync(join(outDir, `api/runs/${FIXTURE_SOURCE_ID}/g2-pending.json`), 'utf8')) as {
      artifacts: string[]
    }
    expect(detail.artifacts.length).toBeGreaterThan(0)
    for (const path of detail.artifacts) {
      const filePath = join(outDir, `api/runs/${FIXTURE_SOURCE_ID}/g2-pending/artifact/${path}.json`)
      expect(existsSync(filePath)).toBe(true)
    }
  })

  it('shells exist for the fixed route set and for runs/<src>/<slug> per run', () => {
    for (const shell of ROUTE_SHELLS) {
      expect(existsSync(join(outDir, shell, 'index.html'))).toBe(true)
    }
    expect(existsSync(join(outDir, `runs/${FIXTURE_SOURCE_ID}/g2-pending/index.html`))).toBe(true)
    for (const run of report.runs) {
      expect(existsSync(join(outDir, `runs/${run.source}/${run.slug}/index.html`))).toBe(true)
    }
  })

  it('copied the web bundle recursively', () => {
    expect(existsSync(join(outDir, 'assets/x.js'))).toBe(true)
    expect(readFileSync(join(outDir, 'assets/x.js'), 'utf8')).toBe('console.log("demo")\n')
    // The copy covers the top-level shell; writeSnapshot must not clobber it
    // with a second, blanker index.html.
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('<html><body>demo shell</body></html>')
  })

  it('returns excluded verbatim from the caller', async () => {
    // A minimal stub app (no runs) rather than the full fixture `app`: this
    // only checks that `excluded` passes through, so it should not pay for a
    // second full writeSnapshot pass over every route of every run.
    const stub = new Hono()
    for (const route of SNAPSHOT_GLOBAL_ROUTES) {
      stub.get(route, (c) => c.json(route === '/api/runs' ? { runs: [], now: 0 } : {}))
    }
    const out2 = mkdtempSync(join(tmpdir(), 'gateline-snapshot-out2-'))
    extraTempDirs.push(out2)
    const rep = await writeSnapshot(stub, {
      outDir: out2,
      excluded: [{ slug: 'x', reason: 'phase spec' }],
    })
    expect(rep.excluded).toEqual([{ slug: 'x', reason: 'phase spec' }])
    expect(rep.runs).toEqual([])
  })

  it('throws naming the route and status on a non-2xx response', async () => {
    const empty = new Hono() // no routes registered → every request 404s
    const failOut = mkdtempSync(join(tmpdir(), 'gateline-snapshot-fail-'))
    extraTempDirs.push(failOut)
    await expect(writeSnapshot(empty, { outDir: failOut })).rejects.toThrow('/api/health → 404')
  })
})

describe('static-by-construction guards (R1, R4)', () => {
  it('the module’s own source text contains neither serve( nor .listen(', () => {
    const src = readFileSync(new URL('../src/snapshot.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/serve\(/)
    expect(src).not.toMatch(/\.listen\(/)
  })

  it('is not registered under packages/cli — no file under packages/cli/src mentions "snapshot"', () => {
    const cliSrc = resolve(import.meta.dirname, '../../cli/src')
    const walk = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true })
      return entries.flatMap((entry) => {
        const child = join(dir, entry.name)
        return entry.isDirectory() ? walk(child) : [child]
      })
    }
    const files = walk(cliSrc)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text.toLowerCase()).not.toContain('snapshot')
    }
  })
})
