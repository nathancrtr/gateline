# gateline documentation site

The public, adopter-facing documentation for gateline: a landing page, three
explanatory pages under `how-it-works/`, three onboarding modules with runnable
exercises, six reference pages, and the generated API reference. It is plain
HTML and one stylesheet; open `index.html` in a browser, or serve the directory:

```bash
python3 -m http.server 8000 --directory site
```

It publishes to GitHub Pages from `main` through
`.github/workflows/site-pages.yml`, which also runs on pull requests without
deploying. The docs track `main`, not a release tag.

## How a page is put together

Pages are half generated. The body of each page lives in the page file between
two markers:

```html
<!-- content:start -->  …page body…  <!-- content:end -->
```

Everything outside them (the `<head>`, the site header and its active-section
state, the sidebar, the on-this-page list, the previous/next pager and the
footer) is rendered by `scripts/build-site.py` from the manifest in
`site.json`, and is overwritten on every build. The build is idempotent and
gives every `<h2>` a stable slug `id`.

```bash
python3 site/scripts/build-site.py           # rewrite the shell on every page
python3 site/scripts/build-site.py --check   # exit 1 if any page is stale
python3 site/scripts/check-names.py          # exit 1 on a retired name
```

To add, remove, reorder or retitle a page, edit `site.json` and rebuild; the
manifest's order is the reading order for the pager. Every page sits in the
same frame, the landing included; its `"layout": "landing"` only drops the
pager, and its `heading` is the `<h1>` where that should differ from the
`<title>`.

## The API reference

`api/` is generated from `packages/` by TypeDoc and is never committed. The
Pages workflow builds it on every deploy; to build it locally:

```bash
npm ci --prefix packages     # once; TypeDoc needs the packages' types
npm ci --prefix site         # once
npm run docs:api --prefix site
```

`docs:api` runs TypeDoc and then the shell builder, so a regeneration cannot
drop the back-to-site bar from the generated pages.

## The Gatehouse demo

`demo/` is assembled into `_site/demo/` at build time and is never committed.
It is Gatehouse — the gate frontend — built once in a static mode, beside a
tree of JSON files answering every read the app makes: a snapshot of every
finished run on `main` (`state.yaml` reading `phase: done`) plus a generated
fixture repository covering the transient states a finished record cannot
show (a gate pending, escalated, round-capped, paused, and so on). Runs from
the fixture are labelled as fixture data in the UI, visibly, on every page
that shows one; no real run carries that label.

The Pages workflow builds and verifies the demo on every pull request and
push, whether or not it publishes:

```bash
npm run build:static -w @gateline/web
node server/src/snapshot.ts --repo <repo> --out _site/demo --web-dist web/dist-static
npm run e2e:static
```

The first command builds the static web bundle; the second drives the
server's own routes in-process (no port bound) and writes each response
alongside the bundle; the third renders the assembled tree with a plain
static file server and Playwright, so a page that fails to render fails the
build. The same three commands are the local recipe (see
`runs/gatehouse-demo/tasks/05-static-render-check.yaml`'s notes for the exact
sequence, including the scratch directory and the site's `404.html`).

Publishing the demo is gated behind one repository variable,
`GATELINE_PUBLISH_DEMO`: unset (or any value other than `true`) removes
`demo/` from the uploaded artifact after the build and the render check both
pass; set to `true`, it is kept. The build runs and is verified either way —
flipping the variable only decides whether the result reaches the published
site, and is a decision made outside any run.

## Design

The site is set like signage: a white ground, ink lettering, one signal blue,
and rules instead of boxes, after the tradition (British Rail's 1965 identity,
GOV.UK's functional palette) whose whole job is guiding people through gates.
Every colour has a job and there are no tints or ornaments beyond that; the
3px ink band at the top and the `gate|line` wordmark are the only signage on a
page. It is light-only (`color-scheme: light`), plain CSS, no JavaScript.

`assets/site.css` is the token file and the whole stylesheet: the palette,
the four type faces and the frame widths are the `:root` custom properties at
the top, and every colour below is one of them. The wordmark is two spans,
`<span>gate</span><span>line</span>`, that the builder emits from the manifest;
the rule between them is a border, so assistive technology hears "gateline".

Fonts are vendored under `assets/fonts/`, one folder per family with its
licence beside it, and nothing loads from a font host. Public Sans (body and
headings), Atkinson Hyperlegible Next (navigation, tables, labels), IBM Plex
Mono (code) and Overpass (the wordmark) are all under the SIL Open Font
License; `assets/fonts/README.md` records each family's version and source.

The generated API pages are skinned, not themed: `assets/typedoc.css` (linked
through `customCss` in `typedoc.json`) sets TypeDoc's `--light-color-*`
variables to the site's tokens, sets the `--dark-color-*` variables to the
same light values and hides the theme toggle, so a dark-OS visitor gets the
light site, and restyles the fonts, frame, code panels and navigation.
`assets/api-bar.css` styles the header that `build-site.py` injects into
every `api/` page as the site header. When a token changes in `site.css`, the
same value changes in those two files.

## Keeping it true

Every falsifiable claim on these pages is a claim about the repository at
`main`. When a name, command, flag, path, count or mechanism changes in the
framework, the page that states it changes in the same pull request, or the
next historian sweep catches it. Text quoted from finished run records
(`runs/`) is left as it was written; it is history, and `check-names.py`
skips `<pre>` blocks for that reason.

`.research/` holds the memos and audit tables behind the 2026-09 re-evaluation
of this site (design precedents, prose method, per-page claim audits). They
explain why the site is the way it is; they are not part of the published
site.

## Naming

The framework and repository are **gateline**; the web UI is **Gatehouse**;
lowercase **gate** is the domain term for a pipeline approval point. Earlier
working names are retired and appear only inside quoted run history.
