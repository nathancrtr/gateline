// Why a run's state could not be read (#435), from core's `StateProblem`.
//
// Only the parser's case has words from the machine, and they are set as the
// Diagnostic they are, under the parser's name. Every other case is the
// cockpit's own sentence: the run state named as the rail names it, and its
// file after that as the Address. The file is a link only when it is there to
// open.

import type { StateProblem } from '../api.ts'
import { railLabel } from '../record-rail.ts'
import { Address, artifactHref, Diagnostic } from './vocabulary.tsx'

export function UnreadableState({ problem, src, slug }: { problem: StateProblem; src: string; slug: string }) {
  if (problem.kind === 'parser') return <Diagnostic producer="Run state parser">{problem.diagnostic}</Diagnostic>
  const kind = railLabel(problem.ledger).text
  return (
    <p className="font-ui text-[11.5px] leading-[1.5] text-muted" data-state-problem={problem.kind}>
      {problem.kind === 'absent' ? (
        <>
          The {kind} is missing from the run <Address size="xs">{problem.ledger.path}</Address>
        </>
      ) : (
        <>
          No state could be read from the {kind}, and no reason was given{' '}
          <Address size="xs" to={artifactHref(src, slug, problem.ledger.path)}>
            {problem.ledger.path}
          </Address>
        </>
      )}
    </p>
  )
}
