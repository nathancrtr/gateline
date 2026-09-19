#!/usr/bin/env python3
"""Render the shared shell around every hand-written page of the docs site.

Content lives in the page files themselves, between the two content markers.
Everything outside those markers — doctype, head, header, sidebar, on-this-page
table of contents, prev/next pager, footer — is generated from `site.json` and
rewritten on every run. Editing a page means editing what is between the
markers; editing the navigation means editing `site.json`.

Every page, the landing included, sits in the same frame: top bar, site tree on
the left, content column, and the on-this-page rail when the page has two or
more <h2>s. The `landing` layout differs from `doc` in one way: it has no
prev/next pager, because the landing is the root of the tree rather than a
step in the reading order. A page's `heading` (when given) is the <h1> and
its pager title; `title` is the <title>.

The wordmark is emitted as two spans, `<span>gate</span><span>line</span>`,
so the stylesheet can draw the rule between the halves without generated
content; the accessible name is the plain word.

The script is idempotent: running it twice produces the same bytes. On its
first run over a page written before the markers existed, it migrates the page
by lifting the inner <main> as the content body.

It also post-processes the TypeDoc output under `api/`, injecting a bar that
links back into the rest of the site, so the generated API section is reachable
in both directions.

Standard library only, Python 3.9+ — same constraint as scripts/render-agents.py
in the framework repo.

Usage:
    python3 scripts/build-site.py           # rewrite pages and the API bar
    python3 scripts/build-site.py --check   # exit 1 if anything would change
"""

import argparse
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

START = "<!-- content:start -->"
END = "<!-- content:end -->"
BAR_START = "<!-- gateline:docsbar:start -->"
BAR_END = "<!-- gateline:docsbar:end -->"

TAG_RE = re.compile(r"<[^>]+>")


# ---- helpers ---------------------------------------------------------------


def esc(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def strip_tags(html):
    return " ".join(TAG_RE.sub("", html).split())


def slugify(text):
    text = unicodedata.normalize("NFKD", strip_tags(text))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "section"


def rel(from_path, to_path):
    """Relative href from one site-root-relative page path to another."""
    depth = from_path.count("/")
    return "../" * depth + to_path


def heading(page):
    """The page's display name: its <h1> and its title in the pager."""
    return page.get("heading") or page["title"]


def render_wordmark(site):
    """`<span>gate</span><span>line</span>` — one span per half of the mark."""
    return "".join("<span>%s</span>" % esc(half) for half in site["wordmark"])


# ---- manifest --------------------------------------------------------------


def load_manifest():
    with open(os.path.join(ROOT, "site.json"), encoding="utf-8") as fh:
        site = json.load(fh)

    pages = []  # flattened reading order, for prev/next
    for section in site["sections"]:
        for page in section["pages"]:
            page["section"] = section
            pages.append(page)
    site["_ordered"] = pages

    index = {p["path"]: p for p in pages}
    for page in site.get("unlisted", []):
        page["section"] = {"id": None, "label": None}
        index[page["path"]] = page
    site["_index"] = index
    return site


# ---- content extraction ----------------------------------------------------

H1_RE = re.compile(r"[ \t]*<h1[^>]*>.*?</h1>\s*", re.S)
MAIN_RE = re.compile(r"<main[^>]*>(.*)</main>", re.S)
PAGER_RE = re.compile(r'\s*<nav class="pager".*?</nav>\s*$', re.S)
TOC_INLINE_RE = re.compile(r'\s*<aside class="toc".*?</aside>\s*', re.S)


def extract_content(raw, path):
    """Return the page body: the region between the markers, or a migration."""
    if START in raw and END in raw:
        body = raw.split(START, 1)[1].split(END, 1)[0]
        return body.strip("\n"), False

    match = MAIN_RE.search(raw)
    if not match:
        raise SystemExit(
            "%s: no content markers and no <main> to migrate from" % path
        )
    body = match.group(1)
    body = PAGER_RE.sub("", body)
    body = TOC_INLINE_RE.sub("", body)
    body = H1_RE.sub("", body, count=1)  # the shell supplies the <h1>
    return body.strip("\n"), True


def add_heading_ids(body):
    """Give every <h2> a stable slug id so the TOC can link to it."""
    seen = {}

    def repl(match):
        attrs, text = match.group(1), match.group(2)
        if "id=" in attrs:
            return match.group(0)
        slug = slugify(text)
        seen[slug] = seen.get(slug, 0) + 1
        if seen[slug] > 1:
            slug = "%s-%d" % (slug, seen[slug])
        return '<h2 id="%s"%s>%s</h2>' % (slug, attrs, text)

    return re.sub(r"<h2([^>]*)>(.*?)</h2>", repl, body, flags=re.S)


ARTICLE_RE = re.compile(r'<article class="doc">(.*?)</article>', re.S)


def collect_toc(body):
    """h2s inside the first <article class="doc"> — not module lists or cards."""
    match = ARTICLE_RE.search(body)
    if not match:
        return []
    entries = []
    for attrs, text in re.findall(r"<h2([^>]*)>(.*?)</h2>", match.group(1), re.S):
        ident = re.search(r'id="([^"]+)"', attrs)
        if ident:
            entries.append((ident.group(1), strip_tags(text)))
    return entries


# ---- shell fragments -------------------------------------------------------


def render_head(site, page):
    title = page["title"]
    if not page.get("rawTitle"):
        title += site["titleSuffix"]
    root = rel(page["path"], "")
    lines = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        "  <title>%s</title>" % esc(title),
    ]
    if page.get("description"):
        lines.append(
            '  <meta name="description" content="%s">' % esc(page["description"])
        )
    lines += [
        '  <link rel="stylesheet" href="%sassets/site.css">' % root,
        '  <link rel="icon" href="%sassets/favicon.svg" type="image/svg+xml">' % root,
        "</head>",
    ]
    return "\n".join(lines)


