"""Unit tests for dupefind's core functions: scan_files, hash_file,
find_duplicate_groups, render_groups. No subprocess — imports the module
directly and exercises it against fixture trees built under pytest's
tmp_path. Run with `pytest test_core.py` from apps/dupefind/ (plan.md's
test-layout contract). Expected paths are built with os.path.join from the
exact root string passed to scan_files — never .resolve()/realpath (macOS
/tmp is itself a symlink; the tool never resolves paths either, R5).
"""

import inspect
import os

import dupefind


def _write(path, content=""):
    with open(path, "w") as f:
        f.write(content)


# --- scan_files: traversal scope (R2) --------------------------------------


def test_scan_files_lists_byte_identical_files_at_different_depths(tmp_path):
    # AC2.1 — two byte-identical files nested at different depths are both
    # listed by scan_files, and land in the same find_duplicate_groups group.
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "a"))
    os.makedirs(os.path.join(root, "b", "c"))
    x = os.path.join(root, "a", "x.txt")
    y = os.path.join(root, "b", "c", "y.txt")
    _write(x, "same content")
    _write(y, "same content")

    paths = [p for p, _size in dupefind.scan_files(root)]
    assert x in paths
    assert y in paths

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [sorted([x, y])]


def test_scan_files_excludes_symlink_file_and_directory_cycle(tmp_path):
    # AC2.2 — a file symlink whose target would otherwise duplicate another
    # file, and a directory symlink pointing back at an ancestor (a
    # traversal cycle), are both absent from scan_files' output; the run
    # terminates and no group ever contains a symlink path. Two *real*
    # files supply the actual duplicate pair so the group assertion has
    # something genuine to check.
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "sub"))
    target = os.path.join(root, "target.txt")
    other_real = os.path.join(root, "other_real.txt")
    _write(target, "dup-content")
    _write(other_real, "dup-content")

    file_symlink = os.path.join(root, "link_to_target.txt")
    os.symlink(target, file_symlink)

    # Directory symlink inside "sub" pointing back at the root (ancestor) —
    # a cycle if followed.
    cycle_symlink = os.path.join(root, "sub", "loop")
    os.symlink(root, cycle_symlink)

    scanned = dupefind.scan_files(root)
    paths = [p for p, _size in scanned]

    assert file_symlink not in paths
    assert cycle_symlink not in paths
    assert target in paths
    assert other_real in paths

    groups = dupefind.find_duplicate_groups(scanned)
    assert groups == [sorted([target, other_real])]
    for group in groups:
        assert file_symlink not in group
        assert cycle_symlink not in group


def test_scan_files_excludes_fifo(tmp_path):
    # AC2.3 — a FIFO inside the tree never appears in scan_files' output.
    # Assert on scan_files ONLY: listing never opens entries (it only
    # lstats them), so this test cannot hang even if hash_file would block
    # on a FIFO read (plan risk + ADR-2).
    root = str(tmp_path)
    fifo_path = os.path.join(root, "a_fifo")
    os.mkfifo(fifo_path)

    real_file = os.path.join(root, "real.txt")
    _write(real_file, "hello")

    paths = [p for p, _size in dupefind.scan_files(root)]
    assert fifo_path not in paths
    assert real_file in paths


def test_scan_files_includes_dotfiles(tmp_path):
    # F5 (review round 2) — hidden files (dotfiles) are ordinary regular
    # files; R2 names no hidden-file exclusion, but "skip names starting
    # with '.'" is a plausible drift many real dedup tools have. A hidden
    # duplicate pair must still be scanned and grouped.
    root = str(tmp_path)
    a = os.path.join(root, ".h1")
    b = os.path.join(root, ".h2")
    _write(a, "hidden dup content")
    _write(b, "hidden dup content")

    paths = [p for p, _size in dupefind.scan_files(root)]
    assert a in paths
    assert b in paths

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [sorted([a, b])]


# --- 0-byte boundary: traversal (R2) vs detection policy (R4, ADR-4) -------


