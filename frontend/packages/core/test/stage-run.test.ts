// The impure half of the run-creation seam (sources/local-source.ts's
// stageRun): the only branch-minting path — identity precondition, ADR-4's
// idempotency/collision scan, a plumbing genesis commit against the default
// branch's tip, and create-only CAS landing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Git, LocalGitSource, parseRunState, planRunScaffold, STAGED_REASON, type Profile, type RunScaffoldInput } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
const who = { name: 'Staging Operator', email: 'staging-operator@example.test' }

beforeEach(async () => {
  ctx = await makeFixture()
})
afterEach(() => dropFixture(ctx))

function input(opts: { slug: string; clientKey?: string | null; profile?: Profile }): RunScaffoldInput {
  return {
    slug: opts.slug,
    title: `Title for ${opts.slug}`,
    profile: opts.profile ?? 'standard',
    briefMarkdown: '## Problem\nsomething worth staging\n',
    costLimitUsd: 25,
    intake: { source: null, ref: null, url: null, clientKey: opts.clientKey ?? null },
    stagedBy: who.name,
  }
}

describe('LocalGitSource.stageRun — created (AC10.1)', () => {
  it('lands a genesis commit readable via git alone, in a fresh process with no server', async () => {
    const scaffold = planRunScaffold(input({ slug: 'new-run' }))
    const result = await ctx.source.stageRun(scaffold, who)
    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('unreachable')
    expect(result.branch).toBe('run/new-run')
    expect(result.commit).toBeTruthy()

    // A brand-new Git instance over the same directory — no server, no cache
    // shared with ctx.source — proves the state is git-only (R10).
    const fresh = new Git(ctx.repo.dir)
    const stateRaw = await fresh.show('run/new-run', 'runs/new-run/state.yaml')
    const briefRaw = await fresh.show('run/new-run', 'runs/new-run/intent-brief.md')
    expect(stateRaw).not.toBeNull()
    expect(briefRaw).not.toBeNull()

    const { state, error } = parseRunState(stateRaw!)
    expect(error).toBeNull()
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe(STAGED_REASON)

    const tip = await fresh.revParse('refs/heads/run/new-run')
    expect(tip).toBe(result.commit)
  })

  it('patch profile: the genesis commit also carries tasks/01-<slug>.yaml', async () => {
    const scaffold = planRunScaffold(input({ slug: 'patch-run', profile: 'patch' }))
    const result = await ctx.source.stageRun(scaffold, who)
    expect(result.outcome).toBe('created')

    const fresh = new Git(ctx.repo.dir)
    const stub = await fresh.show('run/patch-run', 'runs/patch-run/tasks/01-patch-run.yaml')
    expect(stub).not.toBeNull()
    expect(stub).toContain('id: 01-patch-run')
  })
})

describe('LocalGitSource.stageRun — collision (AC1.2)', () => {
  it('refuses when the slug already exists as a non-staged run — no write, branch tip unchanged', async () => {
    const branchRef = 'refs/heads/run/g0-pending'
    const before = await ctx.source.git.revParse(branchRef)
    const scaffold = planRunScaffold(input({ slug: 'g0-pending' }))

    const result = await ctx.source.stageRun(scaffold, who)
    expect(result.outcome).toBe('refused')
    expect(result).toMatchObject({ reason: 'slug-taken' })
    if (result.outcome === 'refused') expect(result.message).toContain('run/g0-pending')

    const after = await ctx.source.git.revParse(branchRef)
    expect(after).toBe(before) // fails closed: nothing was overwritten
  })
})

describe('LocalGitSource.stageRun — replay (AC1.3)', () => {
  it('the same scaffold staged twice is idempotent: exactly one branch, second outcome distinguishable from created', async () => {
    const scaffold = planRunScaffold(input({ slug: 'replay-run', clientKey: 'replay-key-1' }))

    const first = await ctx.source.stageRun(scaffold, who)
    expect(first.outcome).toBe('created')

    const second = await ctx.source.stageRun(scaffold, who)
    expect(second.outcome).toBe('exists')
    expect(second).toMatchObject({ slug: 'replay-run', branch: 'run/replay-run' })
    expect(second).not.toEqual(first) // a success, but not the same outcome shape as the first call

    const branches = await ctx.source.git.forEachRef(['refs/heads/run/replay-run'])
    expect(branches).toHaveLength(1)
  })

  it('the same client key staged under a different slug also returns exists, minting no second branch', async () => {
    const first = planRunScaffold(input({ slug: 'first-slug', clientKey: 'shared-key' }))
    const firstResult = await ctx.source.stageRun(first, who)
    expect(firstResult.outcome).toBe('created')

    const second = planRunScaffold(input({ slug: 'second-slug', clientKey: 'shared-key' }))
    const secondResult = await ctx.source.stageRun(second, who)
    expect(secondResult.outcome).toBe('exists')
    expect(secondResult).toMatchObject({ slug: 'first-slug', branch: 'run/first-slug' })

    const stray = await ctx.source.git.forEachRef(['refs/heads/run/second-slug'])
    expect(stray).toHaveLength(0)
  })

  it('the same slug staged twice with a null client key (free-form intake, no --key) also returns exists', async () => {
    // ADR-4 rule 2's positive branch: no clientKey on either call, so the
    // scan never reaches rule 1 (client-key replay) — the same-slug +
    // staged-rest + null-key-agreement path is the only thing that can
    // recognize this as a replay rather than a slug collision.
    const scaffold = planRunScaffold(input({ slug: 'null-key-run', clientKey: null }))

    const first = await ctx.source.stageRun(scaffold, who)
    expect(first.outcome).toBe('created')

    const second = await ctx.source.stageRun(scaffold, who)
    expect(second.outcome).toBe('exists')
    expect(second).toMatchObject({ slug: 'null-key-run', branch: 'run/null-key-run' })

    const branches = await ctx.source.git.forEachRef(['refs/heads/run/null-key-run'])
    expect(branches).toHaveLength(1)
  })
})

