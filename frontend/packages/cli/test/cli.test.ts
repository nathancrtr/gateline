// CLI acceptance: the full decision loop against a fixture repo, spawning the
// real binary the way an operator would run it.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo, type FixtureRepo } from '@agentic/fixtures'
import { LocalGitSource } from '@agentic/core'
import { draftBriefMarkdown, runInteractiveNew, type InteractiveNewIO } from '../src/main.ts'

const exec = promisify(execFile)
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')

let fixture: FixtureRepo
let briefPath: string

const runIn = async (repoDir: string, args: string[], opts: { expectFail?: boolean; env?: NodeJS.ProcessEnv } = {}) => {
  try {
    const { stdout, stderr } = await exec('node', [cliPath, '--repo', repoDir, ...args], { env: opts.env ?? process.env })
    return { code: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    if (!opts.expectFail) throw new Error(`cli failed: ${err.stderr ?? ''}${err.stdout ?? ''}`)
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

const run = (args: string[], expectFail = false) => runIn(fixture.dir, args, { expectFail })

/** A scratch git repo carrying only a `contracts/intent-brief.md` template —
 * enough for `agentic new` to resolve as a source, distinct from the shared
 * `fixture` (used for identity-refusal tests, which must NOT reuse a repo
 * whose config already carries `user.name`/`user.email`). */
function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-cli-scratch-'))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  const git = (args: string[], commitEnv?: NodeJS.ProcessEnv) => execFileSync('git', ['-C', dir, ...args], { env: commitEnv ?? env, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main'])
  mkdirSync(join(dir, 'contracts'), { recursive: true })
  writeFileSync(join(dir, 'contracts', 'intent-brief.md'), '# Intent Brief: <title>\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n')
  writeFileSync(join(dir, 'README.md'), '# scratch\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'seed'], {
    ...env,
    GIT_AUTHOR_NAME: 'Seed',
    GIT_AUTHOR_EMAIL: 'seed@example.test',
    GIT_COMMITTER_NAME: 'Seed',
    GIT_COMMITTER_EMAIL: 'seed@example.test',
  })
  return dir
}

