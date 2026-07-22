// Route tests over the fixture source (plan §9).
import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo, type FixtureRepo } from '@agentic/fixtures'
import { LocalGitSource, writeEngineHealth } from '@agentic/core'
import type { Hono } from 'hono'
import { createApp } from '../src/app.ts'

let fixture: FixtureRepo
let app: Hono

/* eslint-disable @typescript-eslint/no-explicit-any */
const get = async (path: string) => {
  const res = await app.request(path)
  return { status: res.status, body: (await res.json()) as any }
}

beforeAll(() => {
  fixture = generateFixtureRepo()
  app = createApp({ sources: [new LocalGitSource('fixture', fixture.dir)] })
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
    expect(body.runs).toHaveLength(12)
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
    expect(body.entries.find((e: { id: string }) => e.id === 'AC2.1')?.kind).toBe('criterion')
    expect(body.entries.find((e: { id: string }) => e.id === 'ADR-1')).toMatchObject({ kind: 'decision', artifact: 'plan.md' })
    expect('cites AC10.2 and ADR-3'.match(new RegExp(body.pattern, 'g'))).toEqual(['AC10.2', 'ADR-3'])
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
  })
})
