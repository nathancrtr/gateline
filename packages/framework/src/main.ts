#!/usr/bin/env node
// The dependency-free entry point. `gateline render` is the operator's
// spelling of this, but a host repository's render-staleness CI has no
// workspace to install, so it runs this file directly:
//
//     node <framework>/packages/framework/src/main.ts render --check <repo>
//
// Nothing in this package may import outside node: builtins and itself. That
// is the successor to the renderer's old stdlib-only rule, for the same reason
// (docs/INTEGRATION.md §8): this runs before anything has been set up.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runRender } from './cli.ts'

const USAGE = `usage: gateline-framework render [--check] [repo]

  render   (re)write every adapter's agent files from the role specs
  --check  write nothing; exit 1 if any rendered file is stale
  repo     repository to render (default: the current directory)`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(USAGE)
    return 0
  }
  if (command !== 'render') {
    console.error(`unknown command "${command}"\n\n${USAGE}`)
    return 1
  }
  const positional = rest.filter((arg) => !arg.startsWith('-'))
  const unknown = rest.filter((arg) => arg.startsWith('-') && arg !== '--check')
  if (unknown.length || positional.length > 1) {
    console.error(`${unknown.length ? `unknown option "${unknown[0]}"` : 'too many arguments'}\n\n${USAGE}`)
    return 1
  }
  return runRender(positional[0] ?? process.cwd(), rest.includes('--check'))
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
  process.exit(await main(process.argv.slice(2)))
}
