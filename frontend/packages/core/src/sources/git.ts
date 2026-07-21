// Thin async wrapper over the git CLI. Reads always address refs (never the
// working tree); writes go through plumbing so no checkout is ever touched.
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export class GitError extends Error {
  readonly args: string[]
  readonly stderr: string

  // No parameter properties anywhere in core/server: Node runs this source
  // directly in strip-only mode, which rejects them.
  constructor(message: string, args: string[], stderr: string) {
    super(message)
    this.name = 'GitError'
    this.args = args
    this.stderr = stderr
  }
}

const MISSING_PATH_RE = /does not exist|exists on disk, but not in|invalid object name|not a valid object name|bad revision/i

export interface RefInfo {
  ref: string
  oid: string
}

export interface CommitInfo {
  oid: string
  /** Unix epoch seconds (committer time). */
  time: number
  author: string
  email: string
  subject: string
}

export interface WorktreeInfo {
  path: string
  branch: string | null
}

export class Git {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  run(args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        ['-C', this.dir, ...args],
        {
          maxBuffer: 256 * 1024 * 1024,
          env: opts.env ? { ...process.env, ...opts.env } : process.env,
        },
        (err, stdout, stderr) => {
          if (err) reject(new GitError(`git ${args[0]} failed: ${stderr || err.message}`, args, stderr ?? ''))
          else resolve(stdout)
        },
      )
      if (opts.input !== undefined) {
        child.stdin?.write(opts.input)
        child.stdin?.end()
      }
    })
  }

  async revParse(rev: string): Promise<string | null> {
    try {
      return (await this.run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim() || null
    } catch {
      return null
    }
  }

  async toplevel(): Promise<string> {
    return (await this.run(['rev-parse', '--show-toplevel'])).trim()
  }

  async forEachRef(patterns: string[]): Promise<RefInfo[]> {
    const out = await this.run(['for-each-ref', '--format=%(objectname) %(refname)', ...patterns])
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [oid, ...rest] = line.split(' ')
        return { oid: oid!, ref: rest.join(' ') }
      })
  }

  /** Content of `path` at `rev`, or null when the path/rev doesn't exist. */
  async show(rev: string, path: string): Promise<string | null> {
    try {
      return await this.run(['show', `${rev}:${path}`])
    } catch (e) {
      if (e instanceof GitError && MISSING_PATH_RE.test(e.stderr)) return null
      throw e
    }
  }

  /** Paths (relative to `path`) of blobs under `rev:path`. Empty when missing. */
  async lsTree(rev: string, path: string): Promise<string[]> {
    try {
      const out = await this.run(['ls-tree', '-r', '--name-only', rev, '--', path])
      const prefix = path.endsWith('/') ? path : `${path}/`
      return out
        .split('\n')
        .filter(Boolean)
        .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
    } catch (e) {
      if (e instanceof GitError && MISSING_PATH_RE.test(e.stderr)) return []
      throw e
    }
  }

  /** Top-level directory names under `rev:path`. */
  async lsTreeDirs(rev: string, path: string): Promise<string[]> {
    try {
      const out = await this.run(['ls-tree', '--format=%(objecttype) %(path)', rev, '--', path.endsWith('/') ? path : `${path}/`])
      return out
        .split('\n')
        .filter(Boolean)
        .filter((l) => l.startsWith('tree '))
        .map((l) => l.slice('tree '.length).split('/').pop()!)
    } catch (e) {
      if (e instanceof GitError && MISSING_PATH_RE.test(e.stderr)) return []
      throw e
    }
  }

  async log(rev: string, paths: string[] = [], opts: { maxCount?: number } = {}): Promise<CommitInfo[]> {
    const args = ['log', '--format=%H%x00%ct%x00%an%x00%ae%x00%s']
    if (opts.maxCount) args.push(`-n${opts.maxCount}`)
    args.push(rev)
    if (paths.length) args.push('--', ...paths)
    try {
      const out = await this.run(args)
      return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [oid, time, author, email, subject] = line.split('\0')
          return { oid: oid!, time: Number(time), author: author!, email: email!, subject: subject ?? '' }
        })
    } catch (e) {
      if (e instanceof GitError && MISSING_PATH_RE.test(e.stderr)) return []
      throw e
    }
  }

  /** Most recent commit on `rev` touching any of `paths`, or null. */
  async lastTouched(rev: string, paths: string[]): Promise<CommitInfo | null> {
    const commits = await this.log(rev, paths, { maxCount: 1 })
    return commits[0] ?? null
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    try {
      return (await this.run(['merge-base', a, b])).trim() || null
    } catch {
      return null
    }
  }

  async isAncestor(maybeAncestor: string, of: string): Promise<boolean> {
    try {
      await this.run(['merge-base', '--is-ancestor', maybeAncestor, of])
      return true
    } catch {
      return false
    }
  }

  /** `git rev-list --count <range>`, or null when a ref in the range is unknown. */
  async revListCount(range: string): Promise<number | null> {
    try {
      const n = Number((await this.run(['rev-list', '--count', range])).trim())
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  /**
   * The repo's default branch: origin/HEAD when set, else main/master (local,
   * then remote-tracking — CI checkouts detach HEAD with no local branches),
   * else the current HEAD's branch.
   */
  async defaultBranch(): Promise<string> {
    try {
      const ref = (await this.run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])).trim()
      const name = ref.replace('refs/remotes/origin/', '')
      if (await this.revParse(`refs/heads/${name}`)) return name
      return `origin/${name}`
    } catch {
      /* no origin/HEAD */
    }
    for (const name of ['main', 'master']) {
      if (await this.revParse(`refs/heads/${name}`)) return name
    }
    for (const name of ['main', 'master']) {
      if (await this.revParse(`refs/remotes/origin/${name}`)) return `origin/${name}`
    }
    const head = (await this.run(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => 'HEAD')).trim()
    return head || 'HEAD'
  }

  async configGet(key: string): Promise<string | null> {
    try {
      return (await this.run(['config', '--get', key])).trim() || null
    } catch {
      return null
    }
  }

  async worktrees(): Promise<WorktreeInfo[]> {
    const out = await this.run(['worktree', 'list', '--porcelain'])
    const result: WorktreeInfo[] = []
    let current: Partial<WorktreeInfo> = {}
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length), branch: null }
      else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length)
      else if (line === '' && current.path) {
        result.push(current as WorktreeInfo)
        current = {}
      }
    }
    if (current.path) result.push(current as WorktreeInfo)
    return result
  }

  async hashObject(content: string): Promise<string> {
    return (await this.run(['hash-object', '-w', '--stdin'], { input: content })).trim()
  }

  /**
   * Build a tree that is `baseCommit`'s tree with one blob replaced, without
   * touching any index or working tree the user owns.
   */
  async writeTreeWithBlob(baseCommit: string, path: string, blobOid: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'agentic-index-'))
    const indexFile = join(dir, 'index')
    try {
      const env = { GIT_INDEX_FILE: indexFile }
      await this.run(['read-tree', baseCommit], { env })
      await this.run(['update-index', '--add', '--cacheinfo', `100644,${blobOid},${path}`], { env })
      return (await this.run(['write-tree'], { env })).trim()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async commitTree(tree: string, parent: string, message: string, identity?: { name: string; email: string }): Promise<string> {
    const env = identity
      ? {
          GIT_AUTHOR_NAME: identity.name,
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_COMMITTER_NAME: identity.name,
          GIT_COMMITTER_EMAIL: identity.email,
        }
      : undefined
    return (await this.run(['commit-tree', tree, '-p', parent, '-m', message], env ? { env } : {})).trim()
  }

  /**
   * Atomic compare-and-swap ref update. Returns false when the ref no longer
   * points at `expectedOld` — the caller re-reads and re-presents.
   */
  async updateRefCAS(ref: string, newOid: string, expectedOld: string): Promise<boolean> {
    try {
      await this.run(['update-ref', ref, newOid, expectedOld])
      return true
    } catch {
      return false
    }
  }

  async diff(base: string, head: string, pathspec: string[] = []): Promise<string> {
    const args = ['diff', '--no-color', `${base}...${head}`]
    if (pathspec.length) args.push('--', ...pathspec)
    return this.run(args)
  }
}
