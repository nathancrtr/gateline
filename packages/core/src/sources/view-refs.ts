// The refs a view reads, and nothing else: run branches, their
// remote-tracking refs, and the default branch. Whether "something changed"
// is answered by comparing these — never by which file under the git
// directory was written, which also moves for an index refresh, a fetch that
// brought nothing, or a commit on a branch no view looks at (#461).

export interface NamedRef {
  oid: string
  ref: string
  /** The ref this one points at, when it is symbolic (`origin/HEAD`); else empty. */
  symref: string
}

export interface ViewRefs {
  /** Every ref a view reads. Equal strings mean nothing a view reads has moved. */
  all: string
  /** The default branch's refs, which every run's views depend on. */
  shared: string
  /** Per run slug, that run's own refs. A run with no branch left has no entry. */
  runs: Map<string, string>
}

const LOCAL_RUN = /^refs\/heads\/run\/(.+)$/
const REMOTE_RUN = /^refs\/remotes\/[^/]+\/run\/(.+)$/
const LOCAL = /^refs\/heads\/(.+)$/
const REMOTE = /^refs\/remotes\/[^/]+\/(.+)$/
const REMOTE_HEAD = /^refs\/remotes\/[^/]+\/HEAD$/

const line = (r: NamedRef) => `${r.ref} ${r.oid}${r.symref ? ` -> ${r.symref}` : ''}`

/**
 * `headBranch` is the branch HEAD names, and is consulted only when the
 * repository has no `origin/HEAD`, `main` or `master` to call the default —
 * the same last resort `Git.defaultBranch` falls back to.
 */
export async function viewRefsOf(refs: NamedRef[], headBranch: () => Promise<string | null>): Promise<ViewRefs> {
  const names = new Set(['main', 'master'])
  for (const r of refs) {
    if (!REMOTE_HEAD.test(r.ref) || !r.symref) continue
    const target = REMOTE.exec(r.symref)?.[1]
    if (target) names.add(target)
  }
  const nameOf = (ref: string) => (REMOTE_HEAD.test(ref) ? null : (LOCAL.exec(ref)?.[1] ?? REMOTE.exec(ref)?.[1] ?? null))
  const build = (defaults: Set<string>): ViewRefs => {
    const shared: string[] = []
    const runs = new Map<string, string[]>()
    for (const r of refs) {
      const slug = LOCAL_RUN.exec(r.ref)?.[1] ?? REMOTE_RUN.exec(r.ref)?.[1]
      if (slug) {
        runs.set(slug, [...(runs.get(slug) ?? []), line(r)])
        continue
      }
      const name = nameOf(r.ref)
      if (REMOTE_HEAD.test(r.ref) || (name !== null && defaults.has(name))) shared.push(line(r))
    }
    shared.sort()
    const perRun = new Map([...runs].map(([slug, lines]) => [slug, lines.sort().join('\n')] as const))
    const all = [...shared, ...[...perRun.values()].sort()].join('\n')
    return { all, shared: shared.join('\n'), runs: perRun }
  }
  const named = refs.some((r) => {
    const name = nameOf(r.ref)
    return name !== null && names.has(name)
  })
  if (named) return build(names)
  const head = await headBranch()
  return build(head ? new Set([...names, head]) : names)
}

/** What one run's views depend on: its own refs and the default branch's. */
export function runPrint(refs: ViewRefs, slug: string): string {
  return `${refs.shared}\n--\n${refs.runs.get(slug) ?? ''}`
}
