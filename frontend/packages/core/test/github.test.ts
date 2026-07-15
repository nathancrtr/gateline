// RestPrProvider: the gh-CLI-free PR-approval lookup for hosted deployments.
import { describe, expect, it } from 'vitest'
import { parseGitHubRemote, RestPrProvider } from '../src/github.ts'

describe('parseGitHubRemote', () => {
  it('parses https, ssh, and scp-like remotes with and without .git', () => {
    for (const url of [
      'https://github.com/acme/widgets.git',
      'https://github.com/acme/widgets',
      'https://x-access-token:tok@github.com/acme/widgets.git',
      'git@github.com:acme/widgets.git',
      'ssh://git@github.com/acme/widgets.git',
    ]) {
      expect(parseGitHubRemote(url), url).toEqual({ owner: 'acme', repo: 'widgets' })
    }
  })

  it('rejects non-GitHub remotes', () => {
    expect(parseGitHubRemote('https://gitlab.com/acme/widgets.git')).toBeNull()
    expect(parseGitHubRemote('/local/path/repo')).toBeNull()
  })
})

type Responses = Record<string, unknown>

function fakeFetch(responses: Responses, seen: string[] = []) {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push(url)
    expect(init?.headers?.authorization).toBe('Bearer tok')
    const path = new URL(url).pathname + new URL(url).search
    const body = responses[path]
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body }
  }
}

const review = (state: string, at: string, login = 'reviewer-1') => ({ state, submitted_at: at, user: { login } })

describe('RestPrProvider.approval', () => {
  const target = { owner: 'acme', repo: 'widgets' }
  const prPath = '/repos/acme/widgets/pulls?head=acme%3Arun%2Ftoy&state=all&per_page=1'
  const reviewsPath = '/repos/acme/widgets/pulls/7/reviews?per_page=100'
  const pr = [{ number: 7, html_url: 'https://github.com/acme/widgets/pull/7' }]

  it('returns the latest APPROVED review', async () => {
    const provider = new RestPrProvider(target, 'tok', {
      fetchImpl: fakeFetch({
        [prPath]: pr,
        [reviewsPath]: [review('COMMENTED', '2026-07-01T00:00:00Z'), review('APPROVED', '2026-07-02T00:00:00Z')],
      }),
    })
    expect(await provider.approval('run/toy')).toEqual({
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      reviewer: 'reviewer-1',
      submittedAt: '2026-07-02T00:00:00Z',
    })
  })

  it('returns null when CHANGES_REQUESTED follows the approval', async () => {
    const provider = new RestPrProvider(target, 'tok', {
      fetchImpl: fakeFetch({
        [prPath]: pr,
        [reviewsPath]: [review('APPROVED', '2026-07-02T00:00:00Z'), review('CHANGES_REQUESTED', '2026-07-03T00:00:00Z')],
      }),
    })
    expect(await provider.approval('run/toy')).toBeNull()
  })

  it('returns null when no PR exists for the branch', async () => {
    const provider = new RestPrProvider(target, 'tok', { fetchImpl: fakeFetch({ [prPath]: [] }) })
    expect(await provider.approval('run/toy')).toBeNull()
  })

  it('throws on API failure rather than reporting "no approval"', async () => {
    const provider = new RestPrProvider(target, 'tok', { fetchImpl: fakeFetch({}) })
    await expect(provider.approval('run/toy')).rejects.toThrow('HTTP 404')
  })
})
