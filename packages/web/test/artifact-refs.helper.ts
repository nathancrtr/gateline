// ArtifactRefs for web tests (#415). The server builds them with core's
// `artifactRef`, so the tests do too, rather than hand-writing a kind the
// browser code would then trust. Tests may import core; `web/src` may not
// (boundary.test.ts), which is the point — the refs arrive on the payload.
import { artifactRef } from '@gateline/core/view-model'
import type { ArtifactRef } from '../src/api.ts'

/** One path's ref; a review may name the task it reviews and the round it is at. */
export const ref = (path: string, task?: string | null, round: number | null = null): ArtifactRef =>
  artifactRef(path, task === undefined ? undefined : { task, rounds: round === null ? [] : [{ round, verdict: 'approve', diff: null, line: 1 }] })

/** Refs for plain paths, none of them a review read for its header. */
export const refs = (paths: readonly string[]): ArtifactRef[] => paths.map((p) => ref(p))

export const paths = (refs: readonly ArtifactRef[]): string[] => refs.map((r) => r.path)
