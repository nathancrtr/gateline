// E2E smoke (plan §9): inbox → gate card → approve → the commit exists with
// the right author, message, and preserved YAML comments; the bounce view
// offers no approval; the keyboard loop drives a decision end-to-end.
import { type ChildProcess, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { spawnDemoServer } from './demo-server.ts'

let fixtureDir: string
let server: ChildProcess
let ORIGIN: string

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

/** Navigates against this file's own server — never one another suite
 *  started (demo-server.ts, #438). */
const goto = (page: Page, path: string) => page.goto(ORIGIN + path)

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  ;({ server, origin: ORIGIN } = await spawnDemoServer(fixtureDir))
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

test('inbox ranks oldest first and flags bounced packets', async ({ page }) => {
  await goto(page, '/')
  const rows = page.locator('[data-inbox-row]')
  await expect(rows.first()).toContainText('escalated')
  const bounced = rows.filter({ hasText: 'malformed-spec' })
  await expect(bounced).toContainText('Bounced')
})

test('inbox rows compose their lines from facts (#433)', async ({ page }) => {
  await goto(page, '/')
  const rows = page.locator('[data-inbox-row]')
  // A gate row is the gate and its question; nothing restates the slug.
  const gate = rows.filter({ hasText: /\/g2-pending/ })
  await expect(gate.locator('[data-inbox-title]')).toHaveText('G2 — Does the evidence support merging?')
  await expect(gate.locator('[data-inbox-line]')).toHaveCount(0)
  // An escalation row names who escalated — no pointer, no filename.
  const escalation = rows.filter({ hasText: /\/escalated/ })
  await expect(escalation.locator('[data-inbox-title]')).toHaveText('Escalation from verifier')
  await expect(escalation).not.toContainText('.md')
  // Its reason is the verifier's own words, not a pointer: the row keeps it.
  await expect(escalation.locator('[data-inbox-line]')).toContainText('sample input referenced by the spec does not exist')
  // A paused row quotes the reason after a UI word and says what it spent.
  const paused = rows.filter({ hasText: /\/paused-budget/ })
  await expect(paused.locator('[data-inbox-title]')).toHaveText('Run paused budget-exhausted')
  await expect(paused.locator('[data-quoted-word="budget-exhausted"]')).toBeVisible()
  await expect(paused.locator('[data-inbox-line]')).toHaveText('$10.40 spent · limit $10.00')
  const cap = rows.filter({ hasText: /\/round-cap/ })
  await expect(cap.locator('[data-inbox-title]')).toHaveText('Round cap reached on 01-core')
  await expect(cap.locator('[data-inbox-line]')).toHaveText('review rounds 3/3 without convergence')
})

test('the paused card states its budget with the key as an address, then the instruction (#433)', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/paused-budget?decide=paused`)
  const card = page.locator('[data-needs-card]')
  await expect(card.locator('[data-paused-budget]')).toHaveText('$10.40 spent · limit $10.00, set by cost_limit_usd')
  await expect(card.locator('[data-paused-budget] [data-address]')).toHaveText('cost_limit_usd')
  await expect(card.locator('[data-instruction]')).toContainText('Resume with a higher limit')
})

test('bounce view renders problems and offers no approval (R3)', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/malformed-spec?decide=G0`)
  const card = page.locator('[data-needs-card]')
  await expect(card).toContainText('missing required sections')
  await expect(card.locator('[data-decide="approve"]')).toHaveCount(0)
  await expect(card).toContainText('no approval is offered')
})

test('bounce view at G3 (#260): a thin release plan is malformed, not ready', async ({ page }) => {
  // The last gate to get a checkable packet. Before contracts/release-plan.md
  // existed, a release plan of one line passed on presence alone.
  await goto(page, `/runs/${sourceId()}/malformed-release?decide=G3`)
  const card = page.locator('[data-needs-card]')
  await expect(card).toContainText('missing required sections')
  await expect(card).toContainText('Rollback plan')
  await expect(card.locator('[data-decide="approve"]')).toHaveCount(0)
})

test('G0 packet (#440): Assumptions lead, the roster names each requirement, the brief sits beside', async ({ page }) => {
  // Before the decision loop below approves this run's G0: after it, there is no G0 card to read.
  await goto(page, `/runs/${sourceId()}/g0-pending?decide=G0`)
  const packet = page.locator('[data-g0-packet]')
  await expect(packet).toContainText('G0 packet — composed from the record')
  const assumption = packet.locator('[data-assumption]').first()
  await expect(assumption).toContainText('ASSUMPTION: input fits in memory')
  await expect(packet.locator('[data-requirement="R1"]')).toContainText('Core behavior')
  await expect(packet.locator('[data-requirement="R2"]')).toContainText('Error handling')
  await expect(packet.locator('[data-g0-section="problem"]')).toContainText('The CSV importer workflow is manual')
  await expect(packet.locator('[data-g0-section="constraints"]')).toContainText('Must run offline')

  // Out of scope is audit-time for G0: folded, and opened in place, verbatim.
  const fold = packet.locator('[data-g0-fold="out-of-scope"]')
  await expect(fold).toHaveAttribute('data-open', 'false')
  await expect(fold).not.toContainText('Concurrency')
  await fold.getByRole('button').click()
  await expect(fold).toContainText('Concurrency; internationalization.')

  // The assumption's line is one gesture away, and one click lands on the spec in the reader.
  await assumption.hover()
  const address = assumption.locator('[data-address]')
  await expect(address).toHaveText(/^spec\.md:\d+$/)
  await address.click()
  await expect(page).toHaveURL(/tab=record&artifact=spec\.md/)
  await expect(page.locator('[data-reader] article')).toContainText('input fits in memory')
})

test('a G0 quotation’s address lands on its line in the reader, its fold open (#441)', async ({ page }) => {
  // Short enough that the spec overflows the reader: a landing that did not
  // scroll would leave Out of scope below the fold of the window.
  await page.setViewportSize({ width: 1280, height: 420 })
  const packet = page.locator('[data-g0-packet]')
  const landed = page.locator('[data-reader] article [data-landed]')
  const address = async (quote: string) => {
    const at = packet.locator(quote).locator('[data-at] [data-address]')
    await packet.locator(quote).hover()
    const text = (await at.textContent())!
    await at.click()
    return Number(text.split(':')[1])
  }

  // An Assumption: a list item in a decide-time section of the spec.
  await goto(page, `/runs/${sourceId()}/g0-pending?decide=G0`)
  let line = await address('[data-assumption]')
  await expect(page).toHaveURL(new RegExp(`artifact=spec\\.md&anchor=L${line}$`))
  await expect(landed).toHaveCount(1)
  await expect(landed).toContainText('input fits in memory')
  await expect(landed).toHaveAttribute('data-line', String(line))
  await expect(landed).toBeInViewport()

  // Out of scope: audit-time, so the reader folds it — the landing opens it.
  await goto(page, `/runs/${sourceId()}/g0-pending?decide=G0`)
  await packet.locator('[data-g0-fold="out-of-scope"]').getByRole('button').click()
  line = await address('[data-quote="out-of-scope"]')
  await expect(page).toHaveURL(new RegExp(`artifact=spec\\.md&anchor=L${line}$`))
  await expect(landed).toHaveText('Concurrency; internationalization.')
  await expect(page.locator('[data-reader] details[data-fold="Out of scope"]')).toHaveJSProperty('open', true)
  await expect(landed).toBeInViewport()

  // A brief section: the intent brief renders whole, numbered from its line 1.
  await goto(page, `/runs/${sourceId()}/g0-pending?decide=G0`)
  line = await address('[data-quote="constraints"]')
  await expect(page).toHaveURL(new RegExp(`artifact=intent-brief\\.md&anchor=L${line}$`))
  await expect(landed).toHaveText('Must run offline; none otherwise known.')
  await expect(landed).toBeInViewport()
})

