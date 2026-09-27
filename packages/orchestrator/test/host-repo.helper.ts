// A throwaway host repository for the default-branch-tip reads (#500): the
// tests commit one version of a file to `main`, check out another branch that
// carries a different version (and sometimes leave a third, uncommitted, in
// the working tree), then assert which one the engine-side loader returns.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Host Maintainer',
  GIT_AUTHOR_EMAIL: 'host@example.test',
  GIT_COMMITTER_NAME: 'Host Maintainer',
  GIT_COMMITTER_EMAIL: 'host@example.test',
}

export interface HostRepo {
  dir: string
  /** Write files into the working tree without committing them. */
  write(files: Record<string, string>): void
  /** Write files and commit them on whatever branch is checked out. */
  commit(files: Record<string, string>, message: string): void
  /** Check out `branch`, creating it from the current HEAD when `create` is set. */
  checkout(branch: string, create?: boolean): void
  git(args: string[]): string
  remove(): void
}

/** An empty repository on `branch` (default `main`), with no origin (a local-only host). */
export function makeHostRepo(branch = 'main'): HostRepo {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-host-'))
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV })
  git(['init', '-q', '-b', branch])
  const write = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }
  return {
    dir,
    write,
    commit(files, message) {
      write(files)
      git(['add', '-A'])
      git(['commit', '-q', '--allow-empty', '-m', message])
    },
    checkout(branch, create = false) {
      git(create ? ['checkout', '-q', '-b', branch] : ['checkout', '-q', branch])
    },
    git,
    remove() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** A minimal adapter manifest whose `headless.command` names `bin`. */
export function manifestJson(bin: string): string {
  return JSON.stringify({
    adapter: 'fake',
    headless: { command: [bin, '{prompt}'], dispatch_prompt: '{body}', usage_report: { format: 'static-estimate' } },
    model_map: {},
    model_overrides: {},
    model_vendors: {},
  })
}

/** A framework-lock.json marking a `gateline init --layout prefixed` host. */
export function prefixedLock(prefix: string): string {
  return JSON.stringify({ layout: 'prefixed', prefix })
}
