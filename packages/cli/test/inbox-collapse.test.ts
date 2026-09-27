// `gateline inbox` collapses one repository's unreadable runs into one line
// (#499; docs/MULTI-REPO.md §9.3), as Gatehouse does, and `--all` lists them.
// Spawns the real CLI over throwaway repositories; expected lines are
// literals.
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { floodedRepo, scenarioRoot } from '../../e2e/scenarios.ts'

const exec = promisify(execFile)
const cliPath = join(import.meta.dirname, '../src/main.ts')
let root: string

const inbox = async (repos: string[], ...args: string[]) =>
  (await exec('node', [cliPath, ...repos.flatMap((r) => ['--repo', r]), 'inbox', ...args], { env: { ...process.env, XDG_CONFIG_HOME: join(root, 'no-config') } })).stdout

beforeAll(() => {
  root = scenarioRoot()
  floodedRepo(root, 'website', 4)
  floodedRepo(root, 'billing', 3)
}, 120_000)
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe('gateline inbox', () => {
  it('prints four unreadable runs from one repository as one line, at the place of the oldest, with the command that lists them', async () => {
    const out = await inbox([join(root, 'website')])
    const lines = out.split('\n')
    const firsts = lines.filter((l) => /^\S/.test(l)).map((l) => l.replace(/\s+/g, ' '))
    expect(firsts).toEqual([
      'escalation 5d website/retry-policy escalation from implementer',
      'malformed 4d website 4 runs have unreadable state',
      'paused 3d website/nightly-report run paused: budget-exhausted',
      'G0 1d website/csv-export G0 — Is this what we actually want built?',
    ])
    const at = lines.findIndex((l) => l.startsWith('malformed'))
    expect(lines[at + 1]).toBe(`${' '.repeat(17)}list      gateline inbox --all`)
    expect(out).not.toContain('broken-0')
  })

  it('lists every one with --all', async () => {
    const out = await inbox([join(root, 'website')], '--all')
    expect(out).not.toContain('have unreadable state')
    expect(out.match(/^malformed .*website\/broken-0\d/gm)?.length).toBe(4)
  })

  it('prints three exactly as --all does: nothing collapses', async () => {
    const [plain, all] = await Promise.all([inbox([join(root, 'billing')]), inbox([join(root, 'billing')], '--all')])
    expect(plain).toBe(all)
    expect(plain.match(/^malformed /gm)?.length).toBe(3)
  })

  it('names the repository in the command when the set has several, and counts items in each heading', async () => {
    const out = await inbox([join(root, 'website'), join(root, 'billing')])
    expect(out).toContain(`${' '.repeat(17)}list      gateline inbox --all --repository website`)
    expect(out).toContain('# website  local/website  7 waiting')
    expect(out).toContain('# billing  local/billing  6 waiting')
    expect(out.match(/have unreadable state/g)?.length).toBe(1)
  })
})
