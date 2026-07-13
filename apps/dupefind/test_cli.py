"""End-to-end CLI tests for dupefind.py: exit codes, stderr, exact stdout
bytes, double-run determinism, and the R9 single-file/stdlib-only/3.9-safe
constraint checks.

Per plan.md's "Test-layout contract", the script under test is located as
pathlib.Path(__file__).parent / "dupefind.py" and invoked via
subprocess.run([sys.executable, str(script), ...], capture_output=True,
timeout=30) on every call — the timeout is mandatory so a FIFO-filter
regression fails instead of hanging pytest (AC2.3; plan risk).

Expected output paths are always built with os.path.join from the exact
root string passed to the tool (never .resolve()/realpath() — the tool
never resolves, and macOS tmp dirs are symlinked).
"""

import ast
import importlib.util
import os
import pathlib
import subprocess
import sys
import sysconfig

SCRIPT = pathlib.Path(__file__).parent / "dupefind.py"


def run_cli(args, timeout=30):
    return subprocess.run(
        [sys.executable, str(SCRIPT)] + list(args),
        capture_output=True,
        timeout=timeout,
    )


# --- AC1.1 / AC1.2 -----------------------------------------------------


def test_ac1_1_existing_readable_directory_with_duplicate_exits_zero(tmp_path):
    root = str(tmp_path)
    (tmp_path / "a.txt").write_bytes(b"same content")
    (tmp_path / "b.txt").write_bytes(b"same content")

    result = run_cli([root])

    assert result.returncode == 0


def test_ac1_2_no_argument_exits_nonzero_with_usage_on_stderr():
    result = run_cli([])

    assert result.returncode == 2
    assert result.stderr != b""
    assert result.stdout == b""


# --- No-flags guarantee (R4/AC4.2, plan CLI contract; G0 veto; review-01 F1) --


def test_no_flags_include_empty_rejected_exit_2(tmp_path):
    root = str(tmp_path)

    result = run_cli(["--include-empty", root])

    assert result.returncode == 2
    assert result.stderr != b""
    assert result.stdout == b""


def test_no_flags_help_long_rejected_exit_2(tmp_path):
    root = str(tmp_path)

    result = run_cli(["--help", root])

    assert result.returncode == 2
    assert result.stderr != b""
    assert result.stdout == b""


def test_no_flags_help_short_rejected_exit_2(tmp_path):
    root = str(tmp_path)

    result = run_cli(["-h", root])

    assert result.returncode == 2
    assert result.stderr != b""
    assert result.stdout == b""


def test_no_flags_help_short_alone_rejected_exit_2():
    # -h with no positional at all: still exit 2, usage on stderr,
    # byte-empty stdout (add_help=False means -h is never special-cased).
    result = run_cli(["-h"])

    assert result.returncode == 2
    assert result.stderr != b""
    assert result.stdout == b""


# --- AC2.2 / AC2.3 -------------------------------------------------------


def test_ac2_2_ac2_3_symlinks_and_fifo_excluded_completes_within_timeout(tmp_path):
    root = str(tmp_path)
    sub = tmp_path / "sub"
    sub.mkdir()

    real_a = sub / "real_a.txt"
    real_b = tmp_path / "real_b.txt"
    real_a.write_bytes(b"duplicate payload")
    real_b.write_bytes(b"duplicate payload")

    # File symlink to one of the duplicate pair.
    symlink_file = tmp_path / "link_to_a.txt"
    os.symlink(str(real_a), str(symlink_file))

    # Directory symlink pointing back at an ancestor (cycle).
    cycle_link = sub / "cycle_back"
    os.symlink(str(tmp_path), str(cycle_link))

    # FIFO in the tree.
    fifo_path = tmp_path / "a_fifo"
    os.mkfifo(str(fifo_path))

    result = run_cli([root], timeout=30)

    assert result.returncode == 0

    expected_a = os.path.join(root, "sub", "real_a.txt")
    expected_b = os.path.join(root, "real_b.txt")
    expected_symlink = os.path.join(root, "link_to_a.txt")
    expected_fifo = os.path.join(root, "a_fifo")

    assert expected_a.encode() in result.stdout
    assert expected_b.encode() in result.stdout
    assert expected_symlink.encode() not in result.stdout
    assert expected_fifo.encode() not in result.stdout
    # Directory-symlink half of AC2.2: a followlinks=True mutant would
    # self-terminate via ELOOP within the timeout and exit 0 with a huge
    # group reached *through* cycle_back — kill it by exact stdout bytes:
    # a single two-member group, sorted, no other content (review-03 F1).
    assert b"cycle_back" not in result.stdout
    expected_group = sorted([expected_a, expected_b])
    expected_stdout = ("\n".join(expected_group) + "\n").encode()
    assert result.stdout == expected_stdout


# --- AC4.2 -----------------------------------------------------------------


def test_ac4_2_only_empty_files_exits_zero_empty_stdout(tmp_path):
    root = str(tmp_path)
    (tmp_path / "e1.txt").write_bytes(b"")
    (tmp_path / "e2.txt").write_bytes(b"")
    (tmp_path / "e3.txt").write_bytes(b"")

    result = run_cli([root])

    assert result.returncode == 0
    assert result.stdout == b""


# --- AC5.1 -------------------------------------------------------------