def render_header(site, page):
    root = rel(page["path"], "")
    current = page["section"]["id"]
    out = [
        '<a class="skip-link" href="#content">Skip to content</a>',
        '<header class="site-header">',
        '  <a class="wordmark" href="%sindex.html">%s</a>'
        % (root, render_wordmark(site)),
        '  <nav class="site-nav" aria-label="Sections">',
    ]
    for section in site["sections"]:
        if section.get("inNav") is False:
            continue
        href = root + section["href"]
        active = ' class="active"' if section["id"] == current else ""
        aria = ' aria-current="true"' if section["id"] == current else ""
        out.append('    <a href="%s"%s%s>%s</a>' % (href, active, aria, section["label"]))
    out += ["  </nav>", "</header>"]
    return "\n".join(out)


def render_sidebar(site, page):
    root = rel(page["path"], "")
    out = [
        '<nav class="sidebar" aria-label="All documentation">',
        '  <p class="sidebar-title">Documentation</p>',
    ]
    for section in site["sections"]:
        if section.get("inNav") is False:
            continue
        href = root + section["href"]
        out.append('  <p class="sidebar-section"><a href="%s">%s</a></p>' % (href, section["label"]))
        if section.get("external"):
            out.append('  <ul class="sidebar-list">')
            out.append(
                '    <li><a href="%s">Browse generated API docs</a></li>' % href
            )
            out.append("  </ul>")
            continue
        out.append('  <ul class="sidebar-list">')
        for entry in section["pages"]:
            link = root + entry["path"]
            here = entry["path"] == page["path"]
            attrs = ' aria-current="page"' if here else ""
            out.append(
                '    <li><a href="%s"%s>%s</a></li>' % (link, attrs, esc(entry["nav"]))
            )
        out.append("  </ul>")
    out.append("</nav>")
    return "\n".join(out)


def render_toc(entries):
    if len(entries) < 2:
        return ""
    out = [
        '<aside class="toc" aria-labelledby="toc-heading">',
        '  <p class="toc-title" id="toc-heading">On this page</p>',
        '  <ul class="toc-list">',
    ]
    for ident, text in entries:
        out.append('    <li><a href="#%s">%s</a></li>' % (ident, esc(text)))
    out += ["  </ul>", "</aside>"]
    return "\n".join(out)


def render_pager(site, page):
    ordered = site["_ordered"]
    paths = [p["path"] for p in ordered]
    if page["path"] not in paths:
        return ""
    i = paths.index(page["path"])
    prev_page = ordered[i - 1] if i > 0 else None
    next_page = ordered[i + 1] if i < len(ordered) - 1 else None
    if not prev_page and not next_page:
        return ""

    out = ['<nav class="pager" aria-label="Previous and next page">']
    if prev_page:
        out.append(
            '  <a class="pager-prev" href="%s"><span class="pager-label">Previous</span>'
            '<span class="pager-title">%s</span></a>'
            % (rel(page["path"], prev_page["path"]), esc(heading(prev_page)))
        )
    else:
        out.append('  <span class="pager-spacer"></span>')
    if next_page:
        out.append(
            '  <a class="pager-next" href="%s"><span class="pager-label">Next</span>'
            '<span class="pager-title">%s</span></a>'
            % (rel(page["path"], next_page["path"]), esc(heading(next_page)))
        )
    out.append("</nav>")
    return "\n".join(out)


