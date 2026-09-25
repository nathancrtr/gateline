# Vendored fonts

Gatehouse loads its four typefaces from this directory and nothing from a
font host. They are the public site's faces (`site/assets/fonts/`), the same
binaries, so the two surfaces measure the same text. Each family sits in its
own folder with the licence it ships under; all four are under the SIL Open
Font License 1.1 (Overpass is dual-licensed OFL 1.1 / LGPL 2.1; the OFL is the
one relied on here). Only the weights `src/styles.css` uses are vendored.

| Family | Version | Files | Weights | Source |
|---|---|---|---|---|
| Public Sans | 2.001 | `public-sans/` | 400, 400 italic, 600, 700 | [uswds/public-sans v2.001 release](https://github.com/uswds/public-sans/releases/tag/v2.001), `fonts/webfonts/` |
| Atkinson Hyperlegible Next | 2.001 | `atkinson-hyperlegible-next/` | 400, 500, 700 | [googlefonts/atkinson-hyperlegible-next](https://github.com/googlefonts/atkinson-hyperlegible-next), `fonts/webfonts/` at `main` (font binaries last built in commit `5d633f80`, 2024‑11‑20) |
| IBM Plex Mono | 2.5.0 | `ibm-plex-mono/` | 400, 500 (Latin1 and Latin2 subsets) | [IBM/plex `@ibm/plex-mono@2.5.0` release](https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-mono%402.5.0), `fonts/split/woff2/` |
| Overpass | 3.0.5 | `overpass/` | 700 | [RedHatOfficial/Overpass v3.0.5 release](https://github.com/RedHatOfficial/Overpass/releases/tag/v3.0.5), `webfonts/overpass-webfont/` |

Where they are used (`src/styles.css` and the `font-*` classes in `src/`):

* **Public Sans** — page and section headings, running text, and the
  rendered artifacts on the Record tab.
* **Atkinson Hyperlegible Next** — the UI face: the rack, tabs, buttons,
  table text and column heads, captions, labels, helper text, key hints.
* **IBM Plex Mono** — everything code-shaped, with ligatures off: ids, paths,
  slugs, refs, commit subjects, quoted verdicts, the status chips, `<pre>`.
* **Overpass** — the wordmark only.

Files were taken as shipped; nothing was converted or subset here. To upgrade
a family, replace its files from the newer release in both this directory and
`site/assets/fonts/`, update the version in both READMEs, and check the
`@font-face` blocks still name the right files.