def test_ac5_1_exact_stdout_bytes_for_spec_fixture(tmp_path):
    root = str(tmp_path)
    (tmp_path / "a.txt").write_bytes(b"group one content")
    (tmp_path / "b.txt").write_bytes(b"group one content")
    c_dir = tmp_path / "c"
    c_dir.mkdir()
    (c_dir / "d.txt").write_bytes(b"group two content")
    (tmp_path / "e.txt").write_bytes(b"group two content")
    (tmp_path / "f.txt").write_bytes(b"unique content")

    result = run_cli([root])

    assert result.returncode == 0

    a_path = os.path.join(root, "a.txt")
    b_path = os.path.join(root, "b.txt")
    d_path = os.path.join(root, "c", "d.txt")
    e_path = os.path.join(root, "e.txt")
    f_path = os.path.join(root, "f.txt")

    group1 = sorted([a_path, b_path])
    group2 = sorted([d_path, e_path])
    groups = sorted([group1, group2], key=lambda g: g[0])

    expected = (
        "\n\n".join("\n".join(g) for g in groups) + "\n"
    ).encode()

    assert result.stdout == expected
    assert f_path.encode() not in result.stdout


# --- AC5.2 (name contract: must contain 'reproduc') -----------------------


def test_ac5_2_reproducible_across_two_runs(tmp_path):
    root = str(tmp_path)
    (tmp_path / "a.txt").write_bytes(b"same content")
    (tmp_path / "b.txt").write_bytes(b"same content")
    c_dir = tmp_path / "c"
    c_dir.mkdir()
    (c_dir / "d.txt").write_bytes(b"other content")
    (tmp_path / "e.txt").write_bytes(b"other content")

    first = run_cli([root])
    second = run_cli([root])

    assert first.returncode == 0
    assert second.returncode == 0
    assert first.stdout != b""
    assert first.stdout == second.stdout


# --- AC6.1 / AC6.2 -------------------------------------------------------


def test_ac6_1_no_duplicate_content_exits_zero_empty_stdout(tmp_path):
    root = str(tmp_path)
    (tmp_path / "a.txt").write_bytes(b"alpha")
    (tmp_path / "b.txt").write_bytes(b"bravo")
    (tmp_path / "c.txt").write_bytes(b"charlie")

    result = run_cli([root])

    assert result.returncode == 0
    assert result.stdout == b""


def test_ac6_2_empty_directory_exits_zero_empty_stdout(tmp_path):
    root = str(tmp_path)

    result = run_cli([root])

    assert result.returncode == 0
    assert result.stdout == b""


# --- AC7.1 / AC7.2 -------------------------------------------------------


def test_ac7_1_nonexistent_path_exits_nonzero_no_traceback(tmp_path):
    missing = str(tmp_path / "does-not-exist-dir")

    result = run_cli([missing])

    # Plan CLI contract: root errors exit exactly 1 (distinct from
    # argparse's 2), one pinned stderr line, nothing on stdout
    # (review-03 F2/F3).
    assert result.returncode == 1
    assert result.stderr != b""
    assert b"Traceback" not in result.stderr
    assert result.stdout == b""
    assert result.stderr == "dupefind.py: error: no such directory: {}\n".format(
        missing
    ).encode()


def test_ac7_2_path_to_regular_file_exits_nonzero_no_traceback(tmp_path):
    regular_file = tmp_path / "not_a_dir.txt"
    regular_file.write_bytes(b"just a file")

    result = run_cli([str(regular_file)])

    # Plan CLI contract: root errors exit exactly 1, one pinned stderr
    # line, nothing on stdout (review-03 F2/F3).
    assert result.returncode == 1
    assert result.stderr != b""
    assert b"Traceback" not in result.stderr
    assert result.stdout == b""
    assert result.stderr == "dupefind.py: error: not a directory: {}\n".format(
        str(regular_file)
    ).encode()


# --- AC9.1 -----------------------------------------------------------------


def test_ac9_1_exactly_one_non_test_py_source_file():
    package_dir = pathlib.Path(__file__).parent
    py_files = [
        p
        for p in package_dir.glob("*.py")
        if not p.name.startswith("test_") and p.name != "conftest.py"
    ]

    assert len(py_files) == 1
    assert py_files[0].name == "dupefind.py"


# --- AC9.2 -------------------------------------------------------------


def _is_stdlib_root(module_name):
    """Stdlib-membership check per plan ADR-8, verbatim mechanism."""
    if module_name in sys.builtin_module_names:
        return True

    spec = importlib.util.find_spec(module_name)
    if spec is None:
        return False
    origin = spec.origin
    if origin in ("built-in", "frozen"):
        return True
    if origin is None:
        return False

    stdlib_dir = os.path.realpath(sysconfig.get_paths()["stdlib"])
    resolved_origin = os.path.realpath(origin)
    if not resolved_origin.startswith(stdlib_dir + os.sep):
        return False
    if "site-packages" in resolved_origin or "dist-packages" in resolved_origin:
        return False
    return True


def test_ac9_2_all_imports_are_stdlib():
    tree = ast.parse(SCRIPT.read_text())

    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0
            if node.module is not None:
                roots.add(node.module.split(".")[0])

    assert roots != set()

    for root in roots:
        assert _is_stdlib_root(root), "{} is not a stdlib module".format(root)


# --- AC9.3 -------------------------------------------------------------


def test_ac9_3_py_compile_succeeds_and_no_binop_in_annotations():
    compile_result = subprocess.run(
        [sys.executable, "-m", "py_compile", str(SCRIPT)],
        capture_output=True,
        timeout=30,
    )
    assert compile_result.returncode == 0

    tree = ast.parse(SCRIPT.read_text())

    def _annotation_nodes():
        for node in ast.walk(tree):
            if isinstance(node, ast.arg) and node.annotation is not None:
                yield node.annotation
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.returns is not None:
                    yield node.returns
            if isinstance(node, ast.AnnAssign):
                yield node.annotation

    for annotation in _annotation_nodes():
        for sub in ast.walk(annotation):
            assert not isinstance(sub, ast.BinOp), (
                "PEP 604 union (BinOp) found inside an annotation expression"
            )
