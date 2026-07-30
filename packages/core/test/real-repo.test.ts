// Acceptance check against this repository's real history: the wordfreq run
// (merged, done) must be discovered, summarized, and metered correctly.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectRunDecisions, LocalGitSource, summarizeRun } from '../src/index.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const source = new LocalGitSource('sandbox', repoRoot)

describe('this repository (wordfreq)', () => {
  it('discovers the merged wordfreq run from the default branch', async () => {
    const runs = await source.listRuns()
    const wordfreq = runs.find((r) => r.slug === 'wordfreq')
    expect(wordfreq).toBeDefined()
    expect(wordfreq!.kind).toBe('default')
  })

  it('summarizes it as done with all gates approved and nothing pending', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'wordfreq')!
    const { summary, items } = await summarizeRun(source, ref)
    expect(summary.phase).toBe('done')
    expect(summary.gates.G0.approved).toBe(true)
    expect(summary.gates.G3.approved).toBe(true)
    expect(summary.gates.G2.by).toBe('nthncrtr')
    expect(summary.tasks).toMatchObject({ total: 4, done: 4 })
    expect(summary.tasks.maxRounds).toBe(2)
    expect(items).toHaveLength(0)
  })

  it('extracts gate decision records from state.yaml history', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'wordfreq')!
    const decisions = await collectRunDecisions(source, ref)
    const gates = decisions.map((d) => d.gate)
    expect(gates).toEqual(['G0', 'G1', 'G2', 'G3'])
    for (const d of decisions) {
      expect(d.approved).toBe(true)
      expect(d.by).toBe('nthncrtr')
      expect(d.decidedAt).toBeGreaterThan(0)
      expect(d.burden).toBeNull() // predates the burden amendment — honest gap
    }
  })

  it('validates the real spec.md against the repo’s own contracts', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'wordfreq')!
    const spec = await source.readArtifact(ref, 'spec.md')
    expect(spec).not.toBeNull()
    const { validateArtifact } = await import('../src/index.ts')
    const v = await validateArtifact('spec.md', spec!, source.templates)
    expect(v.contract).toBe('spec.md')
    expect(v.ok).toBe(true)
    expect(v.notes).toHaveLength(0) // template came from contracts/, not built-ins
  })
})
