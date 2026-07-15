"""End-to-end tests for mdtoc's CLI: invokes the finished script as a real
subprocess and asserts on exit codes, stdout bytes, and stderr. Does not
import mdtoc or duplicate test_core.py's function-level tests (that is
test_core.py's job). Run with `pytest` from apps/mdtoc/."""

import ast
import importlib.util
import subprocess
import sys
import sysconfig
from pathlib import Path

SCRIPT = Path(__file__).parent / "mdtoc.py"


def run_cli(*args, **kwargs):
    """Invoke mdtoc.py as a subprocess with the given args; returns the
    completed process with captured stdout/stderr bytes."""
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, **kwargs
    )


# --- CLI file input, stdout-only output (R1) ---------------------------------

def test_ac1_1_existing_readable_file_exits_zero_with_toc(tmp_path):
    """AC1.1 — running against an existing, readable file with headings
    exits 0 and prints the TOC to stdout."""
    path = tmp_path / "sample.md"
    path.write_text("# Title\n\nBody text.\n", encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == b"- [Title](#title)\n"


def test_ac1_2_no_file_argument_exits_nonzero_with_stderr():
    """AC1.2 — no file argument exits non-zero (argparse: 2) and prints
    usage to stderr."""
    result = run_cli()
    assert result.returncode == 2
    assert result.stderr != b""


def test_ac1_3_read_only_leaves_input_and_directory_untouched(tmp_path):
    """AC1.3 — the tool never writes: the input file's bytes are unchanged
    after the run, and no new file appears in the directory it ran in."""
    path = tmp_path / "input.md"
    original_bytes = b"# Title\n\nSome body text.\n"
    path.write_bytes(original_bytes)
    before_entries = {p.name for p in tmp_path.iterdir()}

    result = run_cli("input.md", cwd=tmp_path)

    assert result.returncode == 0
    assert path.read_bytes() == original_bytes
    after_entries = {p.name for p in tmp_path.iterdir()}
    assert after_entries == before_entries


# --- byte-exact nested TOC output (R6) ----------------------------------------

def test_ac6_1_stdout_is_byte_exact(tmp_path):
    """AC6.1 — the spec's four-heading fixture produces the exact expected
    stdout bytes, nested per absolute heading level."""
    path = tmp_path / "doc.md"
    path.write_text(
        "# Title\n## Section A\n### Sub A1\n## Section B\n",
        encoding="utf-8",
    )
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == (
        b"- [Title](#title)\n"
        b"  - [Section A](#section-a)\n"
        b"    - [Sub A1](#sub-a1)\n"
        b"  - [Section B](#section-b)\n"
    )


# --- invalid input handling (R7) ----------------------------------------------

def test_ac7_1_nonexistent_path_exits_nonzero_no_traceback(tmp_path):
    """AC7.1 — a nonexistent path exits non-zero with a non-empty,
    traceback-free stderr message."""
    missing = tmp_path / "does-not-exist.md"
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


def test_ac7_3_invalid_utf8_exits_nonzero_no_traceback(tmp_path):
    """AC7.3 — a file containing invalid UTF-8 bytes exits non-zero with a
    non-empty, traceback-free stderr message."""
    path = tmp_path / "not_utf8.md"
    path.write_bytes(b"\x80\x81abc")
    result = run_cli(str(path))
    assert result.returncode != 0
    assert result.stderr != b""
    assert b"Traceback" not in result.stderr


# --- headingless input is not an error (R8) -----------------------------------

def test_ac8_1_body_text_no_headings_exits_zero_no_stdout(tmp_path):
    """AC8.1 — a file with body text but zero ATX headings exits 0 with no
    stdout output."""
    path = tmp_path / "no_headings.md"
    path.write_text("Just some body text.\n\nMore text, no markers.\n", encoding="utf-8")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == b""


def test_ac8_2_zero_byte_file_exits_zero_no_stdout(tmp_path):
    """AC8.2 — a 0-byte file exits 0 with no stdout output."""
    path = tmp_path / "empty.md"
    path.write_bytes(b"")
    result = run_cli(str(path))
    assert result.returncode == 0
    assert result.stdout == b""


# --- implementation constraints (R10) ------------------------------------------

def test_ac10_1_exactly_one_non_test_source_file():
    """AC10.1 — exactly one non-test *.py file in the deliverable
    directory (test files and conftest.py excluded)."""
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
    directory from the site-packages where pip/setuptools actually live).
    (plan.md ADR-8, mechanism verbatim.)"""
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
    """AC10.2 — every module mdtoc.py imports is a standard-library
    module (via ast, matching the spec's own AC10.2 command; mechanism
    per plan.md ADR-8, not sys.stdlib_module_names)."""
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
        assert _is_stdlib_module(name), "{} is not a standard-library module".format(name)


def test_ac10_3_py_compiles_and_has_no_pep604_annotations():
    """AC10.3 — (a) the file compiles cleanly under sys.executable (3.9.6
    here, per plan.md ADR-8); (b) an interpreter-independent AST check
    confirms no `ast.BinOp` (the `X | Y` union syntax) occurs inside any
    annotation expression (arg annotations, `returns`, `AnnAssign.annotation`)
    -- this stays meaningful even if a future environment runs it on 3.10+,
    where py_compile alone would no longer catch PEP 604 usage."""
    compile_result = subprocess.run(
        [sys.executable, "-m", "py_compile", str(SCRIPT)], capture_output=True
    )
    assert compile_result.returncode == 0

    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))

    def annotation_exprs():
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.returns is not None:
                    yield node.returns
                args = node.args
                all_args = (
                    list(args.posonlyargs)
                    + list(args.args)
                    + list(args.kwonlyargs)
                    + ([args.vararg] if args.vararg else [])
                    + ([args.kwarg] if args.kwarg else [])
                )
                for arg in all_args:
                    if arg.annotation is not None:
                        yield arg.annotation
            elif isinstance(node, ast.AnnAssign):
                yield node.annotation

    for expr in annotation_exprs():
        for sub in ast.walk(expr):
            assert not isinstance(sub, ast.BinOp), "PEP 604 union found in annotation"
