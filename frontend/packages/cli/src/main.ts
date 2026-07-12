#!/usr/bin/env node
// agentic — decisions stay possible when no browser is. Same core, same
// single write path (R2), terminal rendering.
import { createInterface } from 'node:readline/promises'
import { Command } from 'commander'
import {
  buildPortfolio,
  BURDENS,
  DecisionError,
  formatDuration,
  loadSources,
  planDecision,
  type Burden,
  type DecisionInput,
  type GateId,
  type InboxItem,
  type Phase,
  type RunSource,
} from '@agentic/core'

const program = new Command()
program.name('agentic').description('Gate frontend for artifact-driven agent pipelines').version('0.1.0')
// Repeatable, single-value: a variadic <path...> would swallow the subcommand.
program.option(
  '--repo <path>',
  'repository to read; repeat for several (default: config file, else cwd)',
  (value: string, acc: string[]) => [...acc, value],
  [] as string[],
)

interface Resolved {
  sources: RunSource[]
}

async function resolveSources(): Promise<Resolved> {
  const opts = program.opts<{ repo: string[] }>()
  const { sources, warnings } = await loadSources({ repoOverrides: opts.repo.length ? opts.repo : undefined })
  for (const w of warnings) console.error(`warning: ${w}`)
  if (sources.length === 0) {
    console.error('no run sources — run inside a repository, pass --repo <path>, or create ~/.config/agentic/config.yaml')
    process.exit(1)
  }
  return { sources }
}

async function findRun(sources: RunSource[], slug: string, sourceId?: string) {
  const matches: { source: RunSource; ref: Awaited<ReturnType<RunSource['listRuns']>>[number] }[] = []
  for (const source of sources) {
    if (sourceId && source.id !== sourceId) continue
    for (const ref of await source.listRuns()) {
      if (ref.slug === slug) matches.push({ source, ref })
    }
  }
  if (matches.length === 0) {
    console.error(`run "${slug}" not found${sourceId ? ` in source ${sourceId}` : ''}`)
    process.exit(1)
  }
  if (matches.length > 1) {
    console.error(`run "${slug}" exists in multiple sources (${matches.map((m) => m.source.id).join(', ')}) — pass --source`)
    process.exit(1)
  }
  return matches[0]!
}

const now = () => Math.floor(Date.now() / 1000)

function age(since: number | null): string {
  return since === null ? '—' : formatDuration(now() - since)
}

const GATE_GLYPH = (approved: boolean, decided: boolean) => (approved ? '✓' : decided ? '✕' : '·')

// --- read commands ----------------------------------------------------------

program
  .command('status')
  .description('portfolio: every run, phase, gates, and what needs a human')
  .action(async () => {
    const { sources } = await resolveSources()
    const { runs, inbox } = await buildPortfolio(sources)
    if (runs.length === 0) return console.log('no runs found')
    const rows = runs.map((r) => ({
      run: `${r.source}/${r.slug}`,
      phase: r.phase + (r.pausedReason ? ` (${r.pausedReason})` : ''),
      gates: (['G0', 'G1', 'G2', 'G3'] as const).map((g) => GATE_GLYPH(r.gates[g].approved, r.gates[g].decided)).join(' '),
      tasks: r.tasks.total ? `${r.tasks.done}/${r.tasks.total}` : '—',
      updated: age(r.updatedAt),
      needs: r.needsHuman ? String(r.needsHuman) : '',
    }))
    table(rows, ['run', 'phase', 'gates', 'tasks', 'updated', 'needs'])
    if (inbox.length) console.log(`\n${inbox.length} item(s) need a human — run \`agentic inbox\``)
  })

program
  .command('inbox')
  .description('everything that needs a human, oldest first')
  .action(async () => {
    const { sources } = await resolveSources()
    const { inbox } = await buildPortfolio(sources)
    if (inbox.length === 0) return console.log('inbox zero — nothing needs a human')
    for (const item of inbox) printItem(item)
  })

