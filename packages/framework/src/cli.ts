// The command bodies, shared by this package's dependency-free entry point
// (`main.ts`) and by the `gateline` CLI, so both spellings of `render` are one
// implementation. Each returns the exit code its caller should use and never
// calls `process.exit` itself.
import { renderAll } from './render.ts'
import { resolveCoreRoot } from './roots.ts'

export async function runRender(
  repoDir: string,
  check: boolean,
  log: (line: string) => void = (line) => console.log(line),
): Promise<number> {
  const coreRoot = await resolveCoreRoot(repoDir)
  const { written, stale } = await renderAll(coreRoot, { check })
  for (const path of written) log(`rendered ${path}`)
  if (!check) return 0
  if (stale.length) {
    log('STALE (run: gateline render):')
    for (const path of stale) log(`  ${path}`)
    return 1
  }
  log('all rendered agents up to date')
  return 0
}
