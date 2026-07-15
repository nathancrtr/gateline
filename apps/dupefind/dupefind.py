"""dupefind: find duplicate files under a directory tree.

Detection rule (R3): two files are duplicates only if their sizes match
first, and then their SHA-256 content digests match. Files whose size is
unique in the tree are never opened or hashed.

Empty-file rule (R4): files of size 0 are unconditionally excluded from
duplicate detection — there is no flag, environment variable, or other
mechanism anywhere in this module to include them.
"""

import argparse
import hashlib
import os
import stat
import sys
from typing import Iterable, Optional, Sequence

CHUNK_SIZE = 65536


def scan_files(root: str) -> list[tuple[str, int]]:
    """Every regular, non-symlink file under `root` at any depth, as
    (path, size_bytes) pairs. Traversal is os.walk(root, followlinks=False)
    (ADR-2): directory symlinks are never descended, which also breaks
    cycles (AC2.2). An entry from `filenames` is included iff
    stat.S_ISREG(os.lstat(path).st_mode) — this single check excludes file
    symlinks (S_ISLNK), broken symlinks, FIFOs, sockets, and device files
    (R2); an OSError from lstat skips the entry silently (ADR-6). `path` is
    os.path.join(dirpath, name) exactly as produced from os.walk(root) —
    never normalized, resolved, or made absolute (R5). 0-byte files ARE
    included here; their exclusion is detection policy (ADR-4). Result
    order is unspecified — callers must not rely on it (ADR-5)."""
    results = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in filenames:
            path = os.path.join(dirpath, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if stat.S_ISREG(st.st_mode):
                results.append((path, st.st_size))
    return results


def hash_file(path: str) -> str:
    """Hex SHA-256 digest of the file's contents, read in binary
    CHUNK_SIZE chunks (R3, ADR-3). Raises OSError on unreadable paths;
    caller policy in ADR-6."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def find_duplicate_groups(files: Iterable[tuple[str, int]]) -> list[list[str]]:
    """Duplicate groups per R3/R4/R5. Drops every size-0 entry
    unconditionally, before any hashing (R4). Partitions the rest by size;
    files with a unique size are never hashed or reported (R3
    size-then-hash). Hashes each remaining file; groups by digest; keeps
    only groups with >= 2 members (R5). A file whose read raises OSError
    is skipped silently (ADR-6). Each group is sorted ascending by plain
    str comparison, and the group list is sorted by each group's first
    (already-sorted) path (ADR-5). No duplicates -> []."""
    by_size = {}
    for path, size in files:
        if size == 0:
            continue
        by_size.setdefault(size, []).append(path)

    by_digest = {}
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        for path in paths:
            try:
                digest = hash_file(path)
            except OSError:
                continue
            by_digest.setdefault(digest, []).append(path)

    groups = [sorted(paths) for paths in by_digest.values() if len(paths) >= 2]
    groups.sort(key=lambda group: group[0])
    return groups


def render_groups(groups: list[list[str]]) -> str:
    """'\\n\\n'.join('\\n'.join(g) for g in groups) + '\\n' when `groups` is
    non-empty; '' (zero characters) when it is empty (R5, R6). One path
    per line, one blank line between groups, single trailing newline after
    the last group, no trailing blank line."""
    if not groups:
        return ""
    return "\n\n".join("\n".join(group) for group in groups) + "\n"


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the exit code; never raises for anticipated errors (R7)."""
    parser = argparse.ArgumentParser(prog="dupefind.py", add_help=False)
    parser.add_argument("root")
    args = parser.parse_args(argv)
    root = args.root

    if not os.path.isdir(root):
        if not os.path.exists(root):
            sys.stderr.write("dupefind.py: error: no such directory: {}\n".format(root))
        else:
            sys.stderr.write("dupefind.py: error: not a directory: {}\n".format(root))
        return 1

    sys.stdout.write(render_groups(find_duplicate_groups(scan_files(root))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
