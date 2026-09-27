#!/usr/bin/env python3
"""Build the packet sketch from a run's real spec and intent brief.

Every word of the record is copied from data/spec.md and data/intent-brief.md
by this script. Nothing of the record is typed by hand into the page.
data/COMMIT is the commit the two files were read at.

Run:  python3 build.py   ->  writes index.html beside this file, from template.html.
Standard library only.
"""
import html, re, pathlib

HERE = pathlib.Path(__file__).parent
spec_lines = (HERE / 'data/spec.md').read_text().split('\n')
brief_lines = (HERE / 'data/intent-brief.md').read_text().split('\n')
COMMIT = (HERE / 'data/COMMIT').read_text().strip()
RUN = 'criterion-check'


# ---------- inline and block markdown, the subset these two files use ----------
def inline(s: str) -> str:
    out, i = [], 0
    for m in re.finditer(r'`([^`]+)`', s):
        out.append(emph(html.escape(s[i:m.start()])))
        out.append(f'<code>{html.escape(m.group(1))}</code>')
        i = m.end()
    out.append(emph(html.escape(s[i:])))
    return ''.join(out)


ID = re.compile(r'(?<![\w#/.-])(G[0-3]|R\d+|AC\d+\.\d+|ADR-\d+)(?![\w-])')


def emph(s: str) -> str:
    # An id the record uses is a Name: the code face, wherever it stands (SEAM section 4).
    s = ID.sub(r'<span class="ref">\1</span>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    return re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', s)


def pre(code_lines, line_no):
    """A fenced block. Each source line is its own row, so a line too long for
    the column wraps under a hanging indent and stays visibly one line."""
    rows = ''.join(f'<span class="ln">{html.escape(l) or "&#8203;"}</span>' for l in code_lines)
    return f'<pre data-line="{line_no}" data-src="{html.escape(chr(10).join(code_lines), quote=True)}"><code>{rows}</code></pre>'


def blocks(lines, first_line_no):
    """Render paragraphs, bullet lists and fenced code. Returns html."""
    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        if ln.strip().startswith('<!--'):
            while i < n and '-->' not in lines[i]:
                i += 1
            i += 1
            continue
        if not ln.strip():
            i += 1
            continue
        if ln.startswith('```'):
            j = i + 1
            code = []
            while j < n and not lines[j].startswith('```'):
                code.append(lines[j]); j += 1
            out.append(pre(code, first_line_no + i))
            i = j + 1
            continue
        if re.match(r'^[-*] ', ln):
            items = []
            while i < n and (re.match(r'^[-*] ', lines[i]) or (lines[i].startswith('  ') and lines[i].strip())):
                if re.match(r'^[-*] ', lines[i]):
                    items.append([first_line_no + i, [lines[i][2:]]])
                else:
                    items[-1][1].append(lines[i].strip())
                i += 1
            lis = ''.join(f'<li data-line="{no}">{inline(" ".join(t))}</li>' for no, t in items)
            out.append(f'<ul>{lis}</ul>')
            continue
        para, start = [], i
        while i < n and lines[i].strip() and not lines[i].startswith('```') and not re.match(r'^[-*] ', lines[i]):
            para.append(lines[i].strip()); i += 1
        out.append(f'<p data-line="{first_line_no + start}">{inline(" ".join(para))}</p>')
    return '\n'.join(out)


def section(lines, name):
    """(first body line number, body lines) of an H2 section."""
    start = next(i for i, l in enumerate(lines) if l.strip() == f'## {name}')
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    return start + 2, lines[start + 1:end]


# ---------- the spec: assumptions, requirements with criteria ----------
LABELS = ('Resolved as:', 'Because:', 'Basis:')


def assumptions():
    first, body = section(spec_lines, 'Assumptions')
    items, cur = [], None
    for k, raw in enumerate(body):
        no = first + k
        line = raw.rstrip()
        if line.endswith('\\'):
            line = line[:-1].rstrip()
        m = re.match(r'^- (\*\*)?(ASSUMPTION:)(\*\*)?\s*(.*)$', line)
        if m:
            cur = {'line': no, 'parts': [[m.group(2), m.group(4), no, bool(m.group(1))]]}
            items.append(cur)
            continue
        if cur is None or not line.strip():
            continue
        t = line.strip()
        lab = next((L for L in LABELS if t.startswith(L)), None)
        if lab:
            cur['parts'].append([lab, t[len(lab):].strip(), no, False])
        else:
            cur['parts'][-1][1] += ' ' + t
    for it in items:
        it['confirm'] = it['parts'][0][1].startswith('G0 to confirm:')
    return items


def requirements():
    first, body = section(spec_lines, 'Requirements')
    reqs, cur, crit = [], None, None
    for k, raw in enumerate(body):
        no = first + k
        m = re.match(r'^### (R\d+) — (.*)$', raw)
        if m:
            cur = {'id': m.group(1), 'name': m.group(2), 'line': no, 'body': [], 'criteria': []}
            reqs.append(cur); crit = None
            continue
        if cur is None:
            continue
        c = re.match(r'^- \[.\] (AC\d+\.\d+) — (.*)$', raw)
        if c:
            crit = {'id': c.group(1), 'promise': c.group(2), 'check': None, 'line': no}
            cur['criteria'].append(crit)
            continue
        if crit is not None and raw.startswith('  ') and raw.strip():
            t = raw.strip()
            if crit['check'] is None and t.startswith('Check:'):
                crit['check'] = t[len('Check:'):].strip()
            elif crit['check'] is not None:
                crit['check'] += ' ' + t
            else:
                crit['promise'] += ' ' + t
            continue
        if raw.strip() == '**Acceptance criteria:**':
            continue
        if not cur['criteria']:
            cur['body'].append((no, raw))
    return reqs


