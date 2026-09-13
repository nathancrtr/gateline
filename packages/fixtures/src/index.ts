// Fixture repo generator: a temp git repository with pipeline runs in every
// interesting state — each gate pending, an escalation, a round-cap breach,
// a paused run, malformed artifacts, and a merged/done run. Used by the core
// and server test suites, Playwright, and `gateline ui --demo`. Timestamps are
// deterministic (staggered ages) so inbox ordering is assertable.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const DAY = 86_400

export interface FixtureRun {
  slug: string
  branch: string | null // null → lives only on main (merged)
}

export interface FixtureRepo {
  dir: string
  runs: FixtureRun[]
  /** Epoch seconds the fixture treats as "now" (newest commit time). */
  now: number
}

class Repo {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  git(args: string[], date?: number): string {
    const env = { ...process.env }
    if (date !== undefined) {
      const iso = new Date(date * 1000).toISOString()
      env.GIT_AUTHOR_DATE = iso
      env.GIT_COMMITTER_DATE = iso
    }
    env.GIT_CONFIG_GLOBAL = '/dev/null'
    env.GIT_CONFIG_SYSTEM = '/dev/null'
    return execFileSync('git', ['-C', this.dir, ...args], { env, encoding: 'utf8' })
  }

  write(path: string, content: string): void {
    const full = join(this.dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }

  commitAll(message: string, date: number): void {
    this.git(['add', '-A'])
    this.git(['commit', '-q', '-m', message], date)
  }
}

// --- Artifact builders (well-formed per the contracts) ---------------------

const brief = (title: string) => `# Intent Brief: ${title}

## Problem
The ${title} workflow is manual and error-prone today.

## Motivation
Automating it frees roughly an hour a week and removes a class of typos.

## Constraints
Must run offline; none otherwise known.

## Out of scope
Changing the upstream data format.
`

/**
 * The one artifact the Record reader cannot fit at any supported width (#312):
 * an unbreakable token in prose, outside any code block (a `pre` scrolls on
 * its own), so the reader itself overflows and its scroll cue has something
 * real to announce. A digest, deliberately — a path would wrap at its hyphens,
 * which browsers treat as break opportunities. Every other artifact fits,
 * which is the other half of the evidence: a cue that fires on a fitting
 * artifact has regressed #308.
 */
const wideBrief = (title: string) =>
  brief(title).replace(
    'Must run offline; none otherwise known.',
    `Must run offline; the reference corpus is pinned by digest \`sha512:${'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'.repeat(2)}\`.`,
  )

const spec = (title: string) => `# Specification: ${title}

## Context
The repository currently handles ${title} by hand. This spec automates it.

## Requirements

### R1 — Core behavior
The tool reads sample input and emits the documented output, end to end.
**Acceptance criteria:**
- [ ] AC1.1 — running the tool on sample input produces the documented output

### R2 — Error handling
**Acceptance criteria:**
- [ ] AC2.1 — malformed input exits non-zero with a one-line diagnosis
- [ ] AC2.2 — input larger than the documented cap is rejected before parsing

## Assumptions
- **ASSUMPTION:** input fits in memory → resolved as yes because samples are <1MB.

## Out of scope
Concurrency; internationalization.
`

const malformedSpec = (title: string) => `# Specification: ${title}

## Context
This spec is deliberately missing its Requirements and Assumptions sections.

## Out of scope
Everything, apparently.
`

const plan = (title: string) => `# Technical Plan: ${title}

## Approach
A single module with a thin CLI wrapper, mirroring the existing layout.

## Interface contracts
\`process(input: str) -> Result\` — pure; the CLI owns I/O.

## Decisions (ADRs)

### ADR-1: Pure core, thin shell
- **Choice:** keep all logic in a pure function.
- **Rejected:** logic in the CLI handler — untestable.
- **Consequences:** the CLI layer stays under 50 lines.

## Requirement → task mapping
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-core |
| R2 | 02-errors |

## Risks
Input format drift; early signal is AC1.1 failing on fresh samples.
`

// The G1 run's own spec and plan (#255). The shared `spec`/`plan` builders
// describe a tidy two-requirement change where nothing is uncovered and no two
// tasks meet — which is exactly the record against which a coverage view has
// nothing to say. G1's demo run carries what a G1 approver is actually looking
// for: a requirement the mapping table forgot, two independent tasks declaring
// the same file, and a third overlap that a `depends_on` already orders.
const g1Spec = (title: string) => `# Specification: ${title}

## Context
The repository currently handles ${title} by hand. This spec automates it.

## Requirements

### R1 — Core behavior
The tool reads sample input and emits the documented output, end to end.
**Acceptance criteria:**
- [ ] AC1.1 — running the tool on sample input produces the documented output

### R2 — Error handling
**Acceptance criteria:**
- [ ] AC2.1 — malformed input exits non-zero with a one-line diagnosis

### R3 — Rate accounting
Every decision the limiter takes is counted, so an operator can see what it refused.
**Acceptance criteria:**
- [ ] AC3.1 — a refused request increments the refusal counter exactly once

## Assumptions
- **ASSUMPTION:** input fits in memory → resolved as yes because samples are <1MB.

## Out of scope
Concurrency; internationalization.
`

const g1Plan = (title: string) => `# Technical Plan: ${title}

## Approach
A single module with a thin CLI wrapper, mirroring the existing layout.

## Interface contracts
\`process(input: str) -> Result\` — pure; the CLI owns I/O.

## Decisions (ADRs)

### ADR-1: Pure core, thin shell
- **Choice:** keep all logic in a pure function.
- **Rejected:** logic in the CLI handler — untestable.
- **Consequences:** the CLI layer stays under 50 lines.

### ADR-2 (amended 2026-07-06, G1 decline): Shared config module
- **Choice:** the limiter and the error path read one shared config module.
- **Rejected:** duplicating the defaults in each module — they drift.
- **Consequences:** two tasks touch \`src/shared.py\`, so their order matters.

## Requirement → task mapping
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-core |
| R2 | 02-errors |

## Risks
Input format drift; early signal is AC1.1 failing on fresh samples.
`

/** A work item with an explicit surface and dependency list, for the G1 run. */
const g1Task = (id: string, req: string, surface: string[], dependsOn: string[]) => `id: ${id}
title: ${id.replace(/^\d+-/, '').replace(/-/g, ' ')} slice
requirements: [${req}]

scope: |
  Implement the ${id} slice per plan.md.

file_contact_surface:
${surface.map((s) => `  - ${s}`).join('\n')}

acceptance_tests:
  - AC1.1

depends_on: [${dependsOn.join(', ')}]

status: pending

notes: |
`

const workItem = (id: string, req: string, status: string) => `id: ${id}
title: ${id.replace(/^\d+-/, '').replace(/-/g, ' ')}
requirements: [${req}]

scope: |
  Implement the ${id} slice per plan.md.

file_contact_surface:
  - src/${id.replace(/^\d+-/, '')}.py

acceptance_tests:
  - AC1.1

depends_on: []

status: ${status}

notes: |
`

/**
 * A work item from a fork whose `contracts/work-item.yaml` writes the contact
 * surface as a structured block rather than the list this parser reads. Every
 * required top-level key is present, so it passes validation and the gate stays
 * reviewable — it exercises the withheld path (#270 AC5), not the bounce path,
 * exactly as `forkedVerification` does for the evidence grammar.
 */
const forkedWorkItem = (id: string, req: string, status: string) => `id: ${id}
title: ${id.replace(/^\d+-/, '').replace(/-/g, ' ')}
requirements: [${req}]

scope: |
  Implement the ${id} slice per plan.md.

file_contact_surface:
  mode: exclusive
  paths:
    - src/pruner.py

acceptance_tests:
  - AC1.1

depends_on: []

status: ${status}

notes: |
`

const review = (task: string, round: number, verdict: string) => `# Review Report: ${task}

**Verdict:** ${verdict}
**Round:** ${round} of 3
**Diff reviewed:** run branch tip

## Findings

${verdict === 'approve' ? 'None.' : `### F1 — major — off-by-one in boundary handling
- **Where:** \`src/core.py:42\`
- **Failure scenario:** empty input → IndexError instead of clean exit
- **Requirement:** R2/AC2.1`}