def test_scan_files_includes_empty_file_with_zero_size(tmp_path):
    # ADR-4 boundary — scan_files reports a 0-byte file, with size 0; pure
    # traversal semantics, independent of detection policy.
    root = str(tmp_path)
    empty = os.path.join(root, "empty.txt")
    _write(empty, "")
    full = os.path.join(root, "full.txt")
    _write(full, "not empty")

    scanned = dict(dupefind.scan_files(root))
    assert empty in scanned
    assert scanned[empty] == 0
    assert scanned[full] == len("not empty")


def test_find_duplicate_groups_excludes_empty_files_unconditionally(tmp_path):
    # AC4.1 / ADR-4 boundary — two-or-more 0-byte files are never reported
    # as a duplicate group, even alongside a genuine non-empty duplicate
    # pair in the same tree (traversal and detection tested independently).
    root = str(tmp_path)
    for name in ("e1.txt", "e2.txt", "e3.txt"):
        _write(os.path.join(root, name), "")
    dup_a = os.path.join(root, "dup_a.txt")
    dup_b = os.path.join(root, "dup_b.txt")
    _write(dup_a, "payload")
    _write(dup_b, "payload")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))

    assert groups == [sorted([dup_a, dup_b])]
    empty_paths = {
        os.path.join(root, "e1.txt"),
        os.path.join(root, "e2.txt"),
        os.path.join(root, "e3.txt"),
    }
    for group in groups:
        assert not (set(group) & empty_paths)


def test_find_duplicate_groups_only_empty_files_yields_no_groups(tmp_path):
    # AC4.2 — a tree of ONLY 0-byte files: find_duplicate_groups is [] and
    # render_groups of that result is the empty string.
    root = str(tmp_path)
    for name in ("z1.txt", "z2.txt", "z3.txt"):
        _write(os.path.join(root, name), "")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == []
    assert dupefind.render_groups(groups) == ""


def test_find_duplicate_groups_one_byte_duplicate_pair_is_grouped(tmp_path):
    # F3 (review round 2) — the size==0 exclusion boundary must be exact.
    # A 1-byte duplicate pair, placed right next to the 0-byte exclusion
    # tests, catches an off-by-one threshold mutant (e.g. `size <= 1`) that
    # would silently drop legitimate 1-byte duplicates while every 0-byte
    # fixture in this file keeps passing.
    root = str(tmp_path)
    a = os.path.join(root, "a.txt")
    b = os.path.join(root, "b.txt")
    _write(a, "x")
    _write(b, "x")
    assert os.path.getsize(a) == 1

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [sorted([a, b])]


def test_find_duplicate_groups_has_no_empty_file_override_parameter():
    # R4 as amended at G0 — there is no mechanism anywhere in the module to
    # include 0-byte files; at this layer that means find_duplicate_groups
    # accepts exactly one parameter, with no keyword to opt empty files
    # back in.
    params = inspect.signature(dupefind.find_duplicate_groups).parameters
    assert list(params) == ["files"]


# --- find_duplicate_groups: size-then-hash detection (R3) -------------------


def test_find_duplicate_groups_two_identical_files_grouped(tmp_path):
    # AC3.1
    root = str(tmp_path)
    a = os.path.join(root, "a.txt")
    b = os.path.join(root, "b.txt")
    _write(a, "identical bytes")
    _write(b, "identical bytes")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [sorted([a, b])]


def test_find_duplicate_groups_same_size_different_content_not_grouped(tmp_path):
    # AC3.2 — two files of equal size but different bytes must never end up
    # in a group together. This is the case a hash-blind or size-only
    # implementation would get wrong.
    root = str(tmp_path)
    a = os.path.join(root, "a.txt")
    b = os.path.join(root, "b.txt")
    _write(a, "aaaaaaaa")
    _write(b, "bbbbbbbb")
    assert os.path.getsize(a) == os.path.getsize(b)

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == []
    for group in groups:
        assert not ({a, b} <= set(group))


