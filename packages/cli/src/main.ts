#!/usr/bin/env node
// gateline — decisions stay possible when no browser is. Same core, same
// single write path (R2), terminal rendering.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  armRefusal,
  BUILTIN_SECTIONS,
  BURDENS,
  type Burden,
  buildLexicon,
  buildPortfolio,
  CLOSURE_MEANINGS,
  CLOSURES,
  type Closure,
  DecisionError,
  type DecisionInput,
  DISPOSITIONS,
  type Disposition,
  ensureDraftPr,
  extractSections,
  formatDuration,
  type GateId,
  type Identity,
  type InboxItem,
  LocalOnlyPushConflictError,
  loadSources,
  missingSections,
  type Phase,
  PROFILE_GATES,
  PROFILES,
  type Profile,
  planDecision,
  planRunScaffold,
  type RunRef,
  type RunScaffold,
  type RunSource,
  resolveCodeRepo,
  resolveId,
  ScaffoldError,
  SLUG_PATTERN,
  SUPERSEDE_EXIT_CODE,
  scanIds,
  validateArtifact,
  workItemIncomplete,
  workItemPath,
} from '@gateline/core'
import { Command, Option } from 'commander'

const program = new Command()
program.name('gateline').description('Gate frontend for artifact-driven agent pipelines').version('0.3.0')
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
  let sources: RunSource[]
  let warnings: string[]
  try {
    ;({ sources, warnings } = await loadSources({ repoOverrides: opts.repo.length ? opts.repo : undefined }))
  } catch (e) {
    if (e instanceof LocalOnlyPushConflictError) {
      console.error(e.message)
      process.exit(1)
    }
    throw e
  }
  for (const w of warnings) console.error(`warning: ${w}`)
  if (sources.length === 0) {
    console.error('no run sources — run inside a repository, pass --repo <path>, or create ~/.config/gateline/config.yaml')
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
      // A closed run reads as its disposition, never bare "closed": the whole
      // point of the phase is that it says why (#200).
      phase: r.phase + (r.closure ? ` (${r.closure.as})` : r.pausedReason ? ` (${r.pausedReason})` : ''),
      gates: PROFILE_GATES[r.profile].map((g) => GATE_GLYPH(r.gates[g].approved, r.gates[g].decided)).join(' '),
      tasks: r.tasks.total ? `${r.tasks.done}/${r.tasks.total}` : '—',
      updated: age(r.updatedAt),
      needs: r.needsHuman ? String(r.needsHuman) : '',
    }))
    table(rows, ['run', 'phase', 'gates', 'tasks', 'updated', 'needs'])
    if (inbox.length) console.log(`\n${inbox.length} item(s) need a human — run \`gateline inbox\``)
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

/**
 * One inbox entry in the terminal, composed here from the item's facts (#433).
 * The first line is what the item is; the indented lines are what a terminal
 * reader needs to act on it without opening Gatehouse — the gate's question,
 * who escalated about what and in what words, why a run is paused and what it
 * spent, who staged a run and on what terms. Core used to send one title for
 * every surface, and this printed only that, so an escalation's reason and a
 * paused run's way out were unreachable from here.
 */
function printItem(item: InboxItem): void {
  const kind = item.kind === 'gate' ? item.gate : item.kind
  const pad = ' '.repeat(17)
  // A multi-line value (an engine line with a diagnostic, a hold reason)
  // keeps its continuation lines under its first, not at the left margin.
  const more = (label: string, text: string) =>
    console.log(`${pad}${label.padEnd(9)} ${text.trimEnd().split('\n').join(`\n${pad}${' '.repeat(10)}`)}`)
  console.log(`${(kind ?? '').padEnd(10)} ${age(item.since).padStart(4)}  ${item.source}/${item.slug}  ${headline(item)}`)
  switch (item.kind) {
    case 'gate':
      for (const b of item.bouncedBy ?? []) {
        const what = b.contractName ?? 'artifact'
        console.log(
          b.absent
            ? `${pad}✕ BOUNCED: the ${what} is missing (${b.path})`
            : `${pad}✕ BOUNCED: ${b.path} fails its ${what} contract — missing ${b.unit}: ${b.missing.join(', ')}`,
        )
      }
      // The terminal's half of #159: a gate whose producer is out is listed,
      // since it is still the gate on the table, but it must not read as
      // ready to decide.
      if (item.waitingOn && !item.waitingOn.lost)
        console.log(`${pad}⋯ SUPERSEDED: ${item.waitingOn.role} is re-producing ${item.waitingOn.artifact.path}; no approval until it lands`)
      else if (item.waitingOn?.lost)
        more('waiting', `${item.waitingOn.role} re-dispatched ${age(item.waitingOn.since)} ago, ${item.waitingOn.artifact.path} not landed`)
      break
    case 'escalation': {
      const esc = item.escalation
      if (!esc) break
      if (esc.about) more('about', 'task' in esc.about ? `task ${esc.about.task}` : `gate ${esc.about.gate}`)
      more('reason', esc.reason)
      if (esc.artifact) more('report', esc.artifact.path)
      if (item.escalationIndex !== null) more('resolve', `gateline resolve-escalation ${item.slug} ${item.escalationIndex} --note <text>`)
      break
    }
    case 'round-cap':
      if (item.roundCap) more('rounds', `${item.roundCap.rounds}/${item.roundCap.cap} review rounds without convergence`)
      break
    case 'paused': {
      const paused = item.paused
      if (!paused) break
      if (paused.budget) {
        const spent = paused.budget.spent === null ? '?' : `$${paused.budget.spent.toFixed(2)}`
        const limit = paused.budget.limit === null ? 'no cost_limit_usd' : `cost_limit_usd $${paused.budget.limit.toFixed(2)}`
        more('budget', `${spent} spent, ${limit}`)
      }
      if (paused.freeText && paused.reason) more('held', paused.reason)
      if (paused.cause) more('cause', paused.cause)
      const edit = paused.handEdit
      if (edit?.kind === 'contract-dispute') more('fix', `${edit.artifact.path} is still malformed after the engine's bounces`)
      if (edit?.kind === 'profile-violation') more('fix', `the run is outside profile ${edit.profile}: edit profile: or phase: in state.yaml`)
      if (edit?.kind === 'no-task-files') more('fix', 'the G1 breakdown never landed: commit tasks/*.yaml')
      if (edit?.kind === 'unknown-status') more('fix', `task ${edit.task} has status "${edit.status}"; known: ${edit.known.join(', ')}`)
      more('next', pausedNext(item.slug, paused))
      break
    }
    case 'staged': {
      const staged = item.staged
      if (!staged) break
      const ceiling = staged.budgetCeiling === null ? 'no cost_limit_usd' : `cost_limit_usd $${staged.budgetCeiling.toFixed(2)}`
      more('staged', `${staged.by ? `by ${staged.by}, ` : ''}profile ${staged.profile}, ${ceiling}`)
      more('next', `gateline arm ${item.slug} — dispatch begins and the budget starts metering`)
      break
    }
    case 'malformed':
      // The parser's diagnostic, line for line; any other reason is said here,
      // since core states it as a fact rather than a sentence (#435).
      if (item.unreadable?.kind === 'absent') more('state', `${item.unreadable.ledger.path} is missing from the run`)
      else if (item.unreadable?.kind === 'unexplained') more('state', `no state read from ${item.unreadable.ledger.path}, and no reason given`)
      for (const p of item.problems) for (const line of p.trimEnd().split('\n')) console.log(line ? `${pad}${line}` : '')
      break
  }
}

