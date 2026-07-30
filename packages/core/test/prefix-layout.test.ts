// Regression for #94: a source integrated via `integrate.py init --layout
// prefixed` (the tool's own default) must read exactly like an equivalent
// root-layout repo — same runs, same states, same artifacts — instead of the
// #83 failure class (silent empty inbox from an unresolved path assumption).
import { rm } from 'node:fs/promises'
import { generateFixtureRepo, type FixtureRepo } from '@agentic/fixtures'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalGitSource } from '../src/index.ts'

let rootRepo: FixtureRepo
let prefixedRepo: FixtureRepo

const rootSource = (): LocalGitSource => {
  rootRepo = generateFixtureRepo()
  return new LocalGitSource('root', rootRepo.dir)
}
const prefixedSource = (): LocalGitSource => {
  prefixedRepo = generateFixtureRepo(undefined, { layout: 'prefixed' })
  return new LocalGitSource('prefixed', prefixedRepo.dir)
}

afterAll(async () => {
  await rm(rootRepo.dir, { recursive: true, force: true })
  await rm(prefixedRepo.dir, { recursive: true, force: true })
})

describe('prefixed integration layout', () => {
  it('lists the same run slugs as the equivalent root-layout repo', async () => {
    const root = rootSource()
    const prefixed = prefixedSource()
    const rootSlugs = (await root.listRuns()).map((r) => r.slug).sort()
    const prefixedSlugs = (await prefixed.listRuns()).map((r) => r.slug).sort()
    expect(prefixedSlugs).toEqual(rootSlugs)
    expect(prefixedSlugs.length).toBeGreaterThan(0)
  })

  it('reads state, artifacts, and diffs identically to root layout', async () => {
    const root = rootSource()
    const prefixed = prefixedSource()

    const rootRef = (await root.listRuns()).find((r) => r.slug === 'g2-pending')!
    const prefixedRef = (await prefixed.listRuns()).find((r) => r.slug === 'g2-pending')!

    const rootState = await root.readState(rootRef)
    const prefixedState = await prefixed.readState(prefixedRef)
    expect(prefixedState.state).toEqual(rootState.state)

    const rootArtifacts = (await root.listArtifacts(rootRef)).sort()
    const prefixedArtifacts = (await prefixed.listArtifacts(prefixedRef)).sort()
    expect(prefixedArtifacts).toEqual(rootArtifacts)

    const rootSpec = await root.readArtifact(rootRef, 'spec.md')
    const prefixedSpec = await prefixed.readArtifact(prefixedRef, 'spec.md')
    expect(prefixedSpec).toEqual(rootSpec)

    // The diff excludes the run tree at whichever root it actually lives at —
    // it must not leak runs/ contents just because layout moved.
    const prefixedDiff = await prefixed.readDiff(prefixedRef)
    expect(prefixedDiff).not.toMatch(/\.agentic\/runs\//)
  })

  it('validates artifacts against the host’s own contracts/ under the prefix', async () => {
    const { validateArtifact } = await import('../src/index.ts')
    const prefixed = prefixedSource()
    const ref = (await prefixed.listRuns()).find((r) => r.slug === 'done-merged')!
    const spec = await prefixed.readArtifact(ref, 'spec.md')
    const v = await validateArtifact('spec.md', spec!, prefixed.templates)
    expect(v.ok).toBe(true)
    expect(v.notes).toHaveLength(0) // came from the prefixed contracts/, not built-ins
  })
})
