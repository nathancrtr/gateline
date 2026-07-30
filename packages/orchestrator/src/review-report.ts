// Review reports bind to their task by the report's own header, never the
// filename — wordfreq numbers review-NN.md by task while other repos may
// number by round, and the header (`# Review Report: <task id>`) is the
// contract-required, convention-proof signal. Rounds append within a file
// (roles/reviewer.md: "never overwrite earlier rounds"), so the latest
// verdict is the last Verdict line.

export const VERDICTS = ['approve', 'request-changes', 'escalate'] as const
export type Verdict = (typeof VERDICTS)[number]

export interface ReviewInfo {
  path: string
  /** Task id from the first `# Review Report: <id>` header, or null. */
  task: string | null
  /** All verdicts in order; one per delivered round. */
  verdicts: Verdict[]
  /** Commit epoch seconds when this report last changed, or null. */
  lastTouched: number | null
}

export function parseReviewReport(path: string, content: string, lastTouched: number | null): ReviewInfo {
  const header = /^#\s+Review Report:\s*(.+?)\s*$/m.exec(content)
  // Appended rounds may restate the header with a round suffix; the id is the part before it.
  const task = header ? header[1]!.split('—')[0]!.trim() : null
  const verdicts: Verdict[] = []
  for (const m of content.matchAll(/^\*{2}Verdict:\*{2}\s*([a-z-]+)/gim)) {
    const v = m[1]!.toLowerCase()
    if ((VERDICTS as readonly string[]).includes(v)) verdicts.push(v as Verdict)
  }
  return { path, task, verdicts, lastTouched }
}