function printItem(item: InboxItem): void {
  const kind = item.kind === 'gate' ? item.gate : item.kind
  console.log(`${(kind ?? '').padEnd(10)} ${age(item.since).padStart(4)}  ${item.source}/${item.slug}  ${item.title}`)
  if (!item.reviewable && item.problems.length) {
    for (const p of item.problems) console.log(`${' '.repeat(17)}✕ BOUNCED: ${p}`)
  }
}

// --- decision commands (the write path) -------------------------------------

interface DecideFlags {
  source?: string
  notes?: string
  burden?: string
  reason?: string
  phase?: string
  push?: boolean
}

async function decide(slug: string, flags: DecideFlags, input: Omit<DecisionInput, 'notes' | 'burden'> & { notes?: string; burden?: Burden }) {
  const { sources } = await resolveSources()
  const { source, ref } = await findRun(sources, slug, flags.source)
  const who = await source.identity()
  if (!who) {
    console.error('git user.name/user.email are unset — decisions must be attributable to a named human')
    process.exit(1)
  }
  const { state, error } = await source.readState(ref)
  if (!state) {
    console.error(`run state is malformed: ${error}`)
    process.exit(1)
  }
  try {
    const planned = planDecision(state, input, who)
    const result = await source.writeState(ref, planned.mutate, planned.message)
    if (!result.ok) {
      console.error(`refused (${result.reason}): ${result.message}`)
      process.exit(result.reason === 'ref-moved' ? 2 : 1)
    }
    console.log(`${planned.summary}\n→ ${result.commit!.slice(0, 10)} ${planned.message}`)
    if (result.message) console.warn(result.message)
  } catch (e) {
    if (e instanceof DecisionError) {
      console.error(e.message)
      process.exit(1)
    }
    throw e
  }
}

async function promptBurden(given?: string): Promise<Burden> {
  if (given) {
    if ((BURDENS as readonly string[]).includes(given)) return given as Burden
    console.error(`--burden must be one of: ${BURDENS.join(' | ')}`)
    process.exit(1)
  }
  if (!process.stdin.isTTY) {
    console.error(`--burden is required (${BURDENS.join(' | ')}) — it is the pilot's headline metric`)
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`burden? [1] confirmation  [2] light-correction  [3] heavy-correction: `)
  rl.close()
  const byIndex: Record<string, Burden> = { '1': 'confirmation', '2': 'light-correction', '3': 'heavy-correction' }
  const burden = byIndex[answer.trim()] ?? ((BURDENS as readonly string[]).includes(answer.trim()) ? (answer.trim() as Burden) : null)
  if (!burden) {
    console.error('unrecognized burden')
    process.exit(1)
  }
  return burden
}

program
  .command('approve')
  .description('approve a gate (records name, timestamp, notes, burden; advances the phase)')
  .argument('<slug>', 'run slug')
  .argument('<gate>', 'G0 | G1 | G2 | G3')
  .option('--source <id>', 'source id when the slug is ambiguous')
  .option('--burden <category>', BURDENS.join(' | '))
  .option('--notes <text>', 'approval notes')
  .option('--no-advance', 'record the approval without moving the phase')
  .action(async (slug: string, gate: string, flags: DecideFlags & { advance?: boolean }) => {
    const burden = await promptBurden(flags.burden)
    await decide(slug, flags, { action: 'approve', gate: gate.toUpperCase() as GateId, burden, notes: flags.notes, advancePhase: flags.advance })
  })

program
  .command('decline')
  .description('decline a gate with a reason (pauses the run as gate-declined)')
  .argument('<slug>', 'run slug')
  .argument('<gate>', 'G0 | G1 | G2 | G3')
  .requiredOption('--reason <text>', 'why — this is the correction channel back to the producing role')
  .option('--source <id>')
  .action(async (slug: string, gate: string, flags: DecideFlags) => {
    await decide(slug, flags, { action: 'decline', gate: gate.toUpperCase() as GateId, notes: flags.reason })
  })

