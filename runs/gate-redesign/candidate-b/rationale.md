# Design rationale — Candidate A

**Theme: warm light editorial.** I chose a warm off-white ground (`#faf8f5`) over a cold dark shell because the brief reframes Gate as a comfortable reading environment first and a workflow tool second. The palette borrows GitHub Primer’s discipline — cool near-black ink (`#1f2328`), cool borders (`#d1d9e0`), muted functional status tints — but warms the ground and accent toward terracotta to avoid the generic “admin dashboard” temperature.

**Typefaces and roles.** Three distinct roles carry the identity: *Newsreader* (italic serif) for hero headlines and editorial moments, *Inter* for UI labels, tables, and forms, and *JetBrains Mono* for code, slugs, and provenance. Newsreader’s italic display cut provides the Stripe-style editorial confidence called out in the reference board; Inter keeps chrome and scan surfaces calm; the mono role preserves the two-number-jobs distinction the brief emphasizes. I named and reused the roles (`.t-display`, `.t-section`, `.t-body`, `.t-mono`) rather than inventing ad-hoc sizes.

**Signature motif.** A small arched “gate” mark appears in the wordmark and empty-state illustrations, paired with a warm terracotta-to-peach gradient rule under major headings. It is exactly one gesture, used deliberately so the UI has a brand mark without becoming a sticker book.

**Genesis commit chip.** Following the brief’s note that this element rewards a point of view, I treated the chip as an editorial preview rather than debug output. The commit message is set in italic Newsreader, the accent dot signals readiness (hollow when not), and a soft layered ring + drop shadow elevates it without glowing. Author/committer metadata sits quietly beneath, keeping the message as the hero.

**Reading surface.** The artifact body is the centerpiece. It is set in Newsreader roman at `16px / 1.7`, measures `76ch`, and centers inside a generous white pane. Headings create real hierarchy: the H1 is an italic display with a gradient rule, H2s switch back to Inter for structure, code blocks sit in tinted wells, tables use quiet warm borders, and blockquotes carry the accent left rule. This is where the reframe is meant to feel unmistakable.

**Reference-board details adopted.** Primer tinted chips (never solid fills), the `ring + soft drop` shadow on the decision card and preview, Raycast-style metadata rail in the run header, and the Sentry left-edge status rail in the inbox all come from the brief’s “steal these” list. Status is encoded with both color and form: dashed borders for pending gates, age glyphs for old items, over-budget bars with warning glyphs, and validation checkmarks — satisfying the CVD-safety requirement.

