// The fixture label (spec R3, plan ADR-5): a run whose `source` is the
// generator's fixture source id is illustration, not evidence, and every
// surface that names the run says so in the markup itself — never a
// hover-only affordance (AC3.2).
//
// `FIXTURE_SOURCE_ID` is the one value the wire contract carries beside
// `API_VERSION` (ADR-5's "shared source id constant"); the label is a
// client-side rule over data the client already has, so no server test
// moves when it is added.
import { FIXTURE_SOURCE_ID } from '@gateline/server/contract'
import { Imp } from './chips.tsx'

export function isFixtureSource(source: string): boolean {
  return source === FIXTURE_SOURCE_ID
}

export function FixtureLabel({ className = '' }: { className?: string }) {
  return (
    <Imp
      tone="hatch"
      data-fixture-label
      className={className}
      title="Generated fixture run — illustrates a pipeline state; not a record of real work"
    >
      fixture data
    </Imp>
  )
}
