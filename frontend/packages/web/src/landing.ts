// Where the run page lands when something needs a human (#250). The gate on
// the table decides which artifact opens — not which filename sorts first.
// Since #249 closed the gate and profile vocabulary, that mapping is total:
// every (profile, gate) pair names exactly one artifact to open on.
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
