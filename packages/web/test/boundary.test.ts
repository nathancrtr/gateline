/**
 * What the browser bundle is allowed to reach across the workspace (#317).
 *
 * Gatehouse talks to the server over HTTP and takes its wire types from
 * `@gateline/server/contract`. It does not otherwise depend on the workspace,
 * and this test is what makes that a checked fact rather than a comment in
 * `api.ts`.
 *
 * The one exception is real and deliberate (ADR-6): three files value-import
 * the record layer — one so the new-run form can preview the exact commit the
 * server will make, and two split out of the run page (#413) so it can read a
 * state document's passthrough intake block and fold an artifact's audit-time
 * sections in place. `record/` is browser-safe — yaml and zod, no node builtins, with
 * `core/test/layering.test.ts` keeping it that way — but "browser-safe today"
 * is not a licence to spread. The exception is a list, and growing it means
 * editing this file on purpose.
 *
 * The sibling guard is `scripts/check-bundle.mjs`, which reads the built
 * output: this test governs what the source may import, that one proves what
 * actually landed in the bundle.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')

/** The server's declaration of its own wire format — types, plus API_VERSION. */
const CONTRACT = '@gateline/server/contract'

/** Browser-safe by probe, and value-importable only from the files listed below. */
const RECORD = '@gateline/core/record'

/**
 * ADR-6's scope. A file here may value-import the record layer; every other
 * file in `web/src` may not. Adding an entry is a deliberate act — say why.
 */
const RECORD_VALUE_IMPORTERS = new Set([
  // The genesis preview: planRunScaffold/ScaffoldError/SLUG_PATTERN, so the
  // form previews the commit the server would make rather than guessing it.
  'pages/new-run.tsx',
  // readIntake, over the passthrough `intake:` block already on the state doc.
  // Moved here from pages/run.tsx when #413 split the run page by surface:
  // the genesis line is readIntake's only caller, and it lives in the header
  // now, so the value import moved with it.
  'pages/run/header.tsx',
  // splitSections, to fold an artifact's audit-time sections in place (#217).
  // Moved here from pages/run.tsx in the same split — FoldedMarkdown, its only
  // caller, is part of the Record surface now.
  'pages/run/record.tsx',
])

interface ImportStatement {
  specifier: string
  /** True when the statement erases at build: `import type {…}`, or every named binding marked `type`. */
  typeOnly: boolean
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** Every `import … from '…'` / `export … from '…'` in a file, with its erasure. */
function imports(text: string): ImportStatement[] {
  const out: ImportStatement[] = []
  for (const m of text.matchAll(/^(import|export)\s+([\s\S]*?)from\s+'([^']+)'/gm)) {
    const [, , clause, specifier] = m
    const body = clause ?? ''
    // `import type { A, B }` / `export type { … }` — the whole statement erases.
    if (/^type\s/.test(body.trim())) {
      out.push({ specifier: specifier!, typeOnly: true })
      continue
    }
    // `import { type A, type B }` also erases, but only if every binding is marked.
    const named = body.match(/\{([\s\S]*)\}/)
    if (named) {
      const bindings = named[1]!
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean)
      const allTypes = bindings.length > 0 && bindings.every((b) => /^type\s/.test(b))
      // A default or namespace binding sits outside the braces and is a value.
      const outsideBraces = body.slice(0, named.index).replace(/[,\s]/g, '')
      out.push({ specifier: specifier!, typeOnly: allTypes && outsideBraces === '' })
      continue
    }
    out.push({ specifier: specifier!, typeOnly: false })
  }
  return out
}

describe('web workspace boundary', () => {
  const files = walk(SRC).map((f) => relative(SRC, f))

  it('reaches the workspace only through the server contract', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const { specifier, typeOnly } of imports(readFileSync(join(SRC, file), 'utf8'))) {
        if (!specifier.startsWith('@gateline/')) continue
        if (specifier === CONTRACT) continue
        if (specifier === RECORD) {
          if (typeOnly || RECORD_VALUE_IMPORTERS.has(file)) continue
          violations.push(`${file} value-imports ${specifier} but is not in RECORD_VALUE_IMPORTERS`)
          continue
        }
        violations.push(`${file} imports ${specifier} (only ${CONTRACT} is open to web)`)
      }
    }
    expect(violations).toEqual([])
  })

  it('never value-imports core outside the record layer', () => {
    // The failure this prevents: core's sources/ and view-model/ layers reach
    // node:child_process, and a value import drags the runtime toward the
    // browser bundle. The root export re-exports all three layers, so
    // `@gateline/core` is the specifier most likely to be reached for.
    const offenders: string[] = []
    for (const file of files) {
      for (const { specifier, typeOnly } of imports(readFileSync(join(SRC, file), 'utf8'))) {
        if (typeOnly) continue
        if (specifier === '@gateline/core' || specifier.startsWith('@gateline/core/')) {
          if (specifier === RECORD && RECORD_VALUE_IMPORTERS.has(file)) continue
          offenders.push(`${file} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('lists only files that exist, so the exception cannot outlive its reason', () => {
    expect([...RECORD_VALUE_IMPORTERS].filter((f) => !files.includes(f))).toEqual([])
  })

  it('catches a planted violation', () => {
    // Proves the parser sees value imports, rather than passing because it
    // matched nothing. Mirrors core/test/layering.test.ts's own self-check.
    const planted = `import { deriveReadiness } from '@gateline/core'\nimport type { RunState } from '@gateline/core'\n`
    const found = imports(planted)
    expect(found).toEqual([
      { specifier: '@gateline/core', typeOnly: false },
      { specifier: '@gateline/core', typeOnly: true },
    ])
  })

  it('reads inline type bindings as erasing', () => {
    expect(imports(`import { type A, type B } from '@gateline/core'\n`)).toEqual([
      { specifier: '@gateline/core', typeOnly: true },
    ])
    expect(imports(`import { type A, b } from '@gateline/core'\n`)).toEqual([
      { specifier: '@gateline/core', typeOnly: false },
    ])
  })
})
