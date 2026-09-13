// The run page's restatement test (#294). What is under test is the part that
// could quietly delete a fact: a decision card drops its subtitle only when
// every word of it is already on the screen above. The inputs here are the real
// `detail` strings core writes for each inbox kind, so a new kind — or a
// reworded one — fails here rather than silently going quiet on the page.
import { describe, expect, it } from 'vitest'
import { GATE_QUESTIONS, PATCH_G1_QUESTION } from '../src/api.ts'
import { navEntryClass, RECORD_ENTRY_SHAPE, restatesWhatIsShown } from '../src/pages/run.tsx'

/** What the card renders above its subtitle: the title, the run slug (the H1)
 *  and the age badge on the chip row. */
const shown = (title: string, slug: string, age = '3d') => `${title} ${slug} waiting ${age}`

describe('restatesWhatIsShown', () => {
  it('drops a gate subtitle, which is the H1 and the title in a sentence', () => {
    const title = `G2 — ${GATE_QUESTIONS.G2}`
    expect(restatesWhatIsShown('g2-pending is waiting on G2', shown(title, 'g2-pending'))).toBe(true)
  })

  it('drops it for every gate question the profiles carry', () => {
    for (const [gate, question] of Object.entries(GATE_QUESTIONS)) {
      expect(restatesWhatIsShown(`some-run is waiting on ${gate}`, shown(`${gate} — ${question}`, 'some-run'))).toBe(true)
    }
    expect(restatesWhatIsShown('patch-run is waiting on G1', shown(`G1 — ${PATCH_G1_QUESTION}`, 'patch-run'))).toBe(true)
  })

  it('keeps a bounced gate subtitle — "Packet malformed" is not in the title', () => {
    expect(
      restatesWhatIsShown('Packet malformed — bounced, not reviewable', shown(`G1 — ${GATE_QUESTIONS.G1}`, 'bounced-run')),
    ).toBe(false)
  })

  it('keeps an escalation reason', () => {
    const reason = 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo'
    expect(restatesWhatIsShown(reason, shown('Escalation from verifier', 'escalated'))).toBe(false)
  })

  it('keeps a round-cap explanation', () => {
    const detail = '3 review rounds without convergence — usually a spec ambiguity, not an implementation defect'
    expect(restatesWhatIsShown(detail, shown('Round cap reached: 01-core', 'round-cap'))).toBe(false)
  })

  it('keeps the paused and staged calls to action', () => {
    expect(
      restatesWhatIsShown('Resume the run, or close it with a disposition saying why it ends here', shown('Run paused: budget-exhausted', 'paused-budget')),
    ).toBe(false)
    expect(
      restatesWhatIsShown('Arm to start the run — dispatch begins and the budget starts metering', shown('Run staged: awaiting arm', 'staged-run')),
    ).toBe(false)
  })

  it('keeps a malformed-state parse error', () => {
    expect(restatesWhatIsShown('state.yaml unreadable', shown('Malformed run state', 'bad-state'))).toBe(false)
  })

  it('keeps a line that repeats everything but one word', () => {
    const title = `G2 — ${GATE_QUESTIONS.G2}`
    expect(restatesWhatIsShown('some-run is waiting on G2 since Tuesday', shown(title, 'some-run'))).toBe(false)
  })

  it('renders an empty or grammar-only line rather than calling it a restatement', () => {
    const title = `G2 — ${GATE_QUESTIONS.G2}`
    expect(restatesWhatIsShown('', shown(title, 'g2-pending'))).toBe(false)
    expect(restatesWhatIsShown('it is on the', shown(title, 'g2-pending'))).toBe(false)
  })
})

// The Record picker's two shapes (#281). Below `lg` the rail becomes a wrapping
// strip above a full-width reader, and the artifact entries and the diff entry
// now share one class builder. The invariant worth pinning is that selection
// changes the mark and the tint and never the shape — the two entries were
// hand-copied literals before, which is how a narrow shape added to one would
// have missed the other.
describe('navEntryClass', () => {
  it('gives the selected and unselected entries the same shape', () => {
    expect(navEntryClass(true)).toContain(RECORD_ENTRY_SHAPE)
    expect(navEntryClass(false)).toContain(RECORD_ENTRY_SHAPE)
  })

  it('carries a narrow shape, so the picker is not stuck in the desktop rail', () => {
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:w-auto')
  })

  it('moves the selected mark from the left edge to the bottom edge in the strip', () => {
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:border-l-0')
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:border-b-2')
    expect(navEntryClass(true)).toContain('border-b-accent')
    expect(navEntryClass(false)).toContain('border-b-transparent')
  })
})