beforeAll(async () => {
  fixture = generateFixtureRepo()
  const briefDir = await mkdtemp(join(tmpdir(), 'agentic-brief-'))
  briefPath = join(briefDir, 'intent-brief.md')
  await writeFile(
    briefPath,
    '# Intent Brief: CSV Exporter\n\n## Problem\nExporting rows by hand is slow and error-prone.\n\n## Motivation\nSaves roughly an afternoon per release.\n\n## Constraints\nMust run offline.\n\n## Out of scope\nImporting.\n',
  )
})
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('agentic CLI', () => {
  it('status renders the portfolio with gate glyphs', async () => {
    const { stdout } = await run(['status'])
    expect(stdout).toMatch(/RUN\s+PHASE\s+GATES/)
    // Source id derives from the repo directory basename, so match on the slug.
    expect(stdout).toContain('/done-merged')
    expect(stdout).toMatch(/done-merged\s+done\s+✓ ✓ ✓ ✓/)
    expect(stdout).toMatch(/need a human/)
  })

  it('inbox lists items oldest-first with bounce warnings', async () => {
    const { stdout } = await run(['inbox'])
    const lines = stdout.trim().split('\n')
    expect(lines[0]).toContain('escalated')
    expect(stdout).toContain('BOUNCED')
  })

  it('approve requires burden when non-interactive', async () => {
    const { code, stderr } = await run(['approve', 'g0-pending', 'G0'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/--burden is required/)
  })

  it('approve writes the gate entry and advances the phase', async () => {
    const { stdout } = await run(['approve', 'g0-pending', 'G0', '--burden', 'confirmation', '--notes', 'looks right'])
    expect(stdout).toMatch(/Approve G0 and move g0-pending to phase "plan"/)
    expect(stdout).toMatch(/G0 approved by Fixture Operator \[burden: confirmation\]/)

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const { state, raw } = await source.readState(ref)
    expect(state!.gates.G0).toMatchObject({ approved: true, by: 'Fixture Operator', burden: 'confirmation', notes: 'looks right' })
    expect(state!.phase).toBe('plan')
    expect(raw).toContain('# a gate entry is written ONLY by the named human')
  })

  it('decline requires --reason and pauses the run', async () => {
    const missing = await run(['decline', 'g1-pending', 'G1'], true)
    expect(missing.code).not.toBe(0)
    expect(missing.stderr).toMatch(/--reason/)

    await run(['decline', 'g1-pending', 'G1', '--reason', 'task 02 overlaps task 01 surface'])
    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'g1-pending')!
    const { state } = await source.readState(ref)
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe('gate-declined')
  })

  it('resolve-escalation and resume complete the loop', async () => {
    await run(['resolve-escalation', 'escalated', '0', '--note', 'sample data committed'])
    await run(['resume', 'paused-budget'])
    const source = new LocalGitSource('fixture', fixture.dir)
    const refs = await source.listRuns()
    const esc = await source.readState(refs.find((r) => r.slug === 'escalated')!)
    expect(esc.state!.escalations[0]!.resolved).toBe(true)
    const paused = await source.readState(refs.find((r) => r.slug === 'paused-budget')!)
    expect(paused.state!.phase).toBe('plan')
  })

  it('refuses decisions on unknown runs', async () => {
    const { code, stderr } = await run(['approve', 'nope', 'G0', '--burden', 'confirmation'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/not found/)
  })

  it('new with all required flags stages a run with no prompts and exits 0 (AC2.1)', async () => {
    const { code, stdout } = await run(['new', '--slug', 'exporter-cli', '--title', 'CSV Exporter', '--profile', 'standard', '--brief-file', briefPath, '--budget', '30'])
    expect(code).toBe(0)
    expect(stdout).toContain('exporter-cli')

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'exporter-cli')
    expect(ref).toBeTruthy()
    const { state } = await source.readState(ref!)
    expect(state!.phase).toBe('paused')
    expect(state!.paused_reason).toBe('staged')
    expect(state!.profile).toBe('standard')
    expect(state!.budget!.cost_limit_usd).toBe(30)
  })

  it('new without required flags and non-TTY stdin exits 1 naming them, staging nothing (AC2.3)', async () => {
    const { code, stderr } = await run(['new', '--slug', 'incomplete-cli'], true)
    expect(code).toBe(1)
    expect(stderr).toContain('--title')
    expect(stderr).toContain('--brief-file')
    // Names only what is genuinely missing, not every flag (F2): --slug WAS
    // given above, so a mutant that unconditionally names all three must fail.
    expect(stderr).not.toContain('--slug')

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'incomplete-cli')
    expect(ref).toBeUndefined()
  })

  it('repeating the same new call reports already staged and exits 0 (idempotent replay)', async () => {
    const { code, stdout } = await run(['new', '--slug', 'exporter-cli', '--title', 'CSV Exporter', '--profile', 'standard', '--brief-file', briefPath])
    expect(code).toBe(0)
    expect(stdout).toContain('already staged: exporter-cli (run/exporter-cli)')
  })

  it('arm moves a staged standard run to phase spec (AC6.1)', async () => {
    await run(['new', '--slug', 'arm-standard', '--title', 'Arm Standard', '--profile', 'standard', '--brief-file', briefPath])
    const { code, stdout } = await run(['arm', 'arm-standard'])
    expect(code).toBe(0)
    expect(stdout).toMatch(/armed/)
    // The ensureDraftPr call site (F1): the fixture repo has no origin, so
    // this exact skip note is the observable proof the call happened at all —
    // a mutant that drops the `console.log(note.note)` print leaves this
    // text out of stdout.
    expect(stdout).toContain('no remote.origin.url configured — nothing to open a PR against')

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'arm-standard')!
    const { state } = await source.readState(ref)
    expect(state!.phase).toBe('spec')
    expect(state!.paused_reason).toBeNull()
  })

  it("arm passes the run's own branch (not slug or another field) to ensureDraftPr (F1)", async () => {
    const scratch = makeScratchRepo()
    try {
      execFileSync('git', ['-C', scratch, 'config', 'user.name', 'Scratch Operator'])
      execFileSync('git', ['-C', scratch, 'config', 'user.email', 'scratch@example.test'])
      // A configured-but-unfetched origin moves ensureDraftPr past the
      // "no remote" skip and into the "branch not pushed" skip, whose note
      // literally names `refs/remotes/origin/<branch>` — the one string a
      // mis-wired branch argument (e.g. passing the slug, or swapping
      // `dir`/`branch`) cannot reproduce.
      execFileSync('git', ['-C', scratch, 'remote', 'add', 'origin', 'https://example.invalid/scratch.git'])
      await runIn(scratch, ['new', '--slug', 'arm-note', '--title', 'Arm Note', '--brief-file', briefPath])
      const { code, stdout } = await runIn(scratch, ['arm', 'arm-note'])
      expect(code).toBe(0)
      expect(stdout).toContain('branch not pushed: refs/remotes/origin/run/arm-note does not exist yet')
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  it('arm moves a staged patch run to phase plan (AC6.1)', async () => {
    await run(['new', '--slug', 'arm-patch', '--title', 'Arm Patch', '--profile', 'patch', '--brief-file', briefPath])
    const { code } = await run(['arm', 'arm-patch'])
    expect(code).toBe(0)

    const source = new LocalGitSource('fixture', fixture.dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'arm-patch')!
    const { state } = await source.readState(ref)
    expect(state!.phase).toBe('plan')
    expect(state!.paused_reason).toBeNull()
  })

  it('arm on a run that is not in the staged rest state exits 1 with a named error (AC6.2)', async () => {
    const { code, stderr } = await run(['arm', 'g0-pending'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/not staged/)
  })

  it('arm on a nonexistent run exits 1 via findRun\'s existing refusal (AC6.2)', async () => {
    const { code, stderr } = await run(['arm', 'no-such-run'], true)
    expect(code).toBe(1)
    expect(stderr).toMatch(/not found/)
  })

  it('new refuses when git identity is unresolvable, before any write (AC7.1)', async () => {
    const scratch = makeScratchRepo()
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
      delete env.GIT_AUTHOR_NAME
      delete env.GIT_AUTHOR_EMAIL
      delete env.GIT_COMMITTER_NAME
      delete env.GIT_COMMITTER_EMAIL
      const { code, stderr } = await runIn(scratch, ['new', '--slug', 'no-id', '--title', 'No Id', '--brief-file', briefPath], { expectFail: true, env })
      expect(code).toBe(1)
      expect(stderr).toMatch(/attributable to a named human/)

      const source = new LocalGitSource('scratch', scratch)
      expect(await source.listRuns()).toHaveLength(0)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })

  it('new accepts a brief whose H2 differs from the template only in punctuation/whitespace, matching core validate.ts\'s normalize (F6)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'agentic-cli-f6-'))
    const briefDir = await mkdtemp(join(tmpdir(), 'agentic-brief-f6-'))
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
      const git = (args: string[]) => execFileSync('git', ['-C', scratch, ...args], { env, encoding: 'utf8' })
      git(['init', '-q', '-b', 'main'])
      git(['config', 'user.name', 'F6 Operator'])
      git(['config', 'user.email', 'f6@example.test'])
      mkdirSync(join(scratch, 'contracts'), { recursive: true })
      // The template's H2 carries punctuation (&); the brief below repeats it
      // with different internal spacing — core's `normalize` (strip
      // punctuation, collapse whitespace runs) treats them as the same
      // section; a stricter lowercase+trim comparison would not.
      writeFileSync(join(scratch, 'contracts', 'intent-brief.md'), '# Intent Brief: <title>\n\n## Problem\n\n## Constraints & risks\n')
      writeFileSync(join(scratch, 'README.md'), '# scratch\n')
      git(['add', '-A'])
      git(['commit', '-q', '-m', 'seed'])

      const punctBrief = join(briefDir, 'intent-brief.md')
      await writeFile(punctBrief, '# Intent Brief: F6 Case\n\n## Problem\ntext\n\n## Constraints  &  risks\ntext\n')

      const { code, stderr } = await runIn(scratch, ['new', '--slug', 'f6-case', '--title', 'F6 Case', '--brief-file', punctBrief])
      expect(stderr).toBe('')
      expect(code).toBe(0)
    } finally {
      await rm(scratch, { recursive: true, force: true })
      await rm(briefDir, { recursive: true, force: true })
    }
  })
})

