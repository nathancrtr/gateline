// GitHub REST touchpoints for hosted deployments: a PrProvider that needs no
// gh CLI (sync.ts's GhCliProvider assumes an operator's logged-in gh), and
// the remote-URL parsing that scopes it to one repository. Auth is the same
// fine-grained token the deploy recipe already holds — no GitHub App yet.
import type { PrApproval, PrProvider } from './sync.ts'

export interface GitHubRepo {
  owner: string
  repo: string
}

/** owner/repo from a GitHub remote URL (https, ssh, or scp-like), else null. */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    )
  if (!match) return null
  return { owner: match[1]!, repo: match[2]! }
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/**
 * PrProvider over the GitHub REST API. "Approved" means the most recent
 * APPROVED review with no CHANGES_REQUESTED submitted after it — the REST
 * approximation of GraphQL's reviewDecision, documented as such.
 */
export class RestPrProvider implements PrProvider {
  private readonly target: GitHubRepo
  private readonly token: string
  private readonly fetchImpl: FetchLike
  private readonly apiBase: string

  constructor(target: GitHubRepo, token: string, opts: { fetchImpl?: FetchLike; apiBase?: string } = {}) {
    this.target = target
    this.token = token
    this.fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike)
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '')
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'agentic-frontend',
      },
    })
    if (!response.ok) throw new Error(`GitHub API ${path} failed: HTTP ${response.status}`)
    return response.json()
  }

  async approval(branch: string): Promise<PrApproval | null> {
    const { owner, repo } = this.target
    const prs = (await this.get(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=1`,
    )) as { number: number; html_url: string }[]
    const pr = prs[0]
    if (!pr) return null

    const reviews = (await this.get(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`)) as {
      state: string
      submitted_at: string
      user: { login: string } | null
    }[]
    const approved = reviews.filter((r) => r.state === 'APPROVED').at(-1)
    if (!approved) return null
    const rejectedAfter = reviews.some(
      (r) => r.state === 'CHANGES_REQUESTED' && Date.parse(r.submitted_at) > Date.parse(approved.submitted_at),
    )
    if (rejectedAfter) return null
    return {
      number: pr.number,
      url: pr.html_url,
      reviewer: approved.user?.login ?? 'unknown',
      submittedAt: approved.submitted_at,
    }
  }
}
