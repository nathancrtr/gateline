# Making model-drafted docs read as human: research and a pass protocol

Strategy memo for the gateline docs site (about 30k words: essays, onboarding modules, reference pages). Prepared 2026-09-18.

## 1. The short version

The research points one way. Word lists are the weakest signal and age fastest; structure and stance are what expert readers actually notice, and they survive "humanizer" passes. The Wikipedia project that maintains the best-known catalog of machine tells now lists "bland or robotic prose", "perfect grammar", "formal prose" and "transition words in isolation" as *ineffective* indicators, and notes that heavy LLM users detect model text about 90% of the time while everyone else is near chance ([Wikipedia: Signs of AI writing, Caveats](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)). Russell, Karpinska and Iyyer confirm the expert figure: five frequent ChatGPT users, voting, misclassified 1 of 300 articles, and their stated clues were vocabulary (53%), sentence structure (36%), grammar and punctuation (25%), originality (24%) and clarity (20%). After a humanizer pass, vocabulary clues dropped and structural and originality clues carried the verdict ([Russell et al. 2025](https://arxiv.org/html/2501.15654v2)).

Two findings shape the review protocol. LLM judges are poor at this task: on the LAMP corpus of professionally edited AI prose, the best model found problem spans at 0.46 precision against 0.57 for a second expert, and assigned the right *category* at 0.20 ([Chakrabarty et al. 2025](https://arxiv.org/html/2409.14509)); on the follow-up Writing Quality benchmark, frontier models "barely outperform random baselines" ([AI-Slop to AI-Polish, 2025](https://arxiv.org/abs/2504.07532)). So an agent can run the sweep and do the rewriting, but it cannot be the judge of whether the result reads as a person. That judgment stays with the maintainer, and the memo gives him a 10-minute way to exercise it.

The second is the over-correction trap he has already hit. "Human-like" and "liked by humans" are different targets: when Zhang et al. tuned prompts to remove the tells experts named, expert detection fell from 87.6% to 72.5%, but preference for the result did not rise in step ([Is Human-Like Text Liked by Humans?, 2025](https://arxiv.org/html/2502.11614v2)). The Slate piece on "AI paranoia" documents writers purging em dashes, "however" and lists of three from their own prose, and an English professor who convinced himself a 2019 paper was machine-written ([Slate, Aug 2025](https://slate.com/technology/2025/08/chatgpt-artificial-intelligence-shaming-paranoia-writing.html)). The better skills have absorbed this: anti-slop's first rule is "minimum effective edit... 'this text is fine' is a valid verdict. Over-editing human prose is the same failure as slop, pointed the other way" ([anti-slop SKILL.md](https://github.com/kjmagnan1s/anti-slop)).

One site-specific measurement, taken today on three of the repo's docs, is worth stating up front. Sentence length is already varied (DESIGN.md: median 17 words, 10th percentile 7, 90th percentile 36, standard deviation 13; WALKTHROUGH.md and TOPOLOGY.md similar). Em dashes run at 15 to 19 per 1,000 words. For comparison, the paper that traced em dashes to markdown-heavy training measured 0 to 9.1 per 1,000 words across twelve models *under suppression prompts* ([The Last Fingerprint, 2026](https://arxiv.org/abs/2603.27006)), and Wikipedia's page notes a July 2026 study finding Claude the only current model that uses them more than professional writers. On this site the dash, the closer paragraph and the antithesis are where the work is; burstiness is not.

## 2. The consolidated marker catalog

Grouped by level. Each entry says where it comes from and how much weight it carries alone. "Strong" means one sighting justifies an edit; "needs company" means act only when other tells share the passage; "ineffective" means the evidence says to ignore it. Markers already in the maintainer's catalog are marked (in catalog).

### 2.1 Word level

| Marker | Example | Weight | Source |
|---|---|---|---|
| Excess style vocabulary, 2023 to mid-2024 cohort | delve, intricate, tapestry, testament, pivotal, meticulous, realm, landscape, garner, interplay, underscore, bolster, vibrant (in catalog, partly) | Strong in clusters; single hits weak and aging fast | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [Kobak et al., Science Advances 2025](https://www.science.org/doi/10.1126/sciadv.adt3813) ("delves" 28x excess; 280 to 379 excess *style* words, mostly verbs and adjectives, unlike the content nouns of the COVID years) |
| Newer cohort, mid-2024 on | align with, enhance, fostering, highlighting, showcasing, emphasizing, crucial, enduring | Needs company | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (cohort split by date) |
| Copula avoidance | "serves as", "stands as", "functions as", "marks", "represents", "boasts", "features", "offers", "refers to" in place of is/has | Strong | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (10%+ drop in is/are in 2023 abstracts); [humanizer §18](https://github.com/blader/humanizer) |
| Cheerful synonyms for "use" and other stiff synonyms | leverage, utilize, harness, employ; authored (wrote), relocated (moved), attempted (tried) | Strong for leverage/utilize; the rest needs company | [Wikipedia, Signs of human writing: Syntax](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [GitLab style guide](https://docs.gitlab.com/development/documentation/styleguide/) bans leverage/utilize |
| Marketing adjectives | seamless, robust (figurative), comprehensive, cutting-edge, game-changing (in catalog) | Strong in marketing register; weak in technical prose where "robust" has a meaning | [anti-slop patterns.md Tier 1](https://github.com/kjmagnan1s/anti-slop); [SlopMonster](https://github.com/mcpeezy/SlopMonster) matches by root so "elevates" is caught |
| Magic adverbs and self-rating words | quietly, genuinely, honestly, actually, "clean", "exactly", "load-bearing", "earns its place" | Strong for the self-rating family; adverbs alone are not a tell | [sloplint self-rating category](https://github.com/benjaminjackson/sloplint); [paddo.dev on Opus 5 prose](https://paddo.dev/blog/a-dial-worth-turning/) ("load-bearing" 2x, "honestly/frankly" 1.5x) |
| Vague connection words | "associated with", "connected to", "linked to", "in connection with" where the real relation is known | Strong | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Curly quotes and spaced em dashes | " " around code-adjacent text; " — " with spaces | Needs company (editors auto-curl) | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Lexical variation for its own sake | developers, engineers, practitioners, builders in one paragraph | Needs company; listed as historical | [Wikipedia, Historical indicators](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |

### 2.2 Sentence level

| Marker | Example | Weight | Source |
|---|---|---|---|
| Negative parallelism, all variants (in catalog as antithesis) | not X but Y; not just X, but Y; it's not X, it's Y; "This does not mean X. It means Y."; Y rather than X; the clipped tail "..., no guessing"; the asyndetic chain "no fluff, no filler, no jargon" | Strong; but the humanizer's exception matters: keep it "when the negative half corrects a belief the reader actually holds, or when both halves carry information" | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [humanizer §1](https://github.com/blader/humanizer); [sloplint no-x-no-y](https://github.com/benjaminjackson/sloplint) |
| Rule of three / tricolon (in catalog) | "adjective, adjective, adjective"; three parallel examples; three facts then a lesson | Strong when items are padding; keep three real items | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [humanizer §6](https://github.com/blader/humanizer) |
| Present-participle rider | "..., ensuring/highlighting/underscoring/reflecting/enabling X" bolted to a fact | Strong; the PNAS study found present participial clauses among the top overused features | [Wikipedia, Superficial analyses](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [Reinhart et al., PNAS 2025](https://arxiv.org/abs/2410.16107) |
| Nominalization and noun-heavy density | "the implementation of validation" for "validating"; instruction-tuned models are "noun-heavy, informationally dense" even when told to be informal | Needs company; distinctive but shared with academic prose | [Reinhart et al.](https://arxiv.org/abs/2410.16107); Anthropic's own note that Fable 5.1 sentences "run longer and there are fewer paragraph breaks" ([Prompting Claude Fable 5.1](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)) |
| Agentless passive and false agency | "mistakes were made"; "the decision emerges"; "the data tells us" | Needs company | [Reinhart et al.](https://arxiv.org/abs/2410.16107); [stop-slop structures.md](https://github.com/hardikpandya/stop-slop) |
| Semicolon pseudo-list (in catalog) | "A does X; B does Y; C does Z." | Strong when it recurs | SlopMonster counts semicolons past a floor scaled to length ([README](https://github.com/mcpeezy/SlopMonster)) |
| Hedging stack | "could potentially", "might arguably", "in some cases it may" | Strong when stacked; single hedges (perhaps, tends to) are human | [humanizer §9](https://github.com/blader/humanizer); Wikipedia lists hedging qualifiers as a *human* sign |
| Em dash as universal connector | two per sentence; dash where a comma, colon or period would fix the relation | Needs company for one dash; strong at density | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [The Last Fingerprint](https://arxiv.org/abs/2603.27006) (persists even under explicit prohibition; a fine-tuning artifact, not a style choice) |
| Colon reveal | "The answer: simplicity." | Needs company | [anti-slop patterns.md](https://github.com/kjmagnan1s/anti-slop) |
| Mannered metaphor in place of a literal phrase | "a dial worth turning" for "a parameter worth varying"; "earns its keep" for "still matters" | Strong; Anthropic names this as the current Claude failure mode | [Prompting Claude Fable 5.1, Writing density](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1) |
| False range | "from ancient civilizations to modern startups" | Strong but rare in docs | [skill-deslop](https://github.com/stephenturner/skill-deslop); Wikipedia talk page found it in zero sampled articles |
| Hyphenated compound everywhere | "the report is high-quality" | Weak | [humanizer §10](https://github.com/blader/humanizer) |

### 2.3 Paragraph level

| Marker | Example | Weight | Source |
|---|---|---|---|
| Summarising closer / tidy final sentence | last sentence restates the first; "That is the real win."; "In short, ..." | Strong; the humanizer lists it among the five tells that most often survive a rewrite | [humanizer §2](https://github.com/blader/humanizer); [Wikipedia, Section summaries](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (listed as historical, but still common in docs) |
| Enumerated paragraph (in catalog) | "First, ... Second, ... Finally, ..." | Strong | [skill-deslop rule 7](https://github.com/stephenturner/skill-deslop) ("listicles disguised as prose") |
| Staged run-up and pivot | "Here's the thing:", "But here's the thing", "Let's dive in", "It's worth noting", "Let's break this down" | Strong | [humanizer §4](https://github.com/blader/humanizer); Wikipedia lists "it is important to note" as a 2023-era didactic disclaimer |
| Quip after the explanation | "(Yes, really.)", "Let that sink in.", a one-liner joke to close | Strong | [stop-slop](https://github.com/hardikpandya/stop-slop) ("cut quotables"); Google style guide's ban on "cutesy" tone |
| Arguing with no one | "This isn't mainly about X", "Some might say", "One might be tempted to", "To be clear" | Strong when the objection appears nowhere else | [humanizer §5](https://github.com/blader/humanizer) |
| Fractal summary | preview, content, recap in one section | Strong | [skill-deslop rule 8](https://github.com/stephenturner/skill-deslop) |
| Uniform sentence length (low burstiness) | every sentence 15 to 22 words | Strong when present; on this site it is largely absent (see §1) | [GPTZero on burstiness](https://gptzero.me/news/perplexity-and-burstiness-what-is-it/) (no longer used as their classifier, kept as one of seven indicators); [Zhang et al. 2025](https://arxiv.org/html/2502.11614v2) (experts cite "large deviations in length, structure, style" as the human sign) |
| Dense paragraph | 100+ words, no break, most sentences over 30 words | Needs company; a documented Fable 5.1 regression | [anti-slop patterns.md](https://github.com/kjmagnan1s/anti-slop), citing the Anthropic note |
| Same paragraph shape repeated | every paragraph ends punchy; every seam uses the same transition | Strong at document scale | [anti-slop, Seams](https://github.com/kjmagnan1s/anti-slop); [stop-slop](https://github.com/hardikpandya/stop-slop) |
| Synonym cycling within a paragraph | see 2.1 | Needs company | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |

### 2.4 Document structure

| Marker | Example | Weight | Source |
|---|---|---|---|
| Bold-led bullet lists | "- **Performance:** Performance has been enhanced..." | Strong; "inline-header vertical lists" is Wikipedia's own name for it | [Wikipedia, Style](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); [humanizer §19](https://github.com/blader/humanizer) |
| Headings as questions | "Why does the orchestrator never write gates?" | Needs company; question headings are a legitimate FAQ form, a tell when every heading is one | Editors' lists ([Slate](https://slate.com/technology/2025/08/chatgpt-artificial-intelligence-shaming-paranoia-writing.html)); AntiSlop's "headings that point at nothing" ([README](https://github.com/javidjamae/AntiSlop)) |
| Heading repeated in the first sentence | "## Performance / Speed matters." | Strong | [humanizer §24](https://github.com/blader/humanizer) |
| Title Case headings, emoji, arrows, horizontal rules between sections | | Strong for emoji/arrows; Title Case is a house-style question | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing); Microsoft ("When in doubt, don't capitalize") |
| Over-signposting and self-reference | "This page explains...", "In this section we will...", "The rest of this essay..." | Strong | [GitLab](https://docs.gitlab.com/development/documentation/styleguide/) bans self-referential openers; Wikipedia "Collaborative communication" |
| Outline-like "Challenges / Future outlook" closer | "Despite these challenges, X continues to..." | Strong | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Uniform section length and rigid outline | every H2 has three H3s of equal size | Needs company | [Wikipedia, "Headings only containing other headings"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Bold on every key term | | Strong when mechanical | [Wikipedia, Overuse of boldface](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Writing about the previous version in reference text | "This replaces the old approach which..." outside a changelog | Strong | [humanizer §25](https://github.com/blader/humanizer) |

### 2.5 Rhetorical stance

This is the level expert readers cite as "originality" and "clarity", and it is the level no regex reaches.

| Marker | What it looks like | Source |
|---|---|---|
| Significance inflation | a routine fact "marks a pivotal moment", "sets the stage", "reflects a broader shift" | [Wikipedia, Undue emphasis](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Borrowed authority | "experts argue", "observers note", "industry reports" with no one named | [Wikipedia, Vague attributions](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Portability | the sentence could move unchanged to another product's docs; says nothing about this one | [anti-slop spine rule 4](https://github.com/kjmagnan1s/anti-slop); Zhang et al.: humans give "concrete numbers, specific names, exact places or dates" |
| Sterile evenness | no position anywhere; every trade-off balanced; "the millennial gray of prose" | [Semantic ablation thread, HN](https://news.ycombinator.com/item?id=47049088); anti-slop rule 8 ("sterile is also slop"), with the exemption that reference text is *supposed* to be neutral |
| Sycophancy and chat residue | "Great question", "I hope this helps", "You're absolutely right" | [humanizer §22](https://github.com/blader/humanizer) |
| Knowledge-cutoff guessing | "while details are limited, it likely..." | [Wikipedia](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Faux insight | "What most people get wrong is...", "The part everyone misses" | [anti-slop patterns.md](https://github.com/kjmagnan1s/anti-slop) |
| Lack of a stake or a decision | explains without ever saying what the reader should do or what the author chose and why | Diátaxis explanation guidance ("W is better than Z, because..."; "admit opinion") ([diataxis.fr/explanation](https://diataxis.fr/explanation/)); Julia Evans pattern 13, "what without why" ([jvns.ca](https://jvns.ca/blog/confusing-explanations/)) |

### 2.6 Ineffective indicators (do not sweep for these)

From [Wikipedia's "Ineffective indicators" section](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing): perfect grammar; mixed casual and formal register; "bland" or "robotic" prose as a gestalt; "fancy" or academic prose in general (only *specific* words correlate); transition words in isolation; unsourced content. Its "Signs of human writing" section adds constructions that are *more* common in human text and should be left alone or restored: "there is a", "it has a"; plain verbs (wrote, moved, used, tried); superlatives ("the only", "the first"); hedging qualifiers and intensifiers ("very", "perhaps", "tends to"); and the wordy human constructions "as a result of", "in order to", "the fact that". That last group is a direct conflict with stop-slop's "kill all adverbs" and GitLab's "in order to" ban. The resolution for this site: follow the style guide on "in order to" (it costs nothing), but never treat "perhaps" or "tends to" as a tell.

## 3. Positive practice: what the documentation guides actually say

The de-slop skills are all negative space. The guides below describe what to write toward, which is the only way to avoid the over-correction trap: a sentence with a target reads better than a sentence with only prohibitions.

**Diátaxis** ([diataxis.fr](https://diataxis.fr/)) assigns a register per quadrant: tutorials use "we" and reassure; how-to guides use the imperative; reference is "austere" and describes; explanation is discursive and may "admit opinion and perspective", using moves like "The reason for X is because historically, Y", "W is better than Z, because", and "Some users prefer W (because Z). This can be a good approach, but..." ([Explanation page](https://diataxis.fr/explanation/)). The critique from Tom Johnson is that users do not move through quadrants cleanly, that concept and task blend in practice, and that granular sub-types of explanation were more useful than the four buckets; his recommendation is to use the four *shapes* even without the four *sections* ([I'd Rather Be Writing](https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework)). For the pass this matters because a reference page and an essay should receive different rewrite briefs: neutral, "is/has" prose is the correct human voice for reference (anti-slop says so explicitly), while the essays need a stated position to avoid reading as sterile.

**Google developer documentation style guide, Voice and tone** ([developers.google.com/style/tone](https://developers.google.com/style/tone)): "casual, natural, and approachable, not pedantic or pushy"; avoid buzzwords, figurative language, "please" in instructions, "simply/easy/quickly" in procedures, exclamation marks, cutesy jokes, placeholder phrases like "please note" and "at this time", and "choppy, verbose, or repetitive sentence structures". The three-way example (too informal / just right / too formal) is a usable calibration for reviewers.

**Microsoft Writing Style Guide, top 10 tips** ([learn.microsoft.com](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)): "Write like you speak. Read your text aloud."; use contractions; "Get to the point fast. Lead with what's most important."; "Revise weak writing: start each statement with a verb... avoid *there is*, *there are*"; sentence-style capitalization; and a worked before/after for each tip. The read-aloud instruction is the basis for §5(c).

**GitLab documentation style guide** ([docs.gitlab.com](https://docs.gitlab.com/development/documentation/styleguide/)): voice is "concise, direct, and precise... conversational but brief, friendly but succinct"; active voice; second person; present tense; contractions except in reference docs, warnings and error messages; ban on "allows you to", "enables you to", "easily", "simply", "please", "note that", "in order to", "leverage", "utilize"; ban on self-referential openers ("This page explains..."); avoid "-ing" words and ambiguous "it" for translation. This is the closest published match to the maintainer's existing catalog and a good source of Vale rules.

**Write the Docs** ([style guides page](https://www.writethedocs.org/guide/writing/style-guides/)): "write like a human, not a robot" (in the error-message context); points to the Federal Plain Language guide, 18F and gov.uk for plain language, and to Microsoft/Google/Apple for house style.

**Docs for Developers** (Bhatti, Corleissen, Lambourne, Nunez, Waterhouse): the process point that matters here is that five authors with distinct styles appointed one editor-in-chief "to ensure all of the chapters had the same voice and tone" ([interview](https://www.everythingtechnicalwriting.com/writing-docs-for-developers-with-jared-bhatti/)). For a 30k-word site rewritten by agents in batches, one human voice-owner reviewing every batch is the equivalent.

**Stripe** ([Slab on Stripe's writing culture](https://slab.com/blog/stripe-writing-culture/)): paragraphs of three to four sentences; peer review of writing "like code review"; diagrams where prose would strain; footnotes for evidence. **Divio** is the earlier name of Diátaxis ([docs.divio.com](https://docs.divio.com/documentation-system/)).

**The Rust book** ([Ownership chapter](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)): "we" and "you" interchangeably; the code example comes *before* the definition; contractions throughout; admissions of difficulty ("it does take some time to get used to") and encouragement ("Keep at it!"); sentence length swings from "This is a problem." to 30-word walkthroughs. This is the register the onboarding modules should aim at.

**Julia Evans, "Patterns in confusing explanations"** ([jvns.ca](https://jvns.ca/blog/confusing-explanations/)): thirteen patterns, each with a fix. The ones that bear on this pass: start concrete, not abstract; keep an analogy to a single idea; use realistic examples; "prove that your statements are true" with something the reader can verify; give each new concept room; explain the why, from experience.

**Dan Luu, "Some thoughts on writing"** ([danluu.com](https://danluu.com/writing-non-advice/)): most writing advice is "thinly veiled descriptions of how someone writes"; he keeps long, meandering sentences because they reflect how he thinks; he adds "more examples than I would naturally tend to" because readers asked; he rejects "omit needless words" when the words carry caveats and evidence. The lesson for the pass: the goal is a specific person's voice, not a generic "clean" one, and precision beats polish when they conflict.

The common thread across all of these: second person, plain verbs, the example before the definition, the concrete noun, short paragraphs, and permission to state an opinion in explanatory text. None of them says "vary sentence length" as a rule; they say "read it aloud", and variety follows from meaning.

## 4. Prompt-side skills and linters: what is operational

Read in full: stop-slop, anti-slop, humanizer (v3), skill-deslop, sloplint, plus the READMEs of slopster, SlopMonster and AntiSlop.

**[stop-slop](https://github.com/hardikpandya/stop-slop)** (Hardik Pandya, ~9.8k stars). Eight rules and a twelve-item checklist. Operational: the structures table (binary contrasts, negative listing, dramatic fragmentation, rhetorical setups, false agency, narrator-from-a-distance), the "three consecutive sentences match length" check, the "paragraph ends punchy" check. Vibes: "kill all adverbs", "no em dashes at all", "no passive voice", "no Wh- openers", and a 1 to 10 self-score on Directness/Rhythm/Trust/Authenticity/Density that the LAMP results say a model cannot produce reliably. Its examples show the over-correction risk in the skill itself: "In today's fast-paced landscape, we need to lean into discomfort..." becomes "Move faster. Your competition is.", which is a different genre, not an edit.

**[humanizer v3](https://github.com/blader/humanizer)** (blader). The best-designed of the set. Twenty-five patterns numbered strongest first, with the explicit rule that §1 to §5 justify an edit on one sighting while patterns marked *weak alone* need company. Operational and worth lifting verbatim: the "why AI text sounds the way it does" framing (staging, rhythm by rule, inflation, formatting by rule, leftovers); the exception clauses ("keep a contrast only when the negative half corrects a belief the reader actually holds"; "keep three real items when the meaning needs three"; "ordinary hedges such as *perhaps* or *tends to* are human habits and not tells"); the file-mode rule ("change prose only. Keep code blocks, inline code, commands, paths, YAML metadata, data, and link targets unchanged"); the fact-preservation check (did the rewrite add or drop "any fact, name, number, date, quote, citation, ranking"); and the "when not to act" list of voice details to keep. Its one blanket rule, no dashes unless the sample has them, is the one to soften for this site.

**[anti-slop](https://github.com/kjmagnan1s/anti-slop)** (kjmagnan1s; consolidates the two above). Operational: three vocabulary tiers (always replace / flag in clusters / flag by density), which is the right shape for a Vale package; "structure is the #1 detection signal, above vocabulary"; context profiles (docs, technical-blog) with a rule that "technical reference and encyclopedic text are exempt: neutral is the correct human voice there"; the *seams* section, which observes that banning transitions backfires ("the metronome moves") and prescribes varying the *shape* of a connection; the "portability test"; a mandatory fresh-context verifier subagent that reports only misses *and over-corrections*; and a size budget on the rule set, on the grounds that "over-constraint breeds displacement tells". Vibes: the "add disfluency" and "TTS test" checks.

**[skill-deslop](https://github.com/stephenturner/skill-deslop)** (Stephen Turner, aimed at scientific writing). Adds the register rule that "domain terminology is fine and expected... 'weighted interval score' is precise language, not jargon", which is the terms-of-art protection this site needs. Its inline example is a good docs-prose fix: "It's worth noting that these findings have important implications for how we navigate the challenges of..." becomes a concrete conditional claim.

**[sloplint](https://github.com/benjaminjackson/sloplint)** (Ruby, dependency-free, 80 rules in nine categories, JSON output with `severity` and `confidence` kept separate, `--markdown` blanks code and URLs). Admission criterion is the right one: "a pattern earns a place in the catalog only if it shows up constantly in AI writing and rarely in careful human writing. Passive voice, weak adverbs, wordiness, clichés a person reaches for too: those belong in proselint". Its self-rating category (clean-x, honest-x, worth-naming, earns-its-place, does-a-lot-of-work, exact/exactly) covers the newest Claude tics better than any other tool.

**[slopster](https://github.com/t0ddharris/slopster)** ships six Vale YAML rules (AISlop negation pivots, BannedWords, JargonSwaps, WeakWords, EmDash with a per-document max, Orwell) and argues the layering the protocol below adopts: agent for structure, Vale as "the deterministic safety net", a diff tool that reports only *new* findings on a branch. **[SlopMonster](https://github.com/mcpeezy/SlopMonster)** scores out of 5 and fails the build below 5; its distinctive idea is that the cleanse runs on a *different model family* than the draft ("a model cannot hear its own accent"), and it always re-lints after the cleanse because "a frontier model is very good at removing tells and quite capable of adding new ones while it does". No evidence is offered for the rival-model claim; treat it as a cheap heuristic. **[AntiSlop](https://github.com/javidjamae/AntiSlop)** is the only linter that publishes a measured false-positive rate per rule against 101k lines of pre-2022 human prose, keeps the contrast rules *off* by default because they have "a real false-positive tail on human prose", and states the test the protocol uses for antithesis: "delete the contrast, and if no information is lost, cut it."

**Anthropic's guidance** ([Prompting Claude Fable 5.1, Writing density](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)) names the current failure mode as *mannered prose* and supplies a paragraph to paste into the user message (preferred over the system prompt): "Mannered prose substitutes metaphor and flourish for direct statement. Instead of 'a parameter worth varying,' the mannered writer produces 'a dial worth turning'... The fix is to say what you mean. When a literal phrase is available, use it." It also warns that anti-formatting blocks written for older models now suppress structure Fable 5.1 needs, and that its prose runs denser (longer sentences, fewer breaks) than Fable 5's. The general best-practices page recommends telling the model what to do instead of what not to do ([Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)). [paddo.dev's evaluation](https://paddo.dev/blog/a-dial-worth-turning/) finds the mannered-prose prompt "tends to work" but lacks the permanence of a vocabulary standard.

**What the LAMP and WQ findings imply for the protocol.** Chakrabarty et al. had 18 professional writers make 8,035 edits on 1,057 LLM paragraphs under a seven-category taxonomy (cliché, unnecessary exposition, purple prose, poor sentence structure, lack of specificity, awkward word choice, tense inconsistency); the most frequent problems were awkward word choice (28%), poor sentence structure (20%), redundant exposition (18%) and cliché (17%). Asked to find the same spans, the best models managed 0.46 general precision against 0.57 expert-to-expert, and 0.20 on category ([paper](https://arxiv.org/html/2409.14509)). The follow-up benchmark found frontier LLMs "barely outperform random baselines" at expert writing preference until a purpose-trained reward model reached 74% ([AI-Slop to AI-Polish](https://arxiv.org/abs/2504.07532)). Three consequences:

1. Do not gate on an LLM's "does this read as human?" score, and do not ask the agent for a 1 to 10 rubric. Gate on the deterministic sweep plus the maintainer's sample.
2. Use the LLM as a *span flagger with the rule cited*, never as a free-form judge. A flag that names a rule is checkable; a verdict is a guess.
3. The rewriter's self-assessment will be near random on register, so the completeness check has to be structural (a second pass with fresh context, against the same rule list) and the register check has to be human.

## 5. What readers actually notice, and the over-correction problem

**Expert readers.** Russell et al. (ACL 2025): the majority vote of five frequent-ChatGPT-user annotators was 99.3% accurate on 300 non-fiction articles and stayed perfect on 60 humanized articles, though individual confidence dropped. Clue categories by frequency: vocabulary 53.1%, sentence structure 35.9%, grammar and punctuation 24.8% ("usually grammatically perfect"), originality 23.7% ("lacks surprises or humor"), quotes 22.3%, clarity 19.5% ("over-explains"). After humanization, vocabulary mentions fell from 57.1% to 42.3% while formulaic structure and originality persisted. Non-experts scored 56.7% true positives against 51.5% false positives, at high confidence ([paper](https://arxiv.org/html/2501.15654v2)). Zhang et al. replicate at 87.6% across nine languages and name the human signs as concrete numbers, names, places and dates; "diversity and inconsistency with large deviations in length, structure, style and emotions"; and the absence of markdown formatting ([paper](https://arxiv.org/html/2502.11614v2)).

The practical reading for technical docs: after the word list is applied, what remains detectable is (a) structural regularity (same paragraph shape, same closer, same connective), (b) the absence of anything only this author could have written (a real number, a named file, a decision and its reason), and (c) over-explanation. The catalog in §2.5 is where the second pass should spend its attention.

**Burstiness.** GPTZero defined it as variance of per-sentence perplexity across a document and stopped using it as its classifier in autumn 2023, keeping it as one of seven indicators ([GPTZero](https://gptzero.me/news/perplexity-and-burstiness-what-is-it/)); Pangram calls perplexity and burstiness "unreliable" and trains a classifier on a million documents with hard-negative mining instead ([Pangram](https://www.pangram.com/research/how-it-works)). The humanizer-tool literature repeats that "real human burstiness is variation driven by meaning, emerging from the writing, not from a rule about varying", and that mechanical short/long alternation is its own tell ([TextSight](https://www.textsight.ai/blog/sentence-length-variance/)). On this site the measured spread is already healthy (§1), so the brief should say "do not flatten what is there" rather than "add variety".

**Over-correction.** Three documented forms:

- *Purging good conventions.* Slate's account of writers dropping "however", em dashes and metaphors from their own prose, and a university telling faculty to treat "good grammar as suspect", with the observation that "an inherent suspicion of good writing is probably anathema to producing good writing" ([Slate](https://slate.com/technology/2025/08/chatgpt-artificial-intelligence-shaming-paranoia-writing.html)). The LessWrong defense makes the parallel point that the "not X but Y" move survives because it mirrors how an insight replaces a misconception; the problem is the reflex, not the form ([A Thoughtful Defense of AI Writing](https://www.lesswrong.com/posts/BG32yBoHx8jveqRmf/a-thoughtful-defense-of-ai-writing)).
- *Displacement.* anti-slop's maintainers observed that banning transitions moves the metronome elsewhere and that "blunt 'never' rules stacked deep recreate the over-polishing failure they are meant to fix" ([anti-slop](https://github.com/kjmagnan1s/anti-slop)). SlopMonster re-lints after every cleanse for the same reason.
- *Detectable but disliked.* Zhang et al.'s finding that lowering detectability from 87.6% to 72.5% did not raise preference; and the Reuters Institute summary that AI prose "avoids slang, contractions, colloquial language" so that "local crime stories start to read like police press releases", which is a register failure no marker list fixes ([Reuters Institute](https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters)).

"Sounds like a person" versus "has no tics": a page with zero flagged markers can still be portable, stakeless and evenly balanced, and expert readers will still call it machine text on originality grounds. The reverse also holds: a page with two em dashes and one antithesis written by someone who chose them reads as a person. The protocol therefore has a floor (the sweep) and a separate ceiling check (the maintainer's sample), and the two are not interchangeable.

## 6. The pass protocol

Scope: existing pages, one page per agent task, batches of about five pages per PR. The agent rewrites; the maintainer judges. Nothing merges on the agent's say-so.

### 6(a) Deterministic sweep

Run before and after every rewrite; the "after" run must show no hard-rule hits and no increase in any soft count. Exemptions everywhere: fenced code, inline code, blockquotes, link URLs, front matter, tables, and any quotation from `runs/` records (historical text stays as written). Headings are exempt from the word rules and get their own two checks.

Hard rules (zero allowed; the existing Vale package covers most of these):

- Banned vocabulary (the catalog plus: serves as / stands as / functions as / acts as; associated with / connected to where the relation is known; worth noting / it's worth / here's the thing / let's dive / let's break this down; in summary / in conclusion / overall, / ultimately, at paragraph start; "not only... but also"; "no X, no Y" chains).
- Enumerated paragraphs: `^(First|Second|Third|Finally|Lastly),` at sentence start in running prose.
- Bold-led bullets: `^\s*[-*] \*\*[^*]+\*\*:?\s`.
- Heading repeated as first sentence; heading in Title Case; emoji or arrow glyphs in prose.
- Chat residue and cutoff disclaimers.
- Hedging stacks: `(may|might|could) (potentially|possibly|arguably)`.

Soft counts, reported per page with a target; a number over target is a flag for the rewrite brief, not an automatic fail:

- Em dashes per 1,000 words: target at most 3 (current pages run 15 to 19). Count both `—` and ` -- `.
- Antitheses (all negative-parallel variants, including split-across-sentences and the clipped tail): target at most 1 per 500 words, and each kept instance must appear in the agent's "kept on purpose" list with the reason.
- Tricolons (three coordinated items of parallel form in one sentence): target at most 1 per page outside genuine three-item lists.
- Semicolons per sentence 2 or more: target zero.
- `-ing` riders: `, (ensuring|enabling|allowing|highlighting|underscoring|reflecting|showcasing|emphasizing|fostering|contributing to)\b`: target zero in essays, rare in reference.
- Question-form headings: report count; flag if more than a third of headings.
- Closer heuristic: for each paragraph of three or more sentences, the last sentence shares 60% or more of its content words with the first: report.
- Sentence-length stdev and the 10th/90th percentile: report, so the reviewer can see if a rewrite *flattened* a page.
- Paragraphs over 120 words with no sentence under 12 words: report.

Invariant diff, run on the before/after pair, must be empty: the multiset of inline-code spans, fenced blocks, link targets, headings (after case normalization), numbers, and the project lexicon (gate, profile, run, arm, closure, reconciler, Gatehouse, and the rest of the DESIGN.md term list) must be identical. This is the mechanical guarantee that "keep every fact and every term of art" was honored; the agent cannot rename a thing without tripping it.

Tooling: the existing Vale package for vocabulary and phrase rules; sloplint's `--markdown` mode for the cadence rules it has that Vale cannot express (multi-line "no X, no Y" chains, self-rating words); a 60-line script for the counts and the invariant diff. Report only *new* findings relative to `main` on the PR, as slopster's `slop-diff` does, so historical text does not generate noise.

### 6(b) The rewrite brief, per page

The brief goes in the user message, page by page. It says what the page is, what to do, and what not to do, in that order.

> You are editing `<path>`, a **<tutorial | how-to | reference | explanation>** page in the gateline docs. Its reader is an engineer who already uses an LLM coding assistant and is learning to run several agents with human approval at gates. The register for this page type: <tutorial: "we" and "you", reassuring, example before definition | how-to: imperative, terse | reference: neutral, "is/has", no opinion | explanation: second person, discursive, state the decision and the reason, opinion allowed>.
>
> The sweep report is attached. Fix every hard-rule hit. For each soft count over target, bring it under target, except where the note below says to keep an instance.
>
> Do:
> - Keep every fact, number, path, command, identifier, link, heading and term of art exactly. `gate`, `profile`, `run`, `arm`, `closure`, `reconciler`, `Gatehouse` are the lexicon; never substitute a synonym for one. The invariant diff will reject the edit if any of these change.
> - Prefer the concrete noun and the plain verb: `state.yaml`, not "the configuration"; "is", not "serves as"; "use", not "leverage". Say what the reader does: "run `gateline arm <slug>`", not "the run can then be armed".
> - Where a decision turns on a distinction (a rule and the thing it forbids; a design choice and the rejected alternative), one sharp antithesis is allowed and is often the clearest form. Test each one by deleting the negative half: if a fact is lost, keep it; if nothing is lost, state the positive half alone.
> - Replace an em dash with whichever of comma, colon, parentheses or period states the relation the dash was hiding. If none does, split the sentence. Leave one dash in a page if it is the best punctuation for that sentence.
> - Let sentence length follow the idea. A one-clause rule can be a short sentence; a mechanism with a condition can be long. Do not alternate by pattern, and do not flatten variety that is already there.
> - Where a paragraph ends by restating its opening, end it on the last concrete fact instead.
> - Where the page names a trade-off, make sure it says which side the framework chose and why. In an explanation page, an opinion with a reason is wanted; in a reference page it is not.
> - Remove all mannered prose: where a metaphor stands in for a literal phrase and a literal phrase exists, use the literal phrase. (Anthropic's paragraph, verbatim, follows here.)
>
> Do not:
> - Restructure. Keep the heading tree, section order, list-versus-prose choices and paragraph boundaries unless a specific rule (bold-led bullets, heading repeated in first sentence, question heading) requires a local change.
> - Add anything: no new facts, examples, caveats, transitions, summaries, introductions or "in this section" sentences. If a seam needs no connective, start the next thought.
> - Hedge. Do not add "may", "typically", "generally", "in most cases" to a statement the page makes flatly; do not remove a hedge the page makes on purpose.
> - Touch code blocks, inline code, blockquotes, tables, link targets, or quoted text from `runs/`.
> - Reflow for its own sake. A sentence with no flagged pattern that reads plainly stays as written. "This page is fine" is a valid result for any paragraph.
> - Replace one tic with another: no colon reveals in place of dashes, no one-word sentences in place of closers, no rhetorical questions in place of "here's the thing".
>
> Return: the edited file; a list of every change with the rule it answers; a list of flagged instances you kept on purpose, each with a one-line reason; and a yes/no answer to "does the edit add or drop any fact, number, name, path, command or claim?"

Then a second agent, fresh context, gets the original, the edit, the change list and the same rule list, with one job: report misses *and over-corrections* (a stripped antithesis that carried a fact, a hedge removed from a real caveat, a flattened example, a renamed term), as anti-slop's verifier does. It does not rewrite.

Model choice: if the pages were drafted by one model family, run the rewrite on another. The evidence for this is anecdotal (SlopMonster's "a model cannot hear its own accent"), but the cost is zero and the tic catalogs differ by family (Claude: dashes, self-rating words, mannered metaphor; GPT: "delve"-era vocabulary, "not just X but Y"; per the Wikipedia cohort notes and paddo.dev).

### 6(c) Read-aloud and blind review

Who: the maintainer. He is, by Russell et al.'s definition, an expert detector (frequent LLM user), which is the only population that scores above chance. No LLM stands in for this step.

How, per batch:

1. A script pairs each rewritten paragraph with its original, shuffles the order within each pair, and prints eight pairs drawn at random from the batch (weighted toward paragraphs the sweep changed most).
2. He reads each pair aloud (Microsoft's rule; Google's "choppy, verbose, or repetitive" test is easiest to hear) and marks which one reads as written by a person, or "same".
3. Score: if the rewrite wins fewer than five of eight, the batch goes back with the losing pairs attached as examples of what not to do. If he marks "same" on most pairs, the pass is doing too little or the page was already fine; either is useful information.
4. Separately, for any explanation page in the batch, he answers one question: "what does this page say the framework decided, and why?" If he cannot answer from the rewrite but could from the original, the rewrite lost the stance and goes back.

A second reader, if one is available, does the same eight pairs without seeing his marks. Two readers who agree the rewrite reads as a person is the strongest evidence this protocol can produce; it is also the evidence the literature says matters, because a majority of expert readers is the detector that beat every commercial tool.

### 6(d) The 10-minute sampling check

For a PR the maintainer did not have time to review in full:

1. (1 min) Read the sweep summary table: hard-rule hits after must be 0; dash density and antithesis count under target; sentence-length stdev not lower than before by more than 2; invariant diff empty.
2. (2 min) Open the invariant diff output and eyeball the "kept on purpose" list. Every kept antithesis should sit on a rule or a decision. If one sits on a description, that is a miss.
3. (4 min) Pick one page. Read its first paragraph, its last paragraph, and one paragraph from the middle chosen by scrolling blind. In each: does the last sentence restate the first? Is there a dash pair? A bold-led bullet nearby? A sentence that could be moved to another product's docs unchanged? Any of these is a miss to note on the PR.
4. (2 min) Run `git diff --word-diff` on one page and scan for added words. Anything added that is not punctuation or a plain verb ("is", "use", "run") is suspect: the brief said add nothing.
5. (1 min) Read one changed sentence aloud. If it is stiff, say so on the PR with the original beside it; that pair becomes a fixture for the next brief.

Merge if 1 and 2 pass and 3 to 5 turned up at most one miss. Otherwise send back with the specific paragraph.

## 7. Before and after: docs-prose tics fixed without stilting

These use invented gateline-flavored sentences so as not to pre-empt the pass on real pages.

1. Staged run-up plus copula avoidance.
   Before: *It's worth noting that `state.yaml` serves as the authoritative record of a run once the profile is chosen.*
   After: *Once the profile is chosen, `state.yaml` is the authoritative record of the run.*

2. Summarising closer.
   Before: *...The reconciler reads the profile, compares it with the gates already decided, and adds the ones the lighter profile lacked. In short, the reconciler is what makes a profile upgrade safe.*
   After: *...The reconciler reads the profile, compares it with the gates already decided, and adds the ones the lighter profile lacked.* (End there. The paragraph's first sentence already said what the reconciler is for.)

3. Antithesis kept where the decision turns; second one cut.
   Before: *The orchestrator advances runs; it never approves a gate. This is not a limitation of the implementation but a principle of the design. It is not a toggle, it is a rule.*
   After: *The orchestrator advances runs; it never approves a gate. That is a principle of the design, not a limitation of the implementation.* (The first antithesis states a prohibition and is the content. The second carries a real correction, so it stays once. The third repeats the second and goes.)

4. Enumerated paragraph.
   Before: *First, `gateline new` stages the record. Second, a human reviews the intent brief. Third, `arm` makes the run dispatchable. Finally, the draft PR appears.*
   After: *`gateline new` stages the record for a human to review. Nothing dispatches until `arm`, which is also what opens the draft PR.* (Four steps were two actions and two consequences.)

5. Present-participle rider.
   Before: *The engine pauses dispatch when the checkout goes dirty, ensuring no unreviewed code controls metered agents.*
   After: *The engine pauses dispatch when the checkout goes dirty, so unreviewed code is never in charge of metered agents.* (Same fact, stated as the consequence it is.)

6. Cheerful synonym for use, plus a vague verb.
   Before: *Leverage the CLI to surface the current state of a run.*
   After: *Run `gateline status` to see where a run is.*

7. Bold-led bullets to prose, where the labels carried nothing.
   Before:
   *- **Inspect:** Use `status`, `inbox`, and `show` to inspect runs.*
   *- **Decide:** Use `approve` and `decline` to decide gates.*
   After: *`status`, `inbox` and `show` read a run; `approve` and `decline` act on its gates.* (Where labels are real categories, as in the AGENTS.md command list, keep the list and drop the bold.)

8. Hedging stack on a flat rule.
   Before: *Downgrading a profile mid-run may potentially cause the engine to escalate in some cases.*
   After: *Downgrading a profile mid-run is forbidden. An engine that sees a profile lighter than the gates already decided escalates.*

9. Pivot and quip.
   Before: *But here's the thing: a staged run does nothing at all. (Yes, really.)*
   After: *A staged run is inert.*

10. Em dash pair and semicolon pseudo-list in one sentence.
    Before: *Three adapters are built — `claude-code`, `copilot-cli`, and `opencode` — each narrows a role; none widens it; the role spec is the ceiling.*
    After: *Three adapters are built: `claude-code`, `copilot-cli` and `opencode`. An adapter may narrow a role but never widen it. The role spec is the ceiling.* (The dash pair was a colon; the semicolons were three sentences. The antithesis in the middle states the rule and stays.)

## 8. Over-corrections to refuse

1. **Stripping an antithesis that carries the rule.**
   Original: *Gate approvals are written only by the named human approver; agents never self-approve a gate.*
   Over-corrected: *Gate approvals are written by the named human approver.*
   The prohibition on agents is the point of the sentence, and the over-correction loses it. The deletion test (remove the negative half; is a fact lost?) says keep.

2. **Manufactured burstiness.**
   Original: *A run whose `state.yaml` carries no `profile:` is treated as `full`.*
   Over-corrected: *No `profile:` line? Full. Every time.*
   The fragments are a tell of their own (stop-slop calls it dramatic fragmentation; the humanizer lists "a row of fragments" under its strongest patterns), and the reference register does not want them. Variety comes from the ideas on the page, not from chopping one.

3. **Dash removal that breaks the sentence, or de-hedging a real caveat.**
   Original: *A clean fast-forward instead exits the engine 75 — to be restarted on the new code — rather than pausing.*
   Over-corrected: *A clean fast-forward instead exits the engine 75, to be restarted on the new code, rather than pausing.* The commas now attach "rather than pausing" to "restarted". Correct: *A clean fast-forward does not pause the engine. It exits 75 so the engine restarts on the new code.*
   And the hedging case: *The e2e geometry check can fail by a few pixels on CI Linux; rerun before investigating* must not become *The e2e geometry check fails on CI Linux.* The "can" is the fact.

A fourth, implied by anti-slop's seams note: stripping every transition until paragraphs jump. The fix for a mechanical "Additionally," is usually to delete it and start the next thought, not to replace it with "Beyond that,".

## 9. Sources

Catalogs and detection
- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup; fetched as raw wikitext, all sections)
- [Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess vocabulary", Science Advances 2025](https://www.science.org/doi/10.1126/sciadv.adt3813); [arXiv version](https://arxiv.org/html/2406.07016v1)
- [Liang et al., "Mapping the Increasing Use of LLMs in Scientific Papers", 2024](https://arxiv.org/abs/2404.01268) (950,965 papers; CS fastest at 17.5%)
- [Juzek and Ward, "Why Does ChatGPT 'Delve' So Much?", COLING 2025](https://arxiv.org/abs/2412.11385) (21 focal words; RLHF suspected, not proven)
- [Reinhart et al., "Do LLMs write like humans? Variation in grammatical and rhetorical styles", PNAS 2025](https://arxiv.org/abs/2410.16107)
- [Russell, Karpinska, Iyyer, "People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text", ACL 2025](https://arxiv.org/html/2501.15654v2)
- [Zhang et al., "Is Human-Like Text Liked by Humans?", 2025](https://arxiv.org/html/2502.11614v2)
- [Chakrabarty et al., "Can AI writing be salvaged?" (LAMP), CHI 2025](https://arxiv.org/html/2409.14509)
- [Chakrabarty et al., "AI-Slop to AI-Polish?", 2025](https://arxiv.org/abs/2504.07532)
- ["The Last Fingerprint: How Markdown Training Shapes LLM Prose", 2026](https://arxiv.org/abs/2603.27006)
- [Dugan et al., "Real or Fake Text?", AAAI 2023](https://ojs.aaai.org/index.php/AAAI/article/view/26501) (annotator skill varies widely and improves with incentives)
- [GPTZero, "What is perplexity & burstiness"](https://gptzero.me/news/perplexity-and-burstiness-what-is-it/); [GPTZero, "How AI detectors work"](https://gptzero.me/news/how-ai-detectors-work/)
- [Pangram, "How AI detection works"](https://www.pangram.com/research/how-it-works); [Pangram blog](https://www.pangram.com/blog/how-does-ai-detection-work)
- [Originality.ai, "Most commonly used ChatGPT words & phrases"](https://originality.ai/blog/can-humans-detect-chatgpt) (finds the word-level differences are small)

Editors and commentary
- [Slate, "A.I. is making your writing worse, but not in the way you think", Aug 2025](https://slate.com/technology/2025/08/chatgpt-artificial-intelligence-shaming-paranoia-writing.html)
- [Reuters Institute, "How AI-generated prose diverges from human writing"](https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters)
- [LessWrong, "A Thoughtful Defense of AI Writing"](https://www.lesswrong.com/posts/BG32yBoHx8jveqRmf/a-thoughtful-defense-of-ai-writing)
- [Hacker News, "Semantic ablation: why AI writing is generic and boring"](https://news.ycombinator.com/item?id=47049088)
- [Hacker News, "I'm Kenyan. I don't write like ChatGPT, ChatGPT writes like me"](https://news.ycombinator.com/item?id=46273466)
- [Alex Banks, "You Sound Like ChatGPT"](https://thesignal.substack.com/p/you-sound-like-chatgpt)
- [paddo.dev, "A Dial Worth Turning"](https://paddo.dev/blog/a-dial-worth-turning/)
- [Fabrizio Ferri-Benedetti, "What's wrong with AI-generated docs"](https://passo.uno/whats-wrong-ai-generated-docs/)
- [I'd Rather Be Writing, podcast with Sarah Deaton (Anthropic) on docs forensics](https://idratherbewriting.com/blog/podcast-deaton-anthropic-tw-automation) (pitfalls corpus; "steers per PR" as the metric)

Documentation practice
- [Diátaxis](https://diataxis.fr/); [Explanation](https://diataxis.fr/explanation/); [Divio documentation system](https://docs.divio.com/documentation-system/)
- [Tom Johnson, "What is Diátaxis and should you be using it"](https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework)
- [Google developer documentation style guide: Voice and tone](https://developers.google.com/style/tone)
- [Microsoft Writing Style Guide: Top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)
- [GitLab Documentation Style Guide](https://docs.gitlab.com/development/documentation/styleguide/)
- [Write the Docs: Style guides](https://www.writethedocs.org/guide/writing/style-guides/)
- [Docs for Developers (Bhatti, Corleissen, Lambourne, Nunez, Waterhouse)](https://docsfordevelopers.com/); [author interview](https://www.everythingtechnicalwriting.com/writing-docs-for-developers-with-jared-bhatti/)
- [Slab, "How Stripe built a writing culture"](https://slab.com/blog/stripe-writing-culture/)
- [The Rust Programming Language, ch. 4.1](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)
- [Julia Evans, "Patterns in confusing explanations"](https://jvns.ca/blog/confusing-explanations/)
- [Dan Luu, "Some thoughts on writing"](https://danluu.com/writing-non-advice/)

Skills and linters
- [stop-slop](https://github.com/hardikpandya/stop-slop) (SKILL.md, structures.md, examples.md)
- [humanizer v3](https://github.com/blader/humanizer) (SKILL.md)
- [anti-slop](https://github.com/kjmagnan1s/anti-slop) (SKILL.md, references/patterns.md)
- [skill-deslop](https://github.com/stephenturner/skill-deslop) (SKILL.md)
- [sloplint](https://github.com/benjaminjackson/sloplint)
- [slopster](https://github.com/t0ddharris/slopster) (Vale rules)
- [SlopMonster](https://github.com/mcpeezy/SlopMonster)
- [AntiSlop](https://github.com/javidjamae/AntiSlop)
- [no-ai-slop](https://github.com/petergyang/no-ai-slop); [anti-ai-slop-writing](https://github.com/jalaalrd/anti-ai-slop-writing) (READMEs only; SKILL.md not at the expected path)
- [Anthropic, Prompting Claude Fable 5.1: Writing density and Formatting in chat](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)
- [Anthropic, Prompting best practices: Control the format of responses](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Vale](https://vale.sh/docs)