/** The entry's first line: the kind's own words and its record facts, never a sentence core wrote. */
function headline(item: InboxItem): string {
  switch (item.kind) {
    case 'gate':
      return item.question ? `${item.gate} — ${item.question}` : (item.gate ?? '')
    case 'escalation':
      return item.escalation?.role ? `escalation from ${item.escalation.role}` : 'escalation'
    case 'round-cap':
      return item.roundCap ? `round cap reached on ${item.roundCap.task}` : 'round cap reached'
    case 'paused':
      return item.paused?.freeText ? 'run paused (held)' : `run paused: ${item.paused?.reason ?? 'no reason recorded'}`
    case 'staged':
      return 'run staged, awaiting arm'
    case 'malformed':
      return 'malformed run state'
  }
}

/** What clears a pause, in the terminal's own words and commands (#96, #348). */
function pausedNext(slug: string, paused: NonNullable<InboxItem['paused']>): string {
  const close = `gateline close ${slug} --as <disposition> --reason <text>`
  if (paused.reason === 'budget-exhausted')
    return `gateline resume ${slug} --cost-limit <usd> (a higher limit; resuming without one re-pauses), or ${close}`
  if (paused.reason === 'slug-landed') return `${close.replace('<disposition>', 'already-delivered')}; carry remaining work on a fresh slug`
  if (paused.handEdit) return `make the edit above, then gateline resume ${slug} (resolving alone re-pauses)`
  return `gateline resume ${slug}, or ${close}`
}

// The run lexicon in a terminal (#164): a hover can't exist here, so cited
// R/AC/ADR definitions print once, as a footnote block, in first-citation
// order. Quotes are verbatim (elision only — truncation shown as "…");
// dangling ids are listed and flagged, not dropped.
program
  .command('show')
  .description('print a run artifact, with cited R/AC/ADR definitions as footnotes (omit the artifact to list them)')
  .argument('<slug>', 'run slug')
  .argument('[artifact]', 'run-relative artifact path, e.g. plan.md or tasks/01-core.yaml')
  .option('--source <id>', 'source id when the slug is ambiguous')
  .option('--refs <mode>', 'footnotes: first-line | full | off', 'first-line')
  .action(async (slug: string, artifact: string | undefined, flags: { source?: string; refs: string }) => {
    if (!['first-line', 'full', 'off'].includes(flags.refs)) {
      console.error('--refs must be one of: first-line | full | off')
      process.exit(1)
    }
    const { sources } = await resolveSources()
    const { source, ref } = await findRun(sources, slug, flags.source)
    if (!artifact) {
      const paths = await source.listArtifacts(ref)
      if (paths.length === 0) return console.log('no artifacts yet')
      for (const p of paths) console.log(p)
      return
    }
    const content = await source.readArtifact(ref, artifact)
    if (content === null) {
      console.error(`no artifact at ${artifact}`)
      process.exit(1)
    }
    process.stdout.write(content.endsWith('\n') ? content : `${content}\n`)
    if (flags.refs === 'off') return

    const [spec, plan] = await Promise.all([source.readArtifact(ref, 'spec.md'), source.readArtifact(ref, 'plan.md')])
    const lexicon = buildLexicon({ spec, plan })
    // An id defined in the shown artifact is a definition here, not a citation.
    const cited = scanIds(content).filter((id) => resolveId(lexicon, id)?.artifact !== artifact)
    if (cited.length === 0) return

    const from = [...new Set(cited.map((id) => resolveId(lexicon, id)?.artifact).filter(Boolean))]
    console.log('---')
    console.log(`References${from.length ? ` (from ${from.join(', ')})` : ''}:`)
    const width = Math.max(...cited.map((id) => id.length))
    for (const id of cited) {
      const def = resolveId(lexicon, id)
      if (!def) {
        console.log(`  ${id.padEnd(width)}  [not defined in this run's spec/plan]`)
        continue
      }
      const name = def.shortName + (def.qualifier ? ` (${def.qualifier})` : '')
      const body = def.body.replace(/\s+/g, ' ').trim()
      const quote = body ? `"${flags.refs === 'full' ? body : truncate(body, 110)}"` : ''
      console.log(`  ${id.padEnd(width)}  ${[name, quote].filter(Boolean).join(' — ')}`)
    }
  })

// --- decision commands (the write path) -------------------------------------

interface DecideFlags {
  source?: string
  notes?: string
  note?: string
  burden?: string
  reason?: string
  phase?: string
  push?: boolean
}

/**
 * `--note`, `--notes` and `--reason` are three spellings of one field (#264):
 * every decision verb lands its free text in `DecisionInput.notes`. Each verb
 * keeps the semantically apt spelling in `--help` and parses the other two
 * hidden, so a flag remembered from a sibling verb never fails the command.
 */
const noteText = (flags: DecideFlags): string | undefined => flags.reason ?? flags.notes ?? flags.note

/** A hidden alias option: parses like the canonical flag, absent from `--help`. */
const hiddenAlias = (flags: string) => new Option(`${flags} <text>`, 'alias').hideHelp()

