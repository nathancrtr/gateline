# Vendored fonts

The site loads its four typefaces from this directory and nothing from a font
host. Each family sits in its own folder with the licence it ships under.
All four are under the SIL Open Font License 1.1 (Overpass is dual-licensed
OFL 1.1 / LGPL 2.1; the OFL is the one relied on here). Only the weights the
stylesheets use are vendored; the woff2 files together are about 295 KiB.

| Family | Version | Files | Weights | Source |
|---|---|---|---|---|
| Public Sans | 2.001 | `public-sans/` | 400, 400 italic, 600, 700 | [uswds/public-sans v2.001 release](https://github.com/uswds/public-sans/releases/tag/v2.001), `fonts/webfonts/` |
| Atkinson Hyperlegible Next | 2.001 | `atkinson-hyperlegible-next/` | 400, 500, 700 | [googlefonts/atkinson-hyperlegible-next](https://github.com/googlefonts/atkinson-hyperlegible-next), `fonts/webfonts/` at `main` (font binaries last built in commit `5d633f80`, 2024‑11‑20; the same binaries Google Fonts serves) |
| IBM Plex Mono | 2.5.0 | `ibm-plex-mono/` | 400, 500 (Latin1 and Latin2 subsets) | [IBM/plex `@ibm/plex-mono@2.5.0` release](https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-mono%402.5.0), `fonts/split/woff2/` |
| Overpass | 3.0.5 | `overpass/` | 700 | [RedHatOfficial/Overpass v3.0.5 release](https://github.com/RedHatOfficial/Overpass/releases/tag/v3.0.5), `webfonts/overpass-webfont/` |

Where they are used (`assets/site.css`, and the same declarations in
`assets/typedoc.css` for the generated API pages):

* **Public Sans** — body text and headings.
* **Atkinson Hyperlegible Next** — the UI face: top-bar navigation, sidebar,
  on-this-page rail, tables, captions, labels, pager, footer, diagram text.
* **IBM Plex Mono** — code, with ligatures turned off. IBM ships the family
  split by script; `Latin1` covers ASCII and Latin-1, `Latin2` the extended
  Latin block, and each `@font-face` carries the `unicode-range` IBM's own
  CSS declares, so a page that uses only ASCII downloads only the Latin1 file.
* **Overpass** — the wordmark only.

Files were taken as shipped (woff2 from each project's own release; nothing
was converted or subset here). To upgrade a family, replace its files from
the newer release, update the version and source in the table above, and
check the `@font-face` blocks in both stylesheets still name the right files.
