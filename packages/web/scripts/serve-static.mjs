#!/usr/bin/env node
// A Pages-like static server (plan ADR-7, "Pages-like static server"): a
// model of the file host's own rules — GET/HEAD only, MIME by extension, a
// directory serving its own index.html, a directory request missing its
// trailing slash redirecting to it (query string preserved), and a missing
// path answering with the root's own 404.html when one exists. node:http
// and node:fs only — no dependencies, and no relation to `main.ts`'s
// `startServer` (this never mounts an API, only ever reads files under
// `--root`).
//
// node web/scripts/serve-static.mjs --root <dir> --port <n>
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

// Reuses the table shape `server/src/main.ts`'s MIME map uses (same
// extensions, same fallback) — kept as a sibling literal rather than an
// import so this script never reaches into `server` (it must stay a plain
// static host, not a second server).
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

function parseArgs(argv) {
  let root
  let port
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') root = argv[++i]
    else if (a === '--port') port = argv[++i] === undefined ? undefined : Number(argv[i])
  }
  if (!root || !port || Number.isNaN(port)) {
    throw new Error('usage: node serve-static.mjs --root <dir> --port <n>')
  }
  return { root: resolve(root), port }
}

/** Answers 404, with `<root>/404.html` as the body when that file exists
 * (content-type text/html), else a plain-text body. */
async function send404(res, root, method) {
  try {
    const body = await readFile(join(root, '404.html'))
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end(method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end(method === 'HEAD' ? undefined : '404 not found')
  }
}

/** Resolves `pathname` under `root`, refusing anything that escapes it
 * (a `..` segment, an absolute override, or a symlink is not followed —
 * this is a plain path join, checked against the root by prefix). Returns
 * `null` when the resolved path is not under `root`. */
function resolveUnderRoot(root, pathname) {
  const resolved = resolve(join(root, pathname))
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null
  return resolved
}

async function handleRequest(req, res, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end(`405 method not allowed: ${req.method}`)
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    await send404(res, root, req.method)
    return
  }

  const resolved = resolveUnderRoot(root, pathname)
  if (resolved === null) {
    await send404(res, root, req.method)
    return
  }

  let st
  try {
    st = await stat(resolved)
  } catch {
    await send404(res, root, req.method)
    return
  }

  if (st.isDirectory()) {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { location: `${pathname}/${url.search}` })
      res.end()
      return
    }
    try {
      const body = await readFile(join(resolved, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      await send404(res, root, req.method)
    }
    return
  }

  const body = await readFile(resolved)
  const contentType = MIME[extname(resolved)] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': contentType })
  res.end(req.method === 'HEAD' ? undefined : body)
}

const { root, port } = parseArgs(process.argv.slice(2))
const server = createServer((req, res) => {
  handleRequest(req, res, root).catch((e) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(e && e.message ? e.message : e))
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`serve-static: http://127.0.0.1:${port} ← ${root}`)
})