def test_find_duplicate_groups_three_identical_files_single_group(tmp_path):
    # AC3.3 — three files sharing content land in one group of three, not
    # split into pairwise groups.
    root = str(tmp_path)
    paths = [os.path.join(root, name) for name in ("a.txt", "b.txt", "c.txt")]
    for p in paths:
        _write(p, "triplet content")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [sorted(paths)]
    assert len(groups) == 1
    assert len(groups[0]) == 3


def test_find_duplicate_groups_unique_size_files_never_opened(tmp_path, monkeypatch):
    # ADR-3 consequence — files whose size is unique in the input are never
    # hashed (opened) at all. F1 (review round 2): a nonexistent-path probe
    # is false assurance here, because find_duplicate_groups' own
    # `except OSError: continue` (ADR-6) swallows the FileNotFoundError a
    # hash-everything mutant would raise, so that mutant still passes.
    # Instead, monkeypatch dupefind.hash_file itself over a real tree of
    # unique-size files and assert it is never called; the recorder raises
    # AssertionError (not OSError) if it is, so the failure propagates
    # instead of being swallowed by ADR-6's skip policy.
    root = str(tmp_path)
    for name, content in (("one.txt", "a"), ("two.txt", "bb"), ("three.txt", "ccc")):
        _write(os.path.join(root, name), content)

    scanned = dupefind.scan_files(root)
    sizes = [size for _path, size in scanned]
    assert len(sizes) == len(set(sizes))  # sanity: every size is unique

    calls = []

    def recording_hash_file(path):
        calls.append(path)
        raise AssertionError(
            "hash_file must not be called for a unique-size file: {}".format(path)
        )

    monkeypatch.setattr(dupefind, "hash_file", recording_hash_file)

    groups = dupefind.find_duplicate_groups(scanned)
    assert groups == []
    assert calls == []


# --- output grouping/ordering/determinism (R5, ADR-5) -----------------------


def test_find_duplicate_groups_order_independent_of_input_order(tmp_path):
    # AC5.1 / AC5.3 / ADR-5 — a tree with two duplicate sets plus one unique
    # file: exactly two groups, each internally sorted ascending, the group
    # list ordered by first member, the unique file absent. File names are
    # chosen so that sorting the group list by each group's *first* member
    # gives a different order than sorting by each group's *last* member —
    # discriminating a first-vs-last sort-key mutation. The same expected
    # output must also come out when find_duplicate_groups is fed a
    # deliberately shuffled/reversed list (order independent of input
    # order).
    root = str(tmp_path)
    aaa = os.path.join(root, "aaa.txt")
    zzz = os.path.join(root, "zzz.txt")
    bbb = os.path.join(root, "bbb.txt")
    ccc = os.path.join(root, "ccc.txt")
    unique = os.path.join(root, "unique.txt")
    _write(aaa, "group-x")
    _write(zzz, "group-x")
    _write(bbb, "group-y")
    _write(ccc, "group-y")
    _write(unique, "solo content")

    # First members (aaa < bbb) order group-x before group-y; last members
    # (ccc < zzz) would order group-y before group-x under a last-member
    # sort key — the two policies disagree, so this fixture kills that
    # mutant.
    expected = [[aaa, zzz], [bbb, ccc]]

    scanned = dupefind.scan_files(root)
    groups = dupefind.find_duplicate_groups(scanned)
    assert groups == expected
    for group in groups:
        assert unique not in group

    shuffled = list(reversed(scanned))
    shuffled_groups = dupefind.find_duplicate_groups(shuffled)
    assert shuffled_groups == expected


def test_find_duplicate_groups_member_sort_uses_full_path_not_basename(tmp_path):
    # F2 (review round 2) — R5/ADR-5: within a group, members are sorted by
    # the full path string, not by basename. `root/b/a.txt` and
    # `root/a/z.txt` are chosen so path order and basename order disagree:
    # by path, `root/a/z.txt` < `root/b/a.txt` (directory prefix decides);
    # by basename, `a.txt` < `z.txt` would put them the other way around.
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "a"))
    os.makedirs(os.path.join(root, "b"))
    path_b_a = os.path.join(root, "b", "a.txt")
    path_a_z = os.path.join(root, "a", "z.txt")
    _write(path_b_a, "path-vs-basename")
    _write(path_a_z, "path-vs-basename")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [[path_a_z, path_b_a]]