/** Fail the way commander fails a missing `.requiredOption`, so the message shape stays familiar. */
const requireNoteText = (cmd: Command, flags: DecideFlags, canonical: string): string => {
  const text = noteText(flags)
  if (text === undefined) cmd.error(`error: required option '${canonical} <text>' not specified`)
  return text
}

/**
 * The shared plan → write → exit-code core of the decision flow
 * (`planDecision`/`writeState`'s CAS path — AC6.1), factored out of `decide()`
 * so `armRun` can reuse the exact same refusal strings and exit-code mapping
 * instead of hand-duplicating them (F5: duplication was a drift risk between
 * `arm` and the `decide()`-backed commands). Returns `null` on success (after
 * printing the summary), or the exit code the caller should use on failure —
 * never calls `process.exit` itself, so `armRun` can chain `ensureDraftPr`
 * after a successful write.
 */
async function planAndWrite(source: RunSource, ref: RunRef, who: Identity, input: DecisionInput): Promise<number | null> {
  const { state, error } = await source.readState(ref)
  if (!state) {
    console.error(`run state is malformed: ${error}`)
    return 1
  }
  try {
    const planned = planDecision(state, input, who)
    const result = await source.writeState(ref, planned.mutate, planned.message)
    if (!result.ok) {
      console.error(`refused (${result.reason}): ${result.message}`)
      return result.reason === 'ref-moved' ? 2 : 1
    }
    console.log(`${planned.summary}\n→ ${result.commit!.slice(0, 10)} ${planned.message}`)
    if (result.message) console.warn(result.message)
    return null
  } catch (e) {
    if (e instanceof DecisionError) {
      console.error(e.message)
      return 1
    }
    throw e
  }
}

