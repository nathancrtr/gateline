#!/usr/bin/env node
// agentic-orchestrator — the v1 orchestrator's CLI. M1 ships the read-only
// surfaces: `tick --dry-run` (derive and print, write nothing) and
// `shadow <slug>` (replay a run's history and compare derived vs actual).
import { Command } from 'commander'
import { Git, LocalGitSource } from '@agentic/core'
import { loadRegistry } from './registry.ts'
import { deriveAll } from './tick.ts'
import { formatAction } from './derive.ts'
import { formatShadowStep, shadowReplay } from './shadow.ts'

const program = new Command()
program
  .name('agentic-orchestrator')
  .description('Stateless reconciler for artifact-driven agent pipelines (docs/ORCHESTRATOR.md)')
  .version('0.1.0')
  .option('--repo <path>', 'repository to operate on (default: cwd)', process.cwd())

async function openSource(): Promise<{ source: LocalGitSource; estimates: Record<string, number> }> {
  const dir = program.opts<{ repo: string }>().repo
  const source = new LocalGitSource('local', dir)
  const git = new Git(dir)
  const registry = await loadRegistry(git, await git.defaultBranch())
  return { source, estimates: registry?.estimates ?? {} }
}

program
  .command('tick')
  .description('one reconcile pass over every run')
  .option('--dry-run', 'derive and print each run’s next action; write nothing, dispatch nothing')
  .action(async (opts: { dryRun?: boolean }) => {
    if (!opts.dryRun) {
      console.error('live ticks arrive with the M2 dispatch seam; use --dry-run')
      process.exitCode = 2
      return
    }
    const { source, estimates } = await openSource()
    for (const { ref, action } of await deriveAll(source, { estimates })) {
      console.log(formatAction(ref.slug, action))
    }
  })

program
  .command('shadow <slug>')
  .description('replay a run’s history: derived action vs what the human orchestrator actually did')
  .option('--ref <rev>', 'rev to walk (default: the run branch, else the default branch)')
  .action(async (slug: string, opts: { ref?: string }) => {
    const { source, estimates } = await openSource()
    const rev = opts.ref ?? (await pickRev(source, slug))
    if (!rev) {
      console.error(`no branch or default-branch history found for run "${slug}"`)
      process.exitCode = 1
      return
    }
    const steps = await shadowReplay(source, slug, rev, { estimates })
    steps.forEach((s, i) => console.log(`${formatShadowStep(s, i)}\n`))
    const counts = steps.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {})
    console.log(`steps: ${steps.length}  ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  ')}`)
  })

async function pickRev(source: LocalGitSource, slug: string): Promise<string | null> {
  const runs = await source.listRuns()
  const ref = runs.find((r) => r.slug === slug)
  if (ref) return ref.ref
  return null
}

await program.parseAsync()
