// The tick's read half, shared by dry-run (M1) and the live engine (M2):
// for each active run, observe at the branch tip and derive the next action.
// Dry-run stops here — no writes, no dispatches, exactly what shadow mode
// promises. The write/execute half lives in engine.ts.
import type { RunRef, RunSource } from '@agentic/core'
import { deriveAction, type DerivedAction } from './derive.ts'
import { observeRun, type ObserveConfig, type RunObservation } from './observe.ts'

export interface TickDerivation {
  ref: RunRef
  observation: RunObservation
  action: DerivedAction
}

export async function deriveAll(source: RunSource, cfg: ObserveConfig = {}): Promise<TickDerivation[]> {
  const out: TickDerivation[] = []
  for (const ref of await source.listRuns()) {
    // Merged (default-branch) runs are historical records; the engine never
    // acts on them, but deriving still reports them honestly (D1 rest).
    const observation = await observeRun(source, ref, cfg)
    out.push({ ref, observation, action: deriveAction(observation) })
  }
  return out
}
