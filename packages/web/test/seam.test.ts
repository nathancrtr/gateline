/**
 * The seam's layering rule, as a checked fact (docs/SEAM.md §7, #432).
 *
 * "The web layer … is forbidden two things: deriving a kind from a path, and
 * printing a path outside an Address." This file holds the first half. The
 * second half needs a laid-out page and lives in `e2e/seam.spec.ts`.
 *
 * What an artifact *is* is the record layer's to say: `describeArtifact` in
 * `core/src/record/artifact.ts` is the one place a path's kind is derived, and
 * web reads it off the `ArtifactRef` on the wire (#415). Before that, five
 * sites re-derived the kind from the path — a `review-` prefix here, a
 * `tasks/` test there — each free to drift from the others. This test is what
 * keeps a sixth from appearing.
 *
 * What it forbids, anywhere under `web/src`:
 *
 * - a regex literal whose source names a run path or an artifact's filename
 *   grammar (`review-`, `tasks/`, `runs/`, `\.md`, `\.ya?ml`, `spec\.` …);
 * - a string-method call (`startsWith`, `endsWith`, `includes`, `match`, …)
 *   or `new RegExp(…)` whose literal argument is path-shaped;
 * - an equality comparison, or a `case`, against a path-shaped literal.
 *
 * Read from the TypeScript AST rather than grepped, so a comment explaining
 * the old regex never trips it, and a kind name (`'review-report'`, which is
 * the framework's word, not a filename) is not mistaken for a path test.
 *
 * The exceptions are a list, each with its reason, matched by file and by the
 * offending source text rather than by line — a line number would go stale on
 * the first unrelated edit and the entry would start excusing the wrong code.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')

/**
 * A regex source that names a run path or a filename grammar. Read against the
 * literal's own text, escapes and all: `\.md`, `\.(?:md|ya?ml)`, `tasks\/`.
 */
