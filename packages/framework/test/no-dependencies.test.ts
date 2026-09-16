// The load-bearing constraint of this package, enforced rather than asserted in
// a comment: a host repository's render-staleness CI runs it straight from a
// checkout with no `npm install`, so a single third-party import would break
// every adopting repository's CI rather than this one's.
//
// This is the successor to the renderer's old stdlib-only Python rule
// (docs/INTEGRATION.md §8), and it fails here, on the change that introduces
// the dependency, instead of in someone else's repository later.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE = fileURLToPath(new URL('../', import.meta.url))
const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g

describe('@gateline/framework takes no dependencies', () => {
  it('declares none in its package.json', async () => {
    const manifest = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.optionalDependencies).toBeUndefined()
  })

  it('imports only node: builtins and its own modules', async () => {
    const files = (await readdir(join(PACKAGE, 'src'))).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(join(PACKAGE, 'src', file), 'utf8')
      for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
        if (specifier!.startsWith('node:') || specifier!.startsWith('./') || specifier!.startsWith('../')) continue
        offenders.push(`src/${file}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
