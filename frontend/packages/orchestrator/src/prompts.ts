// Dispatch prompts are templates, not compositions (ORCHESTRATOR.md §5.4):
// rendered agents already inline their role spec, so the prompt carries only
// the run-specific bindings — slug, paths, task, round, and on a bounce, the
// named missing sections or decline notes. WALKTHROUGH.md's copy-pasteable
// dispatch lines are the source. No model composes prompts.
//
// One v1 addition to the v0 grammar: agents are told to commit their own
// work (the role specs default to leaving changes uncommitted "unless your
// dispatch says otherwise" — headless runs say otherwise, because the commit
// is how completion becomes observable to the next tick).
import type { DispatchIntent } from './derive.ts'

const COMMIT_LINE = (slug: string, what: string) =>
  `When your work is complete, commit it on the current branch (git add the files you produced or changed) with a message starting "${slug}: ${what}".`

export function promptBody(slug: string, intent: DispatchIntent, taskPath: string | null): string {
  const runDir = `runs/${slug}`
  const parts: string[] = []
  switch (intent.role) {
    case 'analyst':
      parts.push(`for run \`${runDir}\`.`)
      parts.push(COMMIT_LINE(slug, 'spec'))
      break
    case 'architect':
      parts.push(`for run \`${runDir}\`.`)
      parts.push(COMMIT_LINE(slug, 'plan and task breakdown'))
      break
    case 'implementer':
      parts.push(`on task \`${runDir}/${taskPath ?? `tasks/${intent.task}.yaml`}\`.`)
      if (intent.round && intent.round > 1 && intent.bounce?.kind === 'review')
        parts.push(`This is round ${intent.round}: address every finding in \`${runDir}/${intent.bounce.report}\` — fix it, or rebut it finding-by-finding in the task file's notes.`)
      parts.push(COMMIT_LINE(slug, `task ${intent.task ?? ''} round ${intent.round ?? 1}`.trim()))
      break
    case 'reviewer':
      parts.push(`on task \`${runDir}/${taskPath ?? `tasks/${intent.task}.yaml`}\`, reviewing the diff of the last commit(s) for that task.`)
      if (intent.round && intent.round > 1)
        parts.push(`This is round ${intent.round}: verify each prior finding is genuinely resolved and append a clearly-marked round section to the existing report — never overwrite earlier rounds.`)
      parts.push(COMMIT_LINE(slug, `review task ${intent.task ?? ''} round ${intent.round ?? 1}`.trim()))
      break
    case 'verifier':
      parts.push(`for run \`${runDir}\`, verifying the changes on this branch.`)
      parts.push(COMMIT_LINE(slug, 'verification report'))
      break
    case 'ops':
      parts.push(`for run \`${runDir}\`.`)
      parts.push(COMMIT_LINE(slug, 'release plan'))
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
