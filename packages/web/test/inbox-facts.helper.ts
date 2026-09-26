// An inbox item's facts (#433), all absent — what a test's item builder
// spreads before its own overrides, so a gate item with no bounce, no wait and
// no escalation reads exactly as core would send it.
import type { InboxItem } from '../src/api.ts'

export const NO_FACTS = {
  question: null,
  waitingOn: null,
  superseded: false,
  bouncedBy: null,
  escalation: null,
  paused: null,
  staged: null,
  roundCap: null,
  unreadable: null,
} satisfies Partial<InboxItem>
