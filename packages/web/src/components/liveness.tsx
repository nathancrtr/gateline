// A repository's standing facts: its mode, and its engine when that is a
// plain fact rather than an alarm (#499; docs/MULTI-REPO.md §9.5). What is
// computed lives in `../liveness.ts`; this file is the markup.
//
// Two kinds of thing are said about an engine, and they go to two places.
// An outage — an engine expected in a `dispatch` repository that is not
// reporting — is an alarm, and it is the banner at the top of the page
// (`app.tsx`), where it has always been. Everything else is a standing fact
// about a repository — `mode decide`, "No engine in this deployment", "An
// engine outside this deployment, last seen 2m ago" — and it is stated beside
// the repository's name wherever the rail lists repositories: under each
// entry of the scope control when the set has several, and at the rail's foot
// when it has one, where there is no list and the rail's own standing text
// already sits. Below 768px the rail is a top bar with no room for it, and the
// facts sink to the foot of the page (`PageFootFacts`).
//
// Text only, in the cockpit's voice, composed here from the mode and the
// heartbeat. No colour: nothing here is wrong, and colour in Gatehouse
// carries state (GATEHOUSE-DESIGN.md round 5). The one exception is a
// repository that could not be read, which takes the caution ink the page's
// notice uses.

import { useQuery } from '@tanstack/react-query'
import { api, type EngineHealthEntry, formatAge, type RepositoryMode } from '../api.ts'
import { livenessOf } from '../liveness.ts'
import type { Repository } from '../scope.ts'
import { Name } from './vocabulary.tsx'

/** The heartbeats, shared by every reader: the banner, the marks and these facts ask one query. */
export function useEngineHealth() {
  return useQuery({ queryKey: ['engine-health'], queryFn: api.engineHealth, refetchInterval: 60_000 })
}

/** The engine's plain fact for one repository, or null when there is none to state. */
export function engineFact(mode: RepositoryMode | null | undefined, entry: EngineHealthEntry | null | undefined, now: number | undefined): string | null {
  switch (livenessOf(mode, entry)) {
    case 'none':
      return 'No engine in this deployment.'
    case 'outside':
      return `An engine outside this deployment, last seen ${entry && now !== undefined ? `${formatAge(Math.floor(Date.parse(entry.at) / 1000), now)} ago` : 'recently'}.`
    case 'silent':
      // The banner above the page is the alarm; beside the name, only the fact.
      return mode === 'dispatch' ? 'No recent heartbeat from its engine.' : null
    case 'live':
    case 'unknown':
      return null
  }
}

/** Whether `RepositoryFacts` has anything to say for this repository. */
export function hasFacts(repository: Pick<Repository, 'mode' | 'unreadable'>, entry: EngineHealthEntry | null | undefined): boolean {
  return repository.unreadable !== undefined || (repository.mode ?? null) !== null || engineFact(repository.mode, entry, undefined) !== null
}

/**
 * One repository's facts, as a short paragraph: its mode, then its engine.
 * Nothing when neither is known (a server built before #499), so such a
 * deployment's rail reads as it did.
 */
export function RepositoryFacts({
  repository,
  entry,
  now,
  className = '',
}: {
  repository: Pick<Repository, 'mode' | 'unreadable'>
  entry: EngineHealthEntry | null | undefined
  now: number | undefined
  className?: string
}) {
  if (repository.unreadable !== undefined) {
    return (
      <p className={`font-ui text-[11.5px] leading-[1.45] text-warn ${className}`} data-repository-facts="unreadable">
        Could not be read.
      </p>
    )
  }
  const mode = repository.mode ?? null
  const engine = engineFact(mode, entry, now)
  if (mode === null && engine === null) return null
  return (
    <p className={`font-ui text-[11.5px] leading-[1.45] text-muted ${className}`} data-repository-facts={mode ?? ''}>
      {mode !== null && (
        <>
          Mode <Name size="md">{mode}</Name>.
        </>
      )}
      {mode !== null && engine !== null && ' '}
      {engine}
    </p>
  )
}
