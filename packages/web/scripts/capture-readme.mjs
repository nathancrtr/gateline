// Capture the README's five frames from a running `gateline ui` (docs/images/README.md).
//
//   node web/scripts/capture-readme.mjs http://127.0.0.1:4312 ../docs/images
//
// A real Chromium at the 1728×963 viewport the README recipe names, each page
// awaited on the element that proves it has rendered rather than on a timer,
// the "orchestrator not running" alert hidden as the README discloses. Frames
// are saved at native size; scaling, padding and the GIF are ffmpeg's job and
// stay in the recipe.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [base = 'http://127.0.0.1:4312', out = '../docs/images'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })

const FRAMES = [
  { name: 'inbox', path: '/', ready: '[data-inbox-row]' },
  { name: 'portfolio', path: '/portfolio', ready: 'tbody tr' },
  { name: 'run-escalation', path: '/runs/gateline/csvpeek', ready: '[data-needs-card]' },
  { name: 'run-record', path: '/runs/gateline/fleetview-design?tab=record', ready: '.prose-artifact' },
  { name: 'metrics', path: '/metrics', ready: 'tbody tr', timeout: 120_000 },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1728, height: 963 }, deviceScaleFactor: 1 })
await page.addStyleTag({ content: 'main [role="alert"] { display: none }' }).catch(() => {})
for (const f of FRAMES) {
  await page.goto(base + f.path, { waitUntil: 'networkidle' })
  await page.waitForSelector(f.ready, { timeout: f.timeout ?? 30_000 })
  await page.addStyleTag({ content: 'main [role="alert"] { display: none }' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${f.name}.png`), fullPage: false })
  console.log('captured', f.name)
}
await browser.close()