## Coverage
Requirement coverage R1–R2 checked; error paths exercised by reading.

## Boundary check
Diff stayed inside the declared file_contact_surface.
`

/**
 * The three rounds behind a round cap, one file per round — the other shape a
 * run's reviews take on disk, and the one the round-cap comparison (#257) has
 * to read across files.
 *
 * The arc is what a cap actually looks like: F1 raised in round 1 and raised
 * again in every round after it (the finding that did not converge), F2 raised
 * in round 1, carried in round 2, and closed in round 3, and F3 raised for the
 * first time in the final round. The dispositions for F2 sit in later files
 * than the finding they name, which is exactly the case `ReviewReport.
 * dispositions` exists for.
 */
const capReview = (task: string, round: 1 | 2 | 3) => {
  const f1 = `### F1 — blocking — retry loop can double-apply a migration
- **Where:** \`src/migrate.py:88\`
- **Failure scenario:** a step that times out after committing is retried, so the same ALTER runs twice and the second raises
- **Requirement:** R2/AC2.1`
  const rounds: Record<1 | 2 | 3, string> = {
    1: `## Findings

${f1}

### F2 — minor — the dry-run banner prints after the plan
- **Where:** \`src/migrate.py:12\`
- **Failure scenario:** an operator skimming the top of the output reads the plan as live
- **Requirement:** R1/AC1.2`,
    2: `## Findings

${f1}

- **F2 — stands (round 2):** the banner moved but still prints inside the plan block.`,
    3: `## Findings

${f1}

### F3 — minor — the rollback path is untested
- **Where:** \`tests/test_migrate.py\`
- **Failure scenario:** a failed step leaves the schema half-applied and nothing exercises the undo
- **Requirement:** R3/AC3.1

- **F2 — resolved (round 3):** the banner is the first line of output.`,
  }
  return `# Review Report: ${task}

**Verdict:** request-changes
**Round:** ${round} of 3
**Diff reviewed:** run branch tip

${rounds[round]}

## Coverage
Requirement coverage R1–R3 checked; the retry path is read, not exercised.

## Boundary check
Diff stayed inside the declared file_contact_surface.
`
}

/**
 * A report that took two rounds, which is what a task carrying
 * `review_rounds: 2` actually looks like on disk: rounds APPEND to one file
 * (roles/reviewer.md — never overwrite an earlier round), a finding raised in
 * round 1 is dispositioned in round 2, and the verdict in force is the last
 * one. Exercises the typed parse (#214), the finding cards (#215), and the
 * criterion → finding join on G2's packet surface (#256).
 */
