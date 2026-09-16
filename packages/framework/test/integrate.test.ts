// The integration tool against scratch host repositories. These are the nine
// cases scripts/test_integrate.py carried, ported with the tool, plus the ones
// the port itself introduced: the pruning path a pre-port host takes, and the
// host CI workflow, which is now a managed file pinning a framework ref.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCopyManifest, resolveTake } from '../src/copy-manifest.ts'
import {
  CI_WORKFLOW,
  fork,
  frameworkRoot,
  init,
  PROVENANCE_START,
  renderCheckWorkflow,
  repoSlug,
  validate,
} from '../src/integrate.ts'
import { LOCK_REQUIRED_FIELDS, readLock } from '../src/lock.ts'
import { FrameworkError } from '../src/role.ts'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const scratch: string[] = []

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function makeHost(runners: string[] = ['.claude']): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gateline-host-'))
  scratch.push(dir)
  const host = join(dir, 'host')
  await mkdir(host, { recursive: true })
  execFileSync('git', ['init', '-q', host])
  for (const runner of runners) await mkdir(join(host, runner), { recursive: true })
  return host
}

const read = (path: string) => readFile(path, 'utf8')

describe('init and validate', () => {
  it('scaffolds a private, prefixed host that validates', async () => {
    const host = await makeHost()
    const { lock } = await init({ target: host, provenance: 'private', take: 'sdlc' })

    for (const key of LOCK_REQUIRED_FIELDS) expect(lock, key).toHaveProperty(key)
    expect(lock.provenance_mode).toBe('private')
    expect(lock.files).toHaveProperty('.gateline/roles/integrator.md')
    expect(await read(join(host, '.claude', 'agents', 'analyst.md'))).toContain('name: analyst')
    expect(await read(join(host, '.gateline', 'LICENSE.framework.md'))).toContain('Apache')
    expect(await read(join(host, 'NOTICE.md'))).toContain('framework-lock.json')
    expect(await read(join(host, CI_WORKFLOW))).toContain('render --check')

    expect((await validate(host)).failures).toEqual([])
  })

  it('vendors content only — no framework executable travels', async () => {
    const host = await makeHost()
    const { lock } = await init({ target: host, provenance: 'private' })
    const executables = lock.taken.filter((rel) => rel.endsWith('.py') || rel.startsWith('scripts/'))
    expect(executables).toEqual([])
  })

  it('catches a core file edited in place', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const role = join(host, '.gateline', 'roles', 'analyst.md')
    await writeFile(role, `${await read(role)}\nEDITED\n`)
    const { failures } = await validate(host)
    expect(failures.join('\n')).toContain('edited in place')
  })

  it('refuses to clobber a drifted copy on re-init', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const role = join(host, '.gateline', 'roles', 'reviewer.md')
    const drifted = `${await read(role)}drift\n`
    await writeFile(role, drifted)
    await expect(init({ target: host, provenance: 'private' })).rejects.toThrow(/edited in place/)
    expect(await read(role)).toBe(drifted) // never clobbered
  })

  it('scaffolds a root-layout, redistributing host with two adapters', async () => {
    const host = await makeHost(['.claude', '.github/agents'])
    const { lock, adapters } = await init({ target: host, provenance: 'redistribute', layout: 'root' })
    expect(adapters).toEqual(['claude-code', 'copilot-cli'])
    expect(await read(join(host, 'roles', 'analyst.md'))).toContain('Analyst')
    expect(await read(join(host, '.github', 'agents', 'analyst.agent.md'))).toContain('name: analyst')
    expect(await read(join(host, 'NOTICE.md'))).toContain('Apache License 2.0')
    expect(lock.layout).toBe('root')
    expect((await validate(host)).failures).toEqual([])
  })

  it('preserves the project and seeded layers on re-init', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const overlay = join(host, '.gateline', 'overlays', '_all.md')
    const registry = join(host, '.gateline', 'registry', 'models.yaml')
    await writeFile(overlay, 'House rule: run the linter.\n')
    await writeFile(registry, `${await read(registry)}# host binding note\n`)

    await init({ target: host, provenance: 'private' })
    expect(await read(overlay)).toBe('House rule: run the linter.\n')
    expect(await read(registry)).toContain('# host binding note')
    expect((await validate(host)).failures).toEqual([])
  })

  it('refuses a layout or prefix that contradicts an existing lock', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    await expect(init({ target: host, provenance: 'private', layout: 'root' })).rejects.toThrow(/existing lock records layout/)
  })

  it('splices an overlay into the rendered agents', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const rendered = join(host, '.claude', 'agents', 'analyst.md')
    expect(await read(rendered)).not.toContain('OVERLAY') // comment-only stubs splice nothing

    await writeFile(join(host, '.gateline', 'overlays', '_all.md'), 'Run tests first.\n')
    await init({ target: host, provenance: 'private' })
    const text = await read(rendered)
    expect(text).toContain('OVERLAY from overlays/_all.md')
    expect(text).toContain('Run tests first.')
  })
})

