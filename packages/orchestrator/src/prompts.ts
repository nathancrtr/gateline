// Dispatch prompts are templates, not compositions (ORCHESTRATOR.md §5.4):
// rendered agents already inline their role spec, so the prompt carries only
// the run-specific bindings — slug, paths, task, round, and on a bounce, the
// named missing sections or decline notes. WALKTHROUGH.md's copy-pasteable
// dispatch lines are the source. No model composes prompts.
//
// One v1 addition to the v0 grammar: a shell-ful role is told to commit its
// own work — the commit is how completion becomes observable to the next
// tick. A shell-less role (analyst, architect: no adapter maps their
// capabilities to a git-capable tool) is told the opposite: leave the files
// in the working tree, because the engine harvest-commits them itself
// (ORCHESTRATOR.md §4.4) before the checkout is ever removed.
import type { Profile } from '@gateline/core/record'
import type { DispatchIntent } from './derive.ts'

const COMMIT_LINE = (slug: string, what: string) =>
  `When your work is complete, commit it on the current branch (git add the files you produced or changed) with a message starting "${slug}: ${what}".`

const HARVEST_LINE = (slug: string) =>
  `When your work is complete, leave the files you produced in the working tree — you have no shell and must not attempt to commit; the orchestrator commits them for you on the current branch (message starting "${slug}: harvested").`

/** DESIGN.md §4.1: in a patch run there is no spec.md/plan.md — the brief and work item are the standard. */
const PATCH_BASELINE = (runDir: string) =>
  `This is a patch-profile run: there is no spec.md or plan.md. The intent brief (\`${runDir}/intent-brief.md\`) and the work item are the full scope and the standard to work against.`

export function promptBody(
  slug: string,
  intent: DispatchIntent,
  taskPath: string | null,
  runsRoot: string = 'runs',
  profile: Profile = 'full',
  hasShell: boolean,
): string {
  const runDir = `${runsRoot}/${slug}`
  const parts: string[] = []
  switch (intent.role) {
    case 'analyst':
      parts.push(`for run \`${runDir}\`.`)
      parts.push(hasShell ? COMMIT_LINE(slug, 'spec') : HARVEST_LINE(slug))
      break
    case 'architect':
      parts.push(`for run \`${runDir}\`.`)
      if (intent.bounce?.kind === 'amendment')
        parts.push(
          `This is an amendment-mode dispatch (disposition re-plan): task ${intent.bounce.task}'s reviewer escalation — see \`${runDir}/${intent.bounce.report}\` — was resolved with this note from the human: "${intent.bounce.note}". Amend plan.md with a new, dated ADR; if the finding names a surface/decomposition defect, you may also widen the affected task's file_contact_surface in tasks/*.yaml — check it against every other task's surface and serialize any overlap via depends_on. Change nothing else.`,
        )
      parts.push(hasShell ? COMMIT_LINE(slug, 'plan and task breakdown') : HARVEST_LINE(slug))
      break
    case 'implementer':
      parts.push(`on task \`${runDir}/${taskPath ?? `tasks/${intent.task}.yaml`}\`.`)
      if (profile === 'patch') parts.push(PATCH_BASELINE(runDir))
      if (intent.round && intent.round > 1 && intent.bounce?.kind === 'review')
        parts.push(`This is round ${intent.round}: address every finding in \`${runDir}/${intent.bounce.report}\` — fix it, or rebut it finding-by-finding in the task file's notes.`)
      parts.push(hasShell ? COMMIT_LINE(slug, `task ${intent.task ?? ''} round ${intent.round ?? 1}`.trim()) : HARVEST_LINE(slug))
      break
    case 'reviewer':
      parts.push(`on task \`${runDir}/${taskPath ?? `tasks/${intent.task}.yaml`}\`, reviewing the diff of the last commit(s) for that task.`)
      if (profile === 'patch') parts.push(PATCH_BASELINE(runDir))
      if (intent.round && intent.round > 1)
        parts.push(`This is round ${intent.round}: verify each prior finding is genuinely resolved and append a clearly-marked round section to the existing report — never overwrite earlier rounds.`)
      parts.push(hasShell ? COMMIT_LINE(slug, `review task ${intent.task ?? ''} round ${intent.round ?? 1}`.trim()) : HARVEST_LINE(slug))
      break
    case 'verifier':
      parts.push(`for run \`${runDir}\`, verifying the changes on this branch.`)
      parts.push(hasShell ? COMMIT_LINE(slug, 'verification report') : HARVEST_LINE(slug))
      break
    case 'ops':
      parts.push(`for run \`${runDir}\`.`)
      parts.push(hasShell ? COMMIT_LINE(slug, 'release plan') : HARVEST_LINE(slug))
      break
  }

  if (intent.bounce?.kind === 'malformed')
    parts.push(
      `Your previous \`${intent.bounce.artifact}\` was bounced as malformed: it is missing the required section(s) ${intent.bounce.missing.map((m) => `"${m}"`).join(', ')}. Produce a complete artifact per its contract.`,
    )
  if (intent.bounce?.kind === 'gate-declined')
    parts.push(
      `The gate reviewing your artifact was declined by its human owner${intent.bounce.notes ? ` with these notes: ${intent.bounce.notes}` : ''}. Redo the artifact addressing the decline.`,
    )
  return parts.join(' ')
}

/** The full prompt through the adapter's template. */
export function renderPrompt(template: string, role: string, body: string): string {
  return template.replaceAll('{role}', role).replaceAll('{body}', body)
}
