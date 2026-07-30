// Fixture repo generator: a temp git repository with pipeline runs in every
// interesting state — each gate pending, an escalation, a round-cap breach,
// a paused run, malformed artifacts, and a merged/done run. Used by the core
// and server test suites, Playwright, and `agentic ui --demo`. Timestamps are
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

const review = (task: string, round: number, verdict: string) => `# Review Report: ${task}

**Verdict:** ${verdict}
**Round:** ${round} of 3
**Diff reviewed:** run branch tip

## Findings

${verdict === 'approve' ? 'None.' : `### F1 — major — off-by-one in boundary handling
- **Where:** \`src/core.py:42\`
- **Failure scenario:** empty input → IndexError instead of clean exit
- **Requirement:** R2`}

## Coverage
Requirement coverage R1–R2 checked; error paths exercised by reading.

## Boundary check
Diff stayed inside the declared file_contact_surface.
`

const verification = () => `# Verification Report: run

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

const releasePlan = () => `# Release Plan: run

## Release steps
1. Tag the merge commit.
2. Publish via the existing workflow.

## Rollback plan
Re-point the tag at the previous release; no data migrations involved.

## Verification after release
Smoke-run the published artifact against sample.txt.
`

// state.yaml builder — carries the contract's comments so fixture files
// exercise comment preservation exactly like hand-maintained ones.
interface StateOpts {
  slug: string
  phase: string
  /** Run profile (DESIGN.md §4.1); omitted → full. The gates section carries exactly the profile's gates. */
  profile?: 'patch' | 'standard' | 'full'
  pausedReason?: string
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
phase: ${o.phase}               # spec | plan | implement | integrate | release | done | paused
${o.profile ? `profile: ${o.profile}           # patch | standard | full (DESIGN.md §4.1)\n` : ''}paused_reason: ${o.pausedReason ?? 'null'}

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
  'spec.md': `# Specification: <title>\n\n## Context\n\n## Requirements\n\n## Assumptions\n\n## Out of scope\n`,
  'plan.md': `# Technical Plan: <title>\n\n## Approach\n\n## Interface contracts\n\n## Decisions (ADRs)\n\n## Requirement → task mapping\n\n## Risks\n`,
  'review-report.md': `# Review Report: <task id>\n\n**Verdict:** approve | request-changes | escalate\n\n## Findings\n\n## Coverage\n\n## Boundary check\n`,
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
  /** Metadata prefix directory when `layout: 'prefixed'`. Defaults to `.agentic`. */
  prefix?: string
}

export function generateFixtureRepo(dir?: string, layoutOpts: FixtureLayoutOpts = {}): FixtureRepo {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'agentic-fixture-'))
  const repo = new Repo(root)
  const now = Math.floor(Date.now() / 1000)
  const prefix = layoutOpts.prefix ?? '.agentic'
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
        'spec.md': spec('rate limiter'),
        'plan.md': plan('rate limiter'),
        'tasks/01-core.yaml': workItem('01-core', 'R1', 'pending'),
        'tasks/02-errors.yaml': workItem('02-errors', 'R2', 'pending'),
        'state.yaml': stateYaml({
          slug: 'g1-pending',
          phase: 'plan',
          gates: { G0: { by: 'operator', at: '2026-07-05T09:00:00Z', burden: 'confirmation' } },
          tasks: [
            { id: '01-core', status: 'pending', rounds: 0 },
            { id: '02-errors', status: 'pending', rounds: 0 },
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
        'intent-brief.md': brief('log rotator'),
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
            'review-02.md': review('02-errors', 2, 'approve'),
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
        'review-01.md': review('01-core', 1, 'request-changes'),
        'review-02.md': review('01-core', 2, 'request-changes'),
        'review-03.md': review('01-core', 3, 'request-changes'),
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
      slug: 'malformed-spec',
      age: 2,
      files: {
        'intent-brief.md': brief('webhook relay'),
        'spec.md': malformedSpec('webhook relay'),
        'state.yaml': stateYaml({ slug: 'malformed-spec', phase: 'spec', gates: {} }),
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
