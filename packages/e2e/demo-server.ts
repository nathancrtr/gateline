// Shared server bootstrap for every e2e spec (#438).
//
// Each spec used to pin its own fixed port (4394-4399) and navigate against
// it directly. Two worktrees running `npx playwright test` in the same
// minute shared those ports: the second suite's server either failed to
// bind, or the page landed on the *other* worktree's fixture repo. Binding to
// `--port 0` asks the OS for a free port; reading it back from the server's
// own "listening on" line — rather than a port this suite picked itself — is
// what makes it impossible for a suite to ever reach a server it did not
// start.
import { type ChildProcess, spawn } from 'node:child_process'

export interface DemoServer {
  server: ChildProcess
  origin: string
}

/**
 * Spawn `server/src/main.ts` against `repoDir` on an OS-assigned port, and
 * resolve once it has printed the address it bound and answered its own
 * health check.
 */
export async function spawnDemoServer(repoDir: string): Promise<DemoServer> {
  const server = spawn('node', ['server/src/main.ts', '--repo', repoDir, '--port', '0'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  const origin = await new Promise<string>((resolvePromise, reject) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const m = buf.match(/listening on (http:\/\/\S+)/)
      if (m) {
        server.stdout?.off('data', onData)
        server.off('exit', onExit)
        resolvePromise(m[1]!)
      }
    }
    const onExit = (code: number | null) => reject(new Error(`server exited (${code}) before printing the address it bound`))
    server.stdout?.on('data', onData)
    server.once('exit', onExit)
  })

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${origin}/api/health`)
      if (res.ok) return { server, origin }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  server.kill()
  throw new Error('server did not come up')
}