test('the pointer decision loop: approve G0 with burden → correct commit', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g0-pending?decide=G0`)
  const card = page.locator('[data-needs-card]').first()
  await card.locator('[data-decide="approve"]').click()
  await card.getByText('Light correction').click()
  await card.getByPlaceholder(/Notes \(optional\)/).fill('spec is right; two ACs tightened')
  await card.locator('[data-decide="approve-confirm"]').click()
  await expect(card.getByRole('status')).toContainText(/committed [0-9a-f]{10}/)

  const subject = git(['log', '-1', '--format=%s %an', 'run/g0-pending']).trim()
  expect(subject).toBe('state(g0-pending): G0 approved by Fixture Operator [burden: light-correction] Fixture Operator')
  const state = git(['show', 'run/g0-pending:runs/g0-pending/state.yaml'])
  expect(state).toContain('# a gate entry is written ONLY by the named human')
  expect(state).toContain('burden: light-correction')
  expect(state).toMatch(/phase: plan/)
})

// Ordered before the keyboard-loop test below, which approves this very
// gate: once G1 is decided there is no G1 card left to compose a packet
// for. The file already runs in declaration order for the same reason.
test('G1 packet (#255): coverage and parallel safety, composed from the record', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g1-pending?decide=G1`)
  const packet = page.locator('[data-g1-packet]')
  await expect(packet).toBeVisible()

  // AC1 — every requirement the spec defines appears, and the one no mapping
  // row names leads and says so.
  const coverage = packet.locator('[data-g1-coverage] [data-coverage]')
  await expect(coverage).toHaveCount(3)
  await expect(coverage.first()).toHaveAttribute('data-coverage', 'R3')
  await expect(coverage.first()).toContainText('no task')
  await expect(packet.locator('[data-uncovered]')).toContainText('1 requirement appears in no row')
  // …and a covered one names the task the plan mapped it to, verbatim.
  await expect(packet.locator('[data-coverage="R1"]')).toContainText('01-core')
  await expect(packet.locator('[data-unmapped-tasks]')).toContainText('03-cli')

  // AC2 — two independent tasks declaring the same path are flagged; the pair
  // a depends_on orders is shown as ordered rather than hidden.
  await expect(packet.locator('[data-unordered]')).toContainText('1 pair of tasks declares')
  const unordered = packet.locator('[data-overlap][data-ordered="false"]')
  await expect(unordered).toHaveCount(1)
  await expect(unordered).toContainText('01-core ↔ 02-errors')
  await expect(unordered).toContainText('src/shared.py')
  await expect(packet.locator('[data-overlap][data-ordered="true"]')).toContainText('ordered by depends_on')

  // AC3 — ADR cards show the Choice line, with the argument one click away and
  // byte-identical to the artifact.
  const adr = packet.locator('[data-adr="ADR-1"]')
  await expect(adr).toContainText('keep all logic in a pure function')
  await expect(adr).not.toContainText('untestable')
  await adr.getByRole('button').click()
  await expect(adr).toContainText('- **Rejected:** logic in the CLI handler — untestable.')
  // An amended ADR carries its qualifier — which of two is the live one.
  await expect(packet.locator('[data-adr="ADR-2"]')).toContainText('amended 2026-07-06')
})

test('the keyboard loop: a → 1 → approve on the primary card', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g1-pending?decide=G1`)
  const card = page.locator('[data-needs-card]').first()
  await expect(card.locator('[data-decide="approve"]')).toBeVisible()
  await page.keyboard.press('a')
  await page.keyboard.press('1')
  await expect(card.getByText('Confirmation')).toBeVisible()
  await card.locator('[data-decide="approve-confirm"]').click()
  await expect(card.getByRole('status')).toContainText(/committed/)
  const state = git(['show', 'run/g1-pending:runs/g1-pending/state.yaml'])
  expect(state).toContain('burden: confirmation')
})

test('portfolio and metrics render', async ({ page }) => {
  await goto(page, '/portfolio')
  await expect(page.getByRole('table')).toContainText('done-merged')
  await goto(page, '/metrics')
  await expect(page.getByText('Gate decisions')).toBeVisible()
  await expect(page.getByText('Budget honesty')).toBeVisible()
})

test('run lexicon (#163): ids resolve to verbatim hover cards and jump to their definition', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=verification-report.md`)
  await expect(page.locator('.lex-cited > summary')).toContainText('Cites AC1.1, AC2.1')
  const ref = page.locator('.prose-artifact .lex-ref', { hasText: 'AC1.1' }).first()
  await ref.hover()
  const card = ref.locator('.lex-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('acceptance criterion')
  // Verbatim from the fixture spec — the card quotes, never paraphrases.
  await expect(card).toContainText('running the tool on sample input produces the documented output')
  await card.locator('.lex-card-jump').click()
  await expect(page).toHaveURL(/artifact=spec\.md/)
  await expect(page.locator('#def-R1')).toContainText('Core behavior')
  // Definition sites are not self-links: the R1 heading and the AC1.1 bullet
  // in spec.md render their own ids as plain text, while citations of ids
  // defined elsewhere (ADR-1, from plan.md) still resolve.
  await expect(page.locator('#def-R1 .lex-ref')).toHaveCount(0)
  await expect(page.locator('.prose-artifact li .lex-ref', { hasText: 'AC1.1' })).toHaveCount(0)
})

test('Record reader (#312): a clipped artifact shows a scroll cue, and a fitting one shows none', async ({ page }) => {
  // g2-pending's brief carries one unbreakable path, so the reader overflows
  // it at every supported width; plan.md fits everywhere. The second half is
  // the one that used to be false: before #308 the idle lexicon card was laid
  // out beside every reference, and a cue off `scrollWidth` would have fired
  // on 12px of phantom overflow at 1024px with nothing to scroll to.
  for (const width of [800, 900, 1000]) {
    await page.setViewportSize({ width, height: 900 })
    await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=intent-brief.md`)
    await expect(page.locator('[data-reader]')).toBeVisible()
    await expect(page.locator('[data-scroll-cue="right"]'), `${width}px: cue on the clipped edge`).toBeVisible()
    await expect(page.locator('[data-scroll-cue="left"]')).toHaveCount(0)
  }
  for (const width of [800, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=plan.md`)
    await expect(page.locator('[data-reader] .prose-artifact')).toBeVisible()
    await expect(page.locator('[data-scroll-cue]'), `${width}px: no cue on an artifact that fits`).toHaveCount(0)
  }
})

