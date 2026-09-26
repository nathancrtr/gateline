// One long-lived `git cat-file --batch` per repository. Starting a git process
// costs far more than the read it performs, and a history walk asks for
// hundreds of blobs; this answers all of them from a single child.
//
// The child is a reader only and never outlives its usefulness: it holds the
// event loop open while a request is in flight and at no other time, and it is
// stopped after a short idle period, so a CLI command still exits when its
// work is done and a discarded `Git` leaves nothing running.
import { type ChildProcess, spawn } from 'node:child_process'

export interface BatchObject {
  oid: string
  type: string
  content: Buffer
}

export class CatFileError extends Error {
  readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.name = 'CatFileError'
    this.stderr = stderr
  }
}

interface Pending {
  resolve: (object: BatchObject | null) => void
  reject: (error: Error) => void
}

interface Header {
  oid: string
  type: string
  size: number
}

const LF = 0x0a
const IDLE_MS = 2_000

/** Anything with `ref`/`unref` — the child and each of its pipes. */
interface Refable {
  ref(): void
  unref(): void
}

export class CatFileBatch {
  private readonly dir: string
  private child: ChildProcess | null = null
  private pending: Pending[] = []
  private chunks: Buffer[] = []
  private buffered = 0
  private header: Header | null = null
  private stderr = ''
  private idle: NodeJS.Timeout | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  /**
   * Whether `spec` can be asked over the batch protocol, which is one object
   * name per line: a name carrying a line break would be read as two requests
   * and every later answer would go to the wrong caller.
   */
  static accepts(spec: string): boolean {
    return !spec.includes('\n') && !spec.includes('\r')
  }

  /** The object `spec` names, or null when it names nothing. */
  read(spec: string): Promise<BatchObject | null> {
    if (!CatFileBatch.accepts(spec)) return Promise.reject(new CatFileError('object name contains a line break', ''))
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = this.ensure()
      } catch (e) {
        reject(e as Error)
        return
      }
      this.pending.push({ resolve, reject })
      this.hold(child)
      child.stdin!.write(`${spec}\n`)
    })
  }

  /** Stop the child. Requests still in flight are rejected. */
  close(): void {
    const child = this.child
    if (!child) return
    this.fail(child, new CatFileError('git cat-file closed', ''))
  }

  private ensure(): ChildProcess {
    if (this.child) return this.child
    const child = spawn('git', ['-C', this.dir, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.chunks = []
    this.buffered = 0
    this.header = null
    this.stderr = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.chunks.push(chunk)
      this.buffered += chunk.length
      try {
        this.drain(child)
      } catch (e) {
        this.fail(child, e as Error)
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      if (this.child === child) this.stderr = (this.stderr + chunk.toString('utf8')).slice(-4096)
    })
    // A write to a child that has already gone surfaces here; `close` reports it.
    child.stdin!.on('error', () => {})
    child.on('error', (e) => this.fail(child, new CatFileError(`git cat-file failed: ${e.message}`, this.stderr)))
    child.on('close', () =>
      this.fail(child, new CatFileError(`git cat-file failed: ${this.stderr.trim() || 'exited unexpectedly'}`, this.stderr)),
    )
    this.release(child)
    return child
  }

  private drain(child: ChildProcess): void {
    for (;;) {
      if (this.header === null) {
        const buf = this.consolidate()
        const end = buf.indexOf(LF)
        if (end === -1) return
        const line = buf.subarray(0, end).toString('utf8')
        this.consume(end + 1)
        // `<name> missing` and `<name> ambiguous` both mean the name resolved
        // to no single object. The name may itself contain spaces, so these
        // are matched from the end; an object header never ends this way.
        if (line.endsWith(' missing') || line.endsWith(' ambiguous')) {
          this.settle(child, null)
          continue
        }
        const [oid, type, size] = line.split(' ')
        if (!oid || !type || size === undefined || !/^\d+$/.test(size)) {
          throw new CatFileError(`git cat-file answered with an unreadable header: ${line}`, this.stderr)
        }
        this.header = { oid, type, size: Number(size) }
      }
      // The content is followed by one line feed that is not part of it.
      if (this.buffered < this.header.size + 1) return
      const buf = this.consolidate()
      const { oid, type, size } = this.header
      const content = Buffer.from(buf.subarray(0, size))
      this.consume(size + 1)
      this.header = null
      this.settle(child, { oid, type, content })
    }
  }

  private consolidate(): Buffer {
    if (this.chunks.length !== 1) this.chunks = [Buffer.concat(this.chunks)]
    return this.chunks[0]!
  }

  private consume(bytes: number): void {
    const buf = this.consolidate()
    this.chunks = bytes >= buf.length ? [] : [buf.subarray(bytes)]
    this.buffered -= bytes
  }

  private settle(child: ChildProcess, object: BatchObject | null): void {
    const next = this.pending.shift()
    if (!next) throw new CatFileError('git cat-file answered a request nobody made', this.stderr)
    if (this.pending.length === 0) this.release(child)
    next.resolve(object)
  }

  private fail(child: ChildProcess, error: Error): void {
    if (this.child !== child) return
    this.child = null
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const waiting = this.pending
    this.pending = []
    child.stdin?.destroy()
    child.kill()
    for (const p of waiting) p.reject(error)
  }

  private handles(child: ChildProcess): Refable[] {
    return [child, child.stdin, child.stdout, child.stderr].filter((h) => h !== null) as unknown as Refable[]
  }

  private hold(child: ChildProcess): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    for (const h of this.handles(child)) h.ref()
  }

  private release(child: ChildProcess): void {
    for (const h of this.handles(child)) h.unref()
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      if (this.child === child && this.pending.length === 0) this.close()
    }, IDLE_MS)
    this.idle.unref()
  }
}
