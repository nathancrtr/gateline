// SSE freshness: one EventSource; every "change" event (a ref moved in some
// watched repo) invalidates all queries. The repo is the database — the UI
// only ever revalidates, never patches state locally.
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useLiveInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource('/api/events')
    const onChange = () => void queryClient.invalidateQueries()
    es.addEventListener('change', onChange)
    return () => {
      es.removeEventListener('change', onChange)
      es.close()
    }
  }, [queryClient])
}
