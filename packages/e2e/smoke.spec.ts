// E2E smoke (plan §9): inbox → gate card → approve → the commit exists with
// the right author, message, and preserved YAML comments; the bounce view
// offers no approval; the keyboard loop drives a decision end-to-end.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { generateFixtureRepo } from '@gateline/fixtures'

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

test('bounce view at G3 (#260): a thin release plan is malformed, not ready', async ({ page }) => {
  // The last gate to get a checkable packet. Before contracts/release-plan.md
  // existed, a release plan of one line passed on presence alone.
  await page.goto('/runs/' + sourceId() + '/malformed-release?decide=G3')
  const card = page.locator('[data-needs-card]')
  await expect(card).toContainText('missing required sections')
  await expect(card).toContainText('Rollback plan')
  await expect(card.locator('[data-decide="approve"]')).toHaveCount(0)
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

// Ordered before the keyboard-loop test below, which approves this very
// gate: once G1 is decided there is no G1 card left to compose a packet
// for. The file already runs in declaration order for the same reason.
test('G1 packet (#255): coverage and parallel safety, composed from the record', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g1-pending?decide=G1')
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
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=record&artifact=verification-report.md')
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
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=record&artifact=verification-report.md')
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
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=record&artifact=@diff')

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
  await page.goto('/runs/' + sourceId() + '/forked-contract?tab=record&artifact=@diff')
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
  await expect(page).toHaveURL(/artifact=%40diff/)
  await expect(page.locator('[data-undeclared]')).toBeVisible()
})

test('surfaces (#258): a pending run opens on Decide, a done run on Record with no empty Decide', async ({ page }) => {
  // AC1 — the decision is what opens, not the first artifact alphabetically.
  await page.goto('/runs/' + sourceId() + '/g2-pending')
  await expect(page.locator('[data-surface="decide"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-needs-card]')).toBeVisible()
  await expect(page.locator('[data-g2-packet]')).toBeVisible()

  // AC1 — a run with nothing on the table is offered no Decide surface at all.
  await page.goto('/runs/' + sourceId() + '/done-merged')
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
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=artifacts&artifact=spec.md')
  await expect(page).toHaveURL(/tab=record/)
  await expect(page).toHaveURL(/artifact=spec\.md/)
  await expect(page.locator('.prose-artifact')).toBeVisible()

  // ?tab=diff is the record with the change open.
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=diff')
  await expect(page).toHaveURL(/tab=record/)
  await expect(page.locator('[data-surface-group="01-core"]')).toBeVisible()

  // A ?tab=decide link that has aged out lands on the record, not a blank panel.
  await page.goto('/runs/' + sourceId() + '/done-merged?tab=decide')
  await expect(page).toHaveURL(/tab=record/)
  await expect(page.locator('[data-surface="record"]')).toHaveAttribute('aria-current', 'page')
})

test('surfaces (#258): the change reads inside Record, and every artifact stays reachable', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=record')
  // AC2 — the artifact list is unchanged, and the change sits below it.
  for (const path of ['spec.md', 'plan.md', 'verification-report.md', 'review-01.md']) {
    await expect(page.getByRole('button', { name: new RegExp(path.replace('.', '\\.')) })).toBeVisible()
  }
  await page.locator('[data-select-diff]').click()
  await expect(page).toHaveURL(/artifact=%40diff/)
  await expect(page.locator('[data-undeclared]')).toBeVisible()
  // One thing is open at a time: the artifact the pending gate would have
  // landed on must not still read as selected behind the change.
  await expect(page.locator('[data-artifact-entry][data-selected="true"]')).toHaveCount(0)
  // …and back out to an artifact, without leaving the surface.
  await page.getByRole('button', { name: /spec\.md/ }).click()
  await expect(page.locator('[data-surface="record"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.prose-artifact')).toBeVisible()
})

test('G1 packet (#255): a patch run keeps its brief-plus-work-item view', async ({ page }) => {
  // AC4 — patch runs have no plan.md and no spec, so there is no mapping to
  // check and no coverage claim to make.
  await page.goto('/runs/' + sourceId() + '/patch-g1-pending?decide=G1')
  await expect(page.locator('[data-needs-card]').first()).toBeVisible()
  await expect(page.locator('[data-g1-packet]')).toHaveCount(0)
})

test('round cap (#257): the surface compares the last two rounds, not a file list', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/round-cap')
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
  // is the decide card's own packet chip, which carries the verdict too; the
  // panel no longer repeats that row 40px above it (#296).
  const card = page.locator('[data-needs-card]').first()
  for (const path of ['review-01.md', 'review-02.md', 'review-03.md']) {
    await expect(card.getByRole('link', { name: new RegExp(`^${path}`) })).toHaveCount(1)
  }
  await expect(panel.getByRole('link', { name: /review-0\d\.md/ })).toHaveCount(0)
})

test('round cap (#257): a single-round record offers no comparison and says why', async ({ page }) => {
  // AC4 — g2-pending's task carries one numbered round in its own file; the
  // panel is not offered there at all, and where it is offered on a record it
  // cannot compare, it withholds itself in words rather than showing nothing.
  await page.goto('/runs/' + sourceId() + '/g2-pending')
  await expect(page.locator('[data-round-cap]')).toHaveCount(0)
})

test('phase spine (#254): the profile is shape, not prose', async ({ page }) => {
  // AC1 — a full run shows six phases and four gate transitions, interleaved.
  await page.goto('/runs/' + sourceId() + '/g3-pending')
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
  await page.goto('/runs/' + sourceId() + '/patch-g1-pending')
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
  await page.goto('/runs/' + sourceId() + '/paused-budget')
  const spine = page.locator('[data-spine]')
  await expect(spine).toHaveAttribute('data-rest', 'paused')
  await expect(spine.locator('[data-spine-phase="plan"]')).toHaveAttribute('data-state', 'current')
  await expect(page.locator('header [data-phase-chip]')).toContainText('budget-exhausted')
  // Nothing is on the table while a run is at rest.
  await expect(spine.locator('[data-spine-gate][data-state="pending"]')).toHaveCount(0)

  // A moving run carries no rest chip at all — that is what makes the chip mean
  // something when it is there.
  await page.goto('/runs/' + sourceId() + '/g3-pending')
  await expect(page.locator('header [data-phase-chip]')).toHaveCount(0)
})

test('phase spine (#254): the header lays out full-width at 900px', async ({ page }) => {
  // The 2026-07-31 design review: in the 800–1000px band the header's fixed
  // columns stacked into the left half and left the right half empty, above the
  // decide surface they were supposed to introduce.
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.goto('/runs/' + sourceId() + '/g2-pending')
  const header = (await page.locator('header').boundingBox())!

  // The spine uses the band rather than hugging the left edge: a full run's ten
  // cells take at most two rows here, and any row that is not the last one runs
  // the width of the header.
  const spine = page.locator('[data-spine]')
  expect((await spine.boundingBox())!.width).toBeGreaterThan(header.width * 0.9)
  const cells = await spine.locator('[data-spine-phase], [data-spine-gate]').all()
  const boxes = await Promise.all(cells.map(async (c) => (await c.boundingBox())!))
  const rows = new Map<number, number>()
  for (const b of boxes) rows.set(b.y, Math.max(rows.get(b.y) ?? 0, b.x + b.width))
  expect(rows.size).toBeLessThanOrEqual(2)
  const rights = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, right]) => right)
  for (const right of rights.slice(0, -1)) expect(right).toBeGreaterThan(header.x + header.width * 0.85)

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
