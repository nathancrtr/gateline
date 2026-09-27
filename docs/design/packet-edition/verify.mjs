// Verbatim check: the words on the page against the words in the files.
// Run after build.py:  node verify.mjs   (exits 1 on any mismatch)
// Playwright resolves from the repository's packages/ workspace (npm install there once).
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(new URL('../../../packages/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
if (!existsSync(here + 'index.html')) { console.error('index.html is missing: run python3 build.py first'); process.exit(2) }
const norm = s => s.replace(/\\$/gm, '').replace(/\*\*|`/g, '').replace(/^\s*- (\[.\] )?/gm, '').replace(/\s+/g, ' ').trim()
const spec = readFileSync(here + 'data/spec.md', 'utf8').split('\n'), brief = readFileSync(here + 'data/intent-brief.md', 'utf8').split('\n')
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(pathToFileURL(here + 'index.html').href); await page.evaluate(() => document.fonts.ready)
await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true))
const got = await page.evaluate(() => {
  const parts = li => [...li.querySelectorAll('.part')].map((p, i) => p.querySelector('.label').textContent + (li.classList.contains('crit') && i === 0 ? ' — ' : ' ') + p.querySelector('.value').textContent).join(' ')
  return {
    items: [...document.querySelectorAll('.item[data-kind="Assumption"]')].map(li => ({ line: +li.querySelector('.addr-line').textContent, text: parts(li) })),
    crits: [...document.querySelectorAll('.crit')].map(li => ({ line: +li.querySelector('.addr-line').textContent, text: parts(li) })),
    reqs: [...document.querySelectorAll('.req')].map(li => ({ line: +li.querySelector('.addr-line').textContent, text: '### ' + li.querySelector('summary .name').textContent + ' — ' + li.querySelector('.req-name').textContent })),
    // The brief is on the page twice, in the pinned pane and in sequence. Both copies are checked.
    pres: [...document.querySelectorAll('.brief pre')].map(p => ({ rows: [...p.querySelectorAll('.ln')].map(s => s.textContent.replace(/​/g, '')).join('\n'), src: p.dataset.src })),
    paras: [...document.querySelectorAll('.brief [data-line], .foldrow [data-line], .statement [data-line]')].filter(e => e.tagName !== 'PRE').map(e => ({ file: e.closest('.brief') ? 'brief' : 'spec', line: +e.dataset.line, text: e.textContent })),
  }
})
let bad = 0
const until = (lines, i, stop) => { let j = i + 1; while (j < lines.length && !stop(lines[j])) j++; return lines.slice(i, j).join('\n') }
const cmp = (kind, line, src, text) => { if (norm(src) !== norm(text)) { bad++; console.log(kind, 'MISMATCH at', line, '\n src:', norm(src).slice(0, 140), '\n got:', norm(text).slice(0, 140)) } }
for (const it of got.items) cmp('ASSUMPTION', it.line, until(spec, it.line - 1, l => /^- \*\*ASSUMPTION/.test(l) || !l.trim()), it.text)
for (const c of got.crits) cmp('CRITERION', c.line, until(spec, c.line - 1, l => /^- \[/.test(l) || !l.trim() || /^#/.test(l)), c.text)
for (const r of got.reqs) cmp('REQUIREMENT', r.line, spec[r.line - 1], r.text)
for (const p of got.paras) { const L = p.file === 'brief' ? brief : spec; cmp(p.file.toUpperCase() + ' PASSAGE', p.line, until(L, p.line - 1, l => !l.trim() || /^- /.test(l) || /^```/.test(l) || /^\*\*Acceptance/.test(l)), p.text) }
const f = brief.findIndex(l => l.startsWith('```')); const fence = brief.slice(f + 1, brief.indexOf('```', f + 1)).join('\n')
if (!got.pres.length) { bad++; console.log('CODE BLOCK MISSING') }
for (const pre of got.pres) if (fence !== pre.rows || fence !== pre.src) { bad++; console.log('CODE BLOCK MISMATCH', JSON.stringify(fence), JSON.stringify(pre.rows)) }
console.log(`checked ${got.items.length} assumptions, ${got.crits.length} criteria, ${got.reqs.length} requirement headings, ${got.paras.length} passages, ${got.pres.length} code blocks (line for line) — mismatches: ${bad}`)
await browser.close()
process.exitCode = bad ? 1 : 0
