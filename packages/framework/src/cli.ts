// The command bodies, shared by this package's dependency-free entry point
// (`main.ts`) and by the `gateline` CLI, so both spellings are one
// implementation. Each returns the exit code its caller should use and never
// calls `process.exit` itself.
import { fork, type InitOptions, init, validate } from './integrate.ts'
import { renderAll } from './render.ts'
import { resolveCoreRoot } from './roots.ts'

type Log = (line: string) => void
const stdout: Log = (line) => console.log(line)

export async function runRender(repoDir: string, check: boolean, log: Log = stdout): Promise<number> {
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

export async function runInit(options: InitOptions, log: Log = stdout): Promise<number> {
  const { lock, adapters, retired, notes } = await init(options)
  for (const note of notes) log(`note: ${note}`)
  if (retired.length) {
    log(`note: ${retired.length} file(s) this release no longer offers were dropped from the lock:`)
    for (const rel of retired) log(`  ${rel}`)
    log('      their copies are left in place — delete them when you are satisfied nothing reads them')
  }
  log(
    `integrated ${Object.keys(lock.files).length} files into ${options.target} ` +
      `(${lock.layout} layout, ${adapters.length} adapters: ${adapters.join(', ')})`,
  )
  log(`\nNext, from ${options.target}:`)
  log('  1. dispatch the Integrator in your runner:')
  log('       Use the integrator subagent for run runs/000-integration,')
  log('       producing integration-profile.md per contracts/integration-profile.md.')
  log('  2. review its integration-profile.md and overlays (gate GI), then:')
  log(`       gateline validate ${options.target}`)
  log('  3. open the scaffold PR.')
  return 0
}

export async function runValidate(target: string, prefix: string | undefined, log: Log = stdout): Promise<number> {
  const { failures, lock } = await validate(target, prefix)
  if (failures.length) {
    log('validate: FAIL')
    for (const failure of failures) log(`  - ${failure}`)
    return 1
  }
  log(
    `validate: OK (${Object.keys(lock.files).length} core files, ${Object.keys(lock.forks).length} forks, ` +
      `renders current, provenance ${lock.provenance_mode})`,
  )
  log('operator read check (from the framework checkout, not part of validate):')
  log(`  gateline status --repo ${target}`)
  return 0
}

export async function runFork(
  args: { target: string; file: string; reason: string; prefix?: string },
  log: Log = stdout,
): Promise<number> {
  const base = await fork(args)
  log(`forked ${args.file} (pristine base retained at ${base}); it is now yours to edit`)
  return 0
}
