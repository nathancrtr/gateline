// Where the run page points you: which surface opens (#258), which artifact
// opens within it (#250), and which pending card the inbox sent you to (#216).
//
// The gate on the table decides both — not which filename sorts first, and not
// which storage location the bytes happen to live in. Since #249 closed the
// gate and profile vocabulary, that mapping is total: every (profile, gate)
// pair names exactly one artifact to open on.
//
// Pure and type-only by design, so it is unit-testable without a DOM and
// carries no React or core-runtime weight into the bundle.
import type { InboxItem, Profile } from './api.ts'

const REVIEW = /^review-\d+.*\.md$/
const isTask = (p: string) => p.startsWith('tasks/') && p.endsWith('.yaml')

/** The latest review report in filename order, or null when there are none. */
function newestReview(artifacts: string[]): string | null {
  const reviews = artifacts.filter((p) => REVIEW.test(p)).sort()
  return reviews[reviews.length - 1] ?? null
}

function firstTask(artifacts: string[]): string | null {
  return artifacts.filter(isTask).sort()[0] ?? null
}

/** The artifact one pending item wants open, or null when it has no opinion. */
function wantedBy(item: InboxItem, profile: Profile, artifacts: string[]): string | null {
  // A round cap asks "what didn't converge" — that starts at the last round.
  if (item.kind === 'round-cap') return newestReview(artifacts)
  // Escalations, paused, staged and malformed runs point at state.yaml, which
  // is not a reading surface; they keep the caller's default.
  if (item.kind !== 'gate') return null
  switch (item.gate) {
    case 'G0':
      return 'spec.md'
    case 'G1':
      // A patch run has no plan.md — G1 approves the human-authored work item.
      return profile === 'patch' ? firstTask(artifacts) : 'plan.md'
    case 'G2':
      // A patch run has no verifier, so the reviews are the whole packet.
      return profile === 'patch' ? newestReview(artifacts) : 'verification-report.md'
    case 'G3':
      return 'release-plan.md'
    default:
      return null
  }
}

/**
 * The artifact to open for a run, given what needs a human. Returns null when
 * nothing is pending, when the pending item has no reading surface, or when
 * the artifact it wants has not landed yet — in every one of those cases the
 * caller keeps its own default, so this can only ever improve the landing.
 *
 * A bounced (non-reviewable) gate still lands on its packet: seeing what is
 * malformed is exactly the job in that state.
 */
export function landingArtifact(input: { items: InboxItem[]; profile: Profile; artifacts: string[] }): string | null {
  for (const item of input.items) {
    const wanted = wantedBy(item, input.profile, input.artifacts)
    if (wanted !== null && input.artifacts.includes(wanted)) return wanted
  }
  return null
}

/**
 * The run page's surfaces (#258). Three tasks, not three storage locations:
 * decide what is on the table, read the record, read the decisions already
 * taken. `artifacts` and `diff` were containers and are retired.
 */
export type Surface = 'decide' | 'record' | 'history'

/**
 * What Record has open when the reader wants the change rather than a file.
 * Not a path, and it cannot collide with one: artifact paths are repo-relative
 * and never begin with `@`.
 */
export const DIFF_SELECTION = '@diff'

/** The retired container-tab names, and what each one means now. */
const RETIRED: Record<string, { surface: Surface; selection: string | null }> = {
  artifacts: { surface: 'record', selection: null },
  diff: { surface: 'record', selection: DIFF_SELECTION },
}

export interface Route {
  surface: Surface
  /** Record's selection: an artifact path, DIFF_SELECTION, or null for its own default. */
  selection: string | null
  /** The URL named a surface it did not get; the page should rewrite it in place. */
  rewrite: boolean
}

/**
 * Which surface the URL asks for, and which it actually gets.
 *
 * Two rules do all the work. A run with nothing pending is never offered an
 * empty Decide surface, so a `?tab=decide` link that has aged out lands on the
 * record instead of on a blank panel. And a URL that names a retired container
 * tab still resolves: `artifacts` is the record, `diff` is the record with the
 * change open — the views did not go anywhere, only the names did.
 *
 * `rewrite` reports that the resolved surface differs from what the URL said,
 * so the page can replace the params and leave a canonical URL behind. A URL
 * that names no tab at all is not a wrong URL — the surface is derived and
 * nothing is rewritten.
 */
export function resolveSurface(
  params: { tab: string | null; artifact: string | null },
  run: { pending: boolean },
): Route {
  const { tab, artifact } = params
  const resolved = resolve(tab, artifact, run.pending)
  return { ...resolved, rewrite: tab !== null && (tab !== resolved.surface || artifact !== resolved.selection) }
}

function resolve(tab: string | null, artifact: string | null, pending: boolean): { surface: Surface; selection: string | null } {
  const retired = tab === null ? undefined : RETIRED[tab]
  if (retired) return { surface: retired.surface, selection: retired.selection ?? artifact }
  // Decide exists only while something is on the table.
  if (tab === 'decide') return pending ? { surface: 'decide', selection: artifact } : { surface: 'record', selection: artifact }
  if (tab === 'record' || tab === 'history') return { surface: tab, selection: artifact }
  // No tab named, or one this page has never had. Naming an artifact is asking
  // to read it; otherwise the decision leads whenever there is one.
  if (artifact !== null) return { surface: 'record', selection: artifact }
  return { surface: pending ? 'decide' : 'record', selection: null }
}

/**
 * Which pending card the inbox's `?decide=` param names, or -1 (#216). The
 * four shapes mirror `itemHref` in pages/inbox.tsx exactly: a gate id, an
 * `esc-<n>` index, `paused`, or `staged`.
 *
 * A value that is unknown, stale, or names a decision the run has since moved
 * past resolves to -1, and the caller falls back to its ordinary behavior —
 * a link that has aged out is not an error state.
 */
export function decideTargetIndex(decide: string | null, items: InboxItem[]): number {
  if (decide === null || decide === '') return -1
  return items.findIndex((item) => {
    switch (item.kind) {
      case 'gate':
        return item.gate === decide
      case 'escalation':
        return item.escalationIndex !== null && decide === `esc-${item.escalationIndex}`
      case 'paused':
        return decide === 'paused'
      case 'staged':
        return decide === 'staged'
      default:
        return false
    }
  })
}
