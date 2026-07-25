// Draft-PR ensure (#118, R8): best-effort, idempotent, and never fatal. A
// staged/armed run's first `agentic arm` or the engine's first dispatch calls
// this so a reviewable PR exists regardless of how the branch was made — by
// hand, by the CLI, or (later) by a GitHub-triggered intake. It never throws:
// no remote, an unpushed branch, or any `gh` failure (missing binary,
// unauthed, network) all degrade to `skipped` with the reason in `note`
// (AC8.2) rather than surfacing an error to the caller.
//
// The title and body come from the run's own artifacts (#202, pr-description.ts)
// rather than the branch name, and are refreshed as better artifacts land —
// until a human edits the body, which hands the description over for good.
import { execFile } from 'node:child_process'
import { parseRunState, PROFILES, type Profile } from '../record/schema.ts'
import { resolveFrameworkRoots } from './framework-roots.ts'
import { Git } from './git.ts'
import { describeRun, isGeneratedBody, type RunDescription } from './pr-description.ts'

export interface EnsurePrResult {
  status: 'created' | 'exists' | 'skipped'
  note: string
}

/**
 * Same invocation shape as `Git.run` / `GhCliProvider` (sources/sync.ts):
 * `(cmd, args, opts) -> stdout`, rejecting on a non-zero exit. Injectable so
 * tests never shell out to a real `gh`.
 */
export type ExecLike = (cmd: string, args: string[], opts: { cwd: string; maxBuffer: number }) => Promise<string>

const defaultExec: ExecLike = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  })

/**
 * Reads the run's artifacts off `rev` and builds the PR title/body from them
 * (#202). Every read is best-effort: a missing run directory, an unparseable
 * state.yaml, or a malformed artifact degrades to a thinner description — at
 * worst today's `run/<slug>` title — and never to a failure.
 */
/** The run's profile, read leniently: a state.yaml too broken to validate
 * still names its profile, and a description is no place to lose that. */
function readProfile(raw: string | null): Profile | null {
  if (raw === null) return null
  const validated = parseRunState(raw).state?.profile
  if (validated) return validated
  const m = /^profile:\s*([a-z]+)/m.exec(raw)
  return m && (PROFILES as readonly string[]).includes(m[1]!) ? (m[1] as Profile) : null
}

async function describeFromBranch(git: Git, rev: string, slug: string): Promise<RunDescription> {
  let runDir = `runs/${slug}`
  let profile: Profile | null = null
  let brief: string | null = null
  let spec: string | null = null
  try {
    const roots = await resolveFrameworkRoots(git, rev)
    runDir = `${roots.runs}/${slug}`
    profile = readProfile(await git.show(rev, `${runDir}/state.yaml`))
    brief = await git.show(rev, `${runDir}/intent-brief.md`)
    spec = await git.show(rev, `${runDir}/spec.md`)
  } catch {
    // Fall through with whatever was read before the failure.
  }
  return describeRun({ slug, runDir, profile, brief, spec })
}

interface ListedPr {
  number: number
  title: string
  body: string
  state: string
}

/**
 * Refreshes an open PR's title/body when the framework still owns them (the
 * `<!-- agentic:draft-pr -->` marker is present) and the newest artifacts would
 * produce different text. A human-edited body and an already-current
 * description are both left alone.
 */
async function refreshPr(
  exec: ExecLike,
  dir: string,
  pr: ListedPr,
  desc: RunDescription,
): Promise<string> {
  if (!isGeneratedBody(pr.body)) return 'description is human-authored — left untouched'
  if (pr.title === desc.title && pr.body === desc.body) return `description already current (from ${desc.from})`
  try {
    await exec('gh', ['pr', 'edit', String(pr.number), '--title', desc.title, '--body', desc.body], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (e) {
    return `description refresh failed: ${e instanceof Error ? e.message : String(e)}`
  }
  return `description refreshed from ${desc.from}`
}

/**
 * Ensures an *open* draft PR exists for `branch` (the run `slug`'s branch),
 * opening one if there is none, and keeps its description current while the
 * framework still owns it. Steps: no `remote.origin.url` configured ->
 * skipped; `branch` isn't on origin yet -> skipped ("branch not pushed");
 * `gh pr list --head <branch> --state all` finds an open PR -> exists,
 * refreshing its generated title/body (#202) if the run's artifacts have moved
 * on; else `gh pr create --draft ...` -> created.
 *
 * A merged or closed PR is absent for this purpose (#207): the branch is still
 * live and still accruing commits, so a run that outlives its PR gets a
 * replacement rather than being left with no review surface. The listing still
 * asks for every state, because that is how the replacement note can name the
 * dead PR it is standing in for.
 */
export async function ensureDraftPr(
  dir: string,
  branch: string,
  slug: string,
  opts?: { exec?: ExecLike; localOnly?: boolean },
): Promise<EnsurePrResult> {
  if (opts?.localOnly) return { status: 'skipped', note: 'local-only mode — draft-PR ensure suppressed' }
  try {
    const exec = opts?.exec ?? defaultExec
    const git = new Git(dir)

    const origin = await git.configGet('remote.origin.url')
    if (!origin) return { status: 'skipped', note: 'no remote.origin.url configured — nothing to open a PR against' }

    const onOrigin = await git.revParse(`refs/remotes/origin/${branch}`)
    if (!onOrigin) return { status: 'skipped', note: `branch not pushed: refs/remotes/origin/${branch} does not exist yet` }

    let listOut: string
    try {
      listOut = await exec(
        'gh',
        ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '20', '--json', 'number,title,body,state'],
        { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
      )
    } catch (e) {
      return { status: 'skipped', note: `gh pr list failed: ${e instanceof Error ? e.message : String(e)}` }
    }

    let prs: ListedPr[]
    try {
      prs = JSON.parse(listOut) as ListedPr[]
    } catch (e) {
      return { status: 'skipped', note: `gh pr list returned unparseable output: ${e instanceof Error ? e.message : String(e)}` }
    }

    const desc = await describeFromBranch(git, `refs/remotes/origin/${branch}`, slug)

    const open = prs.find((pr) => pr.state === 'OPEN')
    if (open) {
      const refreshed = await refreshPr(exec, dir, open, desc)
      return { status: 'exists', note: `PR #${open.number} already exists for ${branch} — ${refreshed}` }
    }

    // Every PR for this branch is merged or closed, so the run has no review
    // surface (#207). Name the most recent dead one in the note — a
    // replacement appearing without explanation is its own confusion.
    const dead = prs[0]
    const base = await git.defaultBranch()
    try {
      await exec(
        'gh',
        ['pr', 'create', '--draft', '--head', branch, '--base', base, '--title', desc.title, '--body', desc.body],
        { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
      )
    } catch (e) {
      return { status: 'skipped', note: `gh pr create failed: ${e instanceof Error ? e.message : String(e)}` }
    }
    const standingIn = dead ? ` — replaces #${dead.number}, which is ${dead.state.toLowerCase()}` : ''
    return {
      status: 'created',
      note: `opened a draft PR for ${branch} against ${base} (described from ${desc.from})${standingIn}`,
    }
  } catch (e) {
    // Belt-and-braces: this function must never throw (AC8.2).
    return { status: 'skipped', note: `unexpected error ensuring PR: ${e instanceof Error ? e.message : String(e)}` }
  }
}
