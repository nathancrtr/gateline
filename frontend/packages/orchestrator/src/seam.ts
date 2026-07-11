// The dispatch seam (ORCHESTRATOR.md §5.1): nothing above this interface
// knows which harness ran — the seam is to runtimes what the registry is to
// models. Every model invocation in v1 flows through dispatch(), which is
// what makes the seam the single metering point (§6).
import { execFile } from 'node:child_process'
import { dig, type HeadlessManifest } from './manifest.ts'

export interface DispatchRequest {
  /** Working directory the harness runs in: a checkout of the run branch. */
  cwd: string
  role: string
  /** Run-specific prompt body; the adapter's template wraps it. */
  body: string
  timeoutMs: number
}

export interface DispatchOutcome {
  ok: boolean
  /** Reported by the harness, when its manifest says how to read it. */
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  error: string | null
}

export interface Dispatcher {
  readonly adapter: string
  dispatch(req: DispatchRequest): Promise<DispatchOutcome>
}

/**
 * Generic harness runner driven entirely by an adapter's headless manifest —
 * claude-code and copilot-cli differ only in the JSON they parse, which the
 * manifest describes. A new runner costs one manifest, zero code here.
 */
export class HeadlessDispatcher implements Dispatcher {
  readonly adapter: string
  private readonly manifest: HeadlessManifest

  constructor(manifest: HeadlessManifest) {
    this.adapter = manifest.adapter
    this.manifest = manifest
  }

  async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    const prompt = this.manifest.dispatchPrompt.replaceAll('{role}', req.role).replaceAll('{body}', req.body)
    const argv = this.manifest.command.map((a) => a.replaceAll('{prompt}', prompt).replaceAll('{role}', req.role))
    const [cmd, ...args] = argv

    const { stdout, error } = await new Promise<{ stdout: string; error: Error | null }>((resolve) => {
      execFile(
        cmd!,
        args,
        { cwd: req.cwd, timeout: req.timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' },
        (err, out) => resolve({ stdout: out ?? '', error: err }),
      )
    })

    if (this.manifest.usage.format === 'static-estimate') {
      // No per-invocation usage from this harness (yet): the engine meters
      // this dispatch at the registry's static estimate, tokens null.
      return { ok: !error, costUsd: null, tokensIn: null, tokensOut: null, error: error ? error.message : null }
    }

    const parsed = parseJsonOutput(stdout)
    if (!parsed) {
      return {
        ok: false,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        error: error ? error.message : 'harness produced no parseable JSON output',
      }
    }
    const fields = this.manifest.usage.fields ?? {}
    const num = (path?: string) => {
      if (!path) return null
      const v = dig(parsed, path)
      return typeof v === 'number' ? v : null
    }
    const harnessError = this.manifest.usage.errorField ? dig(parsed, this.manifest.usage.errorField) === true : false
    const resultText = this.manifest.usage.resultField ? dig(parsed, this.manifest.usage.resultField) : null
    return {
      ok: !error && !harnessError,
      costUsd: num(fields.cost_usd),
      tokensIn: num(fields.tokens_in),
      tokensOut: num(fields.tokens_out),
      error: error ? error.message : harnessError ? String(resultText ?? 'harness reported an error') : null,
    }
  }
}

/** The whole stdout is one JSON document in print mode; tolerate stray lines. */
export function parseJsonOutput(stdout: string): unknown | null {
  const text = stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    /* fall through to line scan */
  }
  for (const line of text.split('\n').reverse()) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t)
    } catch {
      /* keep scanning */
    }
  }
  return null
}
