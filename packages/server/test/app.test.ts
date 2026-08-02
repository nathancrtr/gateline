// Route tests over the fixture source (plan §9).
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo, type FixtureRepo } from '@gateline/fixtures'
import { LocalGitSource, parseRunState, SLUG_PATTERN, validateArtifact, writeEngineHealth } from '@gateline/core'
import type { Hono } from 'hono'
import { createApp } from '../src/app.ts'

let fixture: FixtureRepo
let source: LocalGitSource
let app: Hono

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = async (path: string) => {
  const res = await app.request(path)
  return { status: res.status, body: (await res.json()) as any }
}

const postJson = async (path: string, payload: object) => {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: (await res.json()) as any }
}

// smoke.spec's idiom: read committed content back through plumbing rather
// than the checkout, so a staged branch is asserted the same way a human
// operator would inspect it.
const git = (args: string[]) => execFileSync('git', ['-C', fixture.dir, ...args], { encoding: 'utf8' })

const branchExists = (branch: string): boolean => {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

// The full required-section set (fixture's built-in intent-brief.md
// template), filled with placeholder prose — a stand-in for what the web
// form assembles client-side (ADR-5); these tests exercise the server half.
const fullBrief = (title: string) => `# Intent Brief: ${title}

## Problem
Something needs fixing.

## Motivation
It saves time.

## Constraints
None known.

## Out of scope
Everything else.
`

beforeAll(() => {
  fixture = generateFixtureRepo()
  source = new LocalGitSource('fixture', fixture.dir)
  app = createApp({ sources: [source] })
})
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('read routes', () => {
  it('GET /api/inbox returns age-ranked items, oldest first', async () => {
    const { status, body } = await get('/api/inbox')
    expect(status).toBe(200)
    expect(body.items.length).toBeGreaterThanOrEqual(8)
    expect(body.items[0].slug).toBe('escalated')
    const ages = body.items.map((i: { since: number | null }) => i.since ?? Infinity)
    expect([...ages].sort((a, b) => a - b)).toEqual(ages)
  })

  it('GET /api/runs returns the portfolio', async () => {
    const { status, body } = await get('/api/runs')
    expect(status).toBe(200)
    expect(body.runs).toHaveLength(15)
    const done = body.runs.find((r: { slug: string }) => r.slug === 'done-merged')
    expect(done.phase).toBe('done')
    expect(done.needsHuman).toBe(0)
  })

  it('GET /api/runs/:src/:slug returns state, readiness, artifacts, history', async () => {
    const { status, body } = await get('/api/runs/fixture/g2-pending')
    expect(status).toBe(200)
    expect(body.summary.phase).toBe('implement')
    expect(body.items[0]).toMatchObject({ kind: 'gate', gate: 'G2', reviewable: true })
    expect(body.artifacts).toContain('verification-report.md')
    expect(body.history.length).toBeGreaterThan(0)
    expect(body.stateRaw).toContain('# a gate entry is written ONLY by the named human')
  })

  it('404s an unknown run', async () => {
    expect((await get('/api/runs/fixture/nope')).status).toBe(404)
  })

  it('GET artifact returns content plus its validation', async () => {
    const { status, body } = await get('/api/runs/fixture/malformed-spec/artifact?path=spec.md')
    expect(status).toBe(200)
    expect(body.validation.ok).toBe(false)
    expect(body.validation.missing).toContain('Requirements')
  })

  it('GET lexicon returns verbatim definitions plus the id grammar as data', async () => {
    const { status, body } = await get('/api/runs/fixture/g2-pending/lexicon')
    expect(status).toBe(200)
    const r1 = body.entries.find((e: { id: string }) => e.id === 'R1')
    expect(r1).toMatchObject({ kind: 'requirement', shortName: 'Core behavior', artifact: 'spec.md' })
    expect(r1.definition).toContain('### R1 — Core behavior')
    expect(r1.body).toBe('The tool reads sample input and emits the documented output, end to end.')
    expect(body.entries.find((e: { id: string }) => e.id === 'AC2.1')?.kind).toBe('criterion')
    expect(body.entries.find((e: { id: string }) => e.id === 'ADR-1')).toMatchObject({ kind: 'decision', artifact: 'plan.md' })
    expect('cites AC10.2 and ADR-3'.match(new RegExp(body.pattern, 'g'))).toEqual(['AC10.2', 'ADR-3'])
  })

  it('GET evidence returns presence per criterion with verbatim report quotes', async () => {
    const { status, body } = await get('/api/runs/fixture/g2-pending/evidence')
    expect(status).toBe(200)
    expect(body.hasVerification).toBe(true)
    const ac11 = body.criteria.find((c: { id: string }) => c.id === 'AC1.1')
    expect(ac11.evidence[0]).toMatchObject({ artifact: 'verification-report.md', label: 'E1' })
    expect(ac11.result).toEqual({ verdict: 'verified', evidence: 'see E1' })
    const ac22 = body.criteria.find((c: { id: string }) => c.id === 'AC2.2')
    expect(ac22.evidence).toEqual([])
    expect(ac22.result).toBeNull()
    expect(ac22.gap).toContain('no oversized sample')
  })

  it('GET g1 returns coverage against the plan’s mapping and the surface overlaps (#255)', async () => {
    const { status, body } = await get('/api/runs/fixture/g1-pending/g1')
    expect(status).toBe(200)
    expect(body.mappingWithheld).toBeNull()
    expect(body.tasksWithheld).toBeNull()
    // Every requirement the spec defines has a row; R3 is in no mapping row.
    expect(body.coverage.map((r: { id: string }) => r.id)).toEqual(['R1', 'R2', 'R3'])
    expect(body.coverage.find((r: { id: string }) => r.id === 'R3').mapped).toEqual([])
    expect(body.coverage.find((r: { id: string }) => r.id === 'R1').mapped).toEqual(['01-core'])
    // The pair nothing orders leads; the pair depends_on orders is marked, not dropped.
    expect(body.overlaps[0]).toMatchObject({ a: '01-core', b: '02-errors', ordered: false })
    expect(body.overlaps.find((o: { b: string }) => o.b === '03-cli')).toMatchObject({ ordered: true })
    expect(body.unmappedTasks).toEqual(['03-cli'])
  })

  it('GET g1 withholds both halves on a run with no plan and no tasks (#255)', async () => {
    const { body } = await get('/api/runs/fixture/g0-pending/g1')
    expect(body.mappingWithheld).toContain('no `plan.md`')
    expect(body.tasksWithheld).toContain('no `tasks/*.yaml`')
    expect(body.overlaps).toEqual([])
  })

  it('GET diff returns parsed hunks for a branch run and merged flag for done', async () => {
    const branch = await get('/api/runs/fixture/g2-pending/diff')
    expect(branch.status).toBe(200)
    const paths = branch.body.files.map((f: { newPath: string }) => f.newPath)
    expect(paths).toContain('src/core.py')
    expect(paths.every((p: string) => !p.startsWith('runs/'))).toBe(true)

    const merged = await get('/api/runs/fixture/done-merged/diff')
    expect(merged.body.merged).toBe(true)
    expect(merged.body.files).toHaveLength(0)
  })

  it('GET diff labels each changed file with the work item that declared it (#270)', async () => {
    const { body } = await get('/api/runs/fixture/g2-pending/diff')
    expect(body.surface.withheld).toBeNull()
    expect(body.surface.items.map((i: { id: string }) => i.id)).toEqual(['01-core', '02-errors'])
    // Positional against `files`, which stays the whole diff — the labelling
    // never filters it, so the two arrays are the same length.
    expect(body.surface.declaredBy).toHaveLength(body.files.length)

    const labelled = Object.fromEntries(
      body.files.map((f: { newPath: string }, i: number) => [f.newPath, body.surface.declaredBy[i]]),
    )
    expect(labelled['src/core.py']).toEqual(['01-core'])
    expect(labelled['src/errors.py']).toEqual(['02-errors'])
    // The boundary case the fixture carries on purpose: touched, declared by
    // nobody. The route states it; judging it is the approver's.
    expect(labelled['src/config.py']).toEqual([])
  })

  it('GET diff withholds the labelling for a run with no task set, keeping the diff (#270)', async () => {
    const { body } = await get('/api/runs/fixture/g0-pending/diff')
    expect(body.surface.withheld).toContain('no work item declares a file-contact surface')
    expect(body.surface.items).toEqual([])
    expect(body.surface.declaredBy).toHaveLength(body.files.length)
  })

  it('GET /api/staging serves the fixture source config and the slug grammar', async () => {
    const { status, body } = await get('/api/staging')
    expect(status).toBe(200)
    expect(body.sources).toHaveLength(1)
    const src = body.sources[0]
    expect(src.id).toBe('fixture')
    expect(src.identity).toEqual({ name: 'Fixture Operator', email: 'operator@example.test' })
    expect(src.briefSections).toEqual(['Problem', 'Motivation', 'Constraints', 'Out of scope'])
    expect(typeof src.briefTemplate).toBe('string')
    expect(body.slugPattern).toBe(SLUG_PATTERN)
  })
})

describe('the write route (R2/R3)', () => {
  const post = async (payload: object) => {
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  it('rejects approve on a bounced packet (R3 backstop)', async () => {
    const { status, body } = await post({
      source: 'fixture',
      slug: 'malformed-spec',
      action: 'approve',
      gate: 'G0',
      burden: 'confirmation',
    })
    expect(status).toBe(422)
    expect(body.error).toMatch(/bounced/)
  })

  it('rejects approve without burden', async () => {
    const { status, body } = await post({ source: 'fixture', slug: 'g0-pending', action: 'approve', gate: 'G0' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/burden/)
  })

  it('approves G0 and the change is visible on subsequent reads', async () => {
    const { status, body } = await post({
      source: 'fixture',
      slug: 'g0-pending',
      action: 'approve',
      gate: 'G0',
      burden: 'confirmation',
      notes: 'spec matches intent',
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/)

    const after = await get('/api/runs/fixture/g0-pending')
    expect(after.body.state.gates.G0.approved).toBe(true)
    expect(after.body.state.phase).toBe('plan')
    // Inbox no longer offers G0 for this run.
    const inbox = await get('/api/inbox')
    expect(inbox.body.items.some((i: { slug: string; gate: string | null }) => i.slug === 'g0-pending' && i.gate === 'G0')).toBe(false)
  })

  it('surfaces decision-legality errors as 400s', async () => {
    const { status, body } = await post({
      source: 'fixture',
      slug: 'g0-pending',
      action: 'approve',
      gate: 'G0',
      burden: 'confirmation',
    })
    expect(status).toBe(400)
    expect(body.error).toMatch(/already approved/)
  })
})

describe('the staging route pair (R1/R4/R8)', () => {
  it.each(['patch', 'standard', 'full'] as const)('stages a %s-profile run end to end (AC1.2)', async (profile) => {
    const slug = `stage-${profile}`
    const { status, body } = await postJson('/api/runs', {
      slug,
      title: `${profile} staging run`,
      profile,
      briefMarkdown: fullBrief(`${profile} staging run`),
      costLimitUsd: 25,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(201)
    expect(body).toMatchObject({ outcome: 'created', slug, branch: `run/${slug}` })
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/)

    const raw = git(['show', `run/${slug}:runs/${slug}/state.yaml`])
    const { state, error } = parseRunState(raw)
    expect(error).toBeNull()
    expect(state?.phase).toBe('paused')
    expect(state?.paused_reason).toBe('staged')

    if (profile === 'patch') {
      const taskRaw = git(['show', `run/${slug}:runs/${slug}/tasks/01-${slug}.yaml`])
      const validation = await validateArtifact(`tasks/01-${slug}.yaml`, taskRaw, source.templates)
      expect(validation.ok).toBe(true)
    }
  })

  it('refuses staging with a missing brief section — no branch is created (AC2.2)', async () => {
    const slug = 'stage-missing-section'
    const briefMissingConstraints = `# Intent Brief: gap

## Problem
Something needs fixing.

## Motivation
It saves time.

## Out of scope
Everything else.
`
    const { status, body } = await postJson('/api/runs', {
      slug,
      title: 'gap',
      profile: 'standard',
      briefMarkdown: briefMissingConstraints,
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(422)
    expect(body).toMatchObject({ outcome: 'refused', reason: 'missing-sections', missing: ['Constraints'] })
    expect(body.message).toBe('intent-brief.md is missing required section(s): Constraints')
    expect(branchExists(`run/${slug}`)).toBe(false)
  })

  it('replaying the same slug+clientKey makes no second commit (AC8.1)', async () => {
    const slug = 'stage-replay'
    const payload = {
      slug,
      title: 'replay test',
      profile: 'standard' as const,
      briefMarkdown: fullBrief('replay test'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: 'replay-key-1' },
    }
    const first = await postJson('/api/runs', payload)
    expect(first.status).toBe(201)
    const tip = git(['rev-parse', `run/${slug}`]).trim()

    const second = await postJson('/api/runs', payload)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ outcome: 'exists', slug, branch: `run/${slug}` })
    expect(git(['rev-parse', `run/${slug}`]).trim()).toBe(tip)
  })

  it('refuses a slug already taken by a different, non-staged run, naming its branch (AC8.2)', async () => {
    const { status, body } = await postJson('/api/runs', {
      slug: 'g0-pending',
      title: 'collision',
      profile: 'standard',
      briefMarkdown: fullBrief('collision'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(409)
    expect(body.outcome).toBe('refused')
    expect(body.reason).toBe('slug-taken')
    expect(body.message).toContain('run/g0-pending')
  })

  it('attributes the commit author and intake.staged_by to the source identity, never the body (AC4.2)', async () => {
    const slug = 'stage-attribution'
    const { status } = await postJson('/api/runs', {
      slug,
      title: 'attribution test',
      profile: 'standard',
      briefMarkdown: fullBrief('attribution test'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(201)
    const author = git(['log', '-1', '--format=%an <%ae>', `run/${slug}`]).trim()
    expect(author).toBe('Fixture Operator <operator@example.test>')
    const raw = git(['show', `run/${slug}:runs/${slug}/state.yaml`])
    expect(raw).toContain('staged_by: "Fixture Operator"')
  })

  it('arms a staged run over the existing decision path (R5)', async () => {
    const slug = 'stage-arm'
    await postJson('/api/runs', {
      slug,
      title: 'arm test',
      profile: 'standard',
      briefMarkdown: fullBrief('arm test'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    const { status } = await postJson('/api/decisions', { source: 'fixture', slug, action: 'arm' })
    expect(status).toBe(200)
    const subject = git(['log', '-1', '--format=%s', `run/${slug}`]).trim()
    expect(subject).toBe(`state(${slug}): armed by Fixture Operator`)
  })

  it("refuses arm on a non-staged run with planDecision's DecisionError message (AC5.2)", async () => {
    const { status, body } = await postJson('/api/decisions', { source: 'fixture', slug: 'g0-pending', action: 'arm' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/not staged/)
  })

  it('closes a run over the existing decision path — no new route (#200)', async () => {
    const { status, body } = await postJson('/api/decisions', {
      source: 'fixture',
      slug: 'paused-budget',
      action: 'close',
      closure: 'superseded',
      notes: 'later work overtook this',
    })
    expect(status).toBe(200)
    expect(body.summary).toBe('Close paused-budget as "superseded"')
    const subject = git(['log', '-1', '--format=%s', 'run/paused-budget']).trim()
    expect(subject).toBe('state(paused-budget): closed by Fixture Operator [disposition: superseded]')
  })

  it('refuses a closure with no disposition — the body field is required, not defaulted (#200)', async () => {
    const { status, body } = await postJson('/api/decisions', { source: 'fixture', slug: 'g0-pending', action: 'close', notes: 'just close it' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/requires a disposition/)
  })

  it('reopens a closed run over the same path (#200)', async () => {
    const { status } = await postJson('/api/decisions', { source: 'fixture', slug: 'closed-delivered', action: 'reopen' })
    expect(status).toBe(200)
    const subject = git(['log', '-1', '--format=%s', 'run/closed-delivered']).trim()
    expect(subject).toMatch(/^state\(closed-delivered\): reopened to \S+ by Fixture Operator \(was closed as already-delivered\)$/)
  })

  it('refuses staging with the no-identity message stageRun already returns, and creates no branch (AC4.1)', async () => {
    // Mirrors core/test/stage-run.test.ts's own "unresolvable identity"
    // technique: pin config lookups to /dev/null so the host's ~/.gitconfig
    // can never leak an identity into this repo's "unset" scratch state.
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL
    const savedSystem = process.env.GIT_CONFIG_SYSTEM
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_SYSTEM = '/dev/null'
    try {
      await source.git.run(['config', '--unset', 'user.name'])
      await source.git.run(['config', '--unset', 'user.email'])
      expect(await source.identity()).toBeNull()

      const slug = 'stage-no-identity'
      const { status, body } = await postJson('/api/runs', {
        slug,
        title: 'no identity test',
        profile: 'standard',
        briefMarkdown: fullBrief('no identity test'),
        costLimitUsd: null,
        intake: { source: null, ref: null, url: null, clientKey: null },
      })
      expect(status).toBe(400)
      expect(body).toMatchObject({ outcome: 'refused', reason: 'no-identity' })
      expect(body.message).toContain('attributable to a named human')
      expect(branchExists(`run/${slug}`)).toBe(false)
    } finally {
      await source.git.run(['config', 'user.name', 'Fixture Operator'])
      await source.git.run(['config', 'user.email', 'operator@example.test'])
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal
      if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM
      else process.env.GIT_CONFIG_SYSTEM = savedSystem
    }
  })
})

describe('POST /api/runs with more than one source configured (AC1.3)', () => {
  // A second LocalGitSource id pointed at the same fixture repo — cheap and
  // valid for exercising source *selection*, which never reaches git state:
  // the negative case is refused before any source is touched, and naming
  // one explicitly resolves to the same fixture identity/behavior already
  // covered above.
  let multiApp: Hono

  beforeAll(() => {
    multiApp = createApp({ sources: [new LocalGitSource('fixture', fixture.dir), new LocalGitSource('fixture-2', fixture.dir)] })
  })

  const postJsonTo = async (app: Hono, path: string, payload: object) => {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: (await res.json()) as any }
  }

  it('refuses to guess which source when none is named', async () => {
    const { status, body } = await postJsonTo(multiApp, '/api/runs', {
      slug: 'stage-ambiguous-source',
      title: 'ambiguous source test',
      profile: 'standard',
      briefMarkdown: fullBrief('ambiguous source test'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({ outcome: 'refused', reason: 'invalid-input' })
    expect(body.message).toContain('source is required when more than one source is configured')
    expect(branchExists('run/stage-ambiguous-source')).toBe(false)
  })

  it('proceeds without asking once a source is named', async () => {
    const { status, body } = await postJsonTo(multiApp, '/api/runs', {
      source: 'fixture-2',
      slug: 'stage-named-source',
      title: 'named source test',
      profile: 'standard',
      briefMarkdown: fullBrief('named source test'),
      costLimitUsd: null,
      intake: { source: null, ref: null, url: null, clientKey: null },
    })
    expect(status).toBe(201)
    expect(body).toMatchObject({ outcome: 'created', slug: 'stage-named-source', branch: 'run/stage-named-source' })
  })
})

describe('GET /api/engine-health (#141 drift passthrough)', () => {
  it('passes commit/codeHead/codeState through undefined-safe (pre-#141 files have none)', async () => {
    const before = await get('/api/engine-health')
    expect(before.body.engines.fixture).toBeNull()

    await writeEngineHealth(fixture.dir, {
      at: new Date().toISOString(),
      pid: process.pid,
      heartbeatMs: 180_000,
      inFlight: 0,
      pushRejections: {},
    })
    const noDrift = await get('/api/engine-health')
    expect(noDrift.body.engines.fixture.commit).toBeUndefined()
    expect(noDrift.body.engines.fixture.codeHead).toBeUndefined()
    expect(noDrift.body.engines.fixture.codeState).toBeUndefined()
    expect(noDrift.body.engines.fixture.codeReason).toBeUndefined()

    await writeEngineHealth(fixture.dir, {
      at: new Date().toISOString(),
      pid: process.pid,
      heartbeatMs: 180_000,
      inFlight: 0,
      pushRejections: {},
      commit: 'a'.repeat(40),
      codeHead: 'b'.repeat(40),
      codeState: 'superseded-pending',
    })
    const drift = await get('/api/engine-health')
    expect(drift.body.engines.fixture).toMatchObject({
      commit: 'a'.repeat(40),
      codeHead: 'b'.repeat(40),
      codeState: 'superseded-pending',
    })
    expect(drift.body.engines.fixture.codeReason).toBeUndefined()

    // A paused heartbeat carries the monitor's cause verbatim (#185).
    await writeEngineHealth(fixture.dir, {
      at: new Date().toISOString(),
      pid: process.pid,
      heartbeatMs: 180_000,
      inFlight: 0,
      pushRejections: {},
      commit: 'a'.repeat(40),
      codeHead: 'b'.repeat(40),
      codeState: 'paused',
      codeReason: "checkout is on branch 'run/toy', not the default branch (main)",
    })
    const paused = await get('/api/engine-health')
    expect(paused.body.engines.fixture).toMatchObject({
      codeState: 'paused',
      codeReason: "checkout is on branch 'run/toy', not the default branch (main)",
    })
  })
})

describe('GET /api/runs/:src/:slug branchUrl — the link out to the host (#267)', () => {
  // The origin is stubbed onto a source rather than configured on the fixture
  // repo: a real `remote.origin.url` would also flip a zero-config source into
  // push mode (view-model/config.ts's pushWhenOriginExists), which is a
  // different behavior than the one under test. Same prototype-copy idiom
  // sync.ts's tests use to stub `localOnly`.
  const withOrigin = (origin: string | null): LocalGitSource =>
    Object.assign(Object.create(Object.getPrototypeOf(source)) as LocalGitSource, source, {
      originUrl: async () => origin,
    })

  const detailFrom = async (src: LocalGitSource, slug: string) => {
    const res = await createApp({ sources: [src] }).request(`/api/runs/fixture/${slug}`)
    return (await res.json()) as any
  }

  it('names the run branch’s page on the host (AC1, AC2)', async () => {
    const body = await detailFrom(withOrigin('git@github.com:acme/gateline.git'), 'g2-pending')
    expect(body.branchUrl).toBe('https://github.com/acme/gateline/tree/run/g2-pending')
  })

  it('is null for a source with no origin — local-only keeps its local view (AC3)', async () => {
    expect((await detailFrom(withOrigin(null), 'g2-pending')).branchUrl).toBeNull()
  })

  it('is null for a remote that cannot be resolved without guessing', async () => {
    expect((await detailFrom(withOrigin('git@git.acme-corp.com:acme/gateline.git'), 'g2-pending')).branchUrl).toBeNull()
  })

  it('is null for a merged run, whose branch is gone — never a dead link', async () => {
    // done-merged has no run branch: it is read at the default branch, which
    // is what `kind: 'default'` means.
    const body = await detailFrom(withOrigin('git@github.com:acme/gateline.git'), 'done-merged')
    expect(body.summary.kind).toBe('default')
    expect(body.branchUrl).toBeNull()
  })

  it('stores nothing — the record is untouched by asking for a link (AC4)', async () => {
    const before = git(['log', '-1', '--format=%H', 'run/g2-pending'])
    await detailFrom(withOrigin('git@github.com:acme/gateline.git'), 'g2-pending')
    expect(git(['log', '-1', '--format=%H', 'run/g2-pending'])).toBe(before)
    expect(git(['status', '--porcelain'])).toBe('')
  })
})
