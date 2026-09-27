#!/usr/bin/env node
// CLI: `node fixtures/src/main.ts [dir] [--small]` — generate a demo repo and
// print its path. `--small` generates the demo's second repository's four runs
// (#498) instead of the full set. A `dir` that does not exist yet is created.
import { mkdirSync } from 'node:fs'
import { generateFixtureRepo, SMALL_FIXTURE_NAME } from './index.ts'

const args = process.argv.slice(2)
const small = args.includes('--small')
const dir = args.find((a) => !a.startsWith('--'))
if (dir) mkdirSync(dir, { recursive: true })
const repo = generateFixtureRepo(dir, small ? { runs: 'small', name: SMALL_FIXTURE_NAME } : {})
console.log(repo.dir)