test('run lexicon (#311): a card opened near the reader\'s right edge stays inside the reader', async ({ page }) => {
  // The geometry sweep never hovers, so this is the one place a *revealed*
  // card is measured. plan.md at 800px is the issue's worst case: the
  // rightmost reference used to open a card 108px past the pane.
  for (const width of [800, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=plan.md`)
    await expect(page.locator('.prose-artifact .lex-ref').first()).toBeVisible()
    const index = await page.evaluate(() => {
      const refs = [...document.querySelectorAll('.prose-artifact .lex-ref')]
      let best = 0
      refs.forEach((el, i) => {
        if (el.getBoundingClientRect().right > refs[best]!.getBoundingClientRect().right) best = i
      })
      return best
    })
    const ref = page.locator('.prose-artifact .lex-ref').nth(index)
    await ref.hover()
    const card = ref.locator('.lex-card')
    await expect(card).toBeVisible()
    const { cardLeft, cardRight, paneLeft, paneRight } = await card.evaluate((el) => {
      let pane = el.parentElement
      while (pane && getComputedStyle(pane).overflowX === 'visible') pane = pane.parentElement
      const c = el.getBoundingClientRect()
      const p = pane!.getBoundingClientRect()
      return { cardLeft: c.left, cardRight: c.right, paneLeft: p.left, paneRight: p.right }
    })
    expect(cardRight, `${width}px: card right edge inside the reader`).toBeLessThanOrEqual(paneRight)
    expect(cardLeft, `${width}px: card left edge inside the reader`).toBeGreaterThanOrEqual(paneLeft)
  }
})

test('audit-time sections fold to their heading and open verbatim (#217)', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=review-01.md`)
  const reader = page.locator('[data-reader]')
  // Decide-time: Findings renders open, as it always did.
  await expect(reader.getByRole('heading', { name: 'Findings' })).toBeVisible()
  // Audit-time: Coverage and Boundary check fold to heading plus count.
  const coverage = reader.locator('details[data-fold="Coverage"]')
  await expect(coverage).toBeVisible()
  expect(await coverage.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)
  await expect(coverage.locator('summary')).toContainText(/\d+ (paragraph|row|item)/)
  // The sentence's tail, past the R1–R2 references the lexicon wraps in spans.
  await expect(reader.getByText('error paths exercised by reading')).toBeHidden()
  await expect(reader.locator('details[data-fold="Boundary check"]')).toBeVisible()
  // One click: the section's own words, verbatim.
  await coverage.locator('summary').click()
  await expect(reader.getByText('error paths exercised by reading')).toBeVisible()

  // The fold's heading is the heading: the count sits beside it, not in its name.
  await expect(reader.getByRole('heading', { name: 'Coverage', exact: true })).toBeVisible()

  // A two-round review: the appended round's own heading and verdict render
  // open, never inside the previous round's Boundary check fold.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=review-02.md`)
  await expect(page.locator('[data-reader]').getByRole('heading', { name: 'Round 2', exact: true })).toBeVisible()
  await expect(page.locator('[data-reader] details[data-fold="Coverage"]')).toHaveCount(2)
  await expect(page.locator('[data-reader] details[data-fold="Boundary check"]').first()).not.toContainText('Round 2')

  // The spec folds Out of scope and nothing else.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=spec.md`)
  await expect(page.locator('[data-reader] details[data-fold]')).toHaveCount(1)
  await expect(page.locator('[data-reader] details[data-fold="Out of scope"]')).toBeVisible()
  await expect(page.locator('[data-reader]').getByRole('heading', { name: 'Requirements' })).toBeVisible()

  // A contract with no annotation folds nothing: the intent brief carries none.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=intent-brief.md`)
  await expect(page.locator('[data-reader] .prose-artifact').first()).toBeVisible()
  await expect(page.locator('[data-reader] details[data-fold]')).toHaveCount(0)
})

test('verification verdict (#152): the G2 surface quotes the report\'s verdict and its non-verified rows', async ({ page }) => {
  // The run that escalated carries the report that did it.
  await goto(page, `/runs/${sourceId()}/escalated?tab=record&artifact=verification-report.md`)
  const rollup = page.locator('[data-evidence-rollup]').first()
  await expect(rollup).toBeVisible()
  await expect(rollup.locator('[data-report-verdict="escalate"]')).toContainText('“escalate”')
  const notVerified = rollup.locator('[data-not-verified]')
  await expect(notVerified).toContainText('one criterion')
  await expect(notVerified).toContainText('AC2.1')
  await expect(notVerified).toContainText('“unverifiable”')
  await expect(notVerified).not.toContainText('AC1.1')

  // A clean report states pass and lists nothing.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=verification-report.md`)
  const clean = page.locator('[data-evidence-rollup]').first()
  await expect(clean.locator('[data-report-verdict="pass"]')).toBeVisible()
  await expect(clean.locator('[data-not-verified]')).toHaveCount(0)

  // And the verdict is on the G2 card itself, where the decision is made —
  // not only on the report's own page.
  await goto(page, `/runs/${sourceId()}/g2-pending?decide=G2`)
  await expect(page.locator('[data-g2-packet] [data-report-verdict="pass"]')).toContainText('“pass”')

  // A report from before the verdict line says so, rather than showing nothing.
  await goto(page, `/runs/${sourceId()}/forked-contract?decide=G2`)
  await expect(page.locator('[data-g2-packet] [data-report-verdict=""]')).toContainText('no overall verdict')
})

test('run lexicon (#308): the idle card takes no space, and the keyboard still opens it', async ({ page }) => {
  // #308 made the idle card `display: none` instead of `visibility: hidden`,
  // which had left 416px of nothing laid out beside every reference on the page.
  // The reachability question that made it more than a one-liner: a
  // `display: none` subtree is not focusable, so if the keyboard reached the
  // card by tabbing *into* it the toggle would have locked it out. It does not
  // — the reference itself carries the tabindex, focusing it displays the card,
  // and only then does the jump link enter the tab order. This test is that
  // sequence, in order, because each step depends on the one before.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=verification-report.md`)
  const ref = page.locator('.prose-artifact .lex-ref', { hasText: 'AC1.1' }).first()
  await expect(ref).toBeVisible()
  const card = ref.locator('.lex-card')
  // Idle: hidden *and* occupying nothing. `toBeHidden` alone passed on the
  // phantom, which is why the defect survived to a design review.
  await expect(card).toBeHidden()
  expect(await card.evaluate((el) => el.getBoundingClientRect().width)).toBe(0)

  await ref.focus()
  await expect(card).toBeVisible()
  // A column, not a block: the card is `flex-col`, so the reveal has to restore
  // `display: flex` — `block` would stack its rows with the wrong box model.
  expect(await card.evaluate((el) => getComputedStyle(el).display)).toBe('flex')

  await page.keyboard.press('Tab')
  await expect(page.locator('.lex-card-jump:focus')).toHaveCount(1)
  await expect(card).toBeVisible() // :focus-within holds it open
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/artifact=spec\.md/)
})

