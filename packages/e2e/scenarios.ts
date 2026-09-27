// Throwaway repositories and deployments for the states the demo lacks
// (#499): a repository flooded with unreadable runs, a repository in `view`
// mode, a repository that cannot be read, and engine heartbeats that are
// fresh, stale or absent. Everything is generated under a temporary
// directory, the config under a temporary `XDG_CONFIG_HOME`; nothing here
// reads or writes the operator's own `~/.config/gateline/`.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'

const DAY = 86_400

/** A fresh temporary directory to hold one scenario's repositories and config. */
export function scenarioRoot(): string {
  return mkdtempSync(join(tmpdir(), 'gateline-499-'))
}

/** The full fixture set (every state the cockpit renders) in `<parent>/<name>`, so its id is `local/<name>`. */
export function fullRepo(parent: string, name: string): FixtureRepo {
  const dir = join(parent, name)
  mkdirSync(dir)
  return generateFixtureRepo(dir)
}

/**
 * The small fixture set (three decisions: an escalation, a budget pause, a
 * G0 gate) in `<parent>/<name>`, plus `malformed` runs whose state cannot be
 * parsed, on branches `run/broken-01`… Their ages start at 4.5 days and step
 * down by a tenth of a day each, so the oldest sits between the escalation
 * (5 days) and the pause (3 days) in an oldest-first inbox.
 */
export function floodedRepo(parent: string, name: string, malformed: number): FixtureRepo & { brokenSlugs: string[] } {
  const dir = join(parent, name)
  mkdirSync(dir)
  const fixture = generateFixtureRepo(dir, { runs: 'small' })
  const brokenSlugs: string[] = []
  for (let i = 0; i < malformed; i++) {
    const slug = `broken-${String(i + 1).padStart(2, '0')}`
    brokenSlugs.push(slug)
    const when = new Date((fixture.now - Math.round((4.5 - i * 0.1) * DAY)) * 1000).toISOString()
    git(dir, ['checkout', '-q', '-b', `run/${slug}`, 'main'])
    const path = join(dir, 'runs', slug, 'state.yaml')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `run: ${slug}\nbranch: run/${slug}\nphase: [this is\n  not: valid yaml for a phase\n`, 'utf8')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', `state(${slug}): artifacts`], when)
  }
  git(dir, ['checkout', '-q', 'main'])
  return { ...fixture, brokenSlugs }
}

function git(dir: string, args: string[], date?: string): void {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  execFileSync('git', ['-C', dir, ...args], { env, stdio: 'ignore' })
}

/** A heartbeat in the shape `core/src/sources/engine-health.ts` reads, written where it reads it. */
export interface Heartbeat {
  at: string
  pid?: number
  heartbeatMs?: number
  inFlight?: number
  pushRejections?: Record<string, number>
  [extra: string]: unknown
}

/**
 * Write a heartbeat into a repository's git directory, as an engine would.
 * `ageSeconds` of 0 is fresh; anything past two heartbeats and a minute's
 * grace (with the 30-second beat used here, 120 seconds) is stale.
 */
export function writeHeartbeat(repoDir: string, ageSeconds: number, extra: Record<string, unknown> = {}): void {
  const path = join(repoDir, '.git', 'gateline', 'engine-health.json')
  mkdirSync(dirname(path), { recursive: true })
  const health: Heartbeat = {
    at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    pid: 4242,
    heartbeatMs: 30_000,
    inFlight: 0,
    pushRejections: {},
    ...extra,
  }
  writeFileSync(path, JSON.stringify(health, null, 2), 'utf8')
}

/** A config file under `<root>/xdg/gateline/config.yaml` listing each repository with its mode; returns the XDG_CONFIG_HOME. */
export function writeConfig(root: string, entries: { path: string; name?: string; mode: 'view' | 'decide' | 'dispatch' }[]): string {
  const xdg = join(root, 'xdg')
  mkdirSync(join(xdg, 'gateline'), { recursive: true })
  const lines = ['repositories:']
  for (const e of entries) {
    lines.push(`  - path: ${JSON.stringify(e.path)}`)
    if (e.name) lines.push(`    name: ${JSON.stringify(e.name)}`)
    lines.push(`    mode: ${e.mode}`)
  }
  writeFileSync(join(xdg, 'gateline', 'config.yaml'), `${lines.join('\n')}\n`, 'utf8')
  return xdg
}

export interface ScenarioServer {
  server: ChildProcess
  origin: string
}

/**
 * Serve a scenario: `server/src/main.ts` over `--repo` paths, or over the
 * config under `xdg` when no paths are given, on an OS-assigned port or the
 * one asked for. Resolves once it answers its health check. With `repos`, the
 * repositories are in `decide` mode, as under `gateline ui`; `engine` serves
 * them as `gateline up` would (`dispatch`), with no engine started.
 */
export async function spawnScenario(opts: { repos?: string[]; xdg?: string; port?: number; engine?: boolean }): Promise<ScenarioServer> {
  const script = opts.engine
    ? [
        '--input-type=module',
        '-e',
        `const { startServer } = await import('./server/src/main.ts'); await startServer({ port: ${opts.port ?? 0}, repoOverrides: ${JSON.stringify(opts.repos ?? [])}, engine: true, push: false })`,
      ]
    : ['server/src/main.ts', ...(opts.repos ?? []).flatMap((dir) => ['--repo', dir]), '--port', String(opts.port ?? 0)]
  const env = { ...process.env, ...(opts.xdg ? { XDG_CONFIG_HOME: opts.xdg } : {}) }
  const server = spawn('node', script, { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'ignore'], env })
  const origin = await new Promise<string>((resolvePromise, reject) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const m = buf.match(/listening on (http:\/\/\S+)/)
      if (m) {
        server.stdout?.off('data', onData)
        server.off('exit', onExit)
        server.stdout?.resume()
        resolvePromise(m[1]!)
      }
    }
    const onExit = (code: number | null) => reject(new Error(`server exited (${code}) before printing the address it bound: ${buf}`))
    server.stdout?.on('data', onData)
    server.once('exit', onExit)
  })
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return { server, origin }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  server.kill()
  throw new Error('server did not come up')
}
