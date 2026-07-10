// I8 placeholder — the full metrics view (approval rates with the >90% flag,
// burden mix, latency, rounds, cost) lands in M3 on top of /api/metrics.
export function MetricsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Metrics</h1>
      <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
        <p className="text-sm font-medium">Coming in M3.</p>
        <p className="mt-1 text-xs text-muted">Approval rates, burden mix, decision latency, review rounds, and budget honesty — all computed from state.yaml history.</p>
      </div>
    </div>
  )
}
