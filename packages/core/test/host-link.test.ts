// The link out to the git host (#267): the remote forms that yield a branch
// page, and — more importantly — every form that must NOT. A wrong link here
// is worse than no link: the approver follows it away from the local view and
// lands on a 404 they have no reason to distrust.
//
// Remote *parsing* is `sources/github.ts`'s existing `parseGitHubRemote`,
// covered by github.test.ts. What is asserted here is which of its answers
// become a URL, and that everything else degrades to null.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hostBranchUrl, LocalGitSource } from '../src/index.ts'

describe('hostBranchUrl', () => {
  it('names the branch page from every remote form the parser accepts', () => {
    const origins = [
      'git@github.com:acme/gateline.git',
      'git@github.com:acme/gateline',
      'ssh://git@github.com/acme/gateline.git',
      'https://github.com/acme/gateline.git',
      'https://github.com/acme/gateline',
      'https://github.com/acme/gateline/',
      'https://someone:token@github.com/acme/gateline.git',
      '  https://github.com/acme/gateline.git\n',
    ]
    for (const origin of origins) {
      expect(hostBranchUrl(origin, 'run/csvpeek'), origin).toBe('https://github.com/acme/gateline/tree/run/csvpeek')
    }
  })

  it('keeps the branch separators and encodes only within a segment', () => {
    expect(hostBranchUrl('https://github.com/acme/gateline', 'run/fix spaces')).toBe('https://github.com/acme/gateline/tree/run/fix%20spaces')
    expect(hostBranchUrl('https://github.com/acme/gateline', 'run/a#b?c')).toBe('https://github.com/acme/gateline/tree/run/a%23b%3Fc')
  })

  it('is null for every host it cannot resolve without guessing', () => {
    const origins = [
      'git@gitlab.com:acme/gateline.git',
      'https://bitbucket.org/acme/gateline.git',
      'git@git.acme-corp.com:acme/gateline.git', // Enterprise, GitLab and Gitea are one string
      'https://github.acme-corp.com/acme/gateline.git',
      'https://notgithub.com/acme/gateline.git',
      'https://github.com.evil.example/acme/gateline.git',
      '/srv/mirror/gateline.git',
      '../sibling-clone',
      'file:///srv/repos/gateline.git',
      'not a url at all',
      'https://github.com/acme.git', // not a repository path
      'https://github.com/',
      'https://github.com/acme/team/gateline.git',
    ]
    for (const origin of origins) expect(hostBranchUrl(origin, 'run/csvpeek'), origin).toBeNull()
  })

  it('is null when there is no origin at all — a local-only source, or no remote (AC3)', () => {
    for (const origin of [null, undefined, '', '   ']) {
      expect(hostBranchUrl(origin, 'run/csvpeek'), String(origin)).toBeNull()
    }
  })

  it('is null without a branch to name', () => {
    expect(hostBranchUrl('git@github.com:acme/gateline.git', '')).toBeNull()
    expect(hostBranchUrl('git@github.com:acme/gateline.git', '   ')).toBeNull()
  })

  it('is a pure function — same inputs, same answer, no I/O and no clock', () => {
    const once = hostBranchUrl('git@github.com:acme/gateline.git', 'run/csvpeek')
    expect(hostBranchUrl('git@github.com:acme/gateline.git', 'run/csvpeek')).toBe(once)
  })
})

describe('LocalGitSource.originUrl', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A bare-minimum repo — the config read under test needs no runs and no commits. */
  function repo(originUrl?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'agentic-origin-'))
    dirs.push(dir)
    execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
    if (originUrl) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', originUrl])
    return dir
  }

  it('returns the configured origin verbatim — interpreting it is hostBranchUrl’s job', async () => {
    const dir = repo('git@github.com:acme/gateline.git')
    expect(await new LocalGitSource('s', dir).originUrl()).toBe('git@github.com:acme/gateline.git')
  })

  it('returns null when the repo has no origin', async () => {
    expect(await new LocalGitSource('s', repo()).originUrl()).toBeNull()
  })

  it('returns null for a local-only source even when a remote is configured (AC3)', async () => {
    // Local-only is a designation, not an observation: the source does not
    // push, does not fetch, and does not link out, whatever git config says.
    const dir = repo('git@github.com:acme/gateline.git')
    expect(await new LocalGitSource('s', dir, { localOnly: true }).originUrl()).toBeNull()
  })
})
