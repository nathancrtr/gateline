// Server-layer proof of R2/R3/R4 for a schema-invalid run whose escalations
// are independently well-formed (ADR-5): the recovered count, the recovered
// content, and the continued write refusal, all against the shared
// esc-recovered fixture (2 open, 1 resolved escalation).
import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo, type FixtureRepo } from '@agentic/fixtures'
import { LocalGitSource } from '@agentic/core'
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

beforeAll(() => {
  fixture = generateFixtureRepo()
  source = new LocalGitSource('fixture', fixture.dir)
  app = createApp({ sources: [source] })
})
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('GET /api/runs (R2)', () => {
  it('AC2.1: the esc-recovered entry reports the recovered open count and a non-null malformed message', async () => {
    const { status, body } = await get('/api/runs')
    expect(status).toBe(200)
    const run = body.runs.find((r: { slug: string }) => r.slug === 'esc-recovered')
    expect(run).toBeDefined()
    expect(run.escalationsOpen).toBe(2)
    expect(run.malformed).not.toBeNull()
  })
})

describe('GET /api/runs/:src/:slug (R2/R3)', () => {
  it('AC2.2: summary.escalationsOpen reflects the recovered open count', async () => {
    const { status, body } = await get('/api/runs/fixture/esc-recovered')
    expect(status).toBe(200)
    expect(body.summary.escalationsOpen).toBe(2)
  })

  it('AC3.2: recoveredEscalations names exactly the 2 open entries, resolved entry absent', async () => {
    const { body } = await get('/api/runs/fixture/esc-recovered')
    // Both open escalations in the esc-recovered fixture share one timestamp:
    // new Date((fixture.now - 1 * DAY) * 1000).toISOString() (frontend/fixtures/src/index.ts).
    const at = new Date((fixture.now - 86400) * 1000).toISOString()
    expect(body.recoveredEscalations).toEqual([
      {
        at,
        from_role: 'implementer',
        reason: 'file_contact_surface conflict with a parallel task; escalating rather than guessing which owns the shared module',
      },
      {
        at,
        from_role: 'verifier',
        reason: 'AC2.2 unverifiable: the oversized-input fixture referenced by the spec is missing from the repo',
      },
    ])
  })

  it("R4 item shape: items[] carries the malformed item plus 2 non-reviewable escalation items with a null escalationIndex", async () => {
    const { body } = await get('/api/runs/fixture/esc-recovered')
    const escalationItems = body.items.filter((i: { kind: string }) => i.kind === 'escalation')
    expect(escalationItems).toHaveLength(2)
    for (const item of escalationItems) {
      expect(item.reviewable).toBe(false)
      expect(item.escalationIndex).toBeNull()
    }
    expect(body.items.some((i: { kind: string }) => i.kind !== 'escalation')).toBe(true)
  })

  it('AC1.2 rider: GET /api/runs/fixture/bad-state carries no recoveredEscalations key', async () => {
    const { status, body } = await get('/api/runs/fixture/bad-state')
    expect(status).toBe(200)
    expect('recoveredEscalations' in body).toBe(false)
  })
})

describe('POST /api/decisions against a schema-invalid run (R4)', () => {
  it('AC4.2: resolve-escalation still returns the malformed-state refusal', async () => {
    const { status, body } = await postJson('/api/decisions', {
      source: 'fixture',
      slug: 'esc-recovered',
      action: 'resolve-escalation',
      escalationIndex: 0,
      notes: 'attempted resolution against malformed state',
    })
    expect(status).toBe(409)
    expect(body.error).toMatch(/malformed/)
  })

  it('AC4.2: approve still returns the malformed-state refusal', async () => {
    const { status, body } = await postJson('/api/decisions', {
      source: 'fixture',
      slug: 'esc-recovered',
      action: 'approve',
      gate: 'G2',
      burden: 'confirmation',
    })
    expect(status).toBe(409)
    expect(body.error).toMatch(/malformed/)
  })

  it('AC4.2: decline still returns the malformed-state refusal', async () => {
    const { status, body } = await postJson('/api/decisions', {
      source: 'fixture',
      slug: 'esc-recovered',
      action: 'decline',
      gate: 'G2',
      notes: 'attempted decline against malformed state',
    })
    expect(status).toBe(409)
    expect(body.error).toMatch(/malformed/)
  })
})
