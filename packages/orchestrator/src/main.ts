#!/usr/bin/env node
// gateline-orchestrator — the v1 orchestrator's CLI.
//   tick --dry-run   derive and print each run's next action; write nothing
//   tick             one live reconcile pass: dispatch, wait, meter, exit
//   watch            resident mode: ref watcher + heartbeat + completions
//   shadow <slug>    replay a run's history, derived vs actual (M1)
//   sweep <role>     force a scheduled sweep now (ignores dueness, not the guards)
import { Command } from 'commander'
import { CodeTreeMonitor, Git, LocalGitSource, resolveCodeRepo, SUPERSEDE_EXIT_CODE } from '@gateline/core'
import { loadRegistry, type Registry } from './registry.ts'
import { deriveAll } from './tick.ts'
import { formatAction } from './derive.ts'
import { formatShadowStep, shadowReplay } from './shadow.ts'
import type { Engine } from './engine.ts'
import type { Scheduler, SweepOutcome } from './schedule.ts'
import { runLoop } from './triggers.ts'
import { stagedShutdown } from './shutdown.ts'
import { assembleOrchestrator, BOT_IDENTITY } from './start.ts'

export { BOT_IDENTITY }

const program = new Command()
program
  .name('gateline-orchestrator')
  .description('Stateless reconciler for artifact-driven agent pipelines (docs/ORCHESTRATOR.md)')
  .version('0.1.0')
  .option('--repo <path>', 'repository to operate on (default: cwd)', process.cwd())
  .option(
    '--gateline-prefix <prefix>',
    'metadata prefix of an integrate.py --layout prefixed host, when not the .gateline default',
  )
  .option(
    '--adapter <name>',
    'headless adapter(s), repeatable; the first is the default runner, later ones satisfy avoid_vendor_of pins',
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )
  // Hosted mode (ORCHESTRATOR.md §2 first deployment): the machine is
  // disposable, origin is the record; unattended dispatch needs hard ceilings.
  .option('--push', 'push every orchestrator commit to origin (hosted mode)')
  .option(
    '--local-only',
    'no push, no gh/GitHub API calls, no origin fetch (conflicts with --push); unset auto-detects off a missing origin remote',
  )
  .option('--spend-limit-usd <usd>', 'refuse new dispatches when projected spend across all active runs exceeds this', parseFloat)
  .option('--require-budget', 'refuse dispatch on any run missing budget.cost_limit_usd')
  .option(
    '--no-budget-enforcement',
    'meter spend but never pause on it: disables the per-run cap, --require-budget, and --spend-limit-usd (for flat-rate-billed harnesses, #109)',
  )
  .option('--role-timeout <seconds>', 'wall clock per dispatched role before its process group is killed (default 1800)', parseFloat)
  .option(
    '--max-concurrent-dispatches <n>',
    'most dispatches running at once across all runs; 0 disables the cap (default 2, #227)',
    parseFloat,
  )

interface Opened {
  dir: string
  source: LocalGitSource
  registry: Registry | null
  frameworkPrefix?: string
}

async function open(): Promise<Opened> {
  const { repo: dir, gatelinePrefix } = program.opts<{ repo: string; gatelinePrefix?: string }>()
  const git = new Git(dir)
  return {
    dir,
    source: new LocalGitSource('local', dir, { frameworkPrefix: gatelinePrefix }),
    registry: await loadRegistry(git, await git.defaultBranch(), gatelinePrefix),
    frameworkPrefix: gatelinePrefix,
  }
}

/** CLI flags → the shared assembly (start.ts): one construction path for the binary and `gateline up`. */
async function buildEngine(opened: Opened): Promise<{ engine: Engine; scheduler: Scheduler; manifestStaleProbe: () => Promise<string[]> }> {
  const names = program.opts<{ adapter: string[] }>().adapter
  const hosted = program.opts<{
    push?: boolean
    localOnly?: boolean
    spendLimitUsd?: number
    requireBudget?: boolean
    budgetEnforcement?: boolean
    roleTimeout?: number
    maxConcurrentDispatches?: number
  }>()
  return assembleOrchestrator({
    repoDir: opened.dir,
    adapters: names,
    frameworkPrefix: opened.frameworkPrefix,
    push: hosted.push,
    localOnly: hosted.localOnly,
    spendLimitUsd: hosted.spendLimitUsd ?? null,
    requireBudget: hosted.requireBudget,
    budgetEnforcement: hosted.budgetEnforcement,
    roleTimeoutSeconds: hosted.roleTimeout,
    maxConcurrentDispatches: hosted.maxConcurrentDispatches,
    log: (line: string) => console.log(line),
  })
}

const printSweep = (s: SweepOutcome) =>
  console.log(`sweep(${s.slug ?? s.role}): ${s.kind}${s.rule ? ` [${s.rule}]` : ''} — ${s.detail}`)