def render_footer(site, page):
    root = rel(page["path"], "")
    return (
        '<footer class="site-footer">\n'
        "  %s\n"
        '  <span class="footer-sep">&middot;</span>\n'
        '  <a href="%sindex.html">Documentation home</a>\n'
        "</footer>" % (site["footer"], root)
    )


# ---- page assembly ---------------------------------------------------------


def build_page(site, page, body):
    layout = page.get("layout", "doc")
    toc = render_toc(collect_toc(body))
    parts = [render_head(site, page), "<body>", render_header(site, page)]
    parts.append('<div class="layout">')
    parts.append('<main id="content">')
    parts.append("  <h1>%s</h1>" % esc(heading(page)))
    parts.append(START)
    parts.append(body)
    parts.append(END)
    if layout != "landing":
        pager = render_pager(site, page)
        if pager:
            parts.append(pager)
    parts.append("</main>")
    if toc:
        parts.append(toc)
    parts.append(render_sidebar(site, page))
    parts.append("</div>")
    parts += [render_footer(site, page), "</body>", "</html>", ""]
    return "\n".join(parts)


# ---- API bar ---------------------------------------------------------------


def render_api_bar(site, depth):
    """`depth` is how many directories below the site root the api page sits."""
    root = "../" * depth
    links = [
        ("index.html", "Documentation home"),
        ("how-it-works/index.html", "How It Works"),
        ("onboarding/index.html", "Onboarding"),
        ("reference/index.html", "Reference"),
    ]
    items = "".join(
        '<a href="%s%s">%s</a>' % (root, href, label) for href, label in links
    )
    return (
        "%s"
        '<div class="gateline-docsbar">'
        '<a class="gateline-docsbar-mark" href="%sindex.html">%s</a>'
        '<nav class="gateline-docsbar-nav" aria-label="Documentation sections">%s</nav>'
        '<span class="gateline-docsbar-here">API reference</span>'
        "</div>"
        "%s" % (BAR_START, root, render_wordmark(site), items, BAR_END)
    )


BAR_BLOCK_RE = re.compile(re.escape(BAR_START) + ".*?" + re.escape(BAR_END), re.S)
BAR_CSS_RE = re.compile(r'<link rel="stylesheet" href="[^"]*assets/api-bar\.css"/?>')


def build_api_page(site, raw, depth):
    root = "../" * depth
    out = BAR_BLOCK_RE.sub("", raw)
    out = BAR_CSS_RE.sub("", out)

    css = '<link rel="stylesheet" href="%sassets/api-bar.css"/>' % root
    if "</head>" in out:
        out = out.replace("</head>", css + "</head>", 1)

    match = re.search(r"<body[^>]*>", out)
    if not match:
        return out
    at = match.end()
    return out[:at] + render_api_bar(site, depth) + out[at:]


# ---- main ------------------------------------------------------------------


def write(path, content, check, changed):
    existing = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            existing = fh.read()
    if existing == content:
        return
    changed.append(os.path.relpath(path, ROOT))
    if not check:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit 1, without writing",
    )
    args = parser.parse_args()

    site = load_manifest()
    changed = []
    migrated = []

    for path, page in site["_index"].items():
        full = os.path.join(ROOT, path)
        if not os.path.exists(full):
            raise SystemExit("%s: listed in site.json but missing on disk" % path)
        with open(full, encoding="utf-8") as fh:
            raw = fh.read()
        body, was_migrated = extract_content(raw, path)
        if was_migrated:
            migrated.append(path)
        body = add_heading_ids(body)
        write(full, build_page(site, page, body), args.check, changed)

    api_dir = os.path.join(ROOT, "api")
    api_count = 0
    if os.path.isdir(api_dir):
        for dirpath, _, filenames in os.walk(api_dir):
            for name in sorted(filenames):
                if not name.endswith(".html"):
                    continue
                full = os.path.join(dirpath, name)
                depth = os.path.relpath(full, ROOT).count("/")
                with open(full, encoding="utf-8") as fh:
                    raw = fh.read()
                write(full, build_api_page(site, raw, depth), args.check, changed)
                api_count += 1

    if migrated:
        print("migrated %d page(s) to content markers:" % len(migrated))
        for path in migrated:
            print("  %s" % path)

    if args.check:
        if changed:
            print("build-site: %d file(s) out of date" % len(changed))
            for path in changed[:20]:
                print("  %s" % path)
            if len(changed) > 20:
                print("  ... and %d more" % (len(changed) - 20))
            return 1
        print("build-site: up to date")
        return 0

    print(
        "build-site: %d page(s), %d API page(s); %d file(s) written"
        % (len(site["_index"]), api_count, len(changed))
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