const REGEX_PATH = [
  /review-/,
  /(^|[^\w])tasks\\?\//,
  /(^|[^\w])runs\\?\//,
  /\\\.\(?(\?:)?(md|ya\??ml|yml|json)\b/,
  /\b(state|spec|plan|intent-brief|verification-report|release-plan|retro|docs-delta)\\\./,
]

/**
 * A string literal that is path-shaped: a filename with an artifact's
 * extension, a `tasks/` or `runs/` segment, or the review report's filename
 * prefix. `review-report` is excluded by name — it is the kind, not a path.
 */
const STRING_PATH = /(^|\/)review-(?!report\b)|(^|\/)(tasks|runs)(\/|$)|\.(md|ya?ml|json)$/

/** The string methods a path test would be written with. */
const STRING_METHODS = new Set([
  'startsWith',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'match',
  'matchAll',
  'search',
  'replace',
  'replaceAll',
  'split',
])

interface Exception {
  /** Relative to `web/src`. */
  file: string
  /** The offending source text, exactly as the finding prints it. */
  text: string
  /** Why this is not classification — or, where it is transitional, which step removes it. */
  reason: string
}

/**
 * The format choices and guards that look like path tests and are not. Each
 * entry is a deliberate act: say why, and name the step when it is
 * transitional. `lists only exceptions that still match` keeps the list from
 * outliving its reasons.
 */
const EXCEPTIONS: Exception[] = [
  {
    file: 'components/vocabulary.tsx',
    text: '/\\S\\.(?:md|ya?ml|json)\\b|\\//',
    reason:
      "KindLabel's dev-time invariant: it throws when a caption *is* a filename. A guard against printing a path, not a classifier of one — it decides nothing about what an artifact is.",
  },
]

interface Finding {
  file: string
  line: number
  text: string
  why: string
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** The literal text of a string-ish node, or null when it is computed. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  // A template with substitutions: its fixed parts are still the author's
  // words, and `runs/${slug}/` is as much a path test as `runs/x/`.
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('\u0000')
  return null
}

const pathShaped = (text: string) => text.split('\u0000').some((part) => STRING_PATH.test(part))

/** Every path classification in one file's source. */
function findPathTests(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Finding[] = []
  const report = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    out.push({ file, line: line + 1, text: node.getText(sf), why })
  }

  const visit = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      const hit = REGEX_PATH.find((p) => p.test(node.text))
      if (hit) report(node, `regex names a path grammar (${hit.source})`)
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const arg = node.arguments[0]
      const text = arg ? literalText(arg) : null
      if (STRING_METHODS.has(method) && text !== null && pathShaped(text)) report(node, `.${method}() over a path-shaped literal`)
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
      const arg = node.arguments?.[0]
      const text = arg ? literalText(arg) : null
      if (text !== null && REGEX_PATH.some((p) => p.test(text.replace(/\\\\/g, '\\')))) report(node, 'new RegExp() names a path grammar')
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      const equality =
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken
      if (equality) {
        const text = literalText(node.left) ?? literalText(node.right)
        if (text !== null && pathShaped(text)) report(node, 'compared against a path-shaped literal')
      }
    } else if (ts.isCaseClause(node)) {
      const text = literalText(node.expression)
      if (text !== null && pathShaped(text)) report(node.expression, '`case` on a path-shaped literal')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const excused = (f: Finding) => EXCEPTIONS.some((e) => e.file === f.file && e.text === f.text)

describe('web never classifies an artifact by its path (SEAM.md §7)', () => {
  const files = walk(SRC).map((f) => relative(SRC, f))
  const findings = files.flatMap((file) => findPathTests(file, readFileSync(join(SRC, file), 'utf8')))

  it('reads kinds off the ArtifactRef, never off the path', () => {
    const offenders = findings
      .filter((f) => !excused(f))
      .map((f) => `web/src/${f.file}:${f.line} — ${f.why}: ${f.text}`)
    expect(
      offenders,
      `path classification in web/src — read the kind off the ArtifactRef (describeArtifact is the one classifier), or add a reasoned entry to EXCEPTIONS:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('lists only exceptions that still match, so none outlives its reason', () => {
    const stale = EXCEPTIONS.filter((e) => !findings.some((f) => f.file === e.file && f.text === e.text)).map(
      (e) => `${e.file}: ${e.text}`,
    )
    expect(stale).toEqual([])
  })

  it('gives every exception a reason', () => {
    expect(EXCEPTIONS.filter((e) => e.reason.trim().length < 40).map((e) => e.file)).toEqual([])
  })

  it('catches a planted classification of each shape', () => {
    // A test that cannot fail is worthless here: every shape the rule names
    // must be seen, and the honest neighbours of each must not be.
    const planted = [
      "const isReview = (p: string) => /^review-\\d+\\.md$/.test(p)",
      "const isTask = (p: string) => p.startsWith('tasks/')",
      'const isYaml = (p: string) => /\\.ya?ml$/.test(p)',
      "const isState = (p: string) => p === 'state.yaml'",
      `const inRun = (p: string, s: string) => p.includes(\`runs/\${s}/\`)`,
      "const re = new RegExp('^tasks/')",
      "function k(p: string) { switch (p) { case 'spec.md': return 1 } return 0 }",
    ]
    for (const line of planted) {
      expect(findPathTests('planted.ts', line), line).toHaveLength(1)
    }
  })

  it('leaves kind names, comments and UI routes alone', () => {
    const honest = [
      "const isReview = (r: { kind: string }) => r.kind === 'review-report'",
      '// the old test was /^review-/ over the path',
      '/** `tasks/` and `review-` are said once */ const x = 1',
      `const href = (s: string, slug: string) => \`/runs/\${s}/\${slug}?tab=record\``,
      "const words = (s: string) => s.split(/[^a-z0-9]+/)",
    ]
    for (const line of honest) {
      expect(findPathTests('honest.ts', line), line).toEqual([])
    }
  })
})
