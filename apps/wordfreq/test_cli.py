"""End-to-end tests for wordfreq's CLI: invokes the finished script as a real
subprocess and asserts on exit codes, stdout bytes, and stderr. Does not
import wordfreq or duplicate test_core.py's function-level tests (that is
test_core.py's job). Run with `pytest` from apps/wordfreq/."""

import ast
import importlib.util
import subprocess
import sys
import sysconfig
from pathlib import Path

SCRIPT = Path(__file__).parent / "wordfreq.py"


def run_cli(*args, **kwargs):
    """Invoke wordfreq.py as a subprocess with the given args; returns the
    completed process with captured stdout/stderr bytes."""
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, **kwargs
    )


# --- CLI file input (R1) -----------------------------------------------------

def test_ac1_1_existing_readable_file_exits_zero(tmp_path):
    """AC1.1 — running against an existing, readable file exits 0."""
    path = tmp_path / "sample.txt"
    path.write_text("hello world", encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0


def test_ac1_2_no_file_argument_exits_nonzero_with_stderr():
    """AC1.2 — no file argument exits non-zero and prints usage to stderr."""
    result = run_cli()
    assert result.returncode != 0
    assert result.stderr != b""


# --- frequency ranking and top-N selection (R4) ------------------------------

def test_ac4_1_no_flag_outputs_exactly_ten_lines(tmp_path):
    """AC4.1 — more than 10 distinct words, no -n flag: exactly 10 lines."""
    words = [f"word{i}" for i in range(15)]
    path = tmp_path / "sample.txt"
    path.write_text(" ".join(words), encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert len(result.stdout.splitlines()) == 10


def test_ac4_2_n_flag_outputs_exact_expected_stdout(tmp_path):
    """AC4.2 — `-n 3` outputs exactly 3 lines, most frequent first, with the
    full expected stdout asserted against a known-count input."""
    path = tmp_path / "sample.txt"
    path.write_text("a a a b b c c d", encoding="utf-8")
    result = run_cli(str(path), "-n", "3")
    assert result.returncode == 0
    assert result.stdout == b"a\t3\nb\t2\nc\t2\n"


def test_ac4_3_n_larger_than_distinct_words_outputs_all_no_padding(tmp_path):
    """AC4.3 — `-n 100` against 5 distinct words: exactly 5 lines, exit 0."""
    path = tmp_path / "sample.txt"
    path.write_text("apple banana cherry date egg", encoding="utf-8")
    result = run_cli(str(path), "-n", "100")
    assert result.returncode == 0
    assert len(result.stdout.splitlines()) == 5


# --- deterministic tie-breaking (R5) -----------------------------------------

def test_ac5_1_ties_break_alphabetically_and_are_reproducible(tmp_path):
    """AC5.1 — 'apple' before 'zebra' at equal count, and running the
    identical command twice produces byte-identical stdout."""
    path = tmp_path / "sample.txt"
    path.write_text("zebra apple zebra apple", encoding="utf-8")
    first = run_cli(str(path), "-n", "2")
    second = run_cli(str(path), "-n", "2")
    assert first.stdout == b"apple\t2\nzebra\t2\n"
    assert first.stdout == second.stdout


# --- output format (R6) ------------------------------------------------------

def test_ac6_1_stdout_is_byte_exact(tmp_path):
    """AC6.1 — stdout is exactly the tab-separated, ranked output bytes."""
    path = tmp_path / "sample.txt"
    path.write_text("cat cat dog", encoding="utf-8")
    result = run_cli(str(path))
    assert result.stdout == b"cat\t2\ndog\t1\n"


# --- error handling for invalid input (R7) -----------------------------------

def test_ac7_1_nonexistent_path_exits_nonzero_no_traceback(tmp_path):
    """AC7.1 — a nonexistent path exits non-zero with a non-empty,
    traceback-free stderr message."""
    missing = tmp_path / "does-not-exist.txt"
    result = run_cli(str(missing))
    assert result.returncode != 0
    assert result.stderr != b""
    assert b"Traceback" not in result.stderr


def test_ac7_2_directory_path_exits_nonzero_no_traceback(tmp_path):
    """AC7.2 — a directory path exits non-zero with a non-empty,
    traceback-free stderr message."""
    result = run_cli(str(tmp_path))
    assert result.returncode != 0
    assert result.stderr != b""
    assert b"Traceback" not in result.stderr


# --- empty / wordless input handling (R8) ------------------------------------

def test_ac8_1_zero_byte_file_exits_zero_no_stdout(tmp_path):
    """AC8.1 — a 0-byte file exits 0 with no stdout output."""
    path = tmp_path / "empty.txt"
    path.write_text("", encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == b""


def test_ac8_2_punctuation_only_file_exits_zero_no_stdout(tmp_path):
    """AC8.2 — a file containing only punctuation/whitespace exits 0 with no
    stdout output."""
    path = tmp_path / "punctuation.txt"
    path.write_text("... !!! ,,,", encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == b""


# --- implementation constraints (R10) ----------------------------------------

def test_ac10_1_exactly_one_non_test_source_file():
    """AC10.1 — exactly one non-test *.py file in the deliverable directory."""
    deliverable_dir = Path(__file__).parent
    sources = [
        p
        for p in deliverable_dir.glob("*.py")
        if not p.name.startswith("test_") and p.name != "conftest.py"
    ]
    assert len(sources) == 1


def _is_stdlib_module(name):
    """Whether `name` is a Python standard-library top-level module.

    `sys.stdlib_module_names` (the obvious one-liner for this check) is
    Python 3.10+ only; this environment's interpreter is 3.9.6 (plan.md
    ADR-8), so this computes the equivalent via each module's spec origin:
    built-in/frozen, or a file under the interpreter's stdlib directory.

    The stdlib-directory check alone is NOT sufficient: on this machine
    (and generally, for framework/Homebrew-style builds) the interpreter's
    own `site-packages` is nested *inside* `sysconfig.get_paths()["stdlib"]`,
    so a third-party package installed there (e.g. `setuptools`, `pip`)
    would be misclassified as stdlib. Reject any origin with a
    `site-packages`/`dist-packages` path component first -- this catches
    that case regardless of where site-packages happens to live relative
    to the stdlib directory (excluding sysconfig's purelib/platlib alone is
    not enough, since on this machine purelib is a distinct, non-nested
    directory from the site-packages where pip/setuptools actually live)."""
    if name in sys.builtin_module_names:
        return True
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ValueError):
        return False
    if spec is None or spec.origin is None:
        return False
    if spec.origin in ("built-in", "frozen"):
        return True
    origin = Path(spec.origin).resolve()
    if "site-packages" in origin.parts or "dist-packages" in origin.parts:
        return False
    stdlib_dir = Path(sysconfig.get_paths()["stdlib"]).resolve()
    try:
        return origin.is_relative_to(stdlib_dir)
    except ValueError:
        return False


def test_ac10_2_only_stdlib_imports():
    """AC10.2 — every module wordfreq.py imports is a standard-library
    module (via ast, matching the spec's own AC10.2 command)."""
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # A relative import (`from . import x` / `from .foo import x`,
            # node.level >= 1) cannot resolve to a third-party package in a
            # single top-level script (there is no parent package to be
            # relative to) -- but reject it explicitly rather than silently
            # skipping it, so a mutant introducing one is still caught.
            assert node.level == 0, "relative imports are not permitted"
            if node.module is not None:
                roots.add(node.module.split(".")[0])
    assert roots
    for name in roots:
        assert _is_stdlib_module(name), f"{name} is not a standard-library module"
