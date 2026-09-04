/**
 * Post-build guard: no node builtin may reach the browser bundle (#317).
 *
 * `web/test/boundary.test.ts` governs what the source is allowed to import.
 * This is the other half — what actually landed in `dist/`. The two catch
 * different failures. The test cannot see through a dependency that grows a
 * node import of its own; this cannot explain which source file caused it.
 *
 * The rule it defends: core's `sources/` and `view-model/` layers reach
 * node:child_process to talk to git, so a value import of them from the SPA
 * pulls the git driver toward the browser. `@gateline/core/record` is probed
 * browser-safe and is the one exception (ADR-6) — "probed" being the operative
 * word, since nothing stops a future record-layer change from importing
 * node:fs. That change should fail a build, not a page load.
 *
 * Exit 0 = clean, exit 1 = a builtin is in the output.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')

/**
 * The node builtin module names. Matching is deliberately narrow: a bundled
 * builtin appears as a *quoted specifier*, so that is what is searched for.
 * An earlier, looser version matched `node:` followed by any letters and fired
 * on minified object literals — `{node:l}`, `{node:null}` — which is how a
 * guard like this ends up disabled instead of fixed.
 */
const BUILTINS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]

/** e.g. fs, fs/promises, stream/web, dns/promises */
const NAME = `(?:${BUILTINS.join('|')})(?:\\/[a-z_]+)?`

const PATTERNS = [
  // The scheme form as a quoted specifier: "node:fs", 'node:child_process'.
  { label: 'node: scheme', re: new RegExp(String.raw`["'\`]node:${NAME}["'\`]`, 'g') },
  // A bare builtin, but only where a module system is resolving it.
  {
    label: 'bare builtin specifier',
    re: new RegExp(String.raw`(?:require\(|from\s*|import\()\s*["'\`](${NAME})["'\`]`, 'g'),
  },
]

/** Every builtin reference in one chunk of JavaScript. Exported so
 * `web/test/bundle-guard.test.ts` can prove this still catches a real leak —
 * a guard that cannot fail is not a guard. */
export function scan(text) {
  const hits = []
  for (const { label, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      hits.push({ label, text: match[0], index: match.index ?? 0 })
    }
  }
  return hits
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

// Importing this module (the test does) must not run the check.
const RUN_AS_CLI = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (!RUN_AS_CLI) {
  // exported API only
} else {
  main()
}

function main() {
let dist
try {
  dist = statSync(DIST)
} catch {
  console.error(`check-bundle: no build at ${DIST} — run \`vite build\` first`)
  process.exit(1)
}
if (!dist.isDirectory()) {
  console.error(`check-bundle: ${DIST} is not a directory`)
  process.exit(1)
}

const assets = walk(DIST).filter((f) => /\.(js|mjs|cjs)$/.test(f))
if (assets.length === 0) {
  // A silent pass here would make every future build "clean" by accident.
  console.error('check-bundle: no JavaScript in dist/ — refusing to report a clean bundle')
  process.exit(1)
}

const findings = []
for (const file of assets) {
  const text = readFileSync(file, 'utf8')
  for (const hit of scan(text)) {
    findings.push({
      file: relative(DIST, file),
      line: text.slice(0, hit.index).split('\n').length,
      label: hit.label,
      text: hit.text,
    })
  }
}

if (findings.length > 0) {
  console.error(`check-bundle: ${findings.length} node builtin reference(s) in the browser bundle:\n`)
  for (const f of findings.slice(0, 20)) {
    console.error(`  ${f.file}:${f.line}  ${f.text}   (${f.label})`)
  }
  if (findings.length > 20) console.error(`  … and ${findings.length - 20} more`)
  console.error(
    '\nThe SPA must not carry node builtins. A value import of @gateline/core\n' +
      '(or its sources/ and view-model/ layers) is the usual cause — web takes\n' +
      'types from the server contract and values from nowhere but the record\n' +
      'layer. See web/test/boundary.test.ts.',
  )
  process.exit(1)
}

console.log(`check-bundle: ${assets.length} bundle file(s) clean — no node builtins`)
}