program
  .command('resolve-escalation')
  .description('resolve an escalation with a disposition note')
  .argument('<slug>', 'run slug')
  .argument('<index>', 'escalation index (see `agentic inbox`)')
  .requiredOption('--note <text>', 'disposition')
  .option('--source <id>')
  .action(async (slug: string, index: string, flags: DecideFlags & { note: string }) => {
    await decide(slug, flags, { action: 'resolve-escalation', escalationIndex: Number(index), notes: flags.note })
  })

program
  .command('pause')
  .description('pause a run')
  .argument('<slug>', 'run slug')
  .option('--reason <r>', 'budget-exhausted | round-cap | escalation | gate-declined', 'escalation')
  .option('--source <id>')
  .action(async (slug: string, flags: DecideFlags & { reason: string }) => {
    await decide(slug, flags, { action: 'pause', pauseReason: flags.reason })
  })

program
  .command('resume')
  .description('resume a paused run (phase derived from the gate ledger unless --phase)')
  .argument('<slug>', 'run slug')
  .option('--phase <phase>', 'spec | plan | implement | integrate | release')
  .option('--source <id>')
  .action(async (slug: string, flags: DecideFlags) => {
    await decide(slug, flags, { action: 'resume', resumePhase: flags.phase as Phase | undefined })
  })

// --- sync ----------------------------------------------------------------------

program
  .command('sync')
  .description('copy PR-review approvals into state.yaml G2 entries (dry-run unless --live)')
  .option('--source <id>', 'only this source')
  .option('--live', 'apply the plan (default: print it)')
  .action(async (flags: { source?: string; live?: boolean }) => {
    const { planSync, applySync, GhCliProvider } = await import('@agentic/core')
    const { sources } = await resolveSources()
    let any = false
    for (const source of sources) {
      if (flags.source && source.id !== flags.source) continue
      const dir = (source as { dir?: string }).dir
      if (!dir) continue
      const plan = await planSync(source, new GhCliProvider(dir))
      if (plan.length === 0) continue
      any = true
      if (!flags.live) {
        for (const p of plan)
          console.log(`would record: ${p.source}/${p.slug} ${p.gate} approved by ${p.approval.reviewer} (PR #${p.approval.number}, ${p.approval.submittedAt})`)
      } else {
        for (const r of await applySync(source, plan)) {
          if (r.ok) console.log(`recorded: ${r.source}/${r.slug} ${r.gate} ← PR #${r.approval.number} → ${r.commit!.slice(0, 10)}`)
          else console.error(`failed: ${r.source}/${r.slug} — ${r.error}`)
        }
      }
    }
    if (!any) console.log('nothing to sync — no undecided G2 with an approved PR review')
    else if (!flags.live) console.log('\ndry-run; pass --live to record')
  })

// --- ui ----------------------------------------------------------------------

program
  .command('ui')
  .description('serve the web app on localhost')
  .option('--port <n>', 'port', '4310')
  .option('--host <h>', 'bind address (multi-user serving is out of scope; see README)', '127.0.0.1')
  .option('--demo', 'generate and serve a demo repository')
  .option('--no-open', 'do not open the browser')
  .action(async (flags: { port: string; host: string; demo?: boolean; open?: boolean }) => {
    const { startServer } = await import('@agentic/server/main')
    const opts = program.opts<{ repo: string[] }>()
    await startServer({
      port: Number(flags.port),
      host: flags.host,
      demo: flags.demo,
      open: flags.open !== false,
      repoOverrides: opts.repo.length ? opts.repo : undefined,
    })
  })

// --- helpers ------------------------------------------------------------------

function table(rows: Record<string, string>[], cols: string[]): void {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => (r[c] ?? '').length)))
  console.log(cols.map((c, i) => c.toUpperCase().padEnd(widths[i]!)).join('  '))
  for (const r of rows) console.log(cols.map((c, i) => (r[c] ?? '').padEnd(widths[i]!)).join('  '))
}

program.parseAsync().catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})
