#!/usr/bin/env node
// CLI: `node fixtures/src/main.ts [dir]` — generate a demo repo and print its path.
import { generateFixtureRepo } from './index.ts'

const dir = process.argv[2]
const repo = generateFixtureRepo(dir)
console.log(repo.dir)