test('evidence rollup (#165): uncited criteria are the headline; anchors jump to the evidence block', async ({ page }) => {
  // The one-line citation map now lives where the report itself is on screen;
  // G2's decision card carries the composed packet instead (#256).
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=verification-report.md`)
  const rollup = page.locator('[data-evidence-rollup]').first()
  await expect(rollup).toContainText('No verification evidence cites:')
  await expect(rollup).toContainText('AC2.2')
  await expect(rollup).toContainText('report states')
  // No computed judgment anywhere — the only verdict text is the report's own words.
  await rollup.getByRole('link', { name: 'E1', exact: true }).click()
  await expect(page).toHaveURL(/artifact=verification-report\.md/)
  await expect(page.locator('#def-E1')).toBeVisible()
})

test('G2 packet (#256): the gate opens on a criterion-ordered surface, not a file listing', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  const packet = page.locator('[data-g2-packet]')
  await expect(packet).toBeVisible()

  // Spec order, with the uncited criterion promoted to the headline: a fact
  // about the record, computed from it, never a score.
  const criteria = packet.locator('[data-criterion]')
  await expect(criteria).toHaveCount(3)
  await expect(criteria.nth(0)).toHaveAttribute('data-criterion', 'AC2.2')
  await expect(criteria.nth(1)).toHaveAttribute('data-criterion', 'AC1.1')
  await expect(criteria.nth(2)).toHaveAttribute('data-criterion', 'AC2.1')

  // AC2.2 — cited by no evidence, and named in the report's own Gaps line.
  const ac22 = criteria.nth(0)
  await expect(ac22).toContainText('No verification evidence cites it')
  await expect(ac22).toContainText('AC2.2 not verified — the fixture corpus has no oversized sample.')
  // The criterion is quoted from spec.md, not paraphrased.
  await expect(ac22).toContainText('input larger than the documented cap is rejected before parsing')

  // AC1.1 — the report's verdict quoted and attributed, its E-block inline and
  // byte-identical, its transcript included.
  const ac11 = criteria.nth(1)
  await expect(ac11).toContainText('verification-report.md states')
  await expect(ac11).toContainText('“verified”')
  // The block is quoted as what its markdown encodes, not as its markdown
  // (#282): the transcript is a code block, and the fence rows that delimit it
  // are syntax rather than content.
  const block = ac11.locator('[data-evidence-block="E1"]')
  await expect(block.locator('pre')).toBeVisible()
  await expect(block).toContainText('$ tool sample.txt')
  await expect(block).toContainText('ok (3 records)')
  await expect(block).not.toContainText('```')
  // `### E1 — AC1.1` restates the two things this card already carries verbatim
  // — the block's own label and the criterion it proves — so the heading is
  // dropped rather than printed. What makes that a fold and not a deletion is
  // that both are still on screen, which is asserted here and not assumed. A
  // heading saying anything beyond the restatement keeps the extra words (minus
  // its hashes); this fixture writes neither E-heading that way, so that
  // direction is covered by packages/web/test/packet.test.ts instead.
  await expect(block).not.toContainText('###')
  await expect(block).not.toContainText('E1 — AC1.1')
  await expect(block.locator('summary')).toContainText('E1')
  await expect(ac11).toHaveAttribute('data-criterion', 'AC1.1')

  // AC2.1 — the findings that cite it, in the reports' own severity order, and
  // a resolved finding still present rather than dropped.
  const ac21 = criteria.nth(2)
  const findings = ac21.locator('[data-finding]')
  await expect(findings).toHaveCount(2)
  await expect(findings.nth(0)).toHaveAttribute('data-finding', 'F1')
  await expect(findings.nth(0)).toContainText('blocking')
  await expect(findings.nth(0)).toContainText('resolved (round 2)')
  await expect(findings.nth(1)).toContainText('stands (round 2)')

  // Every word stays reachable: the block links back to the report it came from.
  await block.getByRole('link', { name: /verification-report\.md:\d+/ }).click()
  await expect(page).toHaveURL(/artifact=verification-report\.md/)
  await expect(page.locator('#def-E1')).toBeVisible()
})

test('G2 packet (#256): a patch run shows the reviews as the whole packet, with no missing-verifier error', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/patch-g2-pending`)
  const packet = page.locator('[data-g2-packet]')
  await expect(packet).toContainText('patch profile runs no verifier — the reviews are the packet')
  // No verification column, and nothing claiming the record is incomplete.
  await expect(packet.locator('[data-criterion]')).toHaveCount(0)
  await expect(packet).not.toContainText('verification-report.md states')
  await expect(packet).not.toContainText('No verification evidence cites')
  // The reviews carry the decision instead, verdict and all.
  await expect(packet.locator('[data-report="review-01.md"]')).toContainText('approve')
})

test('G2 packet (#256): a forked verification grammar withholds the view and says why', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/forked-contract`)
  const packet = page.locator('[data-g2-packet]')
  // The report passes its contract — the gate is reviewable, not bounced.
  await expect(page.locator('[data-needs-card]')).toContainText('Does the evidence support merging?')
  await expect(page.locator('[data-decide="approve"]')).toHaveCount(1)
  // …but the parser does not guess: it names the grammar it looked for.
  await expect(packet.locator('[data-withheld]')).toContainText('looked for an evidence block headed ### E<k> — AC<n>.<m> in the verification report')
  await expect(packet.locator('[data-criterion]')).toHaveCount(0)
  // Never a claim the record cannot support.
  await expect(packet).not.toContainText('No verification evidence cites')
  // The reviews still render, and the report is one click away.
  await expect(packet.locator('[data-report="review-01.md"]')).toContainText('off-by-one in boundary handling')
  await packet.getByRole('link', { name: 'Open the verification report' }).click()
  await expect(page).toHaveURL(/artifact=verification-report\.md/)
  // The artifact page stands down too, rather than asserting nothing cites AC1.1.
  await expect(page.locator('[data-evidence-withheld]')).toBeVisible()
  await expect(page.locator('[data-evidence-rollup]')).toHaveCount(0)
})

