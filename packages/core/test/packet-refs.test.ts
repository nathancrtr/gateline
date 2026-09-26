// An inbox item's packet as references (#415): attached once, from `packet`,
// as deriveReadiness returns — so across every fixture run and every item
// kind the two can never disagree.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { artifactRef, deriveReadiness, type InboxItem, planRunScaffold } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
let items: InboxItem[]

beforeAll(async () => {
  ctx = await makeFixture()
  // The demo fixtures have no staged run; stage one, so every kind is here.
  const who = { name: 'Staging Operator', email: 'staging-operator@example.test' }
  const scaffold = planRunScaffold({
    slug: 'staged-refs',
    title: 'A staged run',
    profile: 'standard',
    briefMarkdown: '## Problem\nsomething worth staging\n',
    costLimitUsd: 25,
    intake: { source: null, ref: null, url: null, clientKey: null },
    stagedBy: who.name,
  })
  expect((await ctx.source.stageRun(scaffold, who)).outcome).toBe('created')
  items = []
  for (const ref of await ctx.source.listRuns()) items.push(...(await deriveReadiness(ctx.source, ref)).items)
})
afterAll(() => dropFixture(ctx))

describe('InboxItem.packetRefs', () => {
  it('covers every item kind the fixtures raise', () => {
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['gate', 'escalation', 'round-cap', 'paused', 'staged', 'malformed']))
  })

  it('names exactly the packet paths, in the packet order, for every item', () => {
    for (const item of items) expect(item.packetRefs.map((r) => r.path), `${item.slug} ${item.kind}`).toEqual(item.packet)
  })

  it('is each path described as the record layer describes it', () => {
    for (const item of items) expect(item.packetRefs).toEqual(item.packet.map((p) => artifactRef(p)))
  })
})
