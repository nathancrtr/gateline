// How a gate card presents, in one reading of the two flags core sets on it.
//
// `reviewable: false` used to mean exactly one thing — the packet failed its
// contract, so draw the bounce (R3). Since #159 it means two, and the second is
// not a fault at all: the producing role is out with a fresh dispatch, and the
// artifact on the card is about to be replaced. Both refuse the approval
// buttons; nothing else about them is the same, and a card that told a human
// their spec was malformed while the analyst was quietly rewriting it would be
// the original bug wearing red.
//
// Every surface that branched on `!item.reviewable` reads through here instead,
// so the three states stay one vocabulary across the inbox row, the kind chip,
// the phase spine and the card.
import type { InboxItem } from './api.ts'

export type GateCardState = 'reviewable' | 'inflight' | 'bounced'

/** The gate card's state, or null for an item that is not a gate. */
export function gateCardState(item: InboxItem): GateCardState | null {
  if (item.kind !== 'gate') return null
  if (item.reviewable) return 'reviewable'
  return item.inflight ? 'inflight' : 'bounced'
}

/** The packet fails its contract (R3): no approval, and the problems say why. */
export function isBouncedGate(item: InboxItem): boolean {
  return gateCardState(item) === 'bounced'
}

/** The producing role is re-dispatched and this packet is superseded (#159). */
export function isInflightGate(item: InboxItem): boolean {
  return gateCardState(item) === 'inflight'
}