describe('LocalGitSource.stageRun — conflict', () => {
  it('refused conflict when the ref is pre-created between the scan and the CAS landing, no second branch', async () => {
    const scaffold = planRunScaffold(input({ slug: 'race-run' }))
    const git = ctx.source.git

    // Simulate a concurrent writer that wins the race: a branch at
    // refs/heads/run/race-run whose tree carries no runs/race-run/state.yaml,
    // so the pre-write scan (which only sees runs it can read a state for)
    // does not detect it — exactly like a real interleaved write would look
    // from stageRun's read side.
    const defaultBranch = await git.defaultBranch()
    const tip = (await git.revParse(defaultBranch))!
    const blob = await git.hashObject('a concurrent writer got here first\n')
    const tree = await git.writeTreeWithBlob(tip, 'note.txt', blob)
    const rival = await git.commitTree(tree, tip, 'concurrent write wins the race')
    await git.run(['update-ref', 'refs/heads/run/race-run', rival])

    const result = await ctx.source.stageRun(scaffold, who)
    expect(result.outcome).toBe('refused')
    expect(result).toMatchObject({ reason: 'conflict' })

    // The rival commit is still the tip — our genesis commit never landed.
    expect(await git.revParse('refs/heads/run/race-run')).toBe(rival)
  })

  it('CAS-loss re-derivation returns exists (not conflict) when the rival landed the identical staged replay', async () => {
    // Two operators race an identical scaffold (same slug, same client key).
    // The pre-write scan sees nothing for either, so both proceed to the
    // create-only CAS; the loser must re-derive via scanForExisting rather
    // than blindly reporting conflict — plan §"sources deltas" step 4, ADR-4
    // rule 3. We force the loss deterministically (same technique as
    // write-path.test.ts's CAS-race test): let the real race happen for the
    // first updateRefCAS call so a genuine identical genesis commit lands,
    // then report loss on our own call.
    const scaffold = planRunScaffold(input({ slug: 'race-replay', clientKey: 'race-replay-key' }))
    const git = ctx.source.git
    const branchRef = 'refs/heads/run/race-replay'

    const realUpdateRefCAS = git.updateRefCAS.bind(git)
    let intercepted = false
    git.updateRefCAS = async (ref: string, newOid: string, expectedOld: string) => {
      if (!intercepted && ref === branchRef) {
        intercepted = true
        // The rival: a second stageRun call for the exact same scaffold,
        // which lands for real (this call's own updateRefCAS override has
        // already flipped `intercepted`, so it goes through unpatched).
        const rival = await ctx.source.stageRun(scaffold, who)
        expect(rival.outcome).toBe('created')
        // Our own CAS attempt lost the race.
        return false
      }
      return realUpdateRefCAS(ref, newOid, expectedOld)
    }

    const result = await ctx.source.stageRun(scaffold, who)
    expect(result.outcome).toBe('exists')
    expect(result).toMatchObject({ slug: 'race-replay', branch: 'run/race-replay' })

    const branches = await git.forEachRef([branchRef])
    expect(branches).toHaveLength(1)
  })
})

describe('LocalGitSource.stageRun — identity (AC7.1)', () => {
  it('refuses before any git write when git user.name/user.email are unresolvable', async () => {
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL
    const savedSystem = process.env.GIT_CONFIG_SYSTEM
    // Match the fixture generator's own technique: pin config lookups to
    // /dev/null so the host machine's own ~/.gitconfig can never leak an
    // identity into this repo's "unset" scratch state.
    process.env.GIT_CONFIG_GLOBAL = '/dev/null'
    process.env.GIT_CONFIG_SYSTEM = '/dev/null'
    try {
      await ctx.source.git.run(['config', '--unset', 'user.name'])
      await ctx.source.git.run(['config', '--unset', 'user.email'])
      expect(await ctx.source.identity()).toBeNull()

      const before = await ctx.source.git.forEachRef(['refs/heads'])
      const scaffold = planRunScaffold(input({ slug: 'no-identity-run' }))
      const result = await ctx.source.stageRun(scaffold, who)

      expect(result.outcome).toBe('refused')
      expect(result).toMatchObject({ reason: 'no-identity' })
      if (result.outcome === 'refused') expect(result.message).toContain('attributable to a named human')

      const after = await ctx.source.git.forEachRef(['refs/heads'])
      expect(after).toHaveLength(before.length) // zero new refs
    } finally {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal
      if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM
      else process.env.GIT_CONFIG_SYSTEM = savedSystem
    }
  })
})

describe('LocalGitSource.stageRun — authorship', () => {
  it('commits as the human `who`, never a bot-pinned source identity', async () => {
    const bot = { name: 'Orchestrator Bot', email: 'bot@example.test' }
    const botSource = new LocalGitSource('fixture', ctx.repo.dir, { identity: bot })
    const scaffold = planRunScaffold(input({ slug: 'authored-by-human' }))

    const result = await botSource.stageRun(scaffold, who)
    expect(result.outcome).toBe('created')

    const [head] = await botSource.git.log('run/authored-by-human', [], { maxCount: 1 })
    expect(head!.author).toBe(who.name)
    expect(head!.email).toBe(who.email)
    expect(head!.author).not.toBe(bot.name)
  })
})