const reviewTwoRounds = (task: string) => `# Review Report: ${task}

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** run branch tip

## Findings

### F1 — blocking — malformed input exits zero
- **Where:** \`src/errors.py:7\`
- **Failure scenario:** a binary file is rejected in the log but the process still exits 0, so a caller cannot tell failure from success
- **Requirement:** R2/AC2.1

### F2 — minor — the diagnosis spans two lines
- **Where:** \`src/errors.py:12\`
- **Failure scenario:** the second line is dropped by callers that read one line
- **Requirement:** R2/AC2.1

## Coverage
Requirement coverage R1–R2 checked; error paths exercised by reading.

## Boundary check
Diff stayed inside the declared file_contact_surface.

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** run branch tip

## Findings

- **F1 — resolved (round 2):** the guard exits 1 and prints one line.
- **F2 — stands (round 2):** cosmetic, and the caller contract is one line either way.

## Coverage
Re-checked R2; R1 is unchanged since round 1.

## Boundary check
Diff stayed inside the declared file_contact_surface.
`

const verification = () => `# Verification Report: run

**Verdict:** pass
**Change verified:** run branch tip
**Environment:** local, python 3.12

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC2.1 | verified | see E2 |

### E1 — AC1.1
\`\`\`
$ tool sample.txt
ok (3 records)
\`\`\`

### E2 — AC2.1
\`\`\`
$ tool garbage.bin; echo exit=$?
error: not a text file
exit=1
\`\`\`

## Beyond the happy path
Probed empty file, 100MB file, and mid-write interruption: all clean.

## Gaps
AC2.2 not verified — the fixture corpus has no oversized sample.
`

/**
 * A verification report that carries every section its contract requires and
 * none of the grammar the evidence parser reads: no `### E<k> — AC<n>.<m>`
 * blocks, no Results rows keyed by a criterion. Contracts are forkable
 * (INTEGRATION.md), so this is a legitimate record, not a malformed one — it
 * passes validation and the gate is reviewable. It exists to prove the
 * structured G2 view withholds itself and says why (#256) instead of guessing.
 */
/**
 * The verifier's escalation channel (#152): the run that escalated carries
 * the report that did it — one criterion unverifiable for a reason that lies
 * in the spec, and the overall verdict that puts it in front of a human. The
 * G2 surface quotes both, so a non-clean report never looks like a clean pass.
 */
const escalatingVerification = () => `# Verification Report: run

**Verdict:** escalate
**Change verified:** run branch tip
**Environment:** local, python 3.12

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC2.1 | unverifiable | see Gaps |

### E1 — AC1.1
\`\`\`
$ tool sample.txt
ok (3 records)
\`\`\`

## Beyond the happy path
Probed an empty queue; the consumer exits cleanly.

## Gaps
- AC2.1 unverifiable: the sample input the spec references does not exist in the repo — a spec defect, not an implementation one. Escalating.
`

const forkedVerification = () => `# Verification Report: run

**Change verified:** run branch tip
**Environment:** hosted CI, python 3.12

## Results
Every acceptance criterion in the spec was exercised against the built
artifact and all of them held. The transcripts live in the CI job for this
branch rather than inline, per this repository's own reporting convention.

## Beyond the happy path
Probed an empty file and a truncated file; both exit cleanly.

## Gaps
None recorded.
`

const releasePlan = () => `# Release Plan: run

**Change released:** \`run/g3-pending\` at \`4c1f9a2\` (PR #14, base \`main\`)
**Environment:** the published package on the public registry; no infrastructure changes

## CI health

The pipeline is green on the merge commit. \`npm test\` and \`npm run build\` both
passed on the latest run of the release workflow.

## Release steps

1. Tag the merge commit \`v0.4.0\`.
2. Publish via the existing release workflow.

## Rollback plan

**Rollback trigger:** the published artifact fails its smoke run, or an install of the
new version reports a missing entrypoint.
**Rollback exercised:** yes — re-pointed the tag on a scratch clone and re-published to
the local registry mirror.

Re-point the tag at the previous release and re-publish. Nothing writes data under the
new version, so there is no state to unwind.

## Verification after release

The published version installs and runs. Watch two signals:

- the smoke run against \`sample.txt\` prints the documented output;
- no install failures appear in the registry's download log within an hour.

## Blast radius

Consumers who install the new version while it is broken. Nothing else depends on this
package, and the previous version stays installable throughout.
`

/** A release plan missing the sections its contract requires — the bounce view
 *  at G3 (#260), which had no checkable packet until the contract existed. */
const malformedReleasePlan = () => `# Release Plan: run

## Release steps

1. Ship it.
`

// state.yaml builder — carries the contract's comments so fixture files
// exercise comment preservation exactly like hand-maintained ones.
interface StateOpts {
  slug: string
  phase: string
  /** Run profile (DESIGN.md §4.1); omitted → full. The gates section carries exactly the profile's gates. */
  profile?: 'patch' | 'standard' | 'full'
  pausedReason?: string
  /** The closure record a `closed` run carries (#200). */
  closure?: { as: string; by: string; at: string; reason: string }
  gates: Partial<Record<'G0' | 'G1' | 'G2' | 'G3', { by: string; at: string; notes?: string; burden?: string; approved?: boolean }>>
  tasks?: { id: string; status: string; rounds: number }[]
  escalations?: { at: string; from: string; reason: string; resolved: boolean }[]
  budget?: { limit: number; spent: number; ledger?: LedgerLine[] }
}

