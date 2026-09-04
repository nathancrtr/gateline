/**
 * The orchestrator's ceiling on @gateline/core (#132).
 *
 * The engine is a peer product of the gate frontend, not a component of it
 * (#133). It reconciles committed state and dispatches agents; it never
 * renders anything. So it has no business in core's `view-model` layer — the
 * derivations Gatehouse draws — and this test is what makes that a checked
 * fact rather than a happy accident of what anyone happened to import.
 *
 * It matters beyond tidiness. `deriveReadiness` and the orchestrator's own
 * `derive.ts` are two readings of the same run state, and two implementations
 * of the readiness rules is how they drift (ORCHESTRATOR.md §9). A view-model
 * import here is the first step of that drift, and it should fail a test
 * rather than pass review.
 *
 * `core/test/layering.test.ts` enforces the same stack *inside* core. This is
 * the consumer-side half.
 *
 * Note the asymmetry, which is deliberate: the server and the CLI have no such
 * ceiling, because both legitimately reach the view-model layer. The server is
 * the thing that serves it (15 view-model symbols), and the CLI renders the
 * portfolio in a terminal. #132 originally proposed one rule for all three
 * consumers; that was measured and found wrong (see the issue).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')

/** The layers the engine may reach, lowest first. */
const ALLOWED = ['@gateline/core/record', '@gateline/core/sources']
const FORBIDDEN = '@gateline/core/view-model'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Core specifiers imported (statically or dynamically) by a file. */
function coreSpecifiers(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^(?:import|export)[^'"]*from\s+'(@gateline\/core[^']*)'/gm)) out.push(m[1]!)
  for (const m of text.matchAll(/import\(\s*'(@gateline\/core[^']*)'\s*\)/g)) out.push(m[1]!)
  return out
}

describe('orchestrator → core ceiling', () => {
  const files = walk(SRC).map((f) => relative(SRC, f))

  it('imports core by layer, never through the root export', () => {
    // The root re-exports all three layers, so importing it makes the ceiling
    // unenforceable — a view-model symbol would arrive through a specifier
    // that looks identical to a record one.
    const rootImporters: string[] = []
    for (const file of files) {
      for (const spec of coreSpecifiers(readFileSync(join(SRC, file), 'utf8'))) {
        if (spec === '@gateline/core') rootImporters.push(file)
      }
    }
    expect(rootImporters).toEqual([])
  })

  it('never reaches the view-model layer', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const spec of coreSpecifiers(readFileSync(join(SRC, file), 'utf8'))) {
        if (spec === FORBIDDEN || spec.startsWith(`${FORBIDDEN}/`)) violations.push(`${file} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('imports only layers that exist', () => {
    const unknown: string[] = []
    for (const file of files) {
      for (const spec of coreSpecifiers(readFileSync(join(SRC, file), 'utf8'))) {
        if (!ALLOWED.includes(spec)) unknown.push(`${file} → ${spec}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('catches a planted violation', () => {
    // Proves the matcher sees imports rather than passing on an empty scan.
    const planted = [
      `import { deriveReadiness } from '@gateline/core/view-model'`,
      `import { Git } from '@gateline/core'`,
      `const m = await import('@gateline/core/view-model')`,
    ].join('\n')
    expect(coreSpecifiers(planted)).toEqual([
      '@gateline/core/view-model',
      '@gateline/core',
      '@gateline/core/view-model',
    ])
  })
})
