// CLI acceptance: the full decision loop against a fixture repo, spawning the
// real binary the way an operator would run it.
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo, type FixtureRepo } from '@agentic/fixtures'
import { LocalGitSource } from '@agentic/core'

const exec = promisify(execFile)
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')

let fixture: FixtureRepo

const run = async (args: string[], expectFail = false) => {
  try {
    const { stdout, stderr } = await exec('node', [cliPath, '--repo', fixture.dir, ...args])
    return { code: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    if (!expectFail) throw new Error(`cli failed: ${err.stderr ?? ''}${err.stdout ?? ''}`)
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

beforeAll(() => {
  fixture = generateFixtureRepo()
})
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('agentic CLI', () => {
  it('status renders the portfolio with gate glyphs', async () => {
    const { stdout } = await run(['status'])
    expect(stdout).toMatch(/RUN\s+PHASE\s+GATES/)
    // Source id derives from the repo directory basename, so match on the slug.
    expect(stdout).toContain('/done-merged')
    expect(stdout).toMatch(/done-merged\s+done\s+✓ ✓ ✓ ✓/)
    expect(stdout).toMatch(/need a human/)
  })

  it('inbox lists items oldest-first with bounce warnings', async () => {
    const { stdout } = await run(['inbox'])
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toContain('escalated')
    expect(stdout).toContain('BOUNCED')
  })

  it('approve requires burden when non-interactive', async () => {
    const { code, stderr } = await run(['approve', 'g0-pending', 'G0'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/--burden is required/)
  })

  it('approve writes the gate entry and advances the phase', async () => {
    const { stdout } = await run(['approve', 'g0-pending', 'G0', '--burden', 'confirmation', '--notes', 'looks right'])
    expect(stdout).toMatch(/Approve G0 and move g0-pending to phase "plan"/)
    expect(stdout).toMatch(/G0 approved by Fixture Operator \[burden: confirmation\]/)

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const { state, raw } = await source.readState(ref)
    expect(state!.gates.G0).toMatchObject({ approved: true, by: 'Fixture Operator', burden: 'confirmation', notes: 'looks right' })
    expect(state!.phase).toBe('plan')
    expect(raw).toContain('# a gate entry is written ONLY by the named human')
  })

  it('decline requires --reason and pauses the run', async () => {
    const missing = await run(['decline', 'g1-pending', 'G1'], true)
    expect(missing.code).not.toBe(0)
    expect(missing.stderr).toMatch(/--reason/)

    await run(['decline', 'g1-pending', 'G1', '--reason', 'task 02 overlaps task 01 surface'])
    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'g1-pending')!
    const { state } = await source.readState(ref)
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe('gate-declined')
  })

  it('resolve-escalation and resume complete the loop', async () => {
    await run(['resolve-escalation', 'escalated', '0', '--note', 'sample data committed'])
    await run(['resume', 'paused-budget'])
    const source = new LocalGitSource('fixture', fixture.dir)
    const refs = await source.listRuns()
    const esc = await source.readState(refs.find((r) => r.slug === 'escalated')!)
    expect(esc.state!.escalations[0]!.resolved).toBe(true)
    const paused = await source.readState(refs.find((r) => r.slug === 'paused-budget')!)
    expect(paused.state!.phase).toBe('plan')
  })

  it('refuses decisions on unknown runs', async () => {
    const { code, stderr } = await run(['approve', 'nope', 'G0', '--burden', 'confirmation'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/not found/)
  })
})
