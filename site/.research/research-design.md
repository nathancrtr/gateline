# Visual direction for the gateline docs site — research memo

Date: 2026-09-18. Scope: a ~15-page hand-written site (landing, three essays, three onboarding modules, six reference pages; ~30k words) plus TypeDoc output, all as plain HTML + one CSS file, no build step, no external requests, fonts vendored.

Method note. Every hex value and font name in §1 was read from the live stylesheet on 2026-09-18 with `curl` (the probe scripts and raw dumps are in `scratchpad/css/`), not from memory or third-party "brand colour" sites. Where a value comes from a summary page rather than live CSS, the text says so.

---

## 1. Precedent survey — what well-regarded docs sites actually do

A one-line reading of the whole survey first, because it drives §5:

* The sites engineers name as "well designed" divide into two families. **(a) Product-company docs** (Stripe, Vercel, Linear, Tailwind, Tailscale, Cloudflare, Fly) all run a licensed or house sans, a dark code surface, a 14–16px UI-scale type size, and a brand accent. **(b) Project/reference docs** (Rust book, docs.rs, Go, Postgres, SQLite, Python, Django, GOV.UK, Gwern, Tufte, Butterick) run bigger text (16–19px), a narrower measure, a plain blue or ink-coloured link, and almost no chrome. Family (a) is where the 2026 "AI look" was learned from; family (b) is where the readable habits live. The maintainer's brief (recorded in §5) puts the target *between* them: Go's docs are "close to workable", the plainest of family (b) — Rust book, Postgres, SQLite, Gwern, Tufte — "take plain and unfashionable a bit too far", and Stripe/Linear/Vercel are acceptable "as long as it is at least somewhat restrained". So the survey should be read for what to borrow from each side, not as a ranking.
* Every site in family (b) that people describe as *pleasant to read* has one of: a tinted ground (Tufte `#fffff8`, mdBook "rust" `hsl(60,9%,87%)`, Django `#F1FFF7`), a serif text face (rustdoc, Gwern, Tufte, Butterick), or a public-signage sans at 19px (GOV.UK). None uses a gradient, a shadow, or a radius above 4px. Of those three devices, only the tinted ground and the signage sans survive the maintainer's register; the serif is recorded but not proposed.
* Accents that read as *chosen* are traceable: Postgres blue from the elephant, Go's turquoise from the gopher, mdBook's "rust" theme literally coloured like the metal, Django's green from its logo, GOV.UK's blue/yellow from public-signage practice. Accents that read as *defaulted* are traceable too: Starlight/mkdocs-material/Docusaurus indigo-blue, Fly's Tailwind `violet-600`, Tailscale's Tailwind `gray-700` body text.

### 1.1 Values read from live CSS

