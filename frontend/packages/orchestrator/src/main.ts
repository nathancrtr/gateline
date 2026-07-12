#!/usr/bin/env node
// agentic-orchestrator — the v1 orchestrator's CLI.
//   tick --dry-run   derive and print each run's next action; write nothing
//   tick             one live reconcile pass: dispatch, wait, meter, exit
//   watch            resident mode: ref watcher + heartbeat + completions
//   shadow <slug>    replay a run's history, derived vs actual (M1)
import { Command } from 'commander'
import { Git, LocalGitSource, type Identity } from '@agentic/core'
import { loadRegistry, type Registry } from './registry.ts'
import { deriveAll } from './tick.ts'
import { formatAction } from './derive.ts'
import { formatShadowStep, shadowReplay } from './shadow.ts'
import { Engine } from './engine.ts'
import { HeadlessDispatcher } from './seam.ts'
import { loadHeadlessManifest } from './manifest.ts'
import { RoutingDispatcher } from './router.ts'
import { runLoop } from './triggers.ts'

/** One identity per orchestrator install (resolved question 4). */
export const BOT_IDENTITY: Identity = {
  name: 'agentic-orchestrator',
  email: 'orchestrator@agentic.invalid',
}

const program = new Command()
program
  .name('agentic-orchestrator')
  .description('Stateless reconciler for artifact-driven agent pipelines (docs/ORCHESTRATOR.md)')
  .version('0.1.0')
  .option('--repo <path>', 'repository to operate on (default: cwd)', process.cwd())
  .option(
    '--adapter <name>',
    'headless adapter(s), repeatable; the first is the default runner, later ones satisfy avoid_vendor_of pins',
    (value: string, acc: string[]) => [...acc, value],
    [] as string[],
  )

interface Opened {
  dir: string
  source: LocalGitSource
  registry: Registry | null
}

async function open(): Promise<Opened> {
  const dir = program.opts<{ repo: string }>().repo
  const git = new Git(dir)
  return { dir, source: new LocalGitSource('local', dir), registry: await loadRegistry(git, await git.defaultBranch()) }
}

async function buildEngine(opened: Opened): Promise<Engine> {
  const names = program.opts<{ adapter: string[] }>().adapter
  const log = (line: string) => console.log(line)
  const adapters = await Promise.all(
    (names.length ? names : ['claude-code']).map(async (name) => {
      const manifest = await loadHeadlessManifest(opened.dir, name)
      return { manifest, dispatcher: new HeadlessDispatcher(manifest) }
    }),
  )
  const dispatcher =
    adapters.length === 1 && !opened.registry
      ? adapters[0]!.dispatcher
      : new RoutingDispatcher(adapters, opened.registry ?? { profiles: {}, bindings: {}, pricing: {}, estimates: {} }, log)
  return new Engine({
    repoDir: opened.dir,
    identity: BOT_IDENTITY,
    dispatcher,
    registry: opened.registry,
    log,
  })
}

program
  .command('tick')
  .description('one reconcile pass over every run')
  .option('--dry-run', 'derive and print each run’s next action; write nothing, dispatch nothing')
  .action(async (opts: { dryRun?: boolean }) => {
    const opened = await open()
    if (opts.dryRun) {
      const cfg = {
        estimates: opened.registry?.estimates ?? {},
        isAncestor: (a: string, b: string) => opened.source.git.isAncestor(a, b),
      }
      for (const { ref, action } of await deriveAll(opened.source, cfg)) {
        console.log(formatAction(ref.slug, action))
      }
      return
    }
    const engine = await buildEngine(opened)
    const outcomes = await engine.tick()
    for (const o of outcomes) console.log(`${o.slug}: ${o.action.kind} [${o.action.rule}]${o.launched ? ` launched ${o.launched}` : ''} — ${o.detail}`)
    await engine.drain() // a one-shot tick owns its jobs to completion
  })

program
  .command('watch')
  .description('resident mode: reconcile on ref changes, dispatch completions, and a heartbeat')
  .option('--heartbeat <seconds>', 'heartbeat interval', '180')
  .action(async (opts: { heartbeat: string }) => {
    const opened = await open()
    const engine = await buildEngine(opened)
    const loop = await runLoop(engine, opened.dir, {
      heartbeatMs: Number(opts.heartbeat) * 1000,
      log: (line) => console.log(line),
    })
    console.log(`watching ${opened.dir} (heartbeat ${opts.heartbeat}s; bot identity ${BOT_IDENTITY.name}) — ^C to stop`)
    const stop = async () => {
      console.log('draining in-flight dispatches…')
      await loop.stop()
      process.exit(0)
    }
    process.on('SIGINT', () => void stop())
    process.on('SIGTERM', () => void stop())
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
