// GitHub PR-approval sync (FRONTEND.md §2): a G2 approval that happened as a
// PR review is copied into state.yaml — mechanically, so the file stays
// canonical and the audit trail doesn't fork. The gate entry records the PR
// reviewer and review time (not the syncer, not sync time); burden stays
// unrecorded — the sync can't know how hard the review was. Phase is not
// advanced: recording a fact is not orchestrating.
import { execFile } from 'node:child_process'
import { gateUndecided } from './schema.ts'
import type { RunRef, RunSource, WriteResult } from './source.ts'

export interface PrApproval {
  number: number
  url: string
  reviewer: string
  submittedAt: string // ISO-8601
}

export interface PrProvider {
  /** Latest APPROVED review of the PR whose head is `branch`, or null. */
  approval(branch: string): Promise<PrApproval | null>
}

export interface SyncPlanEntry {
  source: string
  slug: string
  gate: 'G2'
  approval: PrApproval
  message: string
}

export interface SyncResult extends SyncPlanEntry {
  ok: boolean
  commit?: string
  error?: string
}

/** Runs whose G2 is undecided but whose PR carries an approved review. */
export async function planSync(source: RunSource, provider: PrProvider): Promise<SyncPlanEntry[]> {
  const plan: SyncPlanEntry[] = []
  for (const ref of await source.listRuns()) {
    if (ref.kind === 'default') continue // merged: history, not a pending gate
    const { state } = await source.readState(ref)
    if (!state || !gateUndecided(state.gates.G2)) continue
    const approval = await provider.approval(ref.branch)
    if (!approval) continue
    plan.push({
      source: source.id,
      slug: ref.slug,
      gate: 'G2',
      approval,
      message: `state(${ref.slug}): G2 approved by ${approval.reviewer} [synced from PR #${approval.number}]`,
    })
  }
  return plan
}

export async function applySync(source: RunSource, entries: SyncPlanEntry[]): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  const refs = await source.listRuns()
  for (const entry of entries) {
    const ref = refs.find((r) => r.slug === entry.slug)
    if (!ref) {
      results.push({ ...entry, ok: false, error: 'run disappeared between plan and apply' })
      continue
    }
    const { approval } = entry
    const write: WriteResult = await source.writeState(
      ref,
      (doc) => {
        doc.setIn(['gates', 'G2', 'approved'], true)
        doc.setIn(['gates', 'G2', 'by'], approval.reviewer)
        doc.setIn(['gates', 'G2', 'at'], approval.submittedAt)
        doc.setIn(['gates', 'G2', 'notes'], `approved via PR #${approval.number} review (${approval.url}); synced`)
      },
      entry.message,
    )
    results.push({ ...entry, ok: write.ok, commit: write.commit, error: write.ok ? undefined : (write.message ?? write.reason) })
  }
  return results
}

/** PrProvider over the `gh` CLI — reuses the operator's existing auth. */
export class GhCliProvider implements PrProvider {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async approval(branch: string): Promise<PrApproval | null> {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        'gh',
        ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,url,reviewDecision,latestReviews'],
        { cwd: this.dir, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => (err ? reject(new Error(`gh pr list failed: ${stderr || err.message}`)) : resolve(stdout)),
      )
    })
    const prs = JSON.parse(out) as {
      number: number
      url: string
      reviewDecision: string
      latestReviews: { author: { login: string }; state: string; submittedAt: string }[]
    }[]
    const pr = prs[0]
    if (!pr || pr.reviewDecision !== 'APPROVED') return null
    const review = pr.latestReviews.filter((r) => r.state === 'APPROVED').at(-1)
    if (!review) return null
    return { number: pr.number, url: pr.url, reviewer: review.author.login, submittedAt: review.submittedAt }
  }
}