test('decision ledger (#268): History reads decisions and engine verbs, not a commit log', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=history`)
  const ledger = page.locator('[data-ledger]')
  await expect(ledger).toBeVisible()

  // AC1 — a gate decision names its approver and burden, verbatim from the record.
  const approval = ledger.locator('[data-ledger-kind="gate-approved"]').first()
  await expect(approval).toContainText('G1 approved by operator [burden: light-correction]')
  await expect(approval).toHaveAttribute('data-ledger-actor', 'human')

  // AC2 — the orchestrator's verbs are their own entries, attributed to the engine.
  const engineRows = ledger.locator('[data-ledger-actor="orchestrator"]')
  await expect(engineRows.first()).toContainText('engine')
  // Newest-first, so the implementer dispatch leads and the architect's trails.
  await expect(ledger.locator('[data-ledger-kind="dispatched"]')).toHaveCount(2)
  await expect(ledger.locator('[data-ledger-kind="dispatched"]').first()).toContainText('dispatched implementer(01-core)')
  await expect(ledger.locator('[data-ledger-kind="dispatched"]').last()).toContainText('dispatched architect')
  await expect(ledger.locator('[data-ledger-kind="metered"]').first()).toContainText('$1.86')
  // No engine verb may be dressed as a human decision (AGENTS.md: the
  // orchestrator never writes gates.*).
  await expect(ledger.locator('[data-ledger-actor="orchestrator"][data-ledger-kind="gate-approved"]')).toHaveCount(0)

  // AC3 — the phase-transition spine survives.
  await expect(approval).toContainText('implement')

  // AC4 — the raw commit columns are folded, not deleted: reachable on demand.
  await expect(page.getByRole('button', { name: 'show raw commits' })).toBeVisible()
  await page.getByRole('button', { name: 'show raw commits' }).click()
  await expect(page.getByRole('button', { name: 'hide raw commits' })).toBeVisible()
  await expect(approval).toContainText(/[0-9a-f]{7}/)
})

test('decision ledger (#268): a schema-invalid run still renders its ledger (AC5)', async ({ page }) => {
  // bad-state's state.yaml is not valid YAML. Parsing reads commit subjects
  // only, so the ledger must survive what the state parser cannot.
  await goto(page, `/runs/${sourceId()}/bad-state?tab=history`)
  await expect(page.locator('[data-ledger]')).toBeVisible()
  await expect(page.locator('[data-ledger] li').first()).toBeVisible()
})

test('surface-scoped diff (#270): the diff groups by what each work item declared', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record&artifact=@diff`)

  // AC1 — a group per work item, named by the item and the surface it declared.
  const core = page.locator('[data-surface-group="01-core"]')
  await expect(core).toContainText('declared: src/core.py')
  await expect(core).toContainText('def process(text):')
  await expect(page.locator('[data-surface-group="02-errors"]')).toContainText('declared: src/errors.py')

  // AC2 — the undeclared file is called out, and leads the page.
  const undeclared = page.locator('[data-undeclared]')
  await expect(undeclared).toContainText('1 changed file outside every declared contact surface')
  await expect(undeclared).toContainText('src/config.py')
  // Presence, not verdicts: the callout names the Reviewer's section and the
  // approver, and never calls the change a breach.
  await expect(undeclared).toContainText('Boundary check')
  // …and it leads: a boundary the approver has to go looking for is not a check.
  await expect(page.locator('[data-undeclared], [data-surface-group]').first()).toHaveAttribute('data-undeclared')

  // AC3 — reachable: every changed file still renders, grouped or not.
  for (const path of ['src/core.py', 'src/errors.py', 'src/config.py']) {
    await expect(page.getByText(path, { exact: true }).first()).toBeVisible()
  }
})

test('surface-scoped diff (#270): a forked work-item grammar withholds the grouping (AC5)', async ({ page }) => {
  // forked-contract writes its contact surface as a structured block. Every
  // required key is there, so the gate is reviewable — the view stands down and
  // names the grammar rather than reporting every file as out of surface.
  await goto(page, `/runs/${sourceId()}/forked-contract?tab=record&artifact=@diff`)
  await expect(page.locator('[data-surface-withheld]')).toContainText('looked for a list under the key file_contact_surface: in work item 01-core')
  await expect(page.locator('[data-surface-group]')).toHaveCount(0)
  await expect(page.locator('[data-undeclared]')).toHaveCount(0)
  // AC3 — the diff itself is untouched by the scoping standing down.
  await expect(page.getByText('src/pruner.py', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('def prune(paths):')).toBeVisible()
  // The G2 card claims no boundary check it did not run.
  await goto(page, `/runs/${sourceId()}/forked-contract`)
  await expect(page.locator('[data-boundary-check]')).toHaveCount(0)
})

test('surface-scoped diff (#270): G2’s packet carries the boundary fact and routes to it', async ({ page }) => {
  // DESIGN.md §4 puts the diff in G2's packet; #256 deferred its form to #259,
  // which chose this view. The card states the fact and links to the diff.
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  const boundary = page.locator('[data-boundary-check]')
  await expect(boundary).toContainText('3 changed files')
  await expect(boundary).toContainText('1 outside every declared surface')
  await expect(boundary).toContainText('src/config.py')
  // No score, no verdict word — a count and a link.
  await expect(boundary).not.toContainText('%')
  await boundary.getByRole('link', { name: 'read the diff by surface' }).click()
  await expect(page).toHaveURL(/artifact=%40diff/)
  await expect(page.locator('[data-undeclared]')).toBeVisible()
})

test('surfaces (#258): a pending run opens on Decide, a done run on Record with no empty Decide', async ({ page }) => {
  // AC1 — the decision is what opens, not the first artifact alphabetically.
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  await expect(page.locator('[data-surface="decide"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-needs-card]')).toBeVisible()
  await expect(page.locator('[data-g2-packet]')).toBeVisible()

  // AC1 — a run with nothing on the table is offered no Decide surface at all.
  await goto(page, `/runs/${sourceId()}/done-merged`)
  await expect(page.locator('[data-surface="decide"]')).toHaveCount(0)
  await expect(page.locator('[data-surface="record"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-needs-card]')).toHaveCount(0)

  // The container names are gone from the bar.
  const bar = page.locator('[data-surfaces]')
  await expect(bar).toContainText('Record')
  await expect(bar).not.toContainText('Artifacts')
  await expect(bar).not.toContainText('Diff')
})

test('surfaces (#258): retired tab names still resolve, and leave a canonical URL', async ({ page }) => {
  // AC3 — links minted before the rename keep working. ?tab=artifacts is the
  // record, and the artifact it named is still the one open.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=artifacts&artifact=spec.md`)
  await expect(page).toHaveURL(/tab=record/)
  await expect(page).toHaveURL(/artifact=spec\.md/)
  await expect(page.locator('.prose-artifact')).toBeVisible()

  // ?tab=diff is the record with the change open.
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=diff`)
  await expect(page).toHaveURL(/tab=record/)
  await expect(page.locator('[data-surface-group="01-core"]')).toBeVisible()

  // A ?tab=decide link that has aged out lands on the record, not a blank panel.
  await goto(page, `/runs/${sourceId()}/done-merged?tab=decide`)
  await expect(page).toHaveURL(/tab=record/)
  await expect(page.locator('[data-surface="record"]')).toHaveAttribute('aria-current', 'page')
})

test('surfaces (#258): the change reads inside Record, and every artifact stays reachable', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending?tab=record`)
  // AC2 — every artifact is listed, and the change sits below them. The rail
  // names kinds and tasks rather than files (#401): the review entry is the
  // task it reviews, and the path shows in the reader header instead.
  for (const path of ['spec.md', 'plan.md', 'verification-report.md', 'review-01.md', 'tasks/01-core.yaml']) {
    await expect(page.locator(`[data-artifact-entry="${path}"]`)).toBeVisible()
  }
  const entry = (path: string) => page.locator(`[data-artifact-entry="${path}"]`)
  for (const [path, label] of [
    ['spec.md', /Spec$/],
    ['plan.md', /Plan$/],
    ['verification-report.md', /Verification$/],
    ['tasks/01-core.yaml', /01-core$/],
    ['state.yaml', /^Ledger$/],
  ] as const) {
    await expect(entry(path)).toHaveText(label)
  }
  await expect(page.locator('[data-artifact-entry="review-01.md"]')).toContainText('01-core')
  await expect(page.locator('[data-rail-caption]', { hasText: 'Work items · 2' })).toBeVisible()
  // The two reversals (#425, docs/SEAM.md §8.2–8.3): a task id sets in the
  // code face everywhere the record uses it, so it reads with `state.yaml`'s
  // old treatment; `state.yaml` itself is named by its kind now, like every
  // other one-per-run artifact, and reads in the UI face instead.
  await expect(page.locator('[data-artifact-entry="tasks/01-core.yaml"]')).toHaveClass(/font-mono/)
  await expect(page.locator('[data-artifact-entry="state.yaml"]')).toHaveClass(/font-ui/)
  await expect(page.locator('[data-artifact-entry="spec.md"]')).toHaveClass(/font-ui/)
  await page.locator('[data-select-diff]').click()
  await expect(page).toHaveURL(/artifact=%40diff/)
  await expect(page.locator('[data-undeclared]')).toBeVisible()
  // One thing is open at a time: the artifact the pending gate would have
  // landed on must not still read as selected behind the change.
  await expect(page.locator('[data-artifact-entry][data-selected="true"]')).toHaveCount(0)
  // …and back out to an artifact, without leaving the surface.
  await entry('spec.md').click()
  await expect(page.locator('[data-surface="record"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.prose-artifact')).toBeVisible()
  // The address did not leave the surface: it moved to the reader header.
  await expect(page.locator('article')).toContainText('runs/g2-pending/spec.md')
  // A work item's reader is headed by the sentence its architect wrote.
  await page.locator('[data-artifact-entry="tasks/01-core.yaml"]').click()
  await expect(page.locator('[data-task-title]')).toBeVisible()
  await expect(page.locator('article')).toContainText('runs/g2-pending/tasks/01-core.yaml')
  // …and reads as fields (#434): the contract's words, the bytes one toggle away.
  const fields = page.locator('[data-field-view="work-item"]')
  await expect(fields.locator('[data-field="file_contact_surface"] dt')).toHaveText('File-contact surface')
  await expect(fields.locator('[data-field="file_contact_surface"] [data-address]')).toHaveText('src/core.py')
  await expect(fields.locator('[data-quoted-word="review-approved"]')).toBeVisible()
  await expect(page.locator('article pre')).toHaveCount(0)
  await page.locator('[data-show-bytes]').click()
  await expect(page.locator('[data-bytes]')).toContainText('file_contact_surface:\n  - src/core.py')
  await expect(page.locator('[data-show-bytes]')).toHaveText('hide bytes')
  // The ledger reads as the run's state: its gates, its tasks, the bytes behind the same toggle.
  await entry('state.yaml').click()
  await expect(page.locator('[data-field-view="state"] [data-field-entry="G0"] [data-quoted-word="true"]')).toBeVisible()
  await expect(page.locator('article pre')).toHaveCount(0)
  await page.locator('[data-show-bytes]').click()
  await expect(page.locator('[data-bytes]')).toContainText('gates:')
})