interface LedgerLine {
  at: string
  role: string
  task: string | null
  round: number | null
  adapter: string
  model: string
  /** Null when the adapter reports no per-invocation usage (static-estimate metering). */
  tokensIn: number | null
  tokensOut: number | null
  costUsd: number
}

function stateYaml(o: StateOpts): string {
  const gate = (id: 'G0' | 'G1' | 'G2' | 'G3') => {
    const g = o.gates[id]
    if (!g) return `  ${id}: {approved: false, by: null, at: null, notes: null}`
    const approved = g.approved !== false
    const parts = [`approved: ${approved}`, `by: ${g.by}`, `at: ${g.at}`, `notes: ${g.notes ?? 'null'}`]
    if (g.burden) parts.push(`burden: ${g.burden}`)
    return `  ${id}: {${parts.join(', ')}}`
  }
  const tasks = (o.tasks ?? [])
    .map((t) => `  - {id: ${t.id}, status: ${t.status}, review_rounds: ${t.rounds}}`)
    .join('\n')
  const escalations = (o.escalations ?? [])
    .map((e) => `  - {at: ${e.at}, from_role: ${e.from}, reason: ${JSON.stringify(e.reason)}, resolved: ${e.resolved}}`)
    .join('\n')
  const budget = o.budget ?? { limit: 25, spent: 0 }
  const ledger = (budget.ledger ?? [])
    .map(
      (l) =>
        `  - {at: ${l.at}, role: ${l.role}, task: ${l.task ?? 'null'}, round: ${l.round ?? 'null'}, adapter: ${l.adapter}, model: ${l.model}, tokens_in: ${l.tokensIn ?? 'null'}, tokens_out: ${l.tokensOut ?? 'null'}, cost_usd: ${l.costUsd}}`,
    )
    .join('\n')
  const gateIds =
    o.profile === 'patch'
      ? (['G1', 'G2'] as const)
      : o.profile === 'standard'
        ? (['G0', 'G1', 'G2'] as const)
        : (['G0', 'G1', 'G2', 'G3'] as const)
  return `# Contract: maintained by Orchestrator (human in v0); read by everyone.
# Lives at runs/<slug>/state.yaml — the single source of truth for a run.

run: ${o.slug}
branch: run/${o.slug}
phase: ${o.phase}               # spec | plan | implement | integrate | release | done | paused | closed
${o.profile ? `profile: ${o.profile}           # patch | standard | full (DESIGN.md §4.1)\n` : ''}paused_reason: ${o.pausedReason ?? 'null'}
${o.closure ? `closure: {as: ${o.closure.as}, by: ${o.closure.by}, at: ${o.closure.at}, reason: ${JSON.stringify(o.closure.reason)}}\n` : ''}

budget:
  cost_limit_usd: ${budget.limit}      # exhaustion pauses the run; it never silently degrades
  cost_spent_usd: ${budget.spent}      # derived: sum of ledger[].cost_usd
  ledger:${ledger ? `\n${ledger}` : ' []'}

gates:                    # a gate entry is written ONLY by the named human
${gateIds.map(gate).join('\n')}

tasks:                    # mirrors tasks/*.yaml status; the ONLY home of review_rounds
${tasks || '  []'}

escalations:              # append-only: {at, from_role, reason, resolved}
${escalations || '  []'}
`
}

// --- Contract templates on main (validator reads these at runtime) ---------

const CONTRACTS: Record<string, string> = {
  'intent-brief.md': `# Intent Brief: <title>\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n`,
  'spec.md': `# Specification: <title>\n\n<!-- AUDIENCE: Out of scope=audit -->\n\n## Context\n\n## Requirements\n\n## Assumptions\n\n## Out of scope\n`,
  'plan.md': `# Technical Plan: <title>\n\n## Approach\n\n## Interface contracts\n\n## Decisions (ADRs)\n\n## Requirement → task mapping\n\n## Risks\n`,
  'review-report.md': `# Review Report: <task id>\n\n<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->\n\n**Verdict:** approve | request-changes | escalate\n\n## Findings\n\n## Coverage\n\n## Boundary check\n`,
  'verification-report.md': `# Verification Report: <run or task id>\n\n**Change verified:** <branch/commit>\n\n## Results\n\n## Beyond the happy path\n\n## Gaps\n`,
  'work-item.yaml': `id: 01-example\ntitle: One-line description\nrequirements: [R1]\nscope: |\n  What to build.\nfile_contact_surface:\n  - src/example.py\nacceptance_tests:\n  - AC1.1\ndepends_on: []\nstatus: pending\nnotes: |\n`,
  'state.yaml': stateYaml({ slug: 'example-slug', phase: 'spec', gates: {} }),
}

// --- The generator ----------------------------------------------------------

export interface FixtureLayoutOpts {
  /**
   * `prefixed` mirrors `integrate.py init --layout prefixed` (its own
   * default): runs/contracts live under `prefix/` and a minimal
   * framework-lock.json records it, so a source must probe rather than
   * assume root layout (#94). Defaults to `root`, the shape every existing
   * fixture consumer expects.
   */
  layout?: 'root' | 'prefixed'
  /** Metadata prefix directory when `layout: 'prefixed'`. Defaults to `.gateline`. */
  prefix?: string
}

