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
/** Profile, phase, and the gate ledger, read leniently: a state.yaml too broken
 * to validate still names its profile and phase, and a description is no place
 * to lose them. Anything unreadable simply thins the banner. */
function readStateBits(raw: string | null): { profile: Profile | null; phase: string | null; gates: { id: string; approved: boolean }[] } {
  if (raw === null) return { profile: null, phase: null, gates: [] }
  const state = parseRunState(raw).state
  if (state) {
    return {
      profile: state.profile,
      phase: state.phase,
      gates: Object.entries(state.gates).map(([id, gate]) => ({ id, approved: gate.approved })),
    }
  }
  const profileMatch = /^profile:\s*([a-z]+)/m.exec(raw)
  const phaseMatch = /^phase:\s*([a-z-]+)/m.exec(raw)
  return {
    profile: profileMatch && (PROFILES as readonly string[]).includes(profileMatch[1]!) ? (profileMatch[1] as Profile) : null,
    phase: phaseMatch ? phaseMatch[1]! : null,
    gates: [],
  }
}

async function describeFromBranch(git: Git, rev: string, slug: string): Promise<{ desc: RunDescription; phase: string | null }> {
  let runDir = `runs/${slug}`
  let bits = readStateBits(null)
  let brief: string | null = null
  let spec: string | null = null
  try {
    const roots = await resolveFrameworkRoots(git, rev)
    runDir = `${roots.runs}/${slug}`
    bits = readStateBits(await git.show(rev, `${runDir}/state.yaml`))
    brief = await git.show(rev, `${runDir}/intent-brief.md`)
    spec = await git.show(rev, `${runDir}/spec.md`)
  } catch {
    // Fall through with whatever was read before the failure.
  }
  return { desc: describeRun({ slug, runDir, ...bits, brief, spec }), phase: bits.phase }
}

interface ListedPr {
  number: number
  title: string
  body: string
  state: string
  /** Absent when an older listing (or a test stub) didn't ask for it — treated as "don't know", so the draft flag is left alone. */
  isDraft?: boolean
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
 * Reconciles the GitHub draft flag with the run's phase (#232). Draft is how
 * the framework says "not yet" — and while a run is in flight that is exactly
 * right (#207). Once the phase is `done` every gate is signed and the record is
 * final, so the flag has become a lie sitting inches from a banner that reads
 * "Run complete", and the one state a merger most needs to see is asserted
 * nowhere they look.
 *
 * Only ever draft -> ready. A run cannot leave `done`, and re-drafting someone
 * else's deliberate "ready" would be the framework overriding a human. Returns
 * null when there is nothing to say, and never throws: a failed `gh pr ready`
 * degrades to a note like every other step in the ensure (AC8.2).
 */
async function readyPr(exec: ExecLike, dir: string, pr: ListedPr, phase: string | null): Promise<string | null> {
  if (phase !== 'done' || pr.isDraft !== true) return null
  try {
    await exec('gh', ['pr', 'ready', String(pr.number)], { cwd: dir, maxBuffer: 16 * 1024 * 1024 })
  } catch (e) {
    return `ready-for-review failed: ${e instanceof Error ? e.message : String(e)}`
  }
  return 'marked ready for review — the run is done'
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
 * A closed PR is absent for this purpose (#207): the branch is still live and
 * still accruing commits, so a run that outlives its PR gets a replacement
 * rather than being left with no review surface. A *merged* PR is the one
 * exception (#213) — that branch has shipped, and a replacement would be a PR
 * against landed work. The listing asks for every state so both rules can see
 * what they need: the merged verdict, and the name of the dead PR a
 * replacement stands in for.
 *
 * "Draft" in the name is the default, not the whole story (#232): the draft
 * flag tracks the run's phase, so a `done` run's PR is marked ready for review
 * in the same pass that writes its "Run complete" description.
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
        ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '20', '--json', 'number,title,body,state,isDraft'],
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

    const { desc, phase } = await describeFromBranch(git, `refs/remotes/origin/${branch}`, slug)

    const open = prs.find((pr) => pr.state === 'OPEN')
    if (open) {
      // Description first, draft flag second: if the ready-marking is what
      // draws a human to the PR, the text they arrive at should already be the
      // final one.
      const notes = [await refreshPr(exec, dir, open, desc), await readyPr(exec, dir, open, phase)]
      return { status: 'exists', note: `PR #${open.number} already exists for ${branch} — ${notes.filter(Boolean).join('; ')}` }
    }

    // A branch whose PR already merged has shipped, and shipped work is not
    // waiting on a review (#213). #207's replacement rule answers a run still
    // accruing commits toward a review nobody can give it; a merged branch is
    // the opposite case, and a replacement there is a PR against already-landed
    // content — opened ready-for-review, on a finished run, by a check the
    // operator never asked for. GitHub's own verdict is the signal here rather
    // than git ancestry, because a squash or rebase merge leaves the branch an
    // ancestor of nothing.
    const merged = prs.find((pr) => pr.state === 'MERGED')
    if (merged) {
      const stillRunning = phase !== null && phase !== 'done' ? ` — the run is still deriving on a branch that already shipped (see #213)` : ''
      return { status: 'skipped', note: `#${merged.number} already merged ${branch} — landed work gets no replacement PR${stillRunning}` }
    }

    // Every PR for this branch is closed, so the run has no review surface
    // (#207). Name the most recent dead one in the note — a replacement
    // appearing without explanation is its own confusion.
    const dead = prs[0]
    const base = await git.defaultBranch()
    // A replacement PR for an already-`done` run opens ready, not draft
    // (#232): there is no dispatch left to come back and un-draft it, so
    // opening it draft would strand it in a state nothing ever clears.
    const draft = phase !== 'done'
    try {
      await exec(
        'gh',
        ['pr', 'create', ...(draft ? ['--draft'] : []), '--head', branch, '--base', base, '--title', desc.title, '--body', desc.body],
        { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
      )
    } catch (e) {
      return { status: 'skipped', note: `gh pr create failed: ${e instanceof Error ? e.message : String(e)}` }
    }
    const standingIn = dead ? ` — replaces #${dead.number}, which is ${dead.state.toLowerCase()}` : ''
    return {
      status: 'created',
      note: `opened a ${draft ? 'draft' : 'ready-for-review'} PR for ${branch} against ${base} (described from ${desc.from})${standingIn}`,
    }
  } catch (e) {
    // Belt-and-braces: this function must never throw (AC8.2).
    return { status: 'skipped', note: `unexpected error ensuring PR: ${e instanceof Error ? e.message : String(e)}` }
  }
}