def test_find_duplicate_groups_group_list_sort_uses_full_path_not_basename(tmp_path):
    # F2 (review round 2) — the group *list* itself is ordered by each
    # group's first member's full path, not its basename. Group "low" lives
    # under directory "aaaa" but its files have basenames starting "zzz";
    # group "high" lives under "zzzz" with basenames starting "aaa". By
    # full path, "aaaa/zzz1.txt" < "zzzz/aaa1.txt" (directory prefix
    # decides) — group "low" first. By first-member basename alone,
    # "aaa1.txt" < "zzz1.txt" would reverse that order. Basenames agree
    # with path order *within* each group (same directory), so this
    # isolates the group-list-level key from the member-level one.
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "aaaa"))
    os.makedirs(os.path.join(root, "zzzz"))
    low_1 = os.path.join(root, "aaaa", "zzz1.txt")
    low_2 = os.path.join(root, "aaaa", "zzz2.txt")
    high_1 = os.path.join(root, "zzzz", "aaa1.txt")
    high_2 = os.path.join(root, "zzzz", "aaa2.txt")
    _write(low_1, "group-low")
    _write(low_2, "group-low")
    _write(high_1, "group-high")
    _write(high_2, "group-high")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == [[low_1, low_2], [high_1, high_2]]


def test_scan_files_through_symlinked_root_does_not_resolve_paths(tmp_path):
    # F4 (review round 2) — R5: paths are constructed from the given root
    # exactly, never resolved to a real/absolute path. pytest's tmp_path is
    # already fully resolved on this darwin host, so every comparison built
    # from tmp_path directly would pass even under a realpath()/resolve()
    # mutant. Routing through an explicit symlink root exposes it: the
    # expected path is built by os.path.join from the symlink root string
    # (never os.path.realpath), and must not equal the resolved-target path.
    real_root = os.path.join(str(tmp_path), "real_root")
    link_root = os.path.join(str(tmp_path), "link_root")
    os.mkdir(real_root)
    os.symlink(real_root, link_root)
    os.makedirs(os.path.join(real_root, "nested"))
    _write(os.path.join(real_root, "nested", "f.txt"), "via symlinked root")

    scanned = dupefind.scan_files(link_root)
    paths = [p for p, _size in scanned]

    expected_path = os.path.join(link_root, "nested", "f.txt")
    resolved_path = os.path.join(real_root, "nested", "f.txt")
    assert expected_path in paths
    assert resolved_path not in paths


def test_render_groups_formats_multiple_groups_exactly():
    # render formula — exact byte formula per the interface contract.
    assert dupefind.render_groups([["a", "b"], ["c", "d"]]) == "a\nb\n\nc\nd\n"


def test_render_groups_empty_input_returns_empty_string():
    assert dupefind.render_groups([]) == ""


# --- no-duplicates case (R6) -------------------------------------------------


def test_find_duplicate_groups_no_duplicates_when_content_unique(tmp_path):
    # AC6.1 — files exist but none share content -> [].
    root = str(tmp_path)
    _write(os.path.join(root, "a.txt"), "alpha")
    _write(os.path.join(root, "b.txt"), "bravo")
    _write(os.path.join(root, "c.txt"), "charlie")

    groups = dupefind.find_duplicate_groups(dupefind.scan_files(root))
    assert groups == []


def test_scan_files_empty_directory_no_duplicates(tmp_path):
    # AC6.2 — an empty directory: scan_files == [] and
    # find_duplicate_groups == [].
    root = str(tmp_path)
    assert dupefind.scan_files(root) == []
    assert dupefind.find_duplicate_groups(dupefind.scan_files(root)) == []