| Site | Body / UI face | Code face | Ground · ink · link (light) | Measure & size | Notes |
|---|---|---|---|---|---|
| [Stripe docs](https://docs.stripe.com/payments/quickstart) | `sohne-var` (Klim Söhne, commercial; [Fonts In Use](https://fontsinuse.com/uses/35338/stripe-website-2020)) | `Menlo, Consolas` and `Source Code Pro` | white · dark · `#533afd` ("blurple"); dark code header `#1a2652`, code links `#a4cdfe` | content `max-width: 750px`/`1000px`; 13/14/16px | The reference product-docs layout: three columns, dark code panel on the right. Licensed type is most of what makes it look "Stripe". |
| [Tailwind docs](https://tailwindcss.com/docs/installation/using-vite) | Inter (`--font-inter`) | IBM Plex Mono (`--font-plex-mono`), Ubuntu Mono in places | dark theme default; Tailwind's own grey ramp | — | Origin of the Inter + indigo default; note that even Tailwind pairs Inter with **Plex Mono**, not Geist Mono. |
| [Linear docs](https://linear.app/docs/conceptual-model) | `InterVariable` | (system mono var) | dark by default; grey `#9c9da1` icons | `max-width` 640/768/1024 | The "Linear look" (see §2). |
| [Vercel docs](https://vercel.com/docs/getting-started-with-vercel) | Geist Sans | Geist Mono | `--ds-gray-alpha-*` ramp; warning `#f5a623`; error `#e00`; teal `#008d7d` | 13/14px body; `max-width: 960px` | Geist is now the strongest single AI tell (§2). |
| [Rust book (mdBook)](https://doc.rust-lang.org/book/ch01-01-installation.html) | Open Sans | Source Code Pro | light: `#fff` · `#000` · `#20609f`; **rust** theme: `hsl(60,9%,87%)`≈`#e1e1db` · `#262625` · `#2b79a2`, sidebar `#3b2e2a`, active `#e69f67`, inline code `#6e6b5e`, quote `hsl(60,5%,75%)` | `max-width: 750px`; `line-height: 1.45` | The "rust" theme is the best-known example of a paper-tinted ground with a metal-named accent — an accent derived from the product's *name*. Five themes (light/rust/coal/navy/ayu). |
| [docs.rs / rustdoc](https://docs.rs/serde/latest/serde/) | **Source Serif 4** body, Fira Sans headings/sidebar | Source Code Pro (Fira Mono fallback) | `#fff` · black · `#3873ad`; sidebar & code bg `#f5f5f5`; border `#e0e0e0`; docs.rs chrome uses Fira Sans, type-colour `#e57300`, struct `#df3600`, macro `#068000` | docs.rs `max-width: 700px` | Serif body in developer reference docs — and a decade of pushback: [#16173](https://github.com/rust-lang/rust/issues/16173) ("This is documentation and not the New York Times"), [#52449](https://github.com/rust-lang/rust/issues/52449), [#59845](https://github.com/rust-lang/rust/issues/59845). Evidence that serif body text in *API reference* is contested; in essays it is not. |
| [Go](https://go.dev/doc/effective_go) | system stack; `Go, sans-serif` (Bigelow & Holmes Go fonts) | `Go Mono`, Menlo | grey ramp `--gray-1 #202224` … `--gray-10 #f8f8f8`; brand `--turq-dark #007d9c`; `--slate #253443`; `--yellow #fddd00` | `max-width: 50rem`; 1rem/1.5rem | A teal-and-white docs site that reads as *chosen* because the turquoise is the gopher's. The maintainer has ruled teal out for gateline; Go shows why it works for Go and would look borrowed anywhere else. |
| [PostgreSQL](https://www.postgresql.org/docs/current/tutorial-select.html) | Open Sans (Bootstrap 4.4 base) | `monospace` | `#fff` · dark · `#336791` (Postgres blue), sidenav link `#336791`; doc-content link token `#840032` also present; table borders `#dee2e6` | `max-width: 40rem` on doc content | Bootstrap 4 is visible in the tokens; the *blue* is the elephant's. |
| [SQLite](https://sqlite.org/lang_select.html) | **Verdana** | `pre` default | `#fff` · black · `#044a64` | `max-width: 800px` | No framework, 179-byte external CSS, mostly inline styles, a 2 MB page. Beloved because nothing gets in the way. |
| [Python](https://docs.python.org/3/library/functions.html) | system stack (`-apple-system, … avenir next, … Cantarell, Ubuntu, roboto, noto, arial`) | `Menlo, Consolas, Monaco, Liberation Mono` | `#fff` · dark; admonitions `#eee`, seealso `#ffc`, warning `#ffe4e4`, tip `#dfd` | 1rem; 1.625rem H1 | Sphinx "classic" heritage; admonition tints are pale primaries, the Sphinx tradition. |
| [Django](https://docs.djangoproject.com/en/5.2/topics/db/queries/) | Roboto (300/400/700) | Fira Mono | **`#F1FFF7`** ground · **`#0C3C26`** ink · `#20AA76` link; `--primary #44B78B`; code bg `#F8F8F8`; hairline `#CFE3DC`; dark: `#0e1117` · `#C1CAD2` | 14–18px | The only major docs site with a *tinted ground and tinted ink in the brand hue*. It reads as designed because the whole page is one green family, not white + green accent. [Style guide](https://www.djangoproject.com/styleguide/) lists the faces and weights. |
| [Redis](https://redis.io/docs/latest/develop/get-started/) | Space Grotesk, Geist, TT Trailers | Space Mono, Geist Mono | `--midnight #091a23`, red `#ff4438`; Tailwind prose tokens (`#374151` etc.) | `max-width: 45rem`/`85rem` | Negative reference: the complete 2026 tell stack in one stylesheet. |
| [Cloudflare](https://developers.cloudflare.com/workers/get-started/guide/) | Inter Variable (on Starlight) | JetBrains Mono Variable | accent `#ff5e1f`; GitHub-light Shiki (`#24292E`, `#032F62`, `#D73A49`…) | Starlight defaults | Starlight base + Inter + orange. Competent; visibly a Starlight site. |
| [Fly.io](https://fly.io/docs/launch/deploy/) | "Fricolage Grotesque" (house rename of Bricolage), **Mackinac** serif (commercial) | Fragment Mono (open) | text `#564b80`, `--link-hover #7c3aed`, gradient `#b54ff3`→`#3730a3` | Tailwind | Charming brand, but the palette *is* Tailwind `violet-600`/`indigo-800`. Proof that a strong voice can survive a default palette — and that the palette will still be recognised. |
| [Tailscale](https://tailscale.com/kb/1017/install) | Inter | `MD IO` (Mass-Driver, commercial) | Tailwind `prose` tokens verbatim: body `#374151`, headings `#111827`, borders `#e5e7eb`, pre bg `#1f2937` | Tailwind scale | Body text is Tailwind `gray-700`; the code panel is `gray-800`. This is the "measured default" look in its purest form. |
| [Oxide](https://docs.oxide.computer/guides/introduction) | `SuisseIntl` (Swiss Typefaces, commercial) | `GT America Mono` (Grilli, commercial custom cut) | semantic token system (`--content-default`, `--surface-*`, `--theme-accent-*`), black ink on light | 0.875/1rem; tight line-heights | [Pentagram identity](https://www.pentagram.com/work/oxide): Neue Haas Grotesk + custom GT America Mono; "oxide green" with red/blue/yellow on black. Mono used for *labels and data*, not body. |
| [Sourcehut](https://man.sr.ht/) | Bootstrap 4 system stack | `monospace` | Bootstrap tokens unchanged: `--primary #007bff`, `--gray #6c757d`, `--light #f8f9fa` | 720/960px | Deliberately unstyled. Readable, and exactly what "defaults" look like — a useful floor to measure any direction against. |
| [Gwern](https://gwern.net/design) | **Source Serif 4** body, Source Sans 3 UI | monospaced stack | greyscale only (an explicit "experiment in consistency"); dark mode with image inversion | narrow column (`max-width: 649px` breakpoints) | Sidenotes, collapsible sections, "anything besides the content is distraction." Best living example of monochrome + serif for very long technical reading. |
| [Practical Typography](https://practicaltypography.com/body-text.html) | Equity/Concourse/Heliotrope/Triplicate (Butterick's own, commercial) | Triplicate | white · near-black | **`max-width: 520px`**; 0.9–1rem | Rules: [15–25px body, 120–145% leading, 45–90 chars](https://practicaltypography.com/summary-of-key-rules.html). |
| [Tufte CSS](https://edwardtufte.github.io/tufte-css/) | ET Book (open) | `Consolas, Liberation Mono, Menlo, Courier` | **`#fffff8`** · **`#111111`** | 760px text column in a 1400px frame; 15px base | Sidenotes; h1/h2/h3 only; italic headings, no bold; links same colour as text, underlined ("blue text is crass and distracting"). |
| [Furo](https://pradyunsg.me/furo/reference/) | system stack | `SFMono-Regular, Menlo, Consolas…` | `#fff` · `#000` · brand `#0a4bff`/content `#2757dd`; secondary bg `#f8f9fb`; dark `#131416` | **`max-width: 46em`** content, 67em with sidebar | The good Sphinx default: 46em measure, hairlines, a sidebar you can ignore. |
| [Starlight](https://starlight.astro.build/guides/authoring-content/) | system stack (`--sl-font-system`) | system mono | grey ramp `#17181c…#f6f7f9`; text `gray-2 #353841`; **accent `#3d50f5`** (indigo) / dark `#3369ff` | `--sl-content-width: 45rem`; `line-height: 1.75`; sidebar 18.75rem | Sensible metrics; the indigo accent and pill-shaped badges are its signature. |
| [Docusaurus](https://docusaurus.io/docs) | `system-ui` | `SFMono-Regular, SF Mono, Menlo…` | docusaurus.io itself: `--ifm-color-primary #3578e5`; code bg `#f6f7f8`; dark `#1b1b1d` | Infima | The classic-template default primary is a green (`#2e8555`, from memory of the template, not the live site). Navbar + hero + "3 feature cards" is the identifiable shape. |
| [mkdocs-material](https://squidfunk.github.io/mkdocs-material/reference/) | Roboto (`--md-text-font`) | Roboto Mono | primary **`#4051b5`** (indigo), link `#4051b5`; 15+ palette variants | — | The header bar, tabs, and admonition icons are recognisable at thumbnail size. |
| [GOV.UK Design System](https://design-system.service.gov.uk/styles/type-scale/) | **GDS Transport** (custom New Transport; licensed to gov.uk only) | `ui-monospace, menlo, Cascadia Mono…` | `#fff` · **`#0b0c0c`** · brand `#1d70b8`; secondary text `#484949`; focus **`#ffdd00`**; border `#cecece`; red `#ca3535`, green `#0f7a52` ([colour page](https://design-system.service.gov.uk/styles/colour/)) | **19px / 25px** body; line heights in multiples of 5px | The clearest modern instance of signage typography applied to reading: black on white, one blue, one yellow. |
| [TypeDoc default theme](https://raw.githubusercontent.com/TypeStrong/typedoc/master/static/style.css) | `-apple-system, … Noto Sans, Helvetica, Arial` | `Menlo, Monaco, Consolas, Courier New` | `--light-color-background #f2f4f8` · `--light-color-text #222` · `--light-color-link #1f70c2`; dark `#2b2e33` · `#f5f5f5` · `#00aff4` | container `max-width: 1700px` | See §6. |

### 1.2 What the survey says about each design dimension

**Colour.** The readable sites are two-colour systems: an ink and a link, on white or near-white. Where a third colour appears it is semantic (warning/tip tints in Python, GOV.UK red/green). Tinted grounds appear only where a tradition justifies them (Tufte's book paper, mdBook's rust, Django's green family). Product-docs sites carry the brand accent *and* a dark code panel, which doubles the palette and is the first thing that reads as "SaaS".

**Type.** Three viable body models: (1) system sans (Python, Sourcehut, Furo, Starlight, TypeDoc) — invisible, but now indistinguishable from the AI-scaffolded default; (2) a vendored humanist/grotesque sans at 16–19px (GOV.UK, Django, docs.rs chrome); (3) a text serif for prose (rustdoc, Gwern, Tufte, Butterick). Code is universally a real mono at ~0.875em; the better sites (Tailwind, Stripe, docs.rs, Rust book) vendor **Plex Mono** or **Source Code Pro** rather than a system stack.

**Measure.** The reading sites cluster at 46em–50rem (Furo 46em, Go 50rem, Starlight 45rem, Redis 45rem, Rust book 750px, Tufte 760px); the typographers go narrower (Butterick 520px, Gwern ~650px). Bringhurst's 45–75 characters, ideal 66 ([summary](https://mitchellkember.com/books/bringhurst)), and Butterick's 45–90 both land there.

**Density.** Reference docs (Postgres, SQLite, docs.rs) are dense and rely on strong tables and hairlines; essays (Gwern, Tufte) are loose with 1.5+ leading and sidenotes. Product docs sit in between and use *cards* to fake structure — the card is the thing to avoid.

**Navigation.** Every good multi-page docs site has a persistent left tree (Furo, Starlight, Rust book, Stripe, Django) at 13–14px on a slightly different surface, plus an optional right "on this page". The Rust book collapses it; Tufte and Gwern have none because they are single long pages. For 15 pages + API, a left tree is the honest structure; a top bar of six links would also work.

**Code blocks.** Two idioms: dark panel in a light page (Stripe `#1a2652` header, Tailwind, Tailscale `#1f2937`, Django `#181d27` in dark) or light panel one step off the ground (Rust book, docs.rs `#f5f5f5`, Docusaurus `#f6f7f8`, Cloudflare GitHub-light). The dark-panel-in-light-page idiom is the SaaS signature; the light-panel idiom is the reference-docs signature. Radius: 0 (SQLite, Postgres, Tufte, GOV.UK) to 6px (Starlight, Vercel). Shadows: none anywhere in family (b).

---

## 2. What reads as "AI-generated" or "template" in 2025–26 — the avoid-list

Sources: [Developers Digest, "16 patterns that out your app as vibe-coded"](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it); [impeccable.style/slop (67 detector rules)](https://impeccable.style/slop/); [925 Studios, "AI slop fonts and gradients"](https://www.925studios.co/blog/ai-slop-design-tells); [Alan West, "Blame Tailwind's indigo-500"](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p) (quoting Adam Wathan: "I would like to formally apologize for making every button in Tailwind UI `bg-indigo-500` five years ago"); [Sailop, "Geist is the new Inter"](https://sailop.com/blog/geist-the-new-inter-ai-font-fingerprint-2026); [LogRocket on "Linear design"](https://blog.logrocket.com/ux-design/linear-design/); [SmoothUI](https://smoothui.dev/blog/ai-design-slop); [vibecodekit](https://vibecodekit.dev/ai-slop-design); [Mohit Phogat](https://mohitphogat.medium.com/ai-design-slop-why-every-ai-built-interface-looks-the-same-and-how-to-fix-it-bf874e0b470c).

The mechanism every source agrees on: the model returns the statistical centre of its training set, and its output becomes the next set's training data, so the centre narrows each year. The practical consequence is that *anything that is the default of a popular toolchain* is now a tell, regardless of its intrinsic quality.

| # | Tell | Why it reads as machine-made | Evidence |
|---|---|---|---|
| 1 | **Inter** as body face | "Signals a design choice was never made" (925). Tailwind, Linear, Tailscale, Cloudflare all use it; it is the sans of the training corpus. | 925 Studios; Developers Digest #1; impeccable "Inter everywhere" |
| 2 | **Geist / Geist Mono** | Spread "by plumbing, not taste": default in `create-next-app`, v0, shadcn docs; "three in five AI-startup landing pages" load it. | Sailop; Vercel & Redis stylesheets above |
| 3 | **Space Grotesk, Instrument Serif/Sans, Manrope, Plus Jakarta, Outfit, DM Sans, Satoshi, Bricolage** | The rotating "not-Inter" set models reach for when told to be distinctive; Developers Digest names Space Grotesk + Instrument Serif + Geist as the recurring combo. Redis and Fly both run Space Grotesk / Bricolage today. | Developers Digest #2; Redis and Fly CSS |
| 4 | **Serif-italic accent word** in a sans headline | Named as a formula by two sources. | Developers Digest #3; impeccable |
| 5 | **Indigo/violet/purple**, especially gradients `indigo-500 → purple-600`; "VibeCode purple" | Direct lineage from Tailwind UI's `bg-indigo-500`. Starlight `#3d50f5`, mkdocs-material `#4051b5`, Fly `#7c3aed`, Stripe `#533afd` all sit here — the whole docs-tooling default band is indigo. | Alan West; Developers Digest #4; impeccable |
| 6 | **Teal-on-near-white; terracotta-on-cream** | The maintainer's own vetoes; both are now house palettes of large AI vendors and read as borrowed. (Go's `#007d9c` is the exception that proves it: owned via the gopher.) | Brief; Go CSS |
| 7 | **"Cream and beige chosen by default"** | impeccable lists it as a slop palette when unmotivated. Warm paper is fine *only* with a print/ledger reason and a non-warm accent (see §5A caveat). | impeccable "Color & Contrast" |
| 8 | **Permanent dark mode with medium-grey body text** and barely-AA contrast | The "Linear look": dark, gradient glow, purple accent, sharp type. LogRocket: "just flat design with dark mode and gradients". | Developers Digest #5–6; LogRocket; Arlene Xu |
| 9 | **Gradients** (backgrounds, text, hero), **glassmorphism**, **coloured glows / coloured box-shadows**, "glowing orbs" | Decoration without function; the single most cited visual signature. | all sources |
| 10 | **Rounded cards on grey**, three-in-a-row feature cards with an icon on top, cards inside cards, coloured top/left borders on cards | "Colored left borders are almost as reliable a sign of AI-generated design"; "five layers of cards add padding and shadows around the same content". Breaking the three-card row "does more to de-slop a page than almost anything else". | Developers Digest #11–12; impeccable; 925 |
| 11 | **Badge above the hero H1**, centred hero, oversized hero text, tiny numbered section labels, all-caps section labels | The landing-page grammar of every v0 output. | Developers Digest #9, #10, #16; impeccable |
| 12 | **Stat banner rows, "1-2-3" step sequences, emoji icons in nav/sidebar, thin-line interchangeable icons** | Formulaic structure; emoji as iconography. | Developers Digest #13–15; 925 |
| 13 | **Pulsing status dots, auto-scrolling marquees, bounce on hover, images that move on hover** | Decorative motion. | impeccable "Motion" |
| 14 | **Copy tells**: "Build faster. Ship smarter.", "supercharge", "world-class", forced contrasts, em-dash overuse | Weightless claims. Relevant because the landing page's *words* will be judged with the design. | 925; impeccable "Copy" |
| 15 | **Tailwind's grey ramp as body colour** (`#374151` body, `#111827` headings, `#e5e7eb` rules) and 0.5rem radius + low-opacity shadow | Tailscale and Redis carry these verbatim; they are the "measured default" that the seed-object audit was trying to catch, and a reader who has seen a hundred Tailwind sites recognises them. | Tailscale, Redis CSS; Alan West |
| 16 | **System-font stack + indigo accent** (Starlight/TypeDoc/Docusaurus look) | Not slop, but instantly "generated by a docs tool". | Starlight, Docusaurus, TypeDoc CSS |
| 17 | **mkdocs-material's header bar + tabs + Roboto**, Docusaurus's navbar + hero + feature grid | Recognisable at thumbnail size; the maintainer named both. | mkdocs-material, Docusaurus CSS |
| 18 | Mono fonts with **ligatures** (Fira Code, JetBrains Mono ligatures on) in documentation code | Hides the actual characters the reader must type; a taste tell rather than an AI tell, but common in generated sites. | favtutor / madegooddesigns comparisons |

Two further points from the sources worth keeping in mind:

* The fix is not "be weirder". The 925 piece and Sailop both point at Stripe, Linear and Duolingo as sites that escaped the average by *committing* to a licensed face, a real colour system, and a layout that matches the product — not by novelty. For an open-source docs site the equivalent commitment is a *lineage*: a reason for every choice that predates LLMs.
* The maintainer's report that the seed-object method produced "grey ink, one dusty red, zero radius, no shadows" is itself a recognisable failure: over-correcting for the default register produces the *austere* register, which is just as much a template (impeccable's "flat type hierarchy", "cramped padding", "low contrast text" rules fire on it). The directions in §5 keep radius ≤ 3px and no shadows, but they get warmth from the ground, the type, and the rules rather than from decoration.

---

## 3. How designers actually choose a colour system for reading

**Start from the ink, not the accent.** Tufte CSS's stated reason for `#fffff8` on `#111111` is that the values are "nearly indistinguishable from their 'pure' cousins, but dial down the harsh contrast" ([Tufte CSS](https://edwardtufte.github.io/tufte-css/)). Ian Storm Taylor's [Never use black](https://ianstormtaylor.com/design-tip-never-use-black/) makes the same point for UI: pure black "overpowers everything else", and real shadows are tinted (his darkest pixel is `#130f30`); he recommends saturating greys 2 % (light) to ~22 % (dark) toward one hue. Refactoring UI: "Greys don't have to be grey… saturate them with a bit of blue [cool] or yellow/orange [warm]… don't forget to increase the saturation for the lighter and darker shades" ([Refactoring UI summary](https://github.com/erikuus/good-ui)). The practical rule: pick the temperature of the neutrals first; the accent must share it.

**Warm vs cool neutrals.** Warm neutrals read as paper and pair with serifs and hairlines (Tufte, Solarized's `base3 #fdf6e3`, mdBook rust, Butterick); cool neutrals read as instrument and pair with grotesques and mono (Go's `#202224…#f8f8f8`, Starlight, Oxide). Solarized's rationale is the best-argued paper case: reduce the black-on-white intensity to the level of "a book in the shade", hold the monotones at symmetric CIELAB lightness so light and dark keep the same perceived contrast, then choose accents by colour-wheel relation ([Schoonover](https://ethanschoonover.com/solarized/)). Django is the cool-tinted counter-example that still reads as human: green-tinted ground `#F1FFF7`, green-black ink `#0C3C26`, one green family.

**Paper-tinted ground vs pure white.** The reading tradition (Tufte, Solarized, Kindle sepia, mdBook rust) tints; the reference tradition (Postgres, SQLite, GOV.UK, Furo) uses `#fff` and softens the *ink* instead (`#0b0c0c`, `#111`, `#222`). Both are legitimate; a tinted ground costs you code-block contrast and image compositing (every screenshot needs a matching frame) and buys you long-form comfort. For a 30k-word site with six reference pages and API output, the trade is close; §5 offers one of each.

**Contrast for long reading.** WCAG 2's 4.5:1 is a floor for short UI text; for columns of body text the APCA guidance (the basis of WCAG 3) is Lc 90 preferred for fluent text at ≥14px/400, Lc 75 minimum at ≥18px, and it warns against exceeding ~Lc 90 for very large or bold text in dark mode ([APCA easy intro](https://git.apcacontrast.com/documentation/APCAeasyIntro.html); [readtech ARC](https://www.readtech.org/ARC/)). Material's dark-theme guidance says the same from the other side: `#121212` rather than `#000`, and desaturated accents, because saturated colour on black both fails AA and "vibrates" ([Material dark theme](https://m2.material.io/design/color/dark-theme.html)). Tufte's "smallest effective difference" — "make all visual distinctions as subtle as possible, but still clear and effective", mute grids, frames and rules that only support the data ([Visual Explanations, summarised](https://medium.com/@pj_/the-smallest-effective-difference-90fc94d5ab0d)) — is the rule for everything that is not text: hairlines, table rules, code-block edges.

**Choosing the accent so it reads as deliberate.** Three tested strategies, all visible in §1:

1. *From the name or mark*: mdBook "rust" (`#e69f67` on `#3b2e2a` sidebar), Go turquoise, Postgres blue, Django green. For gateline the mark is a lowercase wordmark; the name carries two nouns — *gate* (railway gateline, signage) and *line* (a rule, a ledger line, a line of a ledger). Either noun yields an accent with a history.
2. *From a domain tradition*: rubrication — red ink for headings, initials, and instructions in manuscripts and early print, "to articulate the text by indicating such parts as headings" ([Rubrication](https://en.wikipedia.org/wiki/Rubrication)); green "Eye-Ease" ledger paper and the green eyeshade, adopted because green reduced glare under direct light and "helped preserve and maintain financial records" ([FAZ Forensics](https://fazforensics.com/yellow-legal-memo-pads-and-green-ledger-paper/)); Rail Blue (BS 381C 114, ≈ `#1f4b61` — a "dark, greyish blue tone which hid the effects of dirt well") with pearl grey and yellow warning panels, adopted in 1965 "to signal a complete break with the past" ([Rail blue](https://en.wikipedia.org/wiki/Rail_blue); [BR Corporate Identity Manual](https://en.wikipedia.org/wiki/British_Rail_Corporate_Identity_Manual)); GOV.UK's *functional* colours — text, link, focus, error, success — each with one job ([GOV.UK colour](https://design-system.service.gov.uk/styles/colour/)).
3. *No accent at all*: Gwern's greyscale "experiment in consistency", Tufte's links "match the body text in colour"; colour is reserved for figures. This is the hardest to make warm, and is where the previous attempt died.

**Dark mode.** (Not required for this site — the maintainer wants light only; kept for completeness because TypeDoc ships a toggle, §6.) Natural for cool/instrument systems (Go, Oxide, Furo, Starlight, TypeDoc all ship one); unnatural for paper systems (Tufte and Butterick don't; Gwern does it by staying greyscale and inverting images with a classifier). If a direction has a paper ground, the honest dark variant is *not* an inversion but a second, cooler theme — mdBook ships "rust" and "coal" as siblings rather than as light/dark of one thing. TypeDoc's theme switch is `data-theme` + `prefers-color-scheme` (§6), so whichever direction is chosen, the site CSS should key off the same attribute so the API pages follow.

---

## 4. Typefaces: open-licensed, vendorable, well-hinted, not the 2026 defaults

Butterick's warning applies: "most free fonts are garbage"; his short list of free faces that are not — Source Code, Source Serif, Cooper Hewitt, IBM Plex, Charter ([Free fonts](https://practicaltypography.com/free-fonts.html)) — is a good filter. Everything below is either on that list, or is a foundry-grade release with a documented reading rationale.

### 4.1 Text serifs (recorded for completeness — under the maintainer's register a serif body is out; at most an *optional trial* for the three essays, see §5A)

| Face | Licence | Why it qualifies | Watch-outs |
|---|---|---|---|
| **Source Serif 4** (Frank Grießhammer, Adobe) | OFL | Fournier-derived transitional; five optical sizes, variable; "moderate contrast for comfortable extended reading" ([Wikipedia](https://en.wikipedia.org/wiki/Source_Serif_4)). Used by rustdoc and Gwern. | Slightly "Adobe-house"; fine. Use the `Text` optical instance for 16–18px. |
| **Literata** (TypeTogether for Google Play Books) | OFL (since 2018) | Designed explicitly for continuous reading across screen densities: hybrid Scotch/old-style, "varied horizontal proportions… pleasant organic texture"; variable with optical axis ([TypeTogether](https://www.type-together.com/literata-book); [GitHub](https://github.com/googlefonts/literata)). | Texture is livelier than Source Serif; pairs best with a plain sans. |
| **Charter** (Matthew Carter, 1987) | Bitstream free licence (use, modify, redistribute) | Engineered for 300 dpi output, "holds up beautifully on today's screens" ([Butterick](https://practicaltypography.com/charter.html)). Ships on macOS. | Only 4 styles; no small caps; bundle the OTF/webfont package Butterick converted. |
| **Spectral** (Production Type, 2017) | OFL | "Screen-first" serif with heavy triangular serifs, made for text-rich screen reading; 7 weights, small caps ([Google Design](https://design.google/library/spectral-new-screen-first-typeface)). | Distinctive serifs read "editorial"; can look precious in reference tables. |
| **Newsreader** (Production Type) | OFL | Newsprint-derived, optical sizes; named by Sailop as a non-AI "B2B display" serif. | Display-leaning at large sizes; body use needs the `Text` instance. |
| **IBM Plex Serif** | OFL | Part of the Plex superfamily (see 4.2). | Wide; measure must stay ≤ 66ch. |
| **ET Book** (Tufte CSS) | MIT-style (open) | Bembo-like; the Tufte CSS default. | Narrow character set; italic/bold as separate files; reads as "Tufte". |
| Avoid as *AI defaults*: **Instrument Serif**, **Fraunces** (as italic accent), **Playfair**, **Lora/Merriweather** (blog defaults, not slop but tired). | | | |

### 4.2 Sans (for UI, nav, or as body)

| Face | Licence | Lineage / why | Watch-outs |
|---|---|---|---|
| **Public Sans** (USWDS) | OFL 1.1 | Fork of Libre Franklin (Franklin Gothic lineage); "strong, neutral, principles-driven"; metrics aligned to system fonts, tabular numerals, tailed `l`, narrowed forms "for legibility in extended reading" ([repo](https://github.com/uswds/public-sans)). Sailop names it as a non-AI B2B body face. | Deliberately quiet; needs confident scale and rules to not look like Helvetica. |
| **Libre Franklin** (Impallari) | OFL | The Franklin Gothic print tradition; parent of Public Sans. | Wider set than Public Sans. |
| **Source Sans 3** (Paul Hunt, Adobe) | OFL | Made as the UI/prose companion to Source Code and Source Serif; Gwern's UI face. | Ubiquitous in 2014–18 dev docs; now reads "quietly competent" rather than dated. |
| **IBM Plex Sans** (Mike Abbink / Bold Monday, IBM) | OFL 1.1 | Corporate typeface built for documentation; Sans/Serif/Mono/Condensed + Math; Butterick-approved ([repo](https://github.com/IBM/plex)); Sailop: "free alternative without AI-startup associations". | Strong personality in `a`, `g`, `M`; the whole family or none. |
| **Overpass** (Delve Fonts for Red Hat) | OFL | "Inspired by Highway Gothic" — US road-sign lettering; 8 weights + true italics; Overpass Mono ([overpassfont.org](https://overpassfont.org/)). | Quirky lowercase at text sizes; strongly associated with Red Hat; use for headings/labels, not 30k words. |
| **Atkinson Hyperlegible Next** (Braille Institute, 2025) | OFL | Legibility-driven, 7 weights + italics ([Braille Institute](https://www.brailleinstitute.org/freefont/)). | The disambiguated glyphs are loud in running text; excellent for UI labels, nav, and tables. |
| **Fira Sans** (Spiekermann/Mozilla) | OFL | docs.rs's chrome face; humanist, huge family. | Very recognisable as "Firefox / Rust"; fine as a UI face. |
| **Cooper Hewitt** (Chester Jenkins, Smithsonian) | OFL | Butterick-approved; museum-signage lineage. | Limited weights in the free release; geometric enough to skirt "Space Grotesk" territory — use with care. |
| **Go** (Bigelow & Holmes) | BSD-style | The Go project's sans/mono; go.dev uses it. | Idiosyncratic; reads as Go's. |
| **Recursive** (Arrow Type) | OFL 1.1 | One variable file with `MONO`, `CASL`, `wght`, `slnt`, `CRSV` axes; Sans and Mono are "superplexed" so labels and code align ([recursive.design](https://www.recursive.design/)). | The Casual end is playful; keep `CASL=0`. A single file covering sans + mono is attractive for a no-build site. |
| Avoid as *AI defaults*: **Inter, Geist, Space Grotesk, Instrument Sans, Manrope, Plus Jakarta, Outfit, DM Sans, Satoshi, General Sans, Bricolage Grotesque, Figtree, Hanken Grotesk** (the last two are on the 2026 "alternatives" lists and are already saturating). Also skip **Roboto/Open Sans** (mkdocs-material / Postgres / Rust book defaults — not slop, but "docs tool"). | | | |

### 4.3 Monospace (for code and identifiers)

| Face | Licence | Why | Watch-outs |
|---|---|---|---|
| **IBM Plex Mono** | OFL | Tailwind's own docs vendor it; the mono half of the Plex family; readable at 13–14px without ligatures. | Italic is a true italic — good in comments. |
| **Source Code Pro** (Paul Hunt) | OFL | Butterick: "very nice"; rustdoc, Rust book, Stripe all use it. | Slightly narrow; set at 0.9em of body. |
| **Commit Mono** (Eigil Nikolajsen, 2023) | OFL 1.1 | "Anonymous and neutral"; smart kerning that slides narrow glyphs together while staying monospaced; 4 weights ([commitmono.com](https://commitmono.com/)). Sailop lists it as non-AI. | Ligatures optional — leave off. |
| **iA Writer Mono / Duo / Quattro** | OFL (fork of Plex Mono; check repo licence file) | Duospace/quattrospace forks of Plex Mono for *writing*; Quattro is a plausible identifier face in prose ([iA-Fonts](https://github.com/iaolo/iA-Fonts)). | Not for code blocks (non-monospace); a niche choice for inline code in essays. |
| **Recursive Mono Linear** | OFL | See above; `CASL=0, MONO=1`. | — |
| **Fira Mono** (not Fira Code) | OFL | Django's choice; no ligatures. | — |
| **Intel One Mono**, **Martian Mono**, **Fragment Mono** (Fly's choice) | OFL | Solid; Fragment is a Helvetica-shaped mono. | Fragment/Martian are drifting into the "alternatives" set. |
| Avoid as *AI defaults*: **Geist Mono**, **Space Mono**, **DM Mono**, **JetBrains Mono with ligatures** (JetBrains Mono itself is fine but is the Cloudflare/Starlight-ecosystem default), **Berkeley Mono** (commercial; also the "AI dev-tool" mono of 2025). | | | |

Hinting/rendering: all of Source, Plex, Public Sans, Literata and Recursive ship hinted TTFs from their repos; vendor static instances for the weights used (Regular/Italic/Semibold/Bold + mono Regular) rather than one variable file unless the page really uses the axis, to keep the CSS simple and rendering predictable on Windows.

---

## 5. Three candidate directions

**Taste input folded in (2026-09-18).** The maintainer wants the site to read as *framework / language / database documentation* — "the gateline docs, not the Gatehouse ones" — and explicitly 2020s rather than plain-and-unfashionable. Go's docs are "close to workable" and near the current state; the Rust book, Postgres, SQLite, Gwern and Tufte "take plain and unfashionable a bit too far"; Stripe / Linear / Vercel are workable "as long as it is at least somewhat restrained". Light theme only.

That fixes the register. Reading it against §1: the band is **between go.dev and a restrained Stripe** — a vendored sans at 16–17px, a persistent left tree, coloured links, light code panels with a label row, a modern type scale, hairlines, and one accent — and it excludes the two things I had been leaning on for warmth: a text serif for body and a paper-tinted ground with sidenotes. Those are recorded at the end of this section as *dropped*, not as a fourth option.

### 5.0 The shared spine (what makes it "2020s framework docs")

Every direction below sits on the same skeleton; they differ in neutral temperature, accent, and type family. The skeleton is what go.dev, Stripe docs and Furo/Starlight have in common once you strip the brand:

* **Type scale.** Body 16–17px, leading 1.55–1.6 (go.dev: 1rem/1.5rem; Starlight: 1.75 is loose; Stripe: 16/24). Nav and captions 14px. Code 13.5–14px (0.85em). Headings at 600, modest: H1 30–32, H2 22–24, H3 18, with more space above than below. No 48px hero type on interior pages.
* **Measure.** Content column 700–740px (≈ 66–70ch at 16.5px). Go's `50rem` is the loose end of acceptable; Furo's `46em` and Starlight's `45rem` are the tight end.
* **Frame.** A slim top bar (wordmark left, 4–5 section links right, no search box unless there is search), a left tree 240–260px at 14px on a surface one step off the ground, a right "on this page" rail at ≥ 1280px. Landing page: the same frame, a two-column intro, no hero, no card grid.
* **Links.** Coloured in the accent, underlined in prose (a thinner/lighter underline via `text-decoration-color`), not underlined in nav. This is the framework-doc convention (Go, Stripe, Furo); Tufte's ink-coloured links are out of register here.
* **Code.** Light panel one step off the ground, 1px hairline, radius 3px, a 28px label row carrying filename/language in the muted colour, line numbers only when referenced. No dark-panel-in-light-page, no copy-button glow. One highlight scheme of four tones shared with TypeDoc (§6).
* **Tables.** Hairline rows, 2px rule under the header, no zebra, `tabular-nums`, header in 600 at 14px.
* **Callouts.** Tinted surface + hairline + a small label; **no coloured left bar** (§2 #10).
* **Nothing else.** No shadows, no gradients, no radius above 4px, no icons in nav, no badges.

This spine is roughly where the current teal site already is; the three directions are three ways of making it look chosen.

### Direction A — "Ledger" (warm-neutral, ledger green, Public Sans)

**Character.** Framework docs on a warm-white sheet with the accountant's green: the friendlier of the two neutral temperatures, one accent that means "checked".

**Lineage.** Django's docs — the one major framework site whose palette is a single tinted family, ground `#F1FFF7`, ink `#0C3C26`, link `#20AA76`, hairline `#CFE3DC`, set in a vendored sans + Fira Mono ([Django CSS](https://static.djangoproject.com/css/output.3f328e5ebae7.css)) — is the proof that a tinted, green docs site reads as contemporary and human, not as a template. Eye-Ease green ledger paper as the reason the green is *this* green ([FAZ Forensics](https://fazforensics.com/yellow-legal-memo-pads-and-green-ledger-paper/)). Refactoring UI on warm greys ("saturate them with a bit of yellow or orange… increase the saturation for the lighter and darker shades", [summary](https://github.com/erikuus/good-ui)). Go's frame and measure ([go.dev CSS](https://go.dev/css/styles.css)). Public Sans as the Franklin-lineage, tabular-figured, extended-reading sans ([repo](https://github.com/uswds/public-sans)).

**Light palette.**

| Role | Hex | Note |
|---|---|---|
| ground | `#fbfaf7` | warm *white*, hue ≈ 45°, chroma ≈ 1.5 % — not cream, not paper |
| surface (sidebar, code, table header, callouts) | `#f3f1eb` | one step down, same hue |
| ink | `#1e1c19` | warm near-black |
| muted | `#625d55` | 6.3:1 on ground |
| line | `#e3e0d8` | hairlines |
| line-strong | `#b9b4a9` | table header rule, H2 rule |
| accent (ledger green) | `#2a6444` | 6.7:1 on ground; links, active nav, "approved" |
| accent-hover | `#1f4f35` | |
| accent-underline | `#9dbfa9` | prose link underline; goes `accent` on hover |
| accent-on | `#fbfaf7` | |
| code bg | `#f3f1eb`, border `#e3e0d8` | highlight tones: ink, `#2a6444`, rust `#8a4b2a`, muted for comments |
| callout note | bg `#eaf1ec`, label `#2a6444` | hairline, no bar |
| callout caution / waiting | bg `#f6eedc`, label `#8a6a1c` | |
| callout danger / declined | bg `#f5e6e2`, label `#a83a2f` | red only here and in gate state |
| selection | `#dfe9e1` | |

**Type.** **Public Sans** body 16.5px/1.6, headings 600; nav 14px; **Source Code Pro** 14px for code (or **Commit Mono** if a more neutral mono is wanted). Both OFL. Optional trial, not default: **Literata** 17px for the three essays only — a serif is the one thing that would pull this out of the register, so it should be tested against the essays specifically and dropped if it reads "Gwern".

**Layout.** The shared spine. What is specific: the sidebar's current-page mark is a 2px green rule under the entry (not a filled pill); H2s carry a hairline above in `line-strong`; tables are set as ledgers (`tabular-nums`, right-aligned numerics, header on `surface`); gate/state values in tables are a text label preceded by a 6px square in the semantic colour.

**Why a person would choose this for gateline.** The product's nouns are ledgers and decision records, and "checked" has been green on paper for a century; a warm neutral is the one Refactoring UI calls friendlier, which suits a single-maintainer open-source project better than an instrument grey. It stays inside the framework-doc band (Django is the precedent, not Tufte) while being the furthest of the three from what a code generator emits: no LLM reaches for green on warm white with Public Sans.

**What would make it fail.** (1) Warmth drift: if the ground goes past ≈ `#f8f5ee` or the accent picks up yellow, it lands in "cream and beige by default" and beside the vetoed terracotta-and-cream — police the hue at 45° and the chroma below 2 %. (2) A bright green (`#2e8555`, `#44B78B`) instead of a deep one reads "Docusaurus/Django template". (3) Public Sans without a confident scale reads as Helvetica-on-beige; the 600 headings and the 2px rules carry it. (4) Screenshots of Gatehouse (which is not warm) will need a hairline frame or they will float.

### Direction B — "Gateline" (white, ink, signal blue, Public Sans / Atkinson)

**Character.** Framework docs with signage discipline: white, black lettering, one signal blue, everything ruled — the row of gates the name refers to, rendered at a 2020s docs scale rather than a station scale.

**Lineage.** "Gateline" is UK rail's word for the row of ticket gates ([Rail Engineer](https://www.railengineer.co.uk/the-gate-line-throughput-challenge/); [Turnstile](https://en.wikipedia.org/wiki/Turnstile)). British Rail's 1965 identity: Rail Blue + pearl grey, Rail Alphabet by Kinneir & Calvert, the double arrow ([BR CIM](https://en.wikipedia.org/wiki/British_Rail_Corporate_Identity_Manual); [Fonts In Use](https://fontsinuse.com/uses/62451/british-rail-identity-and-signs-1965-1990s)). Transport → New Transport → GDS Transport ([Transport](https://en.wikipedia.org/wiki/Transport_(typeface))). GOV.UK's *functional* colours — text `#0b0c0c`, brand `#1d70b8`, focus `#ffdd00`, red `#ca3535`, green `#0f7a52` ([colour](https://design-system.service.gov.uk/styles/colour/)) — and its rhythm rule (line heights in multiples of 5px, [type scale](https://design-system.service.gov.uk/styles/type-scale/)). Stripe's three-column frame and label-row code blocks for the *structure* ([Stripe docs](https://docs.stripe.com/payments/quickstart)); Go's grey ramp for the neutrals.

**Light palette.**

| Role | Hex | Note |
|---|---|---|
| ground | `#ffffff` | |
| surface (sidebar, code, table header) | `#f2f3f4` | cool neutral, near-zero chroma |
| ink | `#0b0c0c` | GOV.UK text black |
| muted | `#4f5459` | ≥ 7:1 |
| line | `#c8cacc` | hairlines |
| line-strong | `#0b0c0c` at 2px | table header rule; the top band |
| accent (signal blue) | `#1d70b8` | 5.2:1; links, active nav |
| accent-hover | `#0b3d78` | |
| accent-underline | `#9cc1e3` | prose links |
| accent-on | `#ffffff` | |
| signal: approved | `#0f7a52` | gate state only |
| signal: declined | `#ca3535` | gate state / errors only |
| signal: waiting / focus | `#ffdd00` with ink text | focus rings and "awaiting a human" only |
| code bg | `#f2f3f4`, border `#c8cacc`, radius 3px | highlight tones: ink, `#1d70b8`, `#0f7a52`, muted |
| callout note | bg `#eaf2fa`, label `#1d70b8` | hairline, no bar |
| callout caution / waiting | bg `#fff8d6`, label `#7a6400` | the only place the yellow family touches prose |
| callout danger / declined | bg `#fbeceb`, label `#ca3535` | |
| selection | `#d6e6f5` | |

Rail Blue's literal screen value (`#1f4b61`, [colors.watch](https://colors.watch/color-tables/british-standard-381c/bs381c-114-rail-blue)) is not used: it is a grey-blue that reads teal, which is vetoed. GOV.UK's blue is the same tradition rendered for screens.

**Type.** **Public Sans** body 17px/1.55 (≈ 26px; not GOV.UK's 19px, which is what would tip it from "framework" into "government service"), headings 600–700 at 32/24/18; nav and tables in **Atkinson Hyperlegible Next** 14px (its disambiguated glyphs earn their keep in identifiers and tables, and it is a 2025 release, so it reads current). Code: **IBM Plex Mono** 14px or **Commit Mono**. All OFL. Optional: **Overpass** 700 for the wordmark only (Highway Gothic's tails are the signage tell).

**Layout.** The shared spine plus: a 3px ink band across the top of every page, the wordmark set as `gate|line` with the `|` in accent (the *line* in the name); the sidebar's current page marked with a 3px accent bar on the sidebar's *right* edge (where it meets content — not a card-left-border); tables get the 2px ink header rule; gate/state columns use a 6px filled square in the signal colour plus a text label.

**Why a person would choose this for gateline.** The name is transport infrastructure and the product's gates are approval points humans pass through; signage is the design tradition whose whole purpose is guiding people through gates, and it already obeys the brief's rules — black, white, one blue, no ornament, big legible type, every colour with a job. Of the three it is the closest to what Go and a restrained Stripe *already do* (white, ink, blue links, grey code panel), so it is the safest read as "framework documentation", and it is the cleanest TypeDoc fit (§6) because TypeDoc's defaults are white/ink/blue.

**What would make it fail.** (1) Under-commitment: white + blue + a quiet sans with timid rules collapses into Sourcehut's Bootstrap floor or Furo's default — the 2px rules, the top band and the 600/700 headings are the whole difference. (2) Yellow anywhere but focus/waiting. (3) The blue sliding toward slate/teal, or toward Starlight's `#3d50f5` indigo — hold it at ≈ 205°. (4) Going to 19px body with GOV.UK spacing: it becomes a public-service site. (5) Tinted pastel admonition boxes with icons — the Sphinx grammar, not signage.

### Direction C — "Manual" (cool desk, white page, IBM Plex, amber)

**Character.** The engineering manual, 2020s edition: a cool grey desk, a white page on it, one superfamily for prose, interface and code, one amber for marks.

**Lineage.** IBM Plex — "developed over two years to reflect IBM's identity… and to function effectively in user interface environments", Sans/Serif/Mono/Condensed + Math, OFL ([IBM/plex](https://github.com/IBM/plex)); Butterick-approved ([Free fonts](https://practicaltypography.com/free-fonts.html)); Sailop's "free alternative without AI-startup associations". Go's neutral ramp `--gray-1 #202224 … --gray-10 #f8f8f8` and `50rem` measure ([go.dev CSS](https://go.dev/css/styles.css)) — this is the direction nearest "the current state" the maintainer called close to workable. Stripe's page-on-ground structure and label-row code. Oxide's mono-for-labels-not-body idiom ([Oxide docs CSS](https://docs.oxide.computer/assets/index-CunaLuI4.css)). Amber as the Rust ecosystem's marker colour (docs.rs `#e57300`, mdBook rust `#e69f67`).

**Light palette.**

| Role | Hex | Note |
|---|---|---|
| ground (desk) | `#eeeff0` | cool grey, ≈ 1 % chroma |
| surface (the page: content column, sidebar panel) | `#ffffff` | |
| ink | `#202224` | Go's `gray-1` |
| muted | `#5b5f63` | 6.4:1 on white |
| line | `#d9dbdd` | hairlines on white; `#c9ccce` on the desk |
| accent (manual amber) | `#a66119` | 4.8:1 on white; links, active nav, callout labels, the wordmark's `|` |
| accent-hover | `#7f4a12` | |
| accent-underline | `#e0bf99` | prose links |
| accent-on | `#ffffff` | |
| secondary (cool) | `#3f5f7a` | code keywords and "info" labels only — never a second accent in prose |
| code bg | `#f5f6f7` on the page, border `#d9dbdd`, radius 3px | highlight tones: ink, `#a66119`, `#3f5f7a`, muted |
| callout note | bg `#f5f6f7`, label `#3f5f7a` | hairline top and bottom |
| callout caution / waiting | bg `#faf3ea`, label `#a66119` | |
| callout danger / declined | bg `#f8eceb`, label `#9a3b32` | |
| selection | `#fbe7cf` | |

**Type.** **IBM Plex Sans** body 16.5px/1.55, headings 600 at 30/22/18; nav 14px; **IBM Plex Mono** 13.5–14px for code, identifiers, table keys and the small labels on code blocks and callouts. All OFL. Alternative single-file option: **Recursive** (`MONO` axis) if payload matters more than Plex's character ([recursive.design](https://www.recursive.design/)). Plex Serif is *not* proposed for the essays under the new brief.

**Layout.** The shared spine, with the content column and the sidebar each drawn as a white panel on the grey desk with 1px `line` edges — panels, not cards: no radius above 3px, no shadow, edge-to-edge below 900px. Section numbers (`1`, `1.2`) in Plex Mono, muted, on reference and module pages only, hanging in the margin at wide widths; none on essays. Tables: full hairline grid (spec-table idiom), keys in mono. Gate/state: mono label + 6px square in amber / cool / danger.

**Why a person would choose this for gateline.** The framework's artefacts are specs, contracts, plans and review reports with numbered requirements (`R<n>`, `AC<n>.<m>`); a site that treats its pages as numbered sections of one manual mirrors the contracts it documents. One superfamily is the kind of commitment §2's sources say separates Stripe and Linear from the average, and Plex is the only open superfamily with an engineering-house pedigree that no generator ships by default. It is also the direction closest to go.dev's neutrals and to the current site's structure, so it is the smallest visible move that still replaces the teal with something owned.

**What would make it fail.** (1) It is one saturated accent away from a generic dev-tools template: if the amber turns orange, or appears on buttons and large areas, or the desk grey becomes Tailwind's `#f3f4f6`, only "Plex + grey" remains. (2) Mono in headings or nav — terminal cosplay. (3) A desk grey dark enough to make screenshots look dirty. (4) A shadow on the page panel — the moment it has one it is a card. (5) Plex Sans at 15px reads "IBM Carbon"; keep 16.5px and the hairline grid.

### Choosing between them

| | A Ledger | B Gateline | C Manual |
|---|---|---|---|
| Distance from a generator's default | largest | medium | smallest (needs accent discipline) |
| Distance from the current teal/near-white site | large (temperature flips) | medium (blue for teal, real type) | small (amber for teal, Plex for system) |
| Fit to "Go-like, restrained Stripe" band | in band via Django precedent | squarely in band | squarely in band |
| Name/domain metaphor | ledger, "checked" | gateline, signage | manual, numbered record |
| TypeDoc fit (§6) | needs ground and code-bg carried through | near-native | native container model |
| Main risk | warmth drift → cream | under-commitment → Bootstrap floor | accent drift → template |

If forced to rank against the new brief: **B**, then **C**, then **A**. B has the strongest name-metaphor and is safest as "framework documentation"; C is the smallest move and the most at risk of looking like a good template; A is the most distinctive and needs the most policing.

**Dropped under the taste input, for the record.** A serif-on-paper direction (Source Serif 4 or Literata at 17px on `#f3f0e7`, ledger green, Tufte/Gwern sidenotes, ink-coloured links, mdBook-"rust"-style ground) was fully worked up before the maintainer's note arrived. It is the register he named as "plain and unfashionable a bit too far", so it is out; its surviving ideas — the ledger green, the warm neutral, the ledger-style tables — moved into Direction A. Dark variants were also worked for B and C (B inverts cleanly to white-on-`#111315` with `#6fb1ec`; C to `#141517`/`#1d1f22` with `#e0a058`); they are not needed and the CSS should declare `color-scheme: light` so form controls and TypeDoc's toggle (§6) do not disagree with the page.

---

## 6. Making TypeDoc output belong

**What TypeDoc gives you without a custom theme** ([Output options](https://typedoc.org/documents/Options.Output.html); [default style.css](https://raw.githubusercontent.com/TypeStrong/typedoc/master/static/style.css)):

* `customCss` — copied into `assets/` and linked *after* the theme CSS, so it wins on specificity ties. `customJs` likewise. `customFooterHtml` (+ `customFooterHtmlDisableWrapper`), `hideGenerator`, `favicon`, `titleLink`, `navigationLinks` (header) and `sidebarLinks` (sidebar) — enough to put "← gateline docs" in the header and the site nav in the sidebar. `lightHighlightTheme` / `darkHighlightTheme` select Shiki themes; pick two that use only the direction's code tones (or write a tiny Shiki theme JSON in `customCss` colours).
* The theme is variable-driven. `:root` declares `--light-color-*` and `--dark-color-*` (background `#f2f4f8`/`#2b2e33`, text `#222`/`#f5f5f5`, link `#1f70c2`/`#00aff4`, `--light-color-ts-keyword`, `-ts-class`, `-ts-interface`, `-ts-function`, alert note/tip/caution …) and maps them to `--color-*` under `@media (prefers-color-scheme)` and `:root[data-theme="light|dark"]`. Overriding the `--light-*`/`--dark-*` values in `customCss` restyles almost everything; the remaining hard-coded bits are the toolbar height variables (`--dim-toolbar-contents-height`, `--dim-header-height`) and the 1700px container.
* Consequences for the site CSS: (a) light only — set both `--light-*` and `--dark-*` groups to the same light values in `customCss` (or hide `.tsd-theme-toggle`/the theme `<select>`) so a visitor with a dark OS preference does not get TypeDoc's `#2b2e33` dark theme next to a light site; declare `color-scheme: light` on both; (b) the API pages can't `@import` the site CSS via a relative URL unless the output dir sits next to it — simplest is to make `customCss` a file that `@import url("../../style.css")` (relative to the generated `assets/`) and then only carries the TypeDoc-specific overrides; (c) fonts: TypeDoc copies only the CSS file, so `@font-face` URLs in it must point at the site's vendored `/fonts/` with a path that resolves from `assets/`.

**What to override in practice** (from the people who have done it: [typedoc-custom-css](https://github.com/smikhalevski/typedoc-custom-css), [Carlos Roso](https://carlosroso.com/how-to-customize-a-typedoc-theme/), [typedoc#1060](https://github.com/TypeStrong/typedoc/issues/1060)): set `body` font to the site's body face and TypeDoc's `code`, `.tsd-signature`, `.tsd-kind-*` to the site's mono; cap `.container` at the site's page width and give `.col-content` the site measure; restyle `.tsd-navigation`/`.site-menu` to match the left tree; kill the `.tsd-page-toolbar` box-shadow and give it the site's top band; recolour `.tsd-signature` backgrounds to the direction's code bg; replace the kind icons' colours with the direction's semantic tones; hide the generator line. Direction C's page-on-desk container maps most directly to TypeDoc's `.container-main` grid; Direction B's white/ink/blue is closest to TypeDoc's defaults; Direction A needs the ground and code-bg carried through or the API pages will look like a white spreadsheet inside a paper site.

**Heavier options, in order of cost.**

1. `customCss` only (above). Enough for "belongs to the same site" if the tokens, fonts, container width and toolbar are covered.
2. A theme plugin that subclasses `DefaultTheme` and overrides `DefaultThemeRenderContext` members (header, footer, toolbar, navigation) and injects markup at `RendererHooks` (`head.end`, `body.begin`, `footer.end` …). This is how [typedoc-github-theme / typedoc-material-theme and the other `typedoc-theme`-tagged packages](https://github.com/topics/typedoc-theme) work; it lets the API pages carry the site's actual header and nav HTML rather than a lookalike. It is a small TypeScript file that runs only when the docs are regenerated, so it does not violate "no build step" for the site itself.
3. [typedoc-plugin-markdown](https://typedoc-plugin-markdown.org/docs) — emit Markdown and render it through the site's own pipeline. There is no site pipeline here (hand-written HTML), so this only makes sense if a one-off script turns the Markdown into HTML using the same templates; it buys perfect consistency at the cost of owning an API-page template.

Recommendation: start with (1), and adopt (2) only if the header/nav lookalike is visibly off. Whatever direction is chosen, keep one code-highlight scheme (a Shiki theme JSON for TypeDoc and the same colours in the hand-written pages' CSS) so signatures on the API pages and snippets in the modules use identical tones.

---

## Appendix — raw probes

`scratchpad/css/probe.sh` (fetches a page, follows its `<link rel=stylesheet>`s, and greps `font-family`, `--*: #hex`, `max-width`/`font-size`/`line-height`); `probe1.txt` and `probe2.txt` hold the dumps for every site in §1.
