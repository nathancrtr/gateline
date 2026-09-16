#!/usr/bin/env node
// The dependency-free entry point. `gateline render|init|validate|fork` are the
// operator's spellings of these, but two callers have no workspace to install:
// a host repository's render-staleness CI,
//
//     node <framework>/packages/framework/src/main.ts render --check <repo>
//
// and whoever is integrating the framework for the first time, before they have
// installed anything at all. That is the property the old stdlib-only Python
// tooling had, and this keeps it: nothing in this package may import outside
// node: builtins and itself (docs/INTEGRATION.md §8).
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runFork, runInit, runRender, runValidate } from './cli.ts'
import type { Layout, ProvenanceMode } from './lock.ts'
import { FrameworkError } from './role.ts'

const USAGE = `usage: gateline-framework <command> [options]

  render [repo] [--check]        (re)write every adapter's agent files from the role specs
  init <target> --provenance <redistribute|private>
                                 scaffold the framework into a host repository
        [--take all|<group>|<file,file>] [--layout prefixed|root]
        [--prefix .gateline] [--adapters auto|<name,name>]
  validate [target] [--prefix .gateline]
                                 re-prove the static integration invariants
  fork <file> --reason <text> [--target .] [--prefix .gateline]
                                 record a deliberate core-file divergence

These are the same commands as \`gateline render|init|validate|fork\`, runnable
with nothing installed.`

interface Parsed {
  positional: string[]
  flags: Record<string, string | true>
}

/** `--flag value` and `--flag` only; the tool has no short options. */
function parseArgs(argv: string[]): Parsed {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }
  return { positional, flags }
}

function str(flags: Record<string, string | true>, name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

function required(flags: Record<string, string | true>, name: string): string {
  const value = str(flags, name)
  if (value === undefined) throw new FrameworkError(`--${name} is required`)
  return value
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new FrameworkError(`--${name} must be one of: ${allowed.join(' | ')}`)
  }
  return value as T
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE)
    return 0
  }
  const { positional, flags } = parseArgs(rest)

  switch (command) {
    case 'render':
      return runRender(positional[0] ?? process.cwd(), flags.check === true)
    case 'init': {
      const target = positional[0]
      if (!target) throw new FrameworkError('init needs a target repository')
      return runInit({
        target,
        // No default on purpose: the operator states the host's posture.
        provenance: oneOf(required(flags, 'provenance'), ['redistribute', 'private'] as const, 'provenance') as ProvenanceMode,
        take: str(flags, 'take'),
        layout: str(flags, 'layout') ? (oneOf(str(flags, 'layout')!, ['prefixed', 'root'] as const, 'layout') as Layout) : undefined,
        prefix: str(flags, 'prefix'),
        adapters: str(flags, 'adapters'),
      })
    }
    case 'validate':
      return runValidate(positional[0] ?? process.cwd(), str(flags, 'prefix'))
    case 'fork': {
      const file = positional[0]
      if (!file) throw new FrameworkError('fork needs the host-relative path of a taken core file')
      return runFork({
        target: str(flags, 'target') ?? process.cwd(),
        file,
        reason: required(flags, 'reason'),
        prefix: str(flags, 'prefix'),
      })
    }
    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`)
      return 1
  }
}

// Compare realpaths, not strings: a linked bin is a symlink chain to this
// file, and Node's ESM loader realpaths the entry module while argv[1] keeps
// the symlink path.
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
  process.exit(
    await main(process.argv.slice(2)).catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e))
      return 1
    }),
  )
}
