// Arming a patch run needs its work item to exist and be written (#221).
//
// DESIGN.md §4.1: in a patch run the human authors the intent brief *and*
// the single work item at staging — the analyst/architect judgment being
// skipped is theirs to supply. `gateline new` scaffolds a stub so the record
// is well-formed from the first commit, and nothing else in the pipeline
// reads that stub for meaning: an implementer dispatched against "Fill in
// what to build" has no spec or plan to fall back on. So the stub is refused
// at the one moment a human is already acting on the run.
import { type RunState, workItemIncomplete } from '../record/index.ts'
import type { RunRef, RunSource } from './source.ts'

/**
 * Why `arm` must refuse this run, or null when it may proceed. Only a
 * `patch` run has anything to check; every other profile plans its tasks
 * after G1.
 */
export async function armRefusal(source: RunSource, ref: RunRef, state: RunState): Promise<string | null> {
  if (state.profile !== 'patch') return null
  const remedy = `author it before arming — \`gateline new --profile patch --task-file <path>\` stages a written one, or edit it on run/${ref.slug} from a throwaway worktree (never the blessed checkout, TOPOLOGY.md §3.5)`
  const items = (await source.listArtifacts(ref)).filter((p) => p.startsWith('tasks/') && p.endsWith('.yaml'))
  if (items.length === 0) return `patch run ${ref.slug} has no work item under tasks/ — ${remedy}`
  for (const path of items) {
    const content = await source.readArtifact(ref, path)
    const why = content === null ? 'unreadable' : workItemIncomplete(content)
    if (why) return `patch run ${ref.slug}: ${path} is not a dispatchable work item (${why}) — ${remedy}`
  }
  return null
}