describe('agentic new — interactive helpers (unit, no TTY)', () => {
  it('draftBriefMarkdown substitutes the title into the template H1, structure only', () => {
    const template = '# Intent Brief: <title>\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n'
    const drafted = draftBriefMarkdown(template, 'My New Thing')
    expect(drafted).toContain('# Intent Brief: My New Thing')
    expect(drafted).not.toContain('<title>')
    // Structure only — no invented Problem/Motivation/Constraints prose (R3).
    expect(drafted).toMatch(/## Problem\n\n## Motivation/)
  })

  it('draftBriefMarkdown falls back to BUILTIN_SECTIONS when the repo has no template', () => {
    const drafted = draftBriefMarkdown(null, 'Fallback Thing')
    expect(drafted).toContain('# Intent Brief: Fallback Thing')
    expect(drafted).toContain('## Problem')
    expect(drafted).toContain('## Out of scope')
  })

  it('runInteractiveNew prompts for missing slug/title, edits, and stages on confirm (AC2.2/AC3.1)', async () => {
    const answers = ['prompted-slug', 'Prompted Title', 'y']
    const prompts: string[] = []
    const io: InteractiveNewIO = {
      prompt: async (q) => {
        prompts.push(q)
        return answers.shift()!
      },
      editFile: async (initial) => `${initial}\n## Problem\nfilled in\n\n## Motivation\nfilled in\n\n## Constraints\nnone\n\n## Out of scope\nnothing\n`,
    }
    const result = await runInteractiveNew({ slug: null, title: null, initialBrief: null }, null, ['Problem', 'Motivation', 'Constraints', 'Out of scope'], io)
    expect(result).toEqual({
      slug: 'prompted-slug',
      title: 'Prompted Title',
      briefMarkdown: expect.stringContaining('# Intent Brief: Prompted Title'),
    })
    expect(prompts).toEqual(['slug: ', 'title: ', 'stage? [y/N] '])
  })

  it('runInteractiveNew re-prompts on an invalid slug instead of accepting it for the editor session (F4)', async () => {
    const answers = ['My New Thing', 'valid-slug', 'Prompted Title', 'y']
    const prompts: string[] = []
    const logs: string[] = []
    const io: InteractiveNewIO = {
      prompt: async (q) => {
        prompts.push(q)
        return answers.shift()!
      },
      log: (line) => logs.push(line),
      editFile: async (initial) => `${initial}\n## Problem\np\n\n## Motivation\nm\n\n## Constraints\nc\n\n## Out of scope\no\n`,
    }
    const result = await runInteractiveNew({ slug: null, title: null, initialBrief: null }, null, ['Problem', 'Motivation', 'Constraints', 'Out of scope'], io)
    expect(result?.slug).toBe('valid-slug')
    expect(prompts).toEqual(['slug: ', 'slug: ', 'title: ', 'stage? [y/N] '])
    expect(logs.some((l) => l.includes('must match'))).toBe(true)
  })

  it('runInteractiveNew offers a re-edit when required sections are missing, never padding them', async () => {
    const edits = ['# Intent Brief: X\n\n## Problem\nonly one section\n', '# Intent Brief: X\n\n## Problem\np\n\n## Motivation\nm\n\n## Constraints\nc\n\n## Out of scope\no\n']
    const answers = ['Y', 'y'] // re-edit once, then confirm
    const io: InteractiveNewIO = {
      prompt: async () => answers.shift()!,
      editFile: async () => edits.shift()!,
    }
    const result = await runInteractiveNew({ slug: 'known', title: 'Known', initialBrief: '' }, null, ['Problem', 'Motivation', 'Constraints', 'Out of scope'], io)
    expect(result?.briefMarkdown).toContain('## Motivation')
  })

  it('runInteractiveNew returns null (refuses) when the human declines to stage', async () => {
    const io: InteractiveNewIO = {
      prompt: async () => 'n',
      editFile: async () => '# Intent Brief: X\n\n## Problem\np\n\n## Motivation\nm\n\n## Constraints\nc\n\n## Out of scope\no\n',
    }
    const result = await runInteractiveNew({ slug: 'known', title: 'Known', initialBrief: '' }, null, ['Problem', 'Motivation', 'Constraints', 'Out of scope'], io)
    expect(result).toBeNull()
  })
})
