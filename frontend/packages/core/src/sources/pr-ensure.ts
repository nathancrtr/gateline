// Draft-PR ensure (#118, R8): best-effort, idempotent, and never fatal. A
// staged/armed run's first `agentic arm` or the engine's first dispatch calls
// this so a reviewable PR exists regardless of how the branch was made — by
// hand, by the CLI, or (later) by a GitHub-triggered intake. It never throws:
// no remote, an unpushed branch, or any `gh` failure (missing binary,
// unauthed, network) all degrade to `skipped` with the reason in `note`
// (AC8.2) rather than surfacing an error to the caller.
import { execFile } from 'node:child_process'
import { Git } from './git.ts'

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
 * Ensures a draft PR exists for `branch` (the run `slug`'s branch), opening
 * one if none exists yet. Steps: no `remote.origin.url` configured ->
 * skipped; `branch` isn't on origin yet -> skipped ("branch not pushed");
 * `gh pr list --head <branch> --state all --limit 1 --json number` finds any
 * PR (any state) -> exists; else `gh pr create --draft ...` -> created.
 */
export async function ensureDraftPr(
  dir: string,
  branch: string,
  slug: string,
  opts?: { exec?: ExecLike },
): Promise<EnsurePrResult> {
  try {
    const exec = opts?.exec ?? defaultExec
    const git = new Git(dir)

    const origin = await git.configGet('remote.origin.url')
    if (!origin) return { status: 'skipped', note: 'no remote.origin.url configured — nothing to open a PR against' }

    const onOrigin = await git.revParse(`refs/remotes/origin/${branch}`)
    if (!onOrigin) return { status: 'skipped', note: `branch not pushed: refs/remotes/origin/${branch} does not exist yet` }

    let listOut: string
    try {
      listOut = await exec('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number'], {
        cwd: dir,
        maxBuffer: 16 * 1024 * 1024,
      })
    } catch (e) {
      return { status: 'skipped', note: `gh pr list failed: ${e instanceof Error ? e.message : String(e)}` }
    }

    let prs: { number: number }[]
    try {
      prs = JSON.parse(listOut) as { number: number }[]
    } catch (e) {
      return { status: 'skipped', note: `gh pr list returned unparseable output: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (prs.length > 0) return { status: 'exists', note: `PR #${prs[0]!.number} already exists for ${branch}` }

    const base = await git.defaultBranch()
    const body = `Draft PR for \`run/${slug}\` — see \`runs/${slug}/\` for the run record.`
    try {
      await exec(
        'gh',
        ['pr', 'create', '--draft', '--head', branch, '--base', base, '--title', `run/${slug}`, '--body', body],
        { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
      )
    } catch (e) {
      return { status: 'skipped', note: `gh pr create failed: ${e instanceof Error ? e.message : String(e)}` }
    }
    return { status: 'created', note: `opened a draft PR for ${branch} against ${base}` }
  } catch (e) {
    // Belt-and-braces: this function must never throw (AC8.2).
    return { status: 'skipped', note: `unexpected error ensuring PR: ${e instanceof Error ? e.message : String(e)}` }
  }
}
