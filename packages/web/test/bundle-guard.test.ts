/**
 * The bundle guard's own test (#317).
 *
 * `scripts/check-bundle.mjs` fails the build when a node builtin reaches the
 * browser bundle. Its first draft matched `node:` followed by any letters and
 * fired on minified object literals (`{node:l}`, `{node:null}`) — a guard that
 * cries wolf gets deleted, and one that matches nothing passes forever. So the
 * patterns are tested from both sides: real leaks are caught, and the shapes
 * that made it noisy stay quiet.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain .mjs script, no type declarations
import { scan } from '../scripts/check-bundle.mjs'

const hits = (text: string): string[] => (scan(text) as { text: string }[]).map((h) => h.text)

describe('bundle guard', () => {
  it('catches the scheme form as a quoted specifier', () => {
    expect(hits('import{x}from"node:child_process";')).toContain('"node:child_process"')
    expect(hits("const f=require('node:fs');")).toContain("'node:fs'")
    expect(hits('await import("node:fs/promises")')).toContain('"node:fs/promises"')
  })

  it('catches a bare builtin in a resolving position', () => {
    expect(hits('import{spawn}from"child_process";').length).toBe(1)
    expect(hits('require("path")').length).toBe(1)
  })

  it('stays quiet on minified object literals — the false positives that made it noisy', () => {
    expect(hits('{node:l,foo:1}')).toEqual([])
    expect(hits('e={node:null}')).toEqual([])
    expect(hits('t.node:x')).toEqual([])
  })

  it('stays quiet on ordinary words that happen to be builtin names', () => {
    expect(hits('const path="/api/runs";')).toEqual([])
    expect(hits('{ url: "https://example.test", os: "mac" }')).toEqual([])
    expect(hits('label("stream")')).toEqual([])
  })

  it('finds every leak in one chunk, not just the first', () => {
    expect(hits('import"node:fs";import"node:os";require("child_process")').length).toBe(3)
  })
})
