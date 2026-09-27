// Re-take the captures in captures/ from the built page, at a device scale factor of 1.
// Run after build.py:  node capture.mjs
// The before capture comes from the first-pass page, which is not in the repository:
//   node capture.mjs --before <path to the first-pass page>
// Each line printed says whether the page overflowed the window and how many font faces loaded or failed.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(new URL('../../../packages/package.json', import.meta.url))
const { chromium } = require('@playwright/test')

const before = process.argv[2] === '--before' ? resolve(process.argv[3] ?? '') : null
const page = before ?? here + 'index.html'
if (!existsSync(page)) { console.error(`${page} is missing${before ? '' : ': run python3 build.py first'}`); process.exit(2) }
mkdirSync(here + 'captures', { recursive: true })

const toItem = n => p => p.evaluate(n => document.querySelector(`[data-item][data-n="${n}"]`).scrollIntoView(), n)
const shots = before
  ? [['before-first-pass-1440', 1440, 900]]
  : [
      ['phone-390', 390, 844],
      ['phone-390-assumption', 390, 844, toItem(1)],
      ['laptop-1280', 1280, 800],
      ['laptop-1280-brief', 1280, 800, p => p.evaluate(() => document.getElementById('brief').scrollIntoView())],
      ['after-1440', 1440, 900],
      ['roster-open-1440', 1440, 900, p => p.evaluate(() => { document.querySelector('.req details').open = true; document.querySelector('[data-section="Requirements"]').scrollIntoView() })],
      ['wide-1920', 1920, 1080],
    ]

const browser = await chromium.launch()
for (const [name, width, height, act] of shots) {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await tab.goto(pathToFileURL(page).href)
  await tab.evaluate(() => document.fonts.ready)
  await tab.waitForTimeout(150)
  if (act) { await act(tab); await tab.waitForTimeout(150) }
  await tab.screenshot({ path: `${here}captures/${name}.png` })
  const r = await tab.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    loaded: [...document.fonts].filter(f => f.status === 'loaded').length,
    failed: [...document.fonts].filter(f => f.status === 'error').length,
    pane: !!document.querySelector('.reference')?.offsetParent,
  }))
  console.log(`${name.padEnd(24)} ${width}x${height}  overflow ${r.overflow}  fonts loaded ${r.loaded}, failed ${r.failed}  brief pane ${r.pane}`)
  await tab.close()
}
await browser.close()
