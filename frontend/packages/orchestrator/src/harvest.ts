// Role-scoped harvest pathspecs (#182 — engine.ts's local harvest-commit for
// a non-isolated dispatch; run "runner-agent" ADR-3 — the remote worker's
// harvest-then-dispose): what a role's own dispatch may commit, so a peer's
// mid-flight file — a reviewer sharing the same run checkout, a stray file
// elsewhere in a remote workspace — never rides along. Shared by both
// consumers so the mapping has one home instead of drifting between two
// copies (review-04.md F1 first found this file missing entirely; #182
// landed its own copy independently before the two were reconciled here).
export function harvestPathspecs(runsRoot: string, slug: string, role: string, task: string | null): string[] {
  const runDir = `${runsRoot}/${slug}`
  switch (role) {
    case 'analyst':
      return [`${runDir}/spec.md`]
    case 'architect':
      return [`${runDir}/plan.md`, `${runDir}/tasks/`]
    case 'reviewer': {
      const nn = task ? /^\d+/.exec(task)?.[0] : null
      return [`${runDir}/${nn ? `review-${nn}*.md` : 'review-*.md'}`]
    }
    case 'verifier':
      return [`${runDir}/verification-report.md`]
    case 'ops':
      return [`${runDir}/release-plan.md`]
    case 'implementer':
      // Task-specific file-contact surface, spanning arbitrary source files
      // outside runs/<slug>/ — policed by review, not git (review-04.md F7's
      // precedent: a G2-ratified out-of-surface edit rather than a silent
      // drop). #182's local harvest-commit never reaches this case (an
      // implementer with a task is always isolated via `foldTaskBranch`,
      // never the non-isolated harvest-commit path) — it only matters for
      // the remote runner (run "runner-agent"), where an implementer
      // dispatch is never isolated either (no local checkout to fold).
      return ['.']
    default:
      // A role with no fixed single artifact and no known broad surface
      // (e.g. a future role, or a task-less implementer dispatch on the
      // local path): scoped to the run's own bookkeeping directory rather
      // than the whole repo, the conservative default for a mechanism that
      // otherwise runs unattended under the bot identity.
      return [`${runDir}/`]
  }
}
