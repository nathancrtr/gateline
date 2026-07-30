// #182: the engine's only signal for "does this role have a shell" is the
// role spec's own frontmatter — there is no adapter-side capability map. A
// prefixed layout (integrate.py init --layout prefixed) must resolve too,
// since roles/ travels under the metadata prefix same as adapters/contracts.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasShell, loadRoleCapabilities } from '../src/capabilities.ts'

const roleSpec = (capabilitiesLine: string | null) =>
  [
    '---',
    'role: toy',
    'dispatch: A toy role.',
    'capability_profile: balanced',
    ...(capabilitiesLine ? [capabilitiesLine] : []),
    'inputs: []',
    'outputs: []',
    'writes_code: false',
    'gate: G0',
    '---',
    '',
    '# Toy',
    '',
  ].join('\n')

describe('loadRoleCapabilities', () => {
  it('parses a shell-less role: capabilities present, no shell', async () => {
    const dir = mktemp()
    writeRole(dir, 'analyst', roleSpec('capabilities: [read, search, write-artifacts]'))
    const caps = await loadRoleCapabilities(dir)
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('parses a shell-ful role: capabilities present, shell included', async () => {
    const dir = mktemp()
    writeRole(dir, 'reviewer', roleSpec('capabilities: [read, search, write-artifacts, shell]'))
    const caps = await loadRoleCapabilities(dir)
    expect(hasShell(caps, 'reviewer')).toBe(true)
  })

  it('defaults an unknown role to shell-ful', async () => {
    const dir = mktemp()
    writeRole(dir, 'analyst', roleSpec('capabilities: [read, search, write-artifacts]'))
    const caps = await loadRoleCapabilities(dir)
    expect(hasShell(caps, 'no-such-role')).toBe(true)
  })

  it('defaults a role file with no capabilities line to shell-ful', async () => {
    const dir = mktemp()
    writeRole(dir, 'orchestrator', roleSpec(null))
    const caps = await loadRoleCapabilities(dir)
    expect(hasShell(caps, 'orchestrator')).toBe(true)
  })

  it('defaults every role to shell-ful when the roles dir is missing entirely', async () => {
    const dir = mktemp()
    const caps = await loadRoleCapabilities(dir)
    expect(caps.size).toBe(0)
    expect(hasShell(caps, 'analyst')).toBe(true)
  })

  it('resolves roles/ under the metadata prefix for a prefixed layout', async () => {
    const dir = mktemp()
    mkdirSync(join(dir, '.agentic', 'roles'), { recursive: true })
    writeFileSync(join(dir, '.agentic', 'roles', 'analyst.md'), roleSpec('capabilities: [read, search, write-artifacts]'))
    writeFileSync(join(dir, '.agentic', 'framework-lock.json'), JSON.stringify({ layout: 'prefixed', prefix: '.agentic' }))
    const caps = await loadRoleCapabilities(dir)
    expect(hasShell(caps, 'analyst')).toBe(false)
  })
})

function mktemp(): string {
  return mkdtempSync(join(tmpdir(), 'agentic-caps-'))
}

function writeRole(dir: string, role: string, content: string): void {
  mkdirSync(join(dir, 'roles'), { recursive: true })
  writeFileSync(join(dir, 'roles', `${role}.md`), content)
}
