// SSE freshness: one EventSource; every "change" event (a ref moved in some
// watched repo) invalidates all queries. The repo is the database — the UI
// only ever revalidates, never patches state locally.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventsUrl } from './static-mode.ts'

export function useLiveInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    // Static build (ADR-4): no route to invalidate against exists on the
    // static host, so no EventSource is opened at all — nothing retries
    // against a route that will never answer (R4).
    const url = eventsUrl()
    if (url === null) return
    const es = new EventSource(url)
    const onChange = () => void queryClient.invalidateQueries()
    es.addEventListener('change', onChange)
    return () => {
      es.removeEventListener('change', onChange)
      es.close()
    }
  }, [queryClient])
}