test('G1 packet (#255): a patch run keeps its brief-plus-work-item view', async ({ page }) => {
  // AC4 — patch runs have no plan.md and no spec, so there is no mapping to
  // check and no coverage claim to make. Its G1 absorbs the G0 question, so it
  // takes G0's packet (#440): the brief half and the work item (#442).
  await goto(page, `/runs/${sourceId()}/patch-g1-pending?decide=G1`)
  await expect(page.locator('[data-needs-card]').first()).toBeVisible()
  await expect(page.locator('[data-g1-packet]')).toHaveCount(0)
  const packet = page.locator('[data-g0-packet][data-g0-mode="patch"]')
  await expect(packet.locator('[data-g0-section="problem"]')).toContainText('The typo hotfix workflow is manual')
  await expect(packet.locator('[data-g0-spec]')).toHaveCount(0)
  await expect(packet.locator('[data-g0-section="brief-out-of-scope"]')).toContainText('Changing the upstream data format.')
  // The work item it approves with the brief (DESIGN.md §4.1), as fields.
  await expect(packet.locator('[data-patch-work-item="01-hotfix"] [data-field-view="work-item"]')).toBeVisible()
  await expect(packet.locator('[data-withheld-view]')).toHaveCount(0)
})

test('G0 packet (#440): a spec with no Assumptions withholds that view, naming the grammar', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/malformed-spec?decide=G0`)
  const packet = page.locator('[data-g0-packet]')
  await expect(packet.locator('[data-withheld="assumptions"]')).toContainText('Assumptions withheld — looked for a section headed ## Assumptions in the spec.')
  await expect(packet.locator('[data-g0-section="problem"]')).toContainText('The webhook relay workflow is manual')
})

test('staged card (#440): the brief, the profile and the recorded ceiling, then Arm', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/staged?decide=staged`)
  const card = page.locator('[data-needs-card]')
  await expect(card.locator('[data-staged-brief] [data-g0-section="problem"]')).toContainText('The changelog linter workflow is manual')
  const terms = card.locator('[data-staged]')
  await expect(terms.locator('[data-name]')).toHaveText('standard')
  await expect(terms.locator('[data-budget-ceiling]')).toHaveText('$18.50')
  await expect(terms).toContainText('Profile standard · budget ceiling $18.50, set by cost_limit_usd')
  await expect(card.getByRole('button', { name: /^Arm/ })).toBeVisible()
})

