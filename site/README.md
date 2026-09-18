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
manifest's order is the reading order for the pager.

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

## Design

The site is set like signage: a white ground, ink lettering, one signal blue,
and rules instead of boxes, after the tradition (British Rail's 1965 identity,
GOV.UK's functional palette) whose whole job is guiding people through gates.
Every colour has a job and there are no tints or ornaments beyond that; the
3px ink band at the top and the `gate|line` wordmark are the only signage on a
page. It is light-only (`color-scheme: light`), plain CSS, no JavaScript.

`assets/site.css` is the token file and the whole stylesheet: the palette,
the four type faces and the frame widths are the `:root` custom properties at
the top, and every colour below is one of them. The wordmark is drawn from the
plain word in the markup with `::before`/`::after` (with empty alt text, so
assistive technology hears "gateline").

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
