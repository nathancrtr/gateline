// Role spec parsing: `roles/<role>.md` is frontmatter plus body, and the
// frontmatter is deliberately flat — a hand-rolled reader instead of a YAML
// dependency, because this package must run in a host repo's CI with nothing
// installed (docs/INTEGRATION.md §8).
//
// Flat keys only, matching what the renderer has always accepted: blank lines
// and indented (nested) lines are skipped rather than parsed, so a nested
// value is invisible here instead of half-understood.

/** A malformed role spec, adapter manifest, or render input. */
export class FrameworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameworkError'
  }
}

export interface RoleSpec {
  /** Flat frontmatter keys, values verbatim after the first colon. */
  frontmatter: Record<string, string>
  /** Everything after the closing delimiter, leading blank lines removed. */
  body: string
}

/** `label` names the file in errors; callers pass the path they read. */
export function parseRole(text: string, label: string): RoleSpec {
  const parts = text.split('---\n')
  if (parts.length < 3 || parts[0]!.trim()) throw new FrameworkError(`${label}: expected leading '---' frontmatter block`)
  const frontmatter: Record<string, string> = {}
  for (const line of parts[1]!.split('\n')) {
    if (!line.trim() || line.trimStart() !== line) continue
    const colon = line.indexOf(':')
    const key = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1)
    frontmatter[key.trim()] = value.trim()
  }
  // A body containing its own `---\n` was split too; put it back.
  const body = parts.slice(2).join('---\n').replace(/^\n+/, '')
  return { frontmatter, body }
}

/** Parse a `[a, b, c]` frontmatter value into a list. */
export function parseList(value: string): string[] {
  return value
    .replace(/^[[\]]+|[[\]]+$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function requireFrontmatter(spec: RoleSpec, label: string, keys: string[]): void {
  for (const key of keys) {
    if (!(key in spec.frontmatter)) throw new FrameworkError(`${label}: missing '${key}' in frontmatter`)
  }
}
