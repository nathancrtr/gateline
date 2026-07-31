// The link out to the git host (#267). #259 decided that Gatehouse keeps the
// derived, gateline-specific views and retires the generic ones — but nothing
// may be deleted before its link-out exists, or the approver is left with no
// destination (FRONTEND.md §4.1). This is that link.
//
// Scope is the run's *branch*, not its PR, and the reason is purity. A PR
// number is not committed state: `ensureDraftPr` discards the PR's identity,
// nothing in the record has a field for it, and adding one is a format-freeze
// decision left to #248. A branch page needs neither — the run's branch is in
// the record already, the origin URL is in git config, and the host's branch
// page surfaces the associated PR itself.
//
// Pure, browser-safe, no I/O and no clock: the same shape as the typed review
// parsing (#214) and the ledger (#268). The caller supplies the origin URL it
// read; this decides what, if anything, it means.
//
// **Never guess.** Which remotes resolve is `parseGitHubRemote`'s answer, and it
// recognizes github.com and nothing else — deliberately, because a GitHub
// Enterprise host is real GitHub with a real branch page whose URL is
// indistinguishable from GitLab's or Gitea's: `git@git.example.com:owner/repo.git`
// is the same string under all three, and `/tree/<branch>` is not. Guessing
// there hands the approver a 404 dressed as an answer, which is worse than the
// local view they already have. An unrecognized remote yields null and the
// caller keeps its own rendering — the contracts' bounce rule turned on the UI.
import { parseGitHubRemote } from '../sources/github.ts'

/**
 * The host's page for `branch` in the repo `origin` points at, or null when
 * the remote is not one this can resolve without guessing, the origin is
 * absent (a local-only source or a repo with no remote — AC3), or the branch
 * name is empty.
 *
 * Every segment of the branch is percent-encoded but the separators are not:
 * `run/csvpeek` addresses the branch, not a directory called `run`, and
 * GitHub's tree URLs read it that way.
 */
export function hostBranchUrl(origin: string | null | undefined, branch: string): string | null {
  if (!origin || origin.trim() === '') return null
  const remote = parseGitHubRemote(origin)
  if (!remote) return null
  if (!branch || branch.trim() === '') return null
  const path = branch
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `https://github.com/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/tree/${path}`
}
