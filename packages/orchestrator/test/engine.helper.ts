// Shared scaffolding for the engine tests: a toy repo with contracts and one
// run branch, a scriptable FakeDispatcher standing in for a harness (its
// script plays the agent: write artifacts, commit, report usage), and a
// reconcile loop that drives the engine to a fixed point.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect } from 'vitest'
import { LocalGitSource, planDecision, type DecisionInput, type RunRef } from '@agentic/core'
import type { Engine } from '../src/engine.ts'
import type { Registry } from '../src/registry.ts'
import type { Dispatcher, DispatchOutcome, DispatchRequest } from '../src/seam.ts'

export const HUMAN = { name: 'Toy Operator', email: 'op@example.test' }

export const TEST_REGISTRY: Registry = {
  profiles: {
    'frontier-reasoning': { default: 'anthropic/claude-fable-5', alternates: ['openai/gpt-5.4'] },
    balanced: { default: 'anthropic/claude-sonnet-5', alternates: ['google/gemini-3-flash'] },
  },
  bindings: {
    orchestrator: { profile: 'frontier-reasoning' },
    analyst: { profile: 'balanced' },
    architect: { profile: 'frontier-reasoning' },
    implementer: { profile: 'balanced' },
    reviewer: { profile: 'frontier-reasoning', avoid_vendor_of: 'implementer' },
    verifier: { profile: 'balanced', avoid_vendor_of: 'implementer' },
    ops: { profile: 'balanced' },
  },
  pricing: {
    'anthropic/claude-fable-5': { usd_per_mtok_in: 15, usd_per_mtok_out: 75 },
    'anthropic/claude-sonnet-5': { usd_per_mtok_in: 3, usd_per_mtok_out: 15 },
  },
  estimates: { orchestrator: 0.5, analyst: 2, architect: 5, implementer: 8, reviewer: 4, verifier: 6, ops: 2 },
}

const CONTRACTS: Record<string, string> = {
  'intent-brief.md': '# Intent Brief: <t>\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n',
  'spec.md': '# Specification: <t>\n\n## Context\n\n## Requirements\n\n## Assumptions\n\n## Out of scope\n',
  'plan.md': '# Technical Plan: <t>\n\n## Approach\n\n## Interface contracts\n\n## Decisions (ADRs)\n\n## Requirement → task mapping\n\n## Risks\n',
  'review-report.md': '# Review Report: <t>\n\n**Verdict:** approve | request-changes | escalate\n\n## Findings\n\n## Coverage\n\n## Boundary check\n',
  'verification-report.md': '# Verification Report: <t>\n\n**Change verified:** <rev>\n\n## Results\n\n## Beyond the happy path\n\n## Gaps\n',
  'work-item.yaml': 'id: 01-x\ntitle: t\nrequirements: [R1]\nscope: |\n  s\nfile_contact_surface:\n  - src/x.py\nacceptance_tests:\n  - AC1.1\ndepends_on: []\nstatus: pending\nnotes: |\n',
}

export const SPEC = '# Specification: toy\n\n## Context\nToy.\n\n## Requirements\n- R1 — behave\n\n## Assumptions\nNone.\n\n## Out of scope\nEverything else.\n'
export const PLAN =
  '# Technical Plan: toy\n\n## Approach\nSmall.\n\n## Interface contracts\nNone.\n\n## Decisions (ADRs)\nADR-1.\n\n## Requirement → task mapping\nR1 → 01-core, 02-cli\n\n## Risks\nNone.\n'
export const REVIEW = (task: string, verdict: string, round = 1) =>
  `# Review Report: ${task}\n\n**Verdict:** ${verdict}\n**Round:** ${round} of 3\n\n## Findings\n${verdict === 'approve' ? 'None.' : '### F1 — major — bug\n- **Where:** src\n'}\n## Coverage\nR1.\n\n## Boundary check\nInside surface.\n`
export const VERIFICATION = '# Verification Report: toy\n\n**Change verified:** tip\n\n## Results\n| AC1.1 | verified | E1 |\n\n## Beyond the happy path\nProbed.\n\n## Gaps\nNone.\n'
export const RELEASE_PLAN = '# Release Plan: toy\n\n## Release steps\n1. Tag.\n\n## Rollback plan\nRe-point.\n'

export const taskYaml = (id: string, surface: string, deps: string[] = [], notes = ''): string =>
  `id: ${id}\ntitle: ${id}\nrequirements: [R1]\nscope: |\n  Build ${id}.\nfile_contact_surface:\n  - ${surface}\nacceptance_tests:\n  - AC1.1\ndepends_on: [${deps.join(', ')}]\nstatus: pending\nnotes: |\n  ${notes}\n`

const STATE = (limit: number) => `# toy run state — comments must survive machine edits
run: toy
branch: run/toy
phase: spec               # spec | plan | implement | integrate | release | done | paused
paused_reason: null

budget:
  cost_limit_usd: ${limit}    # exhaustion pauses the run
  cost_spent_usd: 0

gates:                    # a gate entry is written ONLY by the named human
  G0: {approved: false, by: null, at: null, notes: null}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}

tasks: []

escalations: []
`

