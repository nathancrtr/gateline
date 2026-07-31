// E2E smoke (plan §9): inbox → gate card → approve → the commit exists with
// the right author, message, and preserved YAML comments; the bounce view
// offers no approval; the keyboard loop drives a decision end-to-end.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { generateFixtureRepo } from '@agentic/fixtures'

const PORT = 4399
let fixtureDir: string
let server: ChildProcess

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  server = spawn('node', ['server/src/main.ts', '--repo', fixtureDir, '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  // Wait for readiness.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not come up')
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

test('inbox ranks oldest first and flags bounced packets', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('[data-inbox-row]')
  await expect(rows.first()).toContainText('escalated')
  const bounced = rows.filter({ hasText: 'malformed-spec' })
  await expect(bounced).toContainText('Bounced')
})

test('bounce view renders problems and offers no approval (R3)', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/malformed-spec?decide=G0')
  const card = page.locator('[data-needs-card]')
  await expect(card).toContainText('missing required sections')
  await expect(card.locator('[data-decide="approve"]')).toHaveCount(0)
  await expect(card).toContainText('no approval is offered')
})

test('the pointer decision loop: approve G0 with burden → correct commit', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g0-pending?decide=G0')
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

test('the keyboard loop: a → 1 → approve on the primary card', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g1-pending?decide=G1')
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
  await page.goto('/portfolio')
  await expect(page.getByRole('table')).toContainText('done-merged')
  await page.goto('/metrics')
  await expect(page.getByText('Gate decisions')).toBeVisible()
  await expect(page.getByText('Budget honesty')).toBeVisible()
})

test('run lexicon (#163): ids resolve to verbatim hover cards and jump to their definition', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=artifacts&artifact=verification-report.md')
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

test('evidence rollup (#165): uncited criteria are the headline; anchors jump to the evidence block', async ({ page }) => {
  // The one-line citation map now lives where the report itself is on screen;
  // G2's decision card carries the composed packet instead (#256).
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=artifacts&artifact=verification-report.md')
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
  await page.goto('/runs/' + sourceId() + '/g2-pending')
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
  const block = ac11.locator('[data-evidence-block="E1"]')
  await expect(block).toContainText('### E1 — AC1.1')
  await expect(block).toContainText('ok (3 records)')

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
  await page.goto('/runs/' + sourceId() + '/patch-g2-pending')
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
  await page.goto('/runs/' + sourceId() + '/forked-contract')
  const packet = page.locator('[data-g2-packet]')
  // The report passes its contract — the gate is reviewable, not bounced.
  await expect(page.locator('[data-needs-card]')).toContainText('Does the evidence support merging?')
  await expect(page.locator('[data-decide="approve"]')).toHaveCount(1)
  // …but the parser does not guess: it names the grammar it looked for.
  await expect(packet.locator('[data-withheld]')).toContainText('evidence-block grammar')
  await expect(packet.locator('[data-criterion]')).toHaveCount(0)
  // Never a claim the record cannot support.
  await expect(packet).not.toContainText('No verification evidence cites')
  // The reviews still render, and the report is one click away.
  await expect(packet.locator('[data-report="review-01.md"]')).toContainText('off-by-one in boundary handling')
  await packet.getByRole('link', { name: 'read verification-report.md' }).click()
  await expect(page).toHaveURL(/artifact=verification-report\.md/)
  // The artifact page stands down too, rather than asserting nothing cites AC1.1.
  await expect(page.locator('[data-evidence-withheld]')).toBeVisible()
  await expect(page.locator('[data-evidence-rollup]')).toHaveCount(0)
})

test('decision ledger (#268): History reads decisions and engine verbs, not a commit log', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=history')
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
  await page.goto('/runs/' + sourceId() + '/bad-state?tab=history')
  await expect(page.locator('[data-ledger]')).toBeVisible()
  await expect(page.locator('[data-ledger] li').first()).toBeVisible()
})

test('surface-scoped diff (#270): the diff groups by what each work item declared', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=diff')

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
  await page.goto('/runs/' + sourceId() + '/forked-contract?tab=diff')
  await expect(page.locator('[data-surface-withheld]')).toContainText('nested block')
  await expect(page.locator('[data-surface-group]')).toHaveCount(0)
  await expect(page.locator('[data-undeclared]')).toHaveCount(0)
  // AC3 — the diff itself is untouched by the scoping standing down.
  await expect(page.getByText('src/pruner.py', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('def prune(paths):')).toBeVisible()
  // The G2 card claims no boundary check it did not run.
  await page.goto('/runs/' + sourceId() + '/forked-contract')
  await expect(page.locator('[data-boundary-check]')).toHaveCount(0)
})

test('surface-scoped diff (#270): G2’s packet carries the boundary fact and routes to it', async ({ page }) => {
  // DESIGN.md §4 puts the diff in G2's packet; #256 deferred its form to #259,
  // which chose this view. The card states the fact and links to the diff.
  await page.goto('/runs/' + sourceId() + '/g2-pending')
  const boundary = page.locator('[data-boundary-check]')
  await expect(boundary).toContainText('3 changed files')
  await expect(boundary).toContainText('1 outside every declared surface')
  await expect(boundary).toContainText('src/config.py')
  // No score, no verdict word — a count and a link.
  await expect(boundary).not.toContainText('%')
  await boundary.getByRole('link', { name: 'read the diff by surface' }).click()
  await expect(page).toHaveURL(/tab=diff/)
  await expect(page.locator('[data-undeclared]')).toBeVisible()
})

function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}
