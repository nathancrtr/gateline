// SSE freshness: one EventSource. A "change" event names what moved — a
// repository, and the run when it is known (#496) — and only the queries that
// read it are invalidated. The repo is the database: the UI only ever
// revalidates, never patches state locally.
//
// Query keys are `[kind, repository id, slug, ...]` for everything about one
// run (`['run', src, slug]`, `['artifact', src, slug, path]`), and a bare
// `[kind]` for the views that span repositories.

import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { RefChange } from './api.ts'

/** Views across every repository: any change may move one of their rows. */
const ACROSS_REPOSITORIES = new Set(['inbox', 'runs', 'metrics'])

/**
 * Views across repositories that read only each default branch (the staging
 * form reads every repository's contract templates there), so only a change
 * to a repository as a whole can move them.
 */
const DEFAULT_BRANCHES = new Set(['staging-config'])

/** Ids that differ only in case name one repository (docs/MULTI-REPO.md §6.1). */
const sameRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The changes a `change` event's data lists, or null when the data is not
 * that shape — a server from before #496 sends `{}` — in which case the
 * caller refreshes everything, as every change used to.
 */
export function parseChanges(data: unknown): RefChange[] | null {
  let parsed: unknown
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data
  } catch {
    return null
  }
  const changes = (parsed as { changes?: unknown } | null)?.changes
  if (!Array.isArray(changes)) return null
  const out: RefChange[] = []
  for (const c of changes) {
    const { source, slug } = (c ?? {}) as { source?: unknown; slug?: unknown }
    if (typeof source !== 'string' || !(typeof slug === 'string' || slug === null)) return null
    out.push({ source, slug })
  }
  return out
}

/**
 * Whether a query reads something these changes moved: a view across
 * repositories for any change; a run's views when that run, or its
 * repository as a whole, moved.
 */
export function readsChanged(queryKey: readonly unknown[], changes: readonly RefChange[]): boolean {
  const [kind, source, slug] = queryKey
  if (typeof kind === 'string' && ACROSS_REPOSITORIES.has(kind)) return changes.length > 0
  if (typeof kind === 'string' && DEFAULT_BRANCHES.has(kind)) return changes.some((c) => c.slug === null)
  if (typeof source !== 'string') return false
  return changes.some((c) => sameRepository(c.source, source) && (c.slug === null || c.slug === slug))
}

/** Invalidate what one `change` event's data says moved, or everything when it says nothing readable. */
export function invalidateForChange(queryClient: Pick<QueryClient, 'invalidateQueries'>, data: unknown): Promise<void> {
  const changes = parseChanges(data)
  if (changes === null) return queryClient.invalidateQueries()
  return queryClient.invalidateQueries({ predicate: (query) => readsChanged(query.queryKey, changes) })
}

export function useLiveInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource('/api/events')
    const onChange = (event: MessageEvent) => void invalidateForChange(queryClient, event.data)
    es.addEventListener('change', onChange)
    return () => {
      es.removeEventListener('change', onChange)
      es.close()
    }
  }, [queryClient])
}