export function generateFixtureRepo(dir?: string, layoutOpts: FixtureLayoutOpts = {}): FixtureRepo {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'gateline-fixture-'))
  const repo = new Repo(root)
  const now = Math.floor(Date.now() / 1000)
  const prefix = layoutOpts.prefix ?? '.gateline'
  const prefixed = layoutOpts.layout === 'prefixed'
  const runsRoot = prefixed ? `${prefix}/runs` : 'runs'
  const contractsRoot = prefixed ? `${prefix}/contracts` : 'contracts'

  repo.git(['init', '-q', '-b', 'main'])
  repo.git(['config', 'user.name', 'Fixture Operator'])
  repo.git(['config', 'user.email', 'operator@example.test'])

  // main: contracts + a merged, fully-done run (the wordfreq shape).
  for (const [name, content] of Object.entries(CONTRACTS)) repo.write(`${contractsRoot}/${name}`, content)
  repo.write('README.md', '# fixture\n\nGenerated demo repository for the gate frontend.\n')
  if (prefixed) {
    repo.write(
      `${prefix}/framework-lock.json`,
      JSON.stringify(
        {
          source: { repo: null, ref: 'fixture', version: 'unreleased' },
          integrated_at: '2026-01-01',
          method: 'fixture',
          adapters_rendered: [],
          taken: [],
          files: {},
          forks: {},
          instance_layer: [],
          provenance_mode: 'private',
          layout: 'prefixed',
          prefix,
        },
        null,
        2,
      ),
    )
  }
  repo.commitAll('Seed contracts', now - 30 * DAY)

  const doneSlug = 'done-merged'
  repo.write(`${runsRoot}/${doneSlug}/intent-brief.md`, brief('archived pipeline'))
  repo.write(`${runsRoot}/${doneSlug}/spec.md`, spec('archived pipeline'))
  repo.write(`${runsRoot}/${doneSlug}/plan.md`, plan('archived pipeline'))
  repo.write(`${runsRoot}/${doneSlug}/tasks/01-core.yaml`, workItem('01-core', 'R1', 'done'))
  repo.write(`${runsRoot}/${doneSlug}/review-01.md`, review('01-core', 1, 'approve'))
  repo.write(`${runsRoot}/${doneSlug}/verification-report.md`, verification())
  repo.write(
    `${runsRoot}/${doneSlug}/state.yaml`,
    stateYaml({
      slug: doneSlug,
      phase: 'done',
      gates: {
        G0: { by: 'operator', at: '2026-06-20T10:00:00Z', burden: 'confirmation' },
        G1: { by: 'operator', at: '2026-06-21T10:00:00Z', burden: 'light-correction', notes: 'ADR-1 accepted' },
        G2: { by: 'operator', at: '2026-06-23T10:00:00Z', burden: 'confirmation', notes: 'merged' },
        G3: { by: 'operator', at: '2026-06-24T10:00:00Z', burden: 'confirmation' },
      },
      tasks: [{ id: '01-core', status: 'done', rounds: 1 }],
      budget: {
        limit: 25,
        spent: 6.4,
        // Hand-recorded v0 ledger (the M0 shape the v1 dispatch seam automates).
        ledger: [
          { at: '2026-06-20T09:30:00Z', role: 'analyst', task: null, round: null, adapter: 'claude-code', model: 'anthropic/claude-sonnet-5', tokensIn: 180000, tokensOut: 9000, costUsd: 0.68 },
          { at: '2026-06-21T09:30:00Z', role: 'architect', task: null, round: null, adapter: 'claude-code', model: 'anthropic/claude-fable-5', tokensIn: 120000, tokensOut: 11000, costUsd: 2.63 },
          { at: '2026-06-22T10:00:00Z', role: 'implementer', task: '01-core', round: 1, adapter: 'claude-code', model: 'anthropic/claude-sonnet-5', tokensIn: 310000, tokensOut: 24000, costUsd: 1.29 },
          { at: '2026-06-22T14:00:00Z', role: 'reviewer', task: '01-core', round: 1, adapter: 'copilot-cli', model: 'openai/gpt-5.4', tokensIn: null, tokensOut: null, costUsd: 1.1 },
          { at: '2026-06-23T09:00:00Z', role: 'verifier', task: null, round: null, adapter: 'claude-code', model: 'anthropic/claude-sonnet-5', tokensIn: 150000, tokensOut: 17000, costUsd: 0.7 },
        ],
      },
    }),
  )
  repo.commitAll(`state(${doneSlug}): run complete`, now - 15 * DAY)

  const runs: FixtureRun[] = [{ slug: doneSlug, branch: null }]

  interface BranchRun {
    slug: string
    age: number // days since the run last needed attention
    files: Record<string, string>
    commits?: { files: Record<string, string>; message: string; age: number }[]
  }

  const branchRuns: BranchRun[] = [
    {
      slug: 'g0-pending',
      age: 1,
      files: {
        'intent-brief.md': brief('CSV importer'),
        'spec.md': spec('CSV importer'),
        'state.yaml': stateYaml({ slug: 'g0-pending', phase: 'spec', gates: {} }),
      },
    },
    {
      slug: 'g1-pending',
      age: 2,
      files: {
        'intent-brief.md': brief('rate limiter'),
        'spec.md': g1Spec('rate limiter'),
        'plan.md': g1Plan('rate limiter'),
        // 01-core and 02-errors both declare src/shared.py and nothing orders
        // them — the decomposition defect G1 exists to catch. 03-cli overlaps
        // 01-core too, but depends on it, so the record already orders that pair.
        'tasks/01-core.yaml': g1Task('01-core', 'R1', ['src/core.py', 'src/shared.py'], []),
        'tasks/02-errors.yaml': g1Task('02-errors', 'R2', ['src/errors.py', 'src/shared.py'], []),
        'tasks/03-cli.yaml': g1Task('03-cli', 'R1', ['src/cli.py', 'src/core.py'], ['01-core']),
        'state.yaml': stateYaml({
          slug: 'g1-pending',
          phase: 'plan',
          gates: { G0: { by: 'operator', at: '2026-07-05T09:00:00Z', burden: 'confirmation' } },
          tasks: [
            { id: '01-core', status: 'pending', rounds: 0 },
            { id: '02-errors', status: 'pending', rounds: 0 },
            { id: '03-cli', status: 'pending', rounds: 0 },
          ],
        }),
      },
    },
    {
      slug: 'g2-pending',
      // The genesis commit predates the ledger commits below (ages 5→3), so
      // the history reads oldest-last without a date inversion. The run's own
      // freshness still comes from its tip, which stays at 3 days.
      age: 6,
      // The genesis commit holds only what exists before G0 is decided; the
      // rest of the record arrives across the ledger commits below, which is
      // both how a real run accretes and what gives each commit something to
      // land. The final commit restores the same tree this run had before.
      files: {
        'intent-brief.md': wideBrief('log rotator'),
        'spec.md': spec('log rotator'),
        'state.yaml': stateYaml({ slug: 'g2-pending', phase: 'spec', gates: {} }),
      },
      // g2-pending carries a realistic decision ledger (#268): the commit
      // subjects below are the grammar the two seams actually write —
      // record/actions.ts for the human decisions, orchestrator/src/engine.ts
      // for the bot verbs. Without them every demo run reads as `other` and the
      // ledger has nothing to show. The final commit restores the same
      // state.yaml the base commit wrote, so the branch tip — which is what
      // every other test reads — is unchanged.
      commits: [
        {
          age: 5,
          message: 'state(g2-pending): G0 approved by operator [burden: confirmation]',
          files: {
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'plan',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' } },
            }),
          },
        },
        {
          // Each engine verb also writes state.yaml — metering, task status,
          // harvest — which is why they appear in a state history at all.
          age: 5,
          message: 'state(g2-pending): dispatched architect',
          files: {
            'plan.md': plan('log rotator'),
            'tasks/01-core.yaml': workItem('01-core', 'R1', 'pending'),
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'plan',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' } },
              budget: { limit: 25, spent: 0.54 },
            }),
          },
        },
        {
          age: 4,
          message: 'state(g2-pending): G1 approved by operator [burden: light-correction]',
          files: {
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' }, G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' } },
              tasks: [{ id: '01-core', status: 'pending', rounds: 0 }],
              budget: { limit: 25, spent: 0.54 },
            }),
          },
        },
        {
          age: 4,
          message: 'state(g2-pending): dispatched implementer(01-core)',
          files: {
            '../../src/core.py': 'def process(text):\n    return text.split()\n',
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' }, G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' } },
              tasks: [{ id: '01-core', status: 'dispatched', rounds: 0 }],
              budget: { limit: 25, spent: 0.91 },
            }),
          },
        },
        {
          age: 3,
          message: 'state(g2-pending): bounced review-02.md — re-dispatching reviewer (missing: Boundary check)',
          files: {
            '../../src/errors.py': 'class InputError(Exception):\n    pass\n',
            // Touched by no work item's declared surface — the case the
            // contact-surface-scoped diff (#270) exists to make visible, and
            // exactly what the Reviewer's `Boundary check` section is for. The
            // demo needs it: with every file inside its surface, the view's
            // whole point never renders.
            '../../src/config.py': 'TIMEOUT = 30\nRETRIES = 3\n',
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' }, G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' } },
              tasks: [{ id: '01-core', status: 'in-review', rounds: 1 }],
              budget: { limit: 25, spent: 1.20 },
            }),
          },
        },
        {
          age: 3,
          message: 'state(g2-pending): metered reviewer(02-errors r2) $1.86',
          files: {
            'review-01.md': review('01-core', 1, 'approve'),
            // 02-errors carries review_rounds: 2 in state.yaml, so its report
            // is the two-round shape the record claims.
            'review-02.md': reviewTwoRounds('02-errors'),
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' }, G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' } },
              tasks: [{ id: '01-core', status: 'review-approved', rounds: 1 }],
              budget: { limit: 25, spent: 1.86 },
            }),
          },
        },
        {
          age: 3,
          message: 'state(g2-pending): harvested 2 artifacts',
          files: {
            'verification-report.md': verification(),
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: { G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' }, G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' } },
              tasks: [{ id: '01-core', status: 'review-approved', rounds: 1 }],
              budget: { limit: 25, spent: 2.31 },
            }),
          },
        },
        {
          // Restores exactly the state.yaml and work items this run had before
          // the ledger commits were added, so the branch tip every other test
          // reads is unchanged.
          age: 3,
          message: 'state(g2-pending): advanced — phase implement',
          files: {
            'tasks/01-core.yaml': workItem('01-core', 'R1', 'review-approved'),
            'tasks/02-errors.yaml': workItem('02-errors', 'R2', 'review-approved'),
            'state.yaml': stateYaml({
              slug: 'g2-pending',
              phase: 'implement',
              gates: {
                G0: { by: 'operator', at: '2026-07-02T09:00:00Z', burden: 'confirmation' },
                G1: { by: 'operator', at: '2026-07-03T09:00:00Z', burden: 'light-correction' },
              },
              tasks: [
                { id: '01-core', status: 'review-approved', rounds: 1 },
                { id: '02-errors', status: 'review-approved', rounds: 2 },
              ],
            }),
          },
        },
      ],
    },
    {
      slug: 'g3-pending',
      age: 5,
      files: {
        'intent-brief.md': brief('metrics exporter'),
        'spec.md': spec('metrics exporter'),
        'plan.md': plan('metrics exporter'),
        'tasks/01-core.yaml': workItem('01-core', 'R1', 'done'),
        'review-01.md': review('01-core', 1, 'approve'),
        'verification-report.md': verification(),
        'release-plan.md': releasePlan(),
        'state.yaml': stateYaml({
          slug: 'g3-pending',
          phase: 'release',
          gates: {
            G0: { by: 'operator', at: '2026-06-28T09:00:00Z', burden: 'confirmation' },
            G1: { by: 'operator', at: '2026-06-29T09:00:00Z', burden: 'confirmation' },
            G2: { by: 'operator', at: '2026-07-01T09:00:00Z', burden: 'light-correction', notes: 'merged' },
          },
          tasks: [{ id: '01-core', status: 'done', rounds: 1 }],
          budget: { limit: 25, spent: 11.2 },
        }),
      },
    },
    {
      slug: 'escalated',
      age: 7, // oldest → must rank first in the inbox
      files: {
        'intent-brief.md': brief('queue consumer'),
        'spec.md': spec('queue consumer'),
        'plan.md': plan('queue consumer'),
        'tasks/01-core.yaml': workItem('01-core', 'R1', 'in-progress'),
        'verification-report.md': escalatingVerification(),
        'state.yaml': stateYaml({
          slug: 'escalated',
          phase: 'implement',
          gates: {
            G0: { by: 'operator', at: '2026-06-25T09:00:00Z', burden: 'confirmation' },
            G1: { by: 'operator', at: '2026-06-26T09:00:00Z', burden: 'confirmation' },
          },
          tasks: [{ id: '01-core', status: 'in-progress', rounds: 1 }],
          escalations: [
            {
              at: new Date((now - 7 * DAY) * 1000).toISOString(),
              from: 'verifier',
              reason: 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo',
              resolved: false,
            },
          ],
        }),
      },
    },
    {
      slug: 'round-cap',
      age: 4,
      files: {
        'intent-brief.md': brief('schema migrator'),
        'spec.md': spec('schema migrator'),
        'plan.md': plan('schema migrator'),
        'tasks/01-core.yaml': workItem('01-core', 'R1', 'in-review'),
        'review-01.md': capReview('01-core', 1),
        'review-02.md': capReview('01-core', 2),
        'review-03.md': capReview('01-core', 3),
        'state.yaml': stateYaml({
          slug: 'round-cap',
          phase: 'implement',
          gates: {
            G0: { by: 'operator', at: '2026-06-30T09:00:00Z', burden: 'confirmation' },
            G1: { by: 'operator', at: '2026-07-01T09:00:00Z', burden: 'confirmation' },
          },
          tasks: [{ id: '01-core', status: 'in-review', rounds: 3 }],
        }),
      },
    },
    {
      slug: 'paused-budget',
      age: 6,
      files: {
        'intent-brief.md': brief('report generator'),
        'spec.md': spec('report generator'),
        'state.yaml': stateYaml({
          slug: 'paused-budget',
          phase: 'paused',
          pausedReason: 'budget-exhausted',
          gates: { G0: { by: 'operator', at: '2026-06-27T09:00:00Z', burden: 'confirmation' } },
          budget: { limit: 10, spent: 10.4 },
        }),
      },
    },
    // A run a human closed out (#200). It carries an UNRESOLVED escalation on
    // purpose: a closure answers everything inside the run at once, so this is
    // the fixture that proves readiness stops asking rather than falling
    // through to the escalation rule.
    {
      slug: 'closed-delivered',
      age: 4,
      files: {
        'intent-brief.md': brief('inbox decide link'),
        'spec.md': spec('inbox decide link'),
        'state.yaml': stateYaml({
          slug: 'closed-delivered',
          phase: 'closed',
          closure: {
            as: 'already-delivered',
            by: 'operator',
            at: '2026-06-29T11:00:00Z',
            reason: 'The work landed by another path; this record closes to match reality.',
          },
          gates: { G0: { by: 'operator', at: '2026-06-27T09:00:00Z', burden: 'confirmation' } },
          tasks: [{ id: '01-core', status: 'failed', rounds: 0 }],
          escalations: [{ at: '2026-06-28T09:00:00Z', from: 'orchestrator', reason: 'implementer failed twice', resolved: false }],
        }),
      },
    },
    // Patch-profile runs (DESIGN.md §4.1): no spec/plan, no verifier — the
    // human-authored brief + work item are the G1 packet, reviews alone are G2's.
    {
      slug: 'patch-g1-pending',
      age: 1,
      files: {
        'intent-brief.md': brief('typo hotfix'),
        'tasks/01-hotfix.yaml': workItem('01-hotfix', 'R1', 'pending'),
        'state.yaml': stateYaml({
          slug: 'patch-g1-pending',
          phase: 'plan',
          profile: 'patch',
          gates: {},
          tasks: [{ id: '01-hotfix', status: 'pending', rounds: 0 }],
        }),
      },
    },
    {
      slug: 'patch-g2-pending',
      age: 2,
      files: {
        'intent-brief.md': brief('off-by-one fix'),
        'tasks/01-fix.yaml': workItem('01-fix', 'R1', 'review-approved'),
        'review-01.md': review('01-fix', 1, 'approve'),
        'state.yaml': stateYaml({
          slug: 'patch-g2-pending',
          phase: 'implement',
          profile: 'patch',
          gates: { G1: { by: 'operator', at: '2026-07-08T09:00:00Z', burden: 'confirmation' } },
          tasks: [{ id: '01-fix', status: 'review-approved', rounds: 1 }],
        }),
      },
    },
    {
      // A forked contract, not a broken record: every artifact has its required
      // sections and keys, so the gate is reviewable, but two of them are
      // written in grammars this parser does not read. The evidence blocks
      // withhold G2's criterion view (#256) and the work item's structured
      // contact surface withholds the diff's grouping (#270) — a fork writes
      // its own contracts/ for more than one artifact, and both fallbacks say
      // which grammar they looked for rather than guessing.
      slug: 'forked-contract',
      age: 2,
      files: {
        'intent-brief.md': brief('archive pruner'),
        'spec.md': spec('archive pruner'),
        'plan.md': plan('archive pruner'),
        // The diff is a G2 artifact and renders whatever the labelling does.
        '../../src/pruner.py': 'def prune(paths):\n    return [p for p in paths if p]\n',
        'tasks/01-core.yaml': forkedWorkItem('01-core', 'R1', 'review-approved'),
        'review-01.md': review('01-core', 1, 'request-changes'),
        'verification-report.md': forkedVerification(),
        'state.yaml': stateYaml({
          slug: 'forked-contract',
          phase: 'implement',
          profile: 'standard',
          gates: {
            G0: { by: 'operator', at: '2026-07-07T09:00:00Z', burden: 'confirmation' },
            G1: { by: 'operator', at: '2026-07-08T09:00:00Z', burden: 'confirmation' },
          },
          tasks: [{ id: '01-core', status: 'review-approved', rounds: 1 }],
          budget: { limit: 25, spent: 3.4 },
        }),
      },
    },
    {
      slug: 'malformed-spec',
      age: 2,
      files: {
        'intent-brief.md': brief('webhook relay'),
        'spec.md': malformedSpec('webhook relay'),
        'state.yaml': stateYaml({ slug: 'malformed-spec', phase: 'spec', gates: {} }),
      },
    },
    {
      // G3's bounce view (#260). Until release-plan.md had a contract, this
      // run passed its gate on presence alone — the one gate where a packet
      // could say nothing and still be called ready.
      slug: 'malformed-release',
      age: 2,
      files: {
        'intent-brief.md': brief('cache warmer'),
        'spec.md': spec('cache warmer'),
        'plan.md': plan('cache warmer'),
        'tasks/01-core.yaml': workItem('01-core', 'R1', 'done'),
        'review-01.md': review('01-core', 1, 'approve'),
        'verification-report.md': verification(),
        'release-plan.md': malformedReleasePlan(),
        'state.yaml': stateYaml({
          slug: 'malformed-release',
          phase: 'release',
          gates: {
            G0: { by: 'operator', at: '2026-06-28T09:00:00Z', burden: 'confirmation' },
            G1: { by: 'operator', at: '2026-06-29T09:00:00Z', burden: 'confirmation' },
            G2: { by: 'operator', at: '2026-07-01T09:00:00Z', burden: 'confirmation' },
          },
          tasks: [{ id: '01-core', status: 'done', rounds: 1 }],
        }),
      },
    },
    {
      slug: 'bad-state',
      age: 1,
      files: {
        'state.yaml': 'run: bad-state\nbranch: run/bad-state\nphase: [this is\n  not: valid yaml for a phase\n',
      },
    },
  ]

  for (const r of branchRuns) {
    repo.git(['checkout', '-q', '-b', `run/${r.slug}`, 'main'])
    for (const [path, content] of Object.entries(r.files)) {
      repo.write(path.startsWith('../../') ? path.slice(6) : `${runsRoot}/${r.slug}/${path}`, content)
    }
    repo.commitAll(`state(${r.slug}): artifacts`, now - r.age * DAY)
    for (const extra of r.commits ?? []) {
      for (const [path, content] of Object.entries(extra.files)) {
        repo.write(path.startsWith('../../') ? path.slice(6) : `${runsRoot}/${r.slug}/${path}`, content)
      }
      repo.commitAll(extra.message, now - extra.age * DAY)
    }
    runs.push({ slug: r.slug, branch: `run/${r.slug}` })
  }

  repo.git(['checkout', '-q', 'main'])
  return { dir: root, runs, now }
}
