// The lockfile must carry every platform's optional bindings (#291).
//
// npm records only the current platform's optional dependencies when a
// package is added to an existing tree (npm/cli#4828). A lockfile written
// that way installs cleanly on the machine that wrote it and fails at build
// time on every other platform — "Cannot find native binding" from a wrapper
// with nothing underneath it — three checks later, on an unrelated branch,
// with a message that reads like an npm bug rather than a committed defect.
//
// One invariant catches it on the PR that introduces it: every name in any
// entry's `optionalDependencies` has its own `node_modules/<name>` entry in
// the same lockfile. A from-scratch resolve always satisfies this; the npm
// bug is exactly what breaks it. Run against the two lockfiles from #290,
// the rule names the eleven missing `@tailwindcss/oxide-*` bindings and
// nothing else.
//
// Stdlib only, no install needed, so CI can run it before `npm ci`.
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const lockPath = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const packages = lock.packages ?? {}

// A dependency may be hoisted (`node_modules/<name>`) or nested under its
// dependant (`node_modules/<parent>/node_modules/<name>`); either satisfies it.
const present = new Set(Object.keys(packages).map((key) => key.replace(/^.*node_modules\//, '')))

const missing = []
for (const [path, entry] of Object.entries(packages)) {
  for (const name of Object.keys(entry.optionalDependencies ?? {})) {
    if (!present.has(name)) missing.push({ dependant: path || '(root)', name })
  }
}

const rel = relative(process.cwd(), lockPath)
const shown = rel && !rel.startsWith('..') ? rel : lockPath
if (missing.length === 0) {
  console.log(`${shown}: every optional dependency has its own entry`)
  process.exit(0)
}

console.error(`${shown}: ${missing.length} optional dependenc${missing.length === 1 ? 'y has' : 'ies have'} no entry of their own — the lockfile was written for one platform (npm/cli#4828):`)
for (const { dependant, name } of missing) console.error(`  ${dependant} → ${name}`)
console.error(`\nRegenerate it from scratch so every platform's bindings are recorded:\n  rm -rf node_modules package-lock.json && npm install`)
process.exit(1)