test('G3 packet (#403): the release plan composed for "Ship it?"', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g3-pending?decide=G3`)
  const packet = page.locator('[data-g3-packet]')
  await expect(packet).toBeVisible()

  // AC1 — the rollback facts lead, verbatim from the plan's bold fields.
  const rollback = packet.locator('[data-g3-rollback]')
  await expect(rollback.locator('[data-fact="trigger"]')).toContainText('the published artifact fails its smoke run')
  await expect(rollback.locator('[data-fact="exercised"]')).toContainText('yes — re-pointed the tag on a scratch clone')
  await expect(rollback.locator('[data-g3-rollback-plan]')).toContainText('Re-point the tag at the previous release')
  // The rollback section's own field lines are not said twice.
  await expect(rollback.locator('[data-g3-rollback-plan]')).not.toContainText('Rollback trigger:')

  // What ships: the change, the environment, and CI health as Ops wrote it.
  await expect(packet.locator('[data-fact="change"]')).toContainText('run/g3-pending')
  await expect(packet.locator('[data-fact="environment"]')).toContainText('the published package on the public registry')
  await expect(packet.locator('[data-g3-ci]')).toContainText('The pipeline is green on the merge commit')

  // The ordered steps, one act per item, numbered as written.
  const steps = packet.locator('[data-g3-steps] [data-step]')
  await expect(steps).toHaveCount(2)
  await expect(steps.first()).toHaveAttribute('data-step', '1')
  await expect(steps.first()).toContainText('Tag the merge commit')
  await expect(packet.locator('[data-irreversible]')).toHaveCount(0)

  // What G2 verified: the report's verdict and the criteria count, from the
  // same rollup the G2 surface reads, with the report one click away.
  const verified = packet.locator('[data-g3-verified]')
  await expect(verified.locator('[data-cited]')).toBeVisible()
  await expect(verified.getByRole('link', { name: 'verification-report.md' })).toBeVisible()

  // AC4 — the audit-time sections fold to their heading and open to the
  // plan's own words; folding is never truncation.
  const blast = packet.locator('[data-g3-fold="blast-radius"]')
  await expect(blast).toHaveAttribute('data-open', 'false')
  await expect(blast).not.toContainText('Consumers who install')
  await blast.getByRole('button').click()
  await expect(blast).toContainText('Consumers who install the new version while it is broken')
  await expect(packet.locator('[data-g3-fold="verification-after"]')).toContainText('Verification after release')
})

test('G3 packet (#403): a malformed plan withholds what it cannot read and shows what it can', async ({ page }) => {
  // AC3 — the fixture's plan has a Release steps list and nothing else. The
  // card is bounced (readiness says so); the packet still renders the steps
  // and names the first field line it looked for (#424); the plan, one click
  // away, shows the rest.
  await goto(page, `/runs/${sourceId()}/malformed-release?decide=G3`)
  const packet = page.locator('[data-g3-packet]')
  await expect(packet).toBeVisible()
  const withheld = packet.locator('[data-withheld="fields"]')
  await expect(withheld).toContainText('looked for a bold-label line **Change released:** in the release plan')
  await expect(withheld.getByRole('link', { name: 'Open the release plan' })).toBeVisible()
  await expect(packet.locator('[data-withheld="ci"]')).toBeVisible()
  await expect(packet.locator('[data-g3-steps] [data-step]')).toHaveCount(1)
  await expect(packet.locator('[data-g3-steps] [data-step]')).toContainText('Ship it.')
  await expect(packet.locator('[data-g3-fold]')).toHaveCount(0)
})

test("escalation packet (#407): the escalating role's own words on the card", async ({ page }) => {
  // The fixture's escalated run carries the verifier's report with the
  // Escalation section #405 requires.
  await goto(page, `/runs/${sourceId()}/escalated`)
  const card = page.locator('[data-needs-card]').first()
  await expect(card).toBeVisible()
  // The card is headed by the role that escalated, not the engine that wrote the entry.
  await expect(card.locator('h2')).toContainText('Escalation from verifier')
  // The verifier wrote its words into the entry, so the reason is quoted (#433).
  await expect(card.locator('[data-escalation-reason]')).toContainText('sample input referenced by the spec does not exist')

  const packet = card.locator('[data-escalation-packet]')
  await expect(packet).toBeVisible()
  await expect(packet).toHaveAttribute('data-origin', 'role')

  // AC1 — the section's fields and paragraph, verbatim.
  // The lexicon wraps each id in a reference whose hover card is in the DOM,
  // so the field's text is not one contiguous string.
  await expect(packet.locator('[data-escalation-field="traces-to"]')).toContainText('R2')
  await expect(packet.locator('[data-escalation-field="traces-to"]')).toContainText('AC2.1')
  await expect(packet.locator('[data-escalation-field="criteria-affected"]')).toContainText('AC2.1')
  await expect(packet.locator('[data-escalation-prose]')).toContainText('The sample input the second requirement points at does not exist')
  // The requirement id resolves through the lexicon, as on every card.
  await expect(packet.locator('[data-escalation-field="traces-to"] .lex-ref').first()).toBeVisible()

  // The options as the verifier framed them, numbered, in its order.
  const options = packet.locator('[data-escalation-option]')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText('to name an input that exists')

  // The report: its verdict and one click to the artifact. A verification
  // report has no diff verdict and no findings, so neither is claimed.
  const report = packet.locator('[data-escalation-report]')
  await expect(report).toContainText('escalate')
  // The link is the UI's words and the file follows it as the Address (#423).
  await expect(report.getByRole('link', { name: 'Open the verification report' })).toBeVisible()
  await expect(report.locator('[data-address]')).toHaveText('verification-report.md')
  await expect(report.locator('[data-escalation-diff-verdict]')).toHaveCount(0)
  await expect(report.locator('[data-escalation-standing]')).toHaveCount(0)

  // The state file is no longer offered as reading; the report is the row,
  // named by its kind (#423).
  await expect(card.locator('[data-ref-row="state.yaml"]')).toHaveCount(0)
  await expect(card.locator('[data-ref-row="verification-report.md"]')).toHaveCount(1)
  await expect(card.locator('[data-ref-row="verification-report.md"] [data-kind-label]')).toHaveText('Verification report')
  // The Resolve form is unchanged.
  await expect(card.locator('[data-decide="resolve"]')).toBeVisible()
})

test('round cap (#257): the surface compares the last two rounds, not a file list', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/round-cap`)
  const panel = page.locator('[data-round-cap]')
  await expect(panel).toBeVisible()

  // AC1 — round 2 against round 3, with the finding that kept coming back first.
  await expect(panel).toContainText('Round 2 against round 3')
  const standing = panel.locator('[data-round-group="standing"] [data-finding]')
  await expect(standing).toHaveCount(1)
  await expect(standing.first()).toHaveAttribute('data-finding', 'F1')
  await expect(standing.first()).toContainText('raised again')
  await expect(standing.first()).toContainText('rounds 1, 2, 3')
  // Verbatim from the report, not paraphrased.
  await expect(standing.first()).toContainText('retry loop can double-apply a migration')

  // AC3 — the requirement it cites resolves through the lexicon, because that
  // is where the suspected ambiguity lives.
  await expect(standing.first().locator('.lex-ref').first()).toBeVisible()

  // A finding first raised in the final round is new, not persisting.
  const fresh = panel.locator('[data-round-group="fresh"] [data-finding]')
  await expect(fresh).toHaveCount(1)
  await expect(fresh.first()).toHaveAttribute('data-finding', 'F3')

  // AC2 — a finding resolved between the rounds renders folded, and expanding
  // it shows the artifact's own words. The disposition lives in a later file
  // than the finding it names, which is the case core's `dispositions` covers.
  const resolved = panel.locator('[data-round-group="resolved"] [data-finding]')
  await expect(resolved).toHaveCount(1)
  await expect(resolved.first()).toHaveAttribute('data-finding', 'F2')
  await expect(resolved.first()).not.toContainText('the banner is the first line')
  await resolved.first().getByRole('button').click()
  await expect(resolved.first()).toContainText('the banner is the first line')

  // Every report stays one click away — folding is never truncation. The link
  // is the decide card's own reference row, which carries the verdict too; the
  // panel no longer repeats that row 40px above it (#296, #423).
  const card = page.locator('[data-needs-card]').first()
  for (const path of ['review-01.md', 'review-02.md', 'review-03.md']) {
    await expect(card.locator(`a[data-ref-row="${path}"]`)).toHaveCount(1)
  }
  await expect(panel.getByRole('link', { name: /review-0\d\.md/ })).toHaveCount(0)
})

