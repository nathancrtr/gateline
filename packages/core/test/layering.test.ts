// The import boundary between core's layers. record/ is the evidence kernel
// and must stay extractable with zero knowledge of where records live or how
// they are rendered; sources/ may build on record/; view-model/ sits on top.
// A violation here is an architecture regression, not a style nit.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')

const LAYERS = ['record', 'sources', 'view-model'] as const
type Layer = (typeof LAYERS)[number]

const MAY_IMPORT: Record<Layer, Layer[]> = {
  record: ['record'],
  sources: ['sources', 'record'],
  'view-model': ['view-model', 'sources', 'record'],
}

function layerOf(srcRelPath: string): Layer | null {
  const top = srcRelPath.split('/')[0]
  return (LAYERS as readonly string[]).includes(top!) ? (top as Layer) : null
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Relative specifiers from import/export-from statements, ignoring bare (package) imports. */
function relativeSpecifiers(text: string): string[] {
  const specs: string[] = []
  for (const match of text.matchAll(/^(?:import|export)[^'"]*from\s+'([^']+)'/gm)) {
    if (match[1]!.startsWith('.')) specs.push(match[1]!)
  }
  return specs
}

describe('core layering', () => {
  const files = walk(SRC).map((f) => relative(SRC, f))

  it('every source file belongs to exactly one layer (or is the root index)', () => {
    const strays = files.filter((f) => f !== 'index.ts' && layerOf(f) === null)
    expect(strays).toEqual([])
  })

  it('imports only point down the stack: view-model -> sources -> record', () => {
    const violations: string[] = []
    for (const file of files) {
      const fromLayer = layerOf(file)
      if (fromLayer === null) continue // root index.ts re-exports all layers
      for (const spec of relativeSpecifiers(readFileSync(join(SRC, file), 'utf8'))) {
        const target = relative(SRC, resolve(SRC, dirname(file), spec))
        const toLayer = layerOf(target)
        if (toLayer === null || !MAY_IMPORT[fromLayer].includes(toLayer)) {
          violations.push(`${file} -> ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
