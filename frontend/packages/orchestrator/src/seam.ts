// The dispatch seam (ORCHESTRATOR.md §5.1): nothing above this interface
// knows which harness ran — the seam is to runtimes what the registry is to
// models. Every model invocation in v1 flows through dispatch(), which is
// what makes the seam the single metering point (§6).
import { spawn } from 'node:child_process'
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
  /** Retrying cannot help (e.g. a fold conflict = plan defect): escalate now. */
  fatal?: boolean
}

export interface Dispatcher {
  readonly adapter: string
  /** The adapter that would run this role (routing dispatchers differ per role). */
  adapterFor?(role: string): string
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

    const { stdout, error, timedOut } = await runHarness(cmd!, args, req.cwd, req.timeoutMs)
    // execFile's generic "Command failed: <argv>" hides what actually
    // happened; a timeout is the one failure the seam itself caused, so
    // name it — the ledger and the escalation both carry this string.
    const failure = timedOut
      ? `harness timed out after ${Math.round(req.timeoutMs / 60000)}min wall clock — process group killed (SIGKILL)`
      : error
        ? error.message
        : null

    if (this.manifest.usage.format === 'static-estimate') {
      // No per-invocation usage from this harness (yet): the engine meters
      // this dispatch at the registry's static estimate, tokens null.
      return { ok: !error && !timedOut, costUsd: null, tokensIn: null, tokensOut: null, error: failure }
    }

    const parsed = parseJsonOutput(stdout)
    if (!parsed) {
      return {
        ok: false,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        error: failure ?? 'harness produced no parseable JSON output',
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
      ok: !error && !timedOut && !harnessError,
      costUsd: num(fields.cost_usd),
      tokensIn: num(fields.tokens_in),
      tokensOut: num(fields.tokens_out),
      error: failure ?? (harnessError ? String(resultText ?? 'harness reported an error') : null),
    }
  }
}

/**
 * Run the harness under a wall-clock ceiling, killing its whole process
 * group on timeout. execFile's built-in timeout signals only the direct
 * child: a harness's own children (tool shells, MCP servers) survive the
 * kill, keep spending, and hold the stdio pipes open — the callback (and so
 * the closing commit) then waits on them, minutes after the kill.
 */
const MAX_CAPTURE = 64 * 1024 * 1024

function runHarness(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; error: Error | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk
    })
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid!, 'SIGKILL') // negative pid = the group (POSIX)
      } catch {
        child.kill('SIGKILL') // no group to kill (already gone, or not POSIX)
      }
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout, error: err, timedOut })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const error =
        code === 0
          ? null
          : new Error(
              `Command failed${signal ? ` (${signal})` : code !== null ? ` (exit ${code})` : ''}: ${cmd} ${args.join(' ')}${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
            )
      resolve({ stdout, error, timedOut })
    })
  })
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
