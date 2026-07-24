// Role-scoped harvest pathspecs (run "runner-agent" ADR-3, review-04.md F1):
// what a role's remote dispatch may commit to its harvest branch
// (runner-agent/src/agent.ts) before the control plane folds it into the run
// branch. Scoped narrowly for roles with one well-known artifact path, so a
// stray file elsewhere in the workspace never rides along; roles whose
// output legitimately spans arbitrary source files harvest everything under
// the workspace instead — the review gate, not git, is what polices their
// file-contact surface (ORCHESTRATOR.md §5.3; e.g. review-04.md F7 flagged an
// out-of-surface implementer edit for the G2 human to ratify, rather than a
// git-level restriction silently dropping it).
export function harvestPathspecs(runsRoot: string, slug: string, role: string, task: string | null): string[] {
  void task // no role below needs task-scoping: each artifact path is either
  // fixed per run (analyst/architect/verifier/ops) or globs every round of
  // it (reviewer's review-NN.md); kept in the signature to match the
  // dispatch intent's own shape and for a future task-scoped artifact.
  const runDir = `${runsRoot}/${slug}`
  switch (role) {
    case 'analyst':
      return [`${runDir}/spec.md`]
    case 'architect':
      return [`${runDir}/plan.md`, `${runDir}/tasks/`]
    case 'reviewer':
      return [`${runDir}/review-*.md`]
    case 'ops':
      return [`${runDir}/release-plan.md`]
    default:
      // implementer (task-specific file-contact surface, reviewed rather
      // than git-restricted), verifier (verification-report.md plus
      // whatever tests it adds — contracts/verification-report.md permits
      // committing tests), and any role without one fixed artifact.
      return ['.']
  }
}