async function decide(slug: string, flags: DecideFlags, input: Omit<DecisionInput, 'notes' | 'burden'> & { notes?: string; burden?: Burden }) {
  const { sources } = await resolveSources()
  const { source, ref } = await findRun(sources, slug, flags.source)
  const who = await source.identity()
  if (!who) {
    console.error('git user.name/user.email are unset — decisions must be attributable to a named human')
    process.exit(1)
  }
  const code = await planAndWrite(source, ref, who, input as DecisionInput)
  if (code !== null) process.exit(code)
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
  .addOption(hiddenAlias('--note'))
  .option('--no-advance', 'record the approval without moving the phase')
  .option('--hold <reason>', 'approve but pause the run in the same commit — the dispatch-safe way to wait on a human decision before the next phase runs')
  .action(async (slug: string, gate: string, flags: DecideFlags & { advance?: boolean; hold?: string }) => {
    const burden = await promptBurden(flags.burden)
    await decide(slug, flags, {
      action: 'approve',
      gate: gate.toUpperCase() as GateId,
      burden,
      notes: noteText(flags),
      advancePhase: flags.advance,
      hold: flags.hold !== undefined || undefined,
      holdReason: flags.hold,
    })
  })

program
  .command('decline')
  .description('decline a gate with a reason (pauses the run as gate-declined)')
  .argument('<slug>', 'run slug')
  .argument('<gate>', 'G0 | G1 | G2 | G3')
  .option('--reason <text>', 'why — this is the correction channel back to the producing role')
  .addOption(hiddenAlias('--note, --notes'))
  .option('--source <id>')
  .action(async (slug: string, gate: string, flags: DecideFlags, cmd: Command) => {
    const notes = requireNoteText(cmd, flags, '--reason')
    await decide(slug, flags, { action: 'decline', gate: gate.toUpperCase() as GateId, notes })
  })

program
  .command('resolve-escalation')
  .description('resolve an escalation with a disposition note')
  .argument('<slug>', 'run slug')
  .argument('<index>', 'escalation index (see `gateline inbox`)')
  .option('--note <text>', 'disposition')
  .addOption(hiddenAlias('--notes'))
  .option('--disposition <route>', `${DISPOSITIONS.join(' | ')} — optional machine-actionable route for the engine; omit for the engine default`)
  .option('--source <id>')
  .action(async (slug: string, index: string, flags: DecideFlags & { disposition?: string }, cmd: Command) => {
    const notes = requireNoteText(cmd, flags, '--note')
    let disposition: Disposition | undefined
    if (flags.disposition !== undefined) {
      if (!(DISPOSITIONS as readonly string[]).includes(flags.disposition)) {
        console.error(`--disposition must be one of: ${DISPOSITIONS.join(' | ')}`)
        process.exit(1)
      }
      disposition = flags.disposition as Disposition
    }
    await decide(slug, flags, { action: 'resolve-escalation', escalationIndex: Number(index), notes, disposition })
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
  .option('--cost-limit <usd>', 'new budget.cost_limit_usd, written in the same commit; required from a budget-exhausted pause (#96)', parseFloat)
  .option('--source <id>')
  .action(async (slug: string, flags: DecideFlags & { costLimit?: number }) => {
    await decide(slug, flags, { action: 'resume', resumePhase: flags.phase as Phase | undefined, costLimitUsd: flags.costLimit })
  })

program
  .command('close')
  .description('close a run that ends short of done, with a typed disposition (#200)')
  .argument('<slug>', 'run slug')
  .requiredOption('--as <disposition>', CLOSURES.map((c) => `${c} — ${CLOSURE_MEANINGS[c]}`).join('; '))
  .requiredOption('--reason <text>', 'the comment on the disposition — why this run ends here')
  .option('--source <id>')
  .action(async (slug: string, flags: DecideFlags & { as: string }) => {
    if (!(CLOSURES as readonly string[]).includes(flags.as)) {
      console.error(`--as must be one of: ${CLOSURES.join(' | ')}`)
      process.exit(1)
    }
    await decide(slug, flags, { action: 'close', closure: flags.as as Closure, notes: flags.reason })
  })

program
  .command('reopen')
  .description('undo a closure — the run returns to the phase its gate ledger derives')
  .argument('<slug>', 'run slug')
  .option('--source <id>')
  .action(async (slug: string, flags: DecideFlags) => {
    await decide(slug, flags, { action: 'reopen' })
  })

// --- new / arm (the run-creation seam) --------------------------------------

interface NewFlags {
  slug?: string
  title?: string
  profile: string
  briefFile?: string
  taskFile?: string
  budget: string
  key?: string
  source?: string
}

/**
 * Structure-only brief draft (R3): the repo's own `intent-brief.md` template
 * with the title substituted into the H1 — the CLI never invents
 * Problem/Motivation/Constraints prose. Falls back to `BUILTIN_SECTIONS` when
 * the target repo carries no `contracts/` tree. Pure (no I/O), so it is
 * directly unit-testable.
 */
export function draftBriefMarkdown(template: string | null, title: string): string {
  if (template) {
    const lines = template.split('\n')
    const h1 = lines.findIndex((l) => /^#\s+/.test(l))
    if (h1 >= 0) lines[h1] = `# Intent Brief: ${title}`
    return lines.join('\n')
  }
  const sections = BUILTIN_SECTIONS['intent-brief.md'] ?? ['Problem', 'Motivation', 'Constraints', 'Out of scope']
  return `# Intent Brief: ${title}\n\n${sections.map((s) => `## ${s}\n`).join('\n')}`
}

// Both the section-completeness check and the slug grammar are core's own
// exports now (AC2.2's single-truth demand) — the CLI carries no mirrored
// copy to drift out of sync with `validateArtifact`/`planRunScaffold`.
const SLUG_RE = new RegExp(SLUG_PATTERN)

export interface InteractiveNewIO {
  prompt(question: string): Promise<string>
  /**
   * Writes `initialContent` somewhere editable, opens it in `$EDITOR`/
   * `$VISUAL` (fallback `vi`), and resolves with the re-read, human-edited
   * content — the whole seam a test stubs to avoid spawning a real editor.
   */
  editFile(initialContent: string): Promise<string>
  log?: (line: string) => void
}

export interface InteractiveNewResult {
  slug: string
  title: string
  briefMarkdown: string
}

/**
 * The interactive fallback (AC2.2/AC3.1): prompts for missing slug/title,
 * drafts (or reuses a supplied) brief, opens it for editing, validates its
 * required sections (offering a re-edit rather than padding, R3), and
 * requires an explicit `stage? [y/N]` confirmation. Returns null when the
 * human declines to stage or abandons a re-edit loop — the caller refuses;
 * this never commits on its own. Factored out (the `runSelfUpdate` precedent)
 * so the editor/prompt seam is unit-testable without a real TTY.
 */
export async function runInteractiveNew(
  current: { slug: string | null; title: string | null; initialBrief: string | null },
  templateContent: string | null,
  requiredSections: string[],
  io: InteractiveNewIO,
): Promise<InteractiveNewResult | null> {
  const log = io.log ?? (() => {})
  let slug = current.slug?.trim() || ''
  // Validate here (F4), not just later via ScaffoldError: rejecting an
  // invalid slug after the full edit/confirm session discards the human's
  // authored brief with only the printed preview surviving scrollback.
  while (!slug || !SLUG_RE.test(slug)) {
    if (slug) log(`slug "${slug}" must match ${SLUG_RE} (branch- and path-safe)`)
    slug = (await io.prompt('slug: ')).trim()
  }
  let title = current.title?.trim() || ''
  while (!title) title = (await io.prompt('title: ')).trim()

  let content = current.initialBrief ?? draftBriefMarkdown(templateContent, title)
  for (;;) {
    content = await io.editFile(content)
    const missing = missingSections(content, requiredSections)
    if (missing.length > 0) {
      log(`brief is missing required section(s): ${missing.join(', ')}`)
      const again = (await io.prompt('re-edit? [Y/n] ')).trim().toLowerCase()
      if (again === 'n' || again === 'no') return null
      continue
    }
    log('--- intent-brief.md preview ---')
    log(content)
    log('--------------------------------')
    const confirm = (await io.prompt('stage? [y/N] ')).trim().toLowerCase()
    if (confirm === 'y' || confirm === 'yes') return { slug, title, briefMarkdown: content }
    return null
  }
}

/** Real (non-test) interactive IO: `readline/promises` + a temp-file `$EDITOR` round trip. */
function realInteractiveIO(): InteractiveNewIO & { close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    prompt: (q) => rl.question(q),
    editFile: async (initial) => {
      const dir = await mkdtemp(join(tmpdir(), 'gateline-new-'))
      const file = join(dir, 'intent-brief.md')
      await writeFile(file, initial, 'utf8')
      const editorCmd = process.env.VISUAL || process.env.EDITOR || 'vi'
      const [cmd, ...args] = editorCmd.split(' ').filter(Boolean)
      const code = await streamCommand(cmd!, [...args, file], process.cwd())
      if (code !== 0) console.error(`warning: editor exited ${code} — using its saved contents anyway`)
      const edited = await readFile(file, 'utf8')
      await rm(dir, { recursive: true, force: true })
      return edited
    },
    log: (line) => console.log(line),
    close: () => rl.close(),
  }
}

/**
 * `gateline new`'s body (flags-first, TTY fallback — AC2.1–2.3/AC3.1–3.2).
 * Returns the process exit code the caller should use; never calls
 * `process.exit` itself (the `runSelfUpdate` precedent).
 */
export async function stageNewRun(flags: NewFlags): Promise<number> {
  if (!(PROFILES as readonly string[]).includes(flags.profile)) {
    console.error(`--profile must be one of: ${PROFILES.join(' | ')}`)
    return 1
  }
  const budget = Number(flags.budget)
  if (!Number.isFinite(budget)) {
    console.error(`--budget must be a number (got "${flags.budget}")`)
    return 1
  }
  if (flags.taskFile && flags.profile !== 'patch') {
    console.error(`--task-file applies only to --profile patch — a ${flags.profile} run plans its tasks at G1`)
    return 1
  }

  const { sources } = await resolveSources()
  const candidates = flags.source ? sources.filter((s) => s.id === flags.source) : sources
  if (candidates.length === 0) {
    console.error(flags.source ? `no source "${flags.source}" configured` : 'no run source configured')
    return 1
  }
  if (candidates.length > 1) {
    console.error(`several sources are configured — pass --source (${candidates.map((s) => s.id).join(', ')})`)
    return 1
  }
  const source = candidates[0]!

  // Identity check before staging (AC7.1's CLI half) — decide()'s own
  // refusal shape, adapted for staging, and hoisted above the interactive
  // prompt/edit/confirm session (F3): checking only after that session ends
  // would let an operator in a no-identity repo complete a full editor round
  // trip and answer `stage? y` only to be refused with the temp file already
  // deleted — the authored prose surviving only in printed scrollback.
  const who = await source.identity()
  if (!who) {
    console.error('git user.name/user.email are unset — staged runs must be attributable to a named human')
    return 1
  }

  const templateContent = await source.templates.read('intent-brief.md')
  const requiredSections = templateContent ? extractSections(templateContent) : (BUILTIN_SECTIONS['intent-brief.md'] ?? [])

  const missingFlags: string[] = []
  if (!flags.slug) missingFlags.push('--slug')
  if (!flags.title) missingFlags.push('--title')
  if (!flags.briefFile) missingFlags.push('--brief-file')

  let slug: string
  let title: string
  let briefMarkdown: string

  if (missingFlags.length === 0) {
    // Flags-complete: no prompts, non-interactive brief content comes only
    // from the operator-authored --brief-file (R3/AC3.2 — never generated).
    slug = flags.slug!
    title = flags.title!
    let content: string
    try {
      content = await readFile(flags.briefFile!, 'utf8')
    } catch (e) {
      console.error(`cannot read --brief-file ${flags.briefFile}: ${(e as Error).message}`)
      return 1
    }
    const missing = missingSections(content, requiredSections)
    if (missing.length > 0) {
      console.error(`--brief-file is missing required section(s): ${missing.join(', ')}`)
      return 1
    }
    briefMarkdown = content
  } else if (!process.stdin.isTTY) {
    // promptBurden's refusal shape, one-for-one (AC2.3).
    console.error(`missing required content: ${missingFlags.join(', ')} — stdin is not a terminal, so nothing can be prompted`)
    return 1
  } else {
    let initialBrief: string | null = null
    if (flags.briefFile) {
      try {
        initialBrief = await readFile(flags.briefFile, 'utf8')
      } catch (e) {
        console.error(`cannot read --brief-file ${flags.briefFile}: ${(e as Error).message}`)
        return 1
      }
    }
    const io = realInteractiveIO()
    let result: InteractiveNewResult | null
    try {
      result = await runInteractiveNew({ slug: flags.slug ?? null, title: flags.title ?? null, initialBrief }, templateContent, requiredSections, io)
    } finally {
      io.close()
    }
    if (!result) {
      console.log('not staged')
      return 1
    }
    ;({ slug, title, briefMarkdown } = result)
  }

  // The patch work item (#221): read verbatim, checked for the contract's
  // keys and for the three things the stub leaves blank, then staged in the
  // stub's place. Without it, the stub stages and `arm` will refuse.
  let workItem: string | null = null
  if (flags.taskFile) {
    try {
      workItem = await readFile(flags.taskFile, 'utf8')
    } catch (e) {
      console.error(`cannot read --task-file ${flags.taskFile}: ${(e as Error).message}`)
      return 1
    }
    const validation = await validateArtifact(workItemPath(slug), workItem, source.templates)
    if (!validation.ok) {
      console.error(`--task-file is missing required key(s): ${validation.missing.join(', ')}${validation.notes.length ? ` (${validation.notes.join('; ')})` : ''}`)
      return 1
    }
    const incomplete = workItemIncomplete(workItem)
    if (incomplete) {
      console.error(`--task-file is not a dispatchable work item: ${incomplete}`)
      return 1
    }
  }

  let scaffold: RunScaffold
  try {
    scaffold = planRunScaffold({
      slug,
      title,
      profile: flags.profile as Profile,
      briefMarkdown,
      workItem,
      costLimitUsd: budget,
      intake: { source: null, ref: null, url: null, clientKey: flags.key ?? null },
      stagedBy: who.name,
    })
  } catch (e) {
    if (e instanceof ScaffoldError) {
      console.error(e.message)
      return 1
    }
    throw e
  }

  const outcome = await source.stageRun(scaffold, who)
  if (outcome.outcome === 'created') {
    console.log(`staged ${outcome.slug} → ${outcome.branch} (${outcome.commit.slice(0, 10)})`)
    if (flags.profile === 'patch' && !workItem)
      console.log(`${workItemPath(slug)} is a stub — \`arm\` will refuse until it is written (restage with --task-file, or edit it on ${outcome.branch} from a throwaway worktree)`)
    if (outcome.pushFailed) console.warn(`push failed: ${outcome.pushFailed}`)
    return 0
  }
  if (outcome.outcome === 'exists') {
    console.log(`already staged: ${outcome.slug} (${outcome.branch})`)
    return 0
  }
  // refused: ref-moved-style conflicts get the same exit code decide() uses.
  console.error(`refused (${outcome.reason}): ${outcome.message}`)
  return outcome.reason === 'conflict' ? 2 : 1
}

program
  .command('new')
  .description('stage a new run (branch + intent-brief.md + state.yaml); unarmed until `gateline arm`')
  .option('--slug <slug>', 'run slug (branch- and path-safe: [a-z0-9][a-z0-9-]*)')
  .option('--title <title>', 'run title')
  .option('--profile <profile>', 'patch | standard | full', 'standard')
  .option('--brief-file <path>', 'path to an operator-authored intent-brief.md')
  .option('--task-file <path>', 'patch profile: path to the human-authored work item, staged as tasks/01-<slug>.yaml')
  .option('--budget <usd>', 'cost ceiling in USD', '50')
  .option('--key <key>', 'idempotency / replay client key (optional)')
  .option('--source <id>', 'source id when several are configured')
  .action(async (flags: NewFlags) => {
    process.exit(await stageNewRun(flags))
  })

/**
 * `gateline arm`'s body: `decide()`-style flow with `{ action: 'arm' }`
 * (DecisionError → exit 1 with its message — covers already-armed;
 * nonexistent-run comes from `findRun`'s existing refusal), then a
 * best-effort draft-PR ensure (R8) using the source's dir (the `sync`
 * command's `(source as {dir?}).dir` pattern) — a skipped note is success.
 */
export async function armRun(slug: string, flags: { source?: string }): Promise<number> {
  const { sources } = await resolveSources()
  const { source, ref } = await findRun(sources, slug, flags.source)
  const who = await source.identity()
  if (!who) {
    console.error('git user.name/user.email are unset — decisions must be attributable to a named human')
    return 1
  }
  // A patch run arms only with a written work item (#221).
  const { state } = await source.readState(ref)
  if (state) {
    const why = await armRefusal(source, ref, state)
    if (why) {
      console.error(why)
      return 1
    }
  }
  const code = await planAndWrite(source, ref, who, { action: 'arm' })
  if (code !== null) return code
  const dir = (source as { dir?: string }).dir
  if (dir) {
    const localOnly = (source as { localOnly?: boolean }).localOnly
    const note = await ensureDraftPr(dir, ref.branch, slug, { localOnly })
    console.log(note.note)
  }
  return 0
}

program
  .command('arm')
  .description("arm a staged run — starts it at the profile's first undecided-gate phase")
  .argument('<slug>', 'run slug')
  .option('--source <id>', 'source id when the slug is ambiguous')
  .action(async (slug: string, flags: { source?: string }) => {
    process.exit(await armRun(slug, flags))
  })

// --- sync ----------------------------------------------------------------------

program
  .command('sync')
  .description('copy PR-review approvals into state.yaml G2 entries (dry-run unless --live)')
  .option('--source <id>', 'only this source')
  .option('--live', 'apply the plan (default: print it)')
  .action(async (flags: { source?: string; live?: boolean }) => {
    const { planSyncForSource, applySync, GhCliProvider } = await import('@gateline/core')
    const { sources } = await resolveSources()
    let any = false
    // A local-only source already prints its own line below; the trailing
    // generic "nothing to sync" would otherwise contradict it (scope note:
    // "keep output non-contradictory") — suppressed only when every
    // considered source resolved local-only.
    let anyConsidered = false
    let allLocalOnly = true
    for (const source of sources) {
      if (flags.source && source.id !== flags.source) continue
      const dir = (source as { dir?: string }).dir
      if (!dir) continue
      anyConsidered = true
      const plan = await planSyncForSource(source, () => new GhCliProvider(dir))
      if (plan === 'local-only') {
        console.log('local-only: nothing to sync')
        continue
      }
      allLocalOnly = false
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
    if (anyConsidered && allLocalOnly) {
      // Every considered source already printed its own local-only line.
    } else if (!any) console.log('nothing to sync — no undecided G2 with an approved PR review')
    else if (!flags.live) console.log('\ndry-run; pass --live to record')
  })

// --- ui ----------------------------------------------------------------------

/**
 * Pure resolution of `up`'s startup marker and the push value the engine
 * should use, from the CLI flags (as read via commander's
 * `getOptionValueSource`, plan risk #1) and the source's already-resolved
 * `localOnly` (the one true precedence chain lives in `loadSources` —
 * `resolveUpMode` never re-derives it, only names why it came out the way it
 * did, AC4.2). `enginePush` is `false` whenever `localOnly` is, else the
 * explicit push setting if any, else `true` — equivalent to the source's own
 * resolved `push` in every row of the plan's mode-resolution table.
 */
export function resolveUpMode(
  flags: { pushExplicit: boolean; push: boolean; localOnly: boolean },
  sourceLocalOnly: boolean,
): { enginePush: boolean; localOnly: boolean; marker: string } {
  const localOnly = sourceLocalOnly
  const enginePush = localOnly ? false : flags.pushExplicit ? flags.push : true
  let marker: string
  if (localOnly) {
    marker = flags.localOnly
      ? 'local-only (--local-only)'
      : flags.pushExplicit && !flags.push
        ? 'local-only (--no-push)'
        : 'local-only (no origin remote)'
  } else {
    marker = flags.pushExplicit && flags.push ? 'pushing to origin (--push)' : 'pushing to origin (origin auto-detected)'
  }
  return { enginePush, localOnly, marker }
}

program
  .command('up')
  .description('Gatehouse + the v1 orchestrator over one clone — the single-authority deployment (docs/TOPOLOGY.md §3.1)')
  .option('--port <n>', 'port', '4310')
  .option('--host <h>', 'bind address', '127.0.0.1')
  .option('--no-open', 'do not open the browser')
  .option(
    '--adapter <name>',
    'headless adapter(s), repeatable; the first is the default runner',
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  .option(
    '--spend-limit-usd <usd>',
    'defer new dispatches while projected spend across all active runs inside the window exceeds this (a rate limit, never a pause; #97)',
    parseFloat,
  )
  .option('--spend-window <hours>', 'the rolling window --spend-limit-usd measures over (default 24)', parseFloat)
  .option(
    '--no-budget-enforcement',
    'meter spend but never pause on it: no per-run cap requirement, no cap pauses (for flat-rate-billed harnesses, #109)',
  )
  .option('--push', 'push every orchestrator/decision commit to origin (default: auto-detect from origin presence)')
  .option('--no-push', 'keep orchestrator commits local, and stop fetching/gh-calling origin too — an alias for --local-only')
  .option('--local-only', 'no push, no gh/GitHub calls, no origin fetch — everything about this run stays in this clone')
  .option('--heartbeat <seconds>', 'engine heartbeat interval', '180')
  .option('--role-timeout <seconds>', 'wall clock per dispatched role before its process group is killed (default 1800)', parseFloat)
  .option(
    '--max-concurrent-dispatches <n>',
    'most dispatches running at once across all runs; 0 disables the cap (default 2, #227)',
    parseFloat,
  )
  .addHelpText(
    'after',
    '\nEngine only, no server or browser: the orchestrator has its own binary —\n' +
      '  gateline-orchestrator watch   resident engine (this command minus Gatehouse)\n' +
      '  gateline-orchestrator tick    one reconcile pass, --dry-run to preview\n' +
      'See packages/cli/README.md, "Headless / no browser".',
  )
  .action(
    async (
      flags: {
        port: string
        host: string
        open?: boolean
        adapter: string[]
        spendLimitUsd?: number
        spendWindow?: number
        budgetEnforcement?: boolean
        push?: boolean
        localOnly?: boolean
        heartbeat: string
        roleTimeout?: number
        maxConcurrentDispatches?: number
      },
      cmd: Command,
    ) => {
      const opts = program.opts<{ repo: string[] }>()
      // One engine per `up`: dispatching needs exactly one writable clone.
      // The server may aggregate several sources; the engine takes the one
      // repo named (or the cwd) — a second engine belongs to a second `up`.
      if (opts.repo.length > 1) {
        console.error('`up` runs one engine over one clone — pass a single --repo (the server may still aggregate more via config)')
        process.exit(1)
      }
      const repoDir = opts.repo[0] ?? process.cwd()

      // Explicitness, not just the resolved boolean: auto-detect and an
      // explicit `--push`/`--no-push` must be distinguishable for both the
      // conflict check and the marker (commander ^14 — plan risk #1).
      const pushExplicit = cmd.getOptionValueSource('push') === 'cli'

      // Resolve before starting anything (AC4.1): a `--local-only --push`
      // conflict must exit 1 with no server and no engine started.
      let sources: RunSource[]
      let warnings: string[]
      try {
        ;({ sources, warnings } = await loadSources({
          repoOverrides: [repoDir],
          push: pushExplicit ? flags.push : undefined,
          localOnly: flags.localOnly || undefined,
        }))
      } catch (e) {
        if (e instanceof LocalOnlyPushConflictError) {
          console.error(e.message)
          process.exit(1)
        }
        throw e
      }
      for (const w of warnings) console.error(`warning: ${w}`)
      const source = sources[0]
      if (!source) {
        console.error(`${repoDir} is not a git repository — \`up\` needs one writable clone (pass --repo)`)
        process.exit(1)
      }
      const { enginePush, localOnly, marker } = resolveUpMode(
        { pushExplicit, push: flags.push === true, localOnly: flags.localOnly === true },
        (source as { localOnly?: boolean }).localOnly === true,
      )

      const { startServer } = await import('@gateline/server/main')
      const { stagedShutdown, startOrchestrator } = await import('@gateline/orchestrator')
      const server = await startServer({
        port: Number(flags.port),
        host: flags.host,
        open: flags.open !== false,
        repoOverrides: [repoDir],
        // The resolved pair, not the raw flags (ADR-7): `up` is the one
        // conflict gate, so the server never re-derives (or re-throws) it.
        push: enginePush,
        localOnly,
      })
      // `orchestrator` and the supersede callback below both close over
      // `stop`, but `stop` needs `orchestrator` to drain it — same
      // forward-reference the `watch` command resolves by leaving the
      // variable nullable until startOrchestrator returns; the callback only
      // fires later, on a heartbeat, by which point it's set.
      let orchestrator: Awaited<ReturnType<typeof startOrchestrator>> | null = null
      // A supersede can race the operator's ^C ladder (both end in the same
      // drain); share one idempotent drain so the second caller awaits the
      // first's work instead of double-draining or double process.exit.
      let drained: Promise<void> | null = null
      const drain = () =>
        (drained ??= (async () => {
          await orchestrator?.stop()
          server.close()
        })())
      const stop = async (exitCode: number) => {
        console.log('draining in-flight dispatches…')
        await drain()
        process.exit(exitCode)
      }
      orchestrator = await startOrchestrator({
        repoDir,
        adapters: flags.adapter,
        push: enginePush,
        localOnly,
        // Hosted hard line unless the operator opts out (#109): with
        // enforcement off, requiring a per-run cap would be requiring a
        // number nothing reads.
        requireBudget: flags.budgetEnforcement !== false,
        budgetEnforcement: flags.budgetEnforcement,
        spendLimitUsd: flags.spendLimitUsd ?? null,
        spendWindowHours: flags.spendWindow,
        roleTimeoutSeconds: flags.roleTimeout,
        maxConcurrentDispatches: flags.maxConcurrentDispatches,
        heartbeatSeconds: Number(flags.heartbeat),
        log: (line) => console.log(line),
        onSupersede: (status) => {
          console.log(
            `code tree moved ${status.startHead.slice(0, 10)}..${status.codeHead.slice(0, 10)} — superseding, restart to load fresh code`,
          )
          void stop(SUPERSEDE_EXIT_CODE)
        },
      })
      console.log(`engine watching ${repoDir} (heartbeat ${flags.heartbeat}s, ${marker}) — ^C to stop`)
      const onSignal = stagedShutdown({
        inFlight: () => orchestrator?.inFlightDetail() ?? [],
        drain,
        abort: () => orchestrator?.abortInFlight() ?? 0,
        log: (line) => console.log(line),
        exit: (code) => process.exit(code),
      })
      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
    },
  )

// --- framework ----------------------------------------------------------------

// The operator's spelling of the renderer. A host repository's CI runs the
// same code as `node <framework>/packages/framework/src/main.ts render`, which
// needs nothing installed; this needs the workspace, and is the form a person
// types (AGENTS.md: rendered agent files are never hand-edited).
program
  .command('render')
  .description("re-render every adapter's agent files from the role specs and manifests")
  .argument('[repo]', 'repository to render (default: the current directory)')
  .option('--check', 'write nothing; exit 1 if any rendered file is stale (the check CI runs)')
  .action(async (repo: string | undefined, flags: { check?: boolean }) => {
    const { runRender } = await import('@gateline/framework')
    process.exit(await runRender(repo ?? process.cwd(), flags.check === true))
  })

// Integration (docs/INTEGRATION.md §5). These also run with nothing installed,
// as `node <framework>/packages/framework/src/main.ts <cmd>` — the path an
// operator takes before they have set up the cockpit.
program
  .command('init')
  .description('scaffold the framework into a host repository')
  .argument('<target>', 'the host repository')
  .option('--take <subset>', 'all | a copy-manifest group | a comma-separated file list', 'all')
  .addOption(new Option('--layout <layout>', 'where core files land').choices(['prefixed', 'root']).default('prefixed'))
  .option('--prefix <dir>', 'the metadata prefix directory', '.gateline')
  .addOption(
    new Option('--provenance <mode>', "the host's posture; no default on purpose")
      .choices(['redistribute', 'private'])
      .makeOptionMandatory(),
  )
  .option('--adapters <list>', 'auto | a comma-separated adapter list', 'auto')
  .action(
    async (target: string, flags: { take: string; layout: string; prefix: string; provenance: string; adapters: string }) => {
      const { runInit } = await import('@gateline/framework')
      process.exit(
        await runInit({
          target,
          provenance: flags.provenance as 'redistribute' | 'private',
          take: flags.take,
          layout: flags.layout as 'prefixed' | 'root',
          prefix: flags.prefix,
          adapters: flags.adapters,
        }),
      )
    },
  )

program
  .command('validate')
  .description('re-prove the static integration invariants of a host repository')
  .argument('[target]', 'the host repository (default: the current directory)')
  .option('--prefix <dir>', 'the metadata prefix directory', '.gateline')
  .action(async (target: string | undefined, flags: { prefix: string }) => {
    const { runValidate } = await import('@gateline/framework')
    process.exit(await runValidate(target ?? process.cwd(), flags.prefix))
  })

program
  .command('fork')
  .description('record a deliberate divergence of a core file before you edit it')
  .argument('<file>', 'host-relative path of the taken core file')
  .requiredOption('--reason <text>', 'why this host cannot use the core copy')
  .option('--target <path>', 'the host repository', '.')
  .option('--prefix <dir>', 'the metadata prefix directory', '.gateline')
  .action(async (file: string, flags: { reason: string; target: string; prefix: string }) => {
    const { runFork } = await import('@gateline/framework')
    process.exit(await runFork({ target: flags.target, file, reason: flags.reason, prefix: flags.prefix }))
  })

// --- self-update -------------------------------------------------------------------

/**
 * `gateline self-update`'s body, factored out of the command action so it can be
 * driven directly against an arbitrary repo dir (tests, manual transcripts)
 * without going through `resolveCodeRepo(import.meta.url)` — which always
 * resolves to the checkout this module itself lives in.
 *
 * Returns the process exit code the caller should use; never calls
 * `process.exit` itself.
 */
export async function runSelfUpdate(repoDir: string, log: (line: string) => void = (line) => console.log(line)): Promise<number> {
  const dirty = execFileSync('git', ['-C', repoDir, 'status', '--porcelain'], { encoding: 'utf8' })
  if (dirty.trim()) {
    console.error(`gateline self-update: ${repoDir} has uncommitted changes — commit or stash them before upgrading`)
    return 1
  }

  const before = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const pullCode = await streamCommand('git', ['-C', repoDir, 'pull', '--ff-only'], repoDir)
  if (pullCode !== 0) return pullCode
  const after = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  if (before === after) {
    log(`already up to date at ${after.slice(0, 7)}`)
    return 0
  }

  // The workspace lives at packages/ since the frontend/ → packages/ rename
  // (#133); frontend/ remains as a fallback so `gateline self-update` run from a
  // pre-rename checkout can still cross the rename.
  const packagesPkg = join(repoDir, 'packages', 'package.json')
  const frontendPkg = join(repoDir, 'frontend', 'package.json')
  const rootPkg = join(repoDir, 'package.json')
  const workspaceDir = existsSync(packagesPkg)
    ? join(repoDir, 'packages')
    : existsSync(frontendPkg)
      ? join(repoDir, 'frontend')
      : existsSync(rootPkg)
        ? repoDir
        : null
  if (workspaceDir) {
    const npmCode = await streamCommand('npm', ['install'], workspaceDir)
    if (npmCode !== 0) {
      console.error(`gateline self-update: npm install failed in ${workspaceDir} (exit ${npmCode})`)
      return npmCode
    }
    // The web app is the one part of the tree that does NOT run from source:
    // the server serves packages/web/dist, a built artifact. An upgrade that
    // stops at `npm install` leaves the previous build's UI running over
    // current APIs — invisibly, because everything else picks up the new
    // code on restart. The web package sits at <workspace>/web, or
    // <workspace>/packages/web in the pre-rename layout.
    const webPkg = [join(workspaceDir, 'web', 'package.json'), join(workspaceDir, 'packages', 'web', 'package.json')].find((p) =>
      existsSync(p),
    )
    if (webPkg) {
      const buildCode = await streamCommand('npm', ['run', 'build'], workspaceDir)
      if (buildCode !== 0) {
        console.error(`gateline self-update: npm run build failed in ${workspaceDir} (exit ${buildCode})`)
        return buildCode
      }
    }
  } else {
    log('no package.json found under the repo — skipping npm install')
  }

  log(`upgraded ${before.slice(0, 7)}..${after.slice(0, 7)}`)
  log(`a running engine will notice at its next tick boundary and exit (${SUPERSEDE_EXIT_CODE}) for its supervisor to restart`)
  return 0
}

/** Run a command with stdio inherited (streamed to this process's own streams); resolves to its exit code. */
function streamCommand(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

program
  .command('self-update')
  .description('git pull --ff-only the code checkout this CLI/engine runs from, then npm install if it moved (docs/ORCHESTRATOR.md merge-update lifecycle)')
  .action(async () => {
    const repoDir = resolveCodeRepo(import.meta.url)
    if (!repoDir) {
      console.error('gateline self-update: this install is not a git checkout — nothing to `git pull` (e.g. installed from a published package)')
      process.exit(1)
    }
    process.exit(await runSelfUpdate(repoDir))
  })

program
  .command('ui')
  .description('serve the web app on localhost')
  .option('--port <n>', 'port', '4310')
  .option('--host <h>', 'bind address (multi-user serving is out of scope; see README)', '127.0.0.1')
  .option('--demo', 'generate and serve a demo repository')
  .option('--no-open', 'do not open the browser')
  .action(async (flags: { port: string; host: string; demo?: boolean; open?: boolean }) => {
    const { startServer } = await import('@gateline/server/main')
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

/** Verbatim-or-elided: never rewords, and an elision is always visible. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function table(rows: Record<string, string>[], cols: string[]): void {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => (r[c] ?? '').length)))
  console.log(cols.map((c, i) => c.toUpperCase().padEnd(widths[i]!)).join('  '))
  for (const r of rows) console.log(cols.map((c, i) => (r[c] ?? '').padEnd(widths[i]!)).join('  '))
}

// Only parse argv when this module is the process entrypoint (the bin
// shebang, or `node .../main.ts ...` as cli.test.ts spawns it) — not when
// something imports it as a library, e.g. to drive `runSelfUpdate` directly
// against a scratch repo without going through argv/resolveCodeRepo at all.
// Compare realpaths, not strings: the global `gateline` bin is an npm-link
// symlink chain to this file, and Node's ESM loader realpaths the entry
// module while argv[1] keeps the symlink path.
function isProcessEntrypoint(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return fileURLToPath(import.meta.url) === realpathSync(argv1)
  } catch {
    return false
  }
}
if (isProcessEntrypoint()) {
  program.parseAsync().catch((e: Error) => {
    console.error(e.message)
    process.exit(1)
  })
}