test('round cap (#257): a single-round record offers no comparison and says why', async ({ page }) => {
  // AC4 — g2-pending's task carries one numbered round in its own file; the
  // panel is not offered there at all, and where it is offered on a record it
  // cannot compare, it withholds itself in words rather than showing nothing.
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  await expect(page.locator('[data-round-cap]')).toHaveCount(0)
})

test('phase spine (#254): the profile is shape, not prose', async ({ page }) => {
  // AC1 — a full run shows six phases and four gate transitions, interleaved.
  await goto(page, `/runs/${sourceId()}/g3-pending`)
  const spine = page.locator('[data-spine]')
  await expect(spine.locator('[data-spine-phase]')).toHaveCount(6)
  await expect(spine.locator('[data-spine-gate]')).toHaveCount(4)
  await expect(spine.locator('[data-spine-phase="release"]')).toHaveAttribute('data-state', 'current')

  // AC2 — decided gates carry their approver and date; the gate on the table
  // says so, and nothing beyond it is drawn as waiting.
  await expect(spine.locator('[data-spine-gate="G0"]')).toHaveAttribute('data-state', 'approved')
  await expect(spine.locator('[data-spine-gate="G0"]')).toContainText('operator · 2026-06-28')
  await expect(spine.locator('[data-spine-gate="G2"]')).toContainText('operator · 2026-07-01')
  await expect(spine.locator('[data-spine-gate="G3"]')).toHaveAttribute('data-state', 'pending')
  await expect(spine.locator('[data-spine-gate="G3"]')).toContainText('on the table')

  // AC3 — each gate exposes its question, on hover and to a screen reader.
  await expect(spine.locator('[data-spine-gate="G3"] [title]')).toHaveAttribute('title', /G3 — Ship it\? — pending/)
  await expect(spine.locator('[data-spine-gate="G2"]')).toContainText('Does the evidence support merging?')

  // AC5 — the header states phase and profile in exactly one place: the spine.
  // The retired eyebrow said both again, and the retired GATES rail said the
  // gates a third time.
  const header = page.locator('header')
  await expect(header).not.toContainText('release phase')
  await expect(header).not.toContainText('full profile')
  await expect(page.getByText('Gates', { exact: true })).toHaveCount(0)
})

test('phase spine (#254): a reduced profile has fewer cells, not empty ones', async ({ page }) => {
  // AC1 — patch shows four phases and two gates, with no G0 or G3 cell at all.
  await goto(page, `/runs/${sourceId()}/patch-g1-pending`)
  const spine = page.locator('[data-spine]')
  await expect(spine.locator('[data-spine-phase]')).toHaveCount(4)
  await expect(spine.locator('[data-spine-gate]')).toHaveCount(2)
  await expect(spine.locator('[data-spine-gate="G0"]')).toHaveCount(0)
  await expect(spine.locator('[data-spine-gate="G3"]')).toHaveCount(0)
  await expect(spine.locator('[data-spine-phase="spec"]')).toHaveCount(0)

  // A patch run's G1 absorbs the G0 question — quoted, never paraphrased.
  await expect(spine.locator('[data-spine-gate="G1"]')).toContainText('Is this the change we want, scoped this way?')
})

test('phase spine (#254): a paused run is placed, not parked at the start', async ({ page }) => {
  // AC4 — rest states stay distinguishable from any live phase and from each
  // other: the spine says where the run stands, the chip says it is not moving.
  await goto(page, `/runs/${sourceId()}/paused-budget`)
  const spine = page.locator('[data-spine]')
  await expect(spine).toHaveAttribute('data-rest', 'paused')
  await expect(spine.locator('[data-spine-phase="plan"]')).toHaveAttribute('data-state', 'current')
  await expect(page.locator('header [data-phase-chip]')).toContainText('budget-exhausted')
  // Nothing is on the table while a run is at rest.
  await expect(spine.locator('[data-spine-gate][data-state="pending"]')).toHaveCount(0)

  // A moving run carries no rest chip at all — that is what makes the chip mean
  // something when it is there.
  await goto(page, `/runs/${sourceId()}/g3-pending`)
  await expect(page.locator('header [data-phase-chip]')).toHaveCount(0)
})

test('phase spine (#254): the header lays out full-width at 900px', async ({ page }) => {
  // The 2026-07-31 design review: in the 800–1000px band the header's fixed
  // columns stacked into the left half and left the right half empty, above the
  // decide surface they were supposed to introduce.
  await page.setViewportSize({ width: 900, height: 1000 })
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  const header = (await page.locator('header').boundingBox())!

  // The spine uses the band rather than hugging the left edge, and a full run's
  // ten cells occupy exactly one row.
  //
  // This assertion used to read `rows.size <= 2`, and #301 was filed on it: the
  // one narrow-viewport test in the suite, written in response to a design
  // review, permitting the very shape the next review called the defect. #295
  // settled it — a wrapped sequence stops reading as a sequence, the wrap point
  // is an accident of label widths rather than anything about the run, and the
  // connectors, which mean "flows into", dangle at row ends meaning nothing. So
  // the row is nowrap and crops. Ten cells is more than fits at 900px, which is
  // what makes one row the interesting answer here rather than a free pass.
  const spine = page.locator('[data-spine]')
  expect((await spine.boundingBox())!.width).toBeGreaterThan(header.width * 0.9)
  const cells = await spine.locator('[data-spine-phase], [data-spine-gate]').all()
  const boxes = await Promise.all(cells.map(async (c) => (await c.boundingBox())!))
  expect(boxes.length).toBe(10)
  expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1)

  // …and the columns below reach the right edge instead of stacking into the
  // left half under a header taller than the surface it introduces.
  const meta = (await page.locator('[data-run-metadata]').boundingBox())!
  const columns = await page.locator('[data-run-metadata] > *').all()
  const columnBoxes = await Promise.all(columns.map(async (c) => (await c.boundingBox())!))
  const rightmost = Math.max(...columnBoxes.map((b) => b.x + b.width))
  expect(rightmost).toBeGreaterThan(meta.x + meta.width * 0.85)
  expect(new Set(columnBoxes.map((b) => b.y)).size).toBe(1)
})

function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}
