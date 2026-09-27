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
// A fact every repository shares is said once (`sharedStanding`): when all
// that could be read have one mode and one engine state, the rail's foot
// states it for the set (`SetFacts`) and no entry repeats it. When they
// differ, each entry states its own and the foot says nothing about either.
//
// Text only, in the cockpit's voice, composed here from the mode and the
// heartbeat. No colour: nothing here is wrong, and colour in Gatehouse
// carries state (GATEHOUSE-DESIGN.md round 5). The one exception is a
// repository that could not be read, which takes the caution ink the page's
// notice uses.

import { useQuery } from '@tanstack/react-query'
import { api, type EngineHealthEntry, formatAge, type RepositoryMode } from '../api.ts'
import { type Liveness, livenessOf, sharedStanding } from '../liveness.ts'
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

/**
 * Whether the set's readable repositories share mode and engine state, from
 * the one heartbeat query. Null when they differ, or while it is unknown.
 */
export function useSharedStanding(set: readonly Pick<Repository, 'id' | 'mode' | 'unreadable'>[]) {
  const health = useEngineHealth()
  return sharedStanding(set.map((r) => ({ mode: r.mode, unreadable: r.unreadable, entry: health.data?.engines[r.id] })))
}

/** The engine's fact for a whole set that shares one state, or null when there is none to state. */
function setEngineFact(mode: RepositoryMode | null, liveness: Liveness): string | null {
  switch (liveness) {
    case 'none':
      return 'No engine in this deployment.'
    case 'silent':
      return mode === 'dispatch' ? 'No recent heartbeat from their engines.' : null
    case 'outside':
    case 'live':
    case 'unknown':
      return null
  }
}

/**
 * The facts every repository shares, said once for the set, at the rail's
 * foot: "All repositories: mode decide. No engine in this deployment."
 * Nothing when there is nothing to say (no mode stated, no engine fact).
 */
export function SetFacts({ shared, className = '' }: { shared: { mode: RepositoryMode | null; liveness: Liveness }; className?: string }) {
  const engine = setEngineFact(shared.mode, shared.liveness)
  if (shared.mode === null && engine === null) return null
  return (
    <p className={`font-ui text-[11.5px] leading-[1.45] text-muted ${className}`} data-set-facts={shared.mode ?? ''}>
      All repositories:{' '}
      {shared.mode !== null ? (
        <>
          mode <Name size="md">{shared.mode}</Name>.
        </>
      ) : null}
      {shared.mode !== null && engine !== null && ' '}
      {engine}
    </p>
  )
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