/**
 * Monotonic commit clock so lastTouched comparisons are deterministic:
 * strictly increasing, but never ahead of real time — human decisions and
 * orchestrator commits use the real clock, and an agent commit stamped in
 * the future would break decline-vs-artifact ordering (D9).
 */
export class Clock {
  private t = Math.floor(Date.now() / 1000) - 1
  next(): string {
    this.t = Math.max(this.t + 2, Math.floor(Date.now() / 1000))
    return new Date(this.t * 1000).toISOString()
  }
}

export interface ToyRepoOpts {
  budget?: number
  /**
   * `prefixed` mirrors `integrate.py init --layout prefixed` (#95): contracts
   * and runs live under `prefix/` alongside a minimal framework-lock.json,
   * so a source must probe rather than assume root layout.
   */
  layout?: 'root' | 'prefixed'
  prefix?: string
}

export function makeToyRepo(opts: ToyRepoOpts = {}): { dir: string; clock: Clock } {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-engine-'))
  const clock = new Clock()
  const prefix = opts.prefix ?? '.agentic'
  const prefixed = opts.layout === 'prefixed'
  const contractsRoot = prefixed ? `${prefix}/contracts` : 'contracts'
  const runsRoot = prefixed ? `${prefix}/runs` : 'runs'
  const git = (args: string[], date?: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', HUMAN.name])
  git(['config', 'user.email', HUMAN.email])
  for (const [name, content] of Object.entries(CONTRACTS)) {
    const full = join(dir, contractsRoot, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  if (prefixed) {
    const lock = join(dir, prefix, 'framework-lock.json')
    mkdirSync(dirname(lock), { recursive: true })
    writeFileSync(
      lock,
      JSON.stringify(
        {
          source: { repo: null, ref: 'toy', version: 'unreleased' },
          integrated_at: '2026-01-01',
          method: 'toy',
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
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'Seed contracts'], clock.next())

  git(['checkout', '-q', '-b', 'run/toy'])
  const brief = '# Intent Brief: toy\n\n## Problem\nToy.\n\n## Motivation\nTest.\n\n## Constraints\nNone.\n\n## Out of scope\nAll.\n'
  mkdirSync(join(dir, runsRoot, 'toy'), { recursive: true })
  writeFileSync(join(dir, runsRoot, 'toy', 'intent-brief.md'), brief)
  writeFileSync(join(dir, runsRoot, 'toy', 'state.yaml'), STATE(opts.budget ?? 50))
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'toy: intent brief'], clock.next())
  git(['checkout', '-q', 'main'])
  return { dir, clock }
}

/** Play the agent: write files into the dispatch checkout and commit them. */
export function agentCommit(cwd: string, clock: Clock, files: Record<string, string>, message: string): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  const date = clock.next()
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'toy-agent',
    GIT_AUTHOR_EMAIL: 'agent@example.test',
    GIT_COMMITTER_NAME: 'toy-agent',
    GIT_COMMITTER_EMAIL: 'agent@example.test',
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  }
  execFileSync('git', ['-C', cwd, 'add', '-A'], { env })
  // --allow-empty: a redo may produce byte-identical content (the decline
  // test's analyst); the landing still has to be observable as a commit.
  execFileSync('git', ['-C', cwd, 'commit', '-q', '--allow-empty', '-m', message], { env })
}

export function appendToFile(cwd: string, path: string, extra: string): string {
  const full = join(cwd, path)
  const current = existsSync(full) ? readFileSync(full, 'utf8') : ''
  return current + extra
}

export type Script = (req: DispatchRequest) => Partial<DispatchOutcome> | Promise<Partial<DispatchOutcome>>

export class FakeDispatcher implements Dispatcher {
  readonly adapter = 'fake'
  readonly calls: DispatchRequest[] = []
  private readonly script: Script

  constructor(script: Script) {
    this.script = script
  }

  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    this.calls.push(req)
    const partial = await this.script(req)
    return { ok: true, costUsd: 1.25, tokensIn: 100_000, tokensOut: 10_000, error: null, ...partial }
  }
}

export const toyRef = (dir: string): RunRef => ({ source: 'human', slug: 'toy', ref: 'run/toy', kind: 'branch', branch: 'run/toy' })

/** A human decision through core's own write path — never the engine's. */
export async function humanDecide(dir: string, input: DecisionInput): Promise<void> {
  const source = new LocalGitSource('human', dir)
  const ref = toyRef(dir)
  const { state } = await source.readState(ref)
  expect(state).not.toBeNull()
  const planned = planDecision(state!, input, HUMAN)
  const result = await source.writeState(ref, planned.mutate, planned.message)
  expect(result.ok).toBe(true)
}

/** Tick + drain until a full pass derives rest everywhere (fixed point). */
export async function reconcile(engine: Engine, maxIters = 40): Promise<void> {
  for (let i = 0; i < maxIters; i++) {
    const outcomes = await engine.tick()
    await engine.drain()
    if (outcomes.every((o) => o.action.kind === 'rest') && engine.inFlight() === 0) return
  }
  throw new Error(`engine did not reach a rest state in ${maxIters} ticks`)
}

export function log(dir: string, rev = 'run/toy'): string[] {
  return execFileSync('git', ['-C', dir, 'log', '--format=%an|%s', rev], { encoding: 'utf8' }).split('\n').filter(Boolean)
}