program
  .command('tick')
  .description('one reconcile pass over every run')
  .option('--dry-run', 'derive and print each run’s next action; write nothing, dispatch nothing')
  .action(async (opts: { dryRun?: boolean }) => {
    const opened = await open()
    if (opts.dryRun) {
      const cfg = {
        estimates: opened.registry?.estimates ?? {},
        // Dry-run predicts what a live tick would do — same enforcement stance.
        enforceBudget: program.opts<{ budgetEnforcement?: boolean }>().budgetEnforcement !== false,
        isAncestor: (a: string, b: string) => opened.source.git.isAncestor(a, b),
      }
      for (const { ref, action } of await deriveAll(opened.source, cfg)) {
        console.log(formatAction(ref.slug, action))
      }
      return
    }
    const { engine, scheduler } = await buildEngine(opened)
    // A live one-shot tick owns its own freshness (#104); --dry-run stays
    // read-only end to end — it derives from whatever the clone has and
    // moves no refs, not even fast-forwards.
    await engine.syncFromRemote()
    const outcomes = await engine.tick()
    for (const o of outcomes) console.log(`${o.slug}: ${o.action.kind} [${o.action.rule}]${o.launched ? ` launched ${o.launched}` : ''} — ${o.detail}`)
    for (const s of await scheduler.tick()) printSweep(s)
    await engine.drain() // a one-shot tick owns its jobs to completion
    await scheduler.drain()
  })

program
  .command('watch')
  .description('resident mode: reconcile on ref changes, dispatch completions, and a heartbeat')
  .option('--heartbeat <seconds>', 'heartbeat interval', '180')
  .action(async (opts: { heartbeat: string }) => {
    const opened = await open()
    const { engine, scheduler, manifestStaleProbe } = await buildEngine(opened)
    // Self-supersede (#141): the code tree is this binary's own checkout —
    // resolved from our own import.meta.url — independent of the run source
    // at opened.dir.
    const codeRepo = resolveCodeRepo(import.meta.url)
    const codeMonitor = codeRepo ? await CodeTreeMonitor.create(codeRepo) : undefined
    // The supersede callback passed into runLoop below closes over `loop`
    // before it exists — set once runLoop resolves; the callback only fires
    // later, on a heartbeat. A supersede and the operator's ^C ladder end in
    // the same drain: share one idempotent promise so neither double-drains.
    let loop: Awaited<ReturnType<typeof runLoop>> | null = null
    let drained: Promise<void> | null = null
    const drain = () => (drained ??= Promise.resolve().then(() => loop?.stop()))
    const stop = async (exitCode: number) => {
      console.log('draining in-flight dispatches…')
      await drain()
      process.exit(exitCode)
    }
    loop = await runLoop(engine, opened.dir, {
      heartbeatMs: Number(opts.heartbeat) * 1000,
      scheduler,
      log: (line) => console.log(line),
      staleProbe: manifestStaleProbe,
      codeMonitor,
      onSupersede: (status) => {
        console.log(`code tree moved ${status.startHead}..${status.codeHead}, superseding — draining and exiting ${SUPERSEDE_EXIT_CODE}`)
        void stop(SUPERSEDE_EXIT_CODE)
      },
    })
    console.log(`watching ${opened.dir} (heartbeat ${opts.heartbeat}s; bot identity ${BOT_IDENTITY.name}) — ^C to stop`)
    const onSignal = stagedShutdown({
      inFlight: () => engine.inFlightDetail(),
      drain,
      abort: () => engine.abortInFlight(),
      log: (line) => console.log(line),
      exit: (code) => process.exit(code),
    })
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })

program
  .command('sweep <role>')
  .description('run a scheduled sweep now, ignoring dueness (the open-sweep and same-day guards still apply)')
  .action(async (role: string) => {
    const opened = await open()
    const { scheduler } = await buildEngine(opened)
    const outcomes = await scheduler.tick({ force: role })
    const mine = outcomes.filter((s) => s.role === role)
    if (mine.length === 0) {
      console.error(`no schedule for role "${role}" in orchestrator.yaml`)
      process.exitCode = 1
      return
    }
    for (const s of mine) printSweep(s)
    await scheduler.drain()
  })

program
  .command('shadow <slug>')
  .description('replay a run’s history: derived action vs what the human orchestrator actually did')
  .option('--ref <rev>', 'rev to walk (default: the run branch, else the default branch)')
  .action(async (slug: string, opts: { ref?: string }) => {
    const opened = await open()
    const runs = await opened.source.listRuns()
    const rev = opts.ref ?? runs.find((r) => r.slug === slug)?.ref
    if (!rev) {
      console.error(`no branch or default-branch history found for run "${slug}"`)
      process.exitCode = 1
      return
    }
    const steps = await shadowReplay(opened.source, slug, rev)
    steps.forEach((s, i) => console.log(`${formatShadowStep(s, i)}\n`))
    const counts = steps.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {})
    console.log(`steps: ${steps.length}  ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ')}`)
  })

await program.parseAsync()