def addr(path, line):
    """One address: the line number shows; the file is named once, in the section head."""
    return (f'<a class="addr" href="#" aria-label="{path}, line {line}" title="{path}:{line}">'
            f'<span class="addr-file">{path}:</span><span class="addr-line">{line}</span></a>')


def part(label, value_html, cls='', label_cls='', margin=''):
    return (f'<div class="part {cls}"><div class="margin">{margin}</div>'
            f'<div class="label {label_cls}">{html.escape(label)}</div><div class="value">{value_html}</div></div>')


def render_assumption(it, idx, total):
    rows = []
    for j, (lab, val, no, bold) in enumerate(it['parts']):
        v = inline(val)
        if j == 0 and it['confirm']:
            v = v.replace('<span class="ref">G0</span> to confirm:', '<span class="confirm"><span class="ref">G0</span> to confirm:</span>', 1)
        margin = ''
        if j == 0:
            margin = addr('spec.md', no) + ('<span class="flag">to confirm</span>' if it['confirm'] else '')
        rows.append(part(lab, v, 'part-first' if j == 0 else '', 'authored-bold' if bold else '', margin))
    return (f'<li class="item" data-item data-kind="Assumption" data-n="{idx}" data-total="{total}" '
            f'data-confirm="{str(it["confirm"]).lower()}">' + ''.join(rows) + '</li>')


def render_requirement(r):
    crits = []
    for c in r['criteria']:
        rows = part(c['id'], inline(c['promise']), 'part-first', 'name', addr('spec.md', c['line']))
        if c['check'] is not None:
            rows += part('Check:', inline(c['check']))
        crits.append(f'<li class="item crit" data-item data-kind="Criterion" data-label="{c["id"]}">{rows}</li>')
    body = blocks([t for _, t in r['body']], r['body'][0][0] if r['body'] else r['line'])
    n = len(r['criteria'])
    return (f'<li class="req row3" data-req="{r["id"]}"><div class="margin req-margin">{addr("spec.md", r["line"])}</div>'
            f'<details><summary><span class="label name">{r["id"]}</span>'
            f'<span class="req-name">{inline(r["name"])}</span>'
            f'<span class="count">{n} {"criterion" if n == 1 else "criteria"}</span></summary>'
            f'<div class="req-body"><div class="statement flow">{body}</div><ul class="items">{"".join(crits)}</ul></div></details></li>')


A = assumptions()
R = requirements()
confirm = [a for a in A if a['confirm']]
rest = [a for a in A if not a['confirm']]
total = len(A)
n_crit = sum(len(r['criteria']) for r in R)

a_html, k = [], 0
if not A:
    a_html.append('<p class="empty">The spec’s Assumptions section is empty. It states no choice for G0 to veto.</p>')
if confirm:
    a_html.append(f'<p class="group"><span>Open with “G0 to confirm”</span> <span class="count">{len(confirm)}</span></p><ul class="items group-confirm">')
    for it in confirm:
        k += 1; a_html.append(render_assumption(it, k, total))
    a_html.append('</ul>')
if rest:
    if confirm:
        a_html.append(f'<p class="group"><span>The rest</span> <span class="count">{len(rest)}</span></p>')
    a_html.append('<ul class="items">')
    for it in rest:
        k += 1; a_html.append(render_assumption(it, k, total))
    a_html.append('</ul>')

p_first, p_body = section(brief_lines, 'Problem')
c_first, c_body = section(brief_lines, 'Constraints')
bo_first, bo_body = section(brief_lines, 'Out of scope')
so_first, so_body = section(spec_lines, 'Out of scope')
n_bo = sum(1 for l in bo_body if l.startswith('- '))
n_so = sum(1 for l in so_body if l.startswith('- '))


def brief_html(prefix):
    return (f'<h4 id="{prefix}-problem"><span>Problem</span>{addr("intent-brief.md", p_first - 1)}</h4>'
            f'<div class="flow">{blocks(p_body, p_first)}</div>'
            f'<h4 id="{prefix}-constraints"><span>Constraints</span>{addr("intent-brief.md", c_first - 1)}</h4>'
            f'<div class="flow">{blocks(c_body, c_first)}</div>'
            f'<details class="fold in-brief" id="{prefix}-oos"><summary><span class="t">Out of scope <span class="count">{n_bo}</span></span>'
            f'{addr("intent-brief.md", bo_first - 1)}</summary><div class="flow">{blocks(bo_body, bo_first)}</div></details>')


page = (HERE / 'template.html').read_text()
page = (page
        .replace('{{RUN}}', RUN).replace('{{COMMIT}}', COMMIT)
        .replace('{{N_ASSUMPTIONS}}', str(total)).replace('{{N_CONFIRM}}', str(len(confirm)))
        .replace('{{N_REQ}}', str(len(R))).replace('{{N_CRIT}}', str(n_crit))
        .replace('{{ASSUMPTIONS}}', '\n'.join(a_html))
        .replace('{{REQUIREMENTS}}', '\n'.join(render_requirement(r) for r in R))
        .replace('{{SPEC_OOS_ADDR}}', addr('spec.md', so_first - 1))
        .replace('{{N_SPEC_OOS}}', str(n_so))
        .replace('{{SPEC_OOS}}', blocks(so_body, so_first))
        .replace('{{BRIEF_PANE}}', brief_html('pane'))
        .replace('{{BRIEF_INLINE}}', brief_html('seq')))
assert '{{' not in page, re.findall(r'\{\{[A-Z_]+\}\}', page)
(HERE / 'index.html').write_text(page)
print(f'assumptions {total} (confirm {len(confirm)}), requirements {len(R)}, criteria {n_crit}')
