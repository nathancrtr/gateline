#!/usr/bin/env node
// gateline-runner-agent — the workstation half of the remote-dispatch relay
// (ORCHESTRATOR.md / TOPOLOGY.md §3.3, run "runner-agent"). CLI-flag parsing
// only; the actual poll/claim/execute/report loop lives in agent.ts so it
// can be exercised in tests without spawning this process.
import { Command } from 'commander'
import { runAgent } from './agent.ts'

const program = new Command()
program
  .name('gateline-runner-agent')
  .description('Workstation agent: polls a control plane for dispatch intents, executes them in a disposable clone, and reports outcomes back.')
  .version('0.1.0')
  .requiredOption('--control-plane <url>', 'base URL of the control plane server (the @gateline/server instance exposing /api/runner/*)')
  .requiredOption('--token <token>', 'runner service token (matches the control plane\'s RUNNER_TOKEN)')
  // No default here on purpose (R8, AC8.1): a hardcoded adapter name in this
  // agent's own source would be exactly the kind of harness identity R8
  // forbids outside manifest-driven data. The operator names the adapter;
  // pointing the same binary at a different one (AC8.2) is just a different
  // value for this flag.
  .requiredOption('--adapter <name>', 'adapter whose manifest.json (in the target repo) governs the command this agent runs')
  .option('--work-dir <path>', 'directory disposable workspaces are created under', process.cwd())
  .option('--poll-interval <seconds>', 'seconds between polls of the control plane', '5')
  .option('--repo-url <url>', 'fallback git remote URL, used only when the control plane cannot determine one itself')
  .option('--gateline-prefix <prefix>', 'metadata prefix override for an integrate.py --prefix host (default: auto-detected per clone)')
  .parse(process.argv)

const opts = program.opts<{
  controlPlane: string
  token: string
  adapter: string
  workDir: string
  pollInterval: string
  repoUrl?: string
  gatelinePrefix?: string
}>()

const pollIntervalSeconds = Number(opts.pollInterval)
if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
  console.error(`--poll-interval must be a positive number of seconds, got "${opts.pollInterval}"`)
  process.exit(1)
}

runAgent({
  controlPlane: opts.controlPlane,
  token: opts.token,
  adapter: opts.adapter,
  workDir: opts.workDir,
  pollIntervalMs: pollIntervalSeconds * 1000,
  repoUrl: opts.repoUrl,
  prefixHint: opts.gatelinePrefix,
  log: (line: string) => console.log(line),
}).catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