describe('forks', () => {
  it('records a fork, retains the pristine base, and lets the copy diverge', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const rel = '.gateline/contracts/state.yaml'
    await fork({ target: host, file: rel, reason: 'non-SDLC gates' })

    const forked = join(host, rel)
    await writeFile(forked, `${await read(forked)}\n# host-local extension\n`)
    expect((await validate(host)).failures).toEqual([])

    const lock = await readLock(join(host, '.gateline', 'framework-lock.json'))
    expect(lock?.forks[rel]?.reason).toBe('non-SDLC gates')
    expect(lock?.forks[rel]?.review_at_upgrade).toBe(true)
    expect(await read(join(host, '.gateline', 'upstream', rel))).not.toContain('host-local extension')
  })

  it('refuses to fork a file that has already been edited', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const rel = '.gateline/roles/analyst.md'
    await writeFile(join(host, rel), `${await read(join(host, rel))}drift\n`)
    await expect(fork({ target: host, file: rel, reason: 'x' })).rejects.toThrow(/already been edited/)
  })

  it('reports a fork whose retained base has gone missing', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const rel = '.gateline/contracts/spec.md'
    await fork({ target: host, file: rel, reason: 'host template' })
    await rm(join(host, '.gateline', 'upstream', rel))
    expect((await validate(host)).failures.join('\n')).toContain('retained upstream copy missing')
  })
})

describe('the copy manifest', () => {
  it('rejects a take naming a file it does not offer', async () => {
    const manifest = await loadCopyManifest(REPO)
    expect(() => resolveTake(manifest, 'roles/nonexistent.md')).toThrow(FrameworkError)
  })

  it('resolves a group to that group plus the always-set', async () => {
    const manifest = await loadCopyManifest(REPO)
    const taken = resolveTake(manifest, 'sdlc')
    for (const always of manifest.always) expect(taken).toContain(always)
    expect(taken).toContain('roles/analyst.md')
    expect(new Set(taken).size).toBe(taken.length) // no duplicates
  })

  // The pre-port hosts took scripts/ entries that this release no longer
  // offers. Re-init drops them from the lock and says so, rather than failing
  // on a source file that is gone.
  it('prunes taken entries a newer manifest no longer offers', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const lockFile = join(host, '.gateline', 'framework-lock.json')
    const lock = (await readLock(lockFile))!
    lock.taken.push('scripts/render-agents.py')
    lock.files['.gateline/scripts/render-agents.py'] = 'stale'
    await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`)

    const { retired, lock: fresh } = await init({ target: host, provenance: 'private' })
    expect(retired).toEqual(['scripts/render-agents.py'])
    expect(fresh.taken).not.toContain('scripts/render-agents.py')
    expect(fresh.files).not.toHaveProperty('.gateline/scripts/render-agents.py')
    expect((await validate(host)).failures).toEqual([])
  })
})

describe('the host CI workflow', () => {
  it('pins the framework ref and needs no install step', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    const workflow = await read(join(host, CI_WORKFLOW))
    const lock = (await readLock(join(host, '.gateline', 'framework-lock.json')))!
    expect(workflow).toContain(`ref: ${lock.source.ref}`)
    expect(workflow).toContain('packages/framework/src/main.ts render --check')
    expect(workflow).not.toContain('npm ci')
    expect(workflow).not.toContain('npm install')
  })

  // The ref moves, so unlike every other seeded file this one is rewritten.
  it('is rewritten on re-init rather than left pinning a stale ref', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    await writeFile(join(host, CI_WORKFLOW), 'name: hand-edited\n')
    await init({ target: host, provenance: 'private' })
    expect(await read(join(host, CI_WORKFLOW))).toContain('render --check')
  })

  it('normalises a remote URL to owner/repo in either form', () => {
    expect(repoSlug('git@github.com:nathancrtr/gateline.git')).toBe('nathancrtr/gateline')
    expect(repoSlug('https://github.com/nathancrtr/gateline.git')).toBe('nathancrtr/gateline')
    expect(repoSlug('https://github.com/nathancrtr/gateline')).toBe('nathancrtr/gateline')
    expect(repoSlug(null)).toBe('nathancrtr/gateline')
    expect(renderCheckWorkflow('acme/host', 'v1.2.3', '.gateline')).toContain('repository: acme/host')
  })
})

describe('the lockfile schema', () => {
  // The JSON Schema is the normative document for readers; the constant is what
  // validate checks. They must not drift apart.
  it('agrees with the required-field list the tool enforces', async () => {
    const schema = JSON.parse(await read(join(frameworkRoot(), 'scripts', 'framework-lock.schema.json'))) as {
      required: string[]
    }
    expect([...schema.required].sort()).toEqual([...LOCK_REQUIRED_FIELDS].sort())
  })

  it('refuses to validate a host with no lock', async () => {
    const host = await makeHost()
    await expect(validate(host)).rejects.toThrow(/no lock at/)
  })

  it('reports provenance stripped out of NOTICE.md', async () => {
    const host = await makeHost()
    await init({ target: host, provenance: 'private' })
    await writeFile(join(host, 'NOTICE.md'), '# NOTICE\n\nnothing here\n')
    expect((await validate(host)).failures.join('\n')).toContain('NOTICE.md missing its framework section')
    expect(PROVENANCE_START).toContain('gateline-framework-provenance')
  })
})
