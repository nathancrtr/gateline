"""Tests for the npm distribution: the packed tarball is a working framework
release. Run with: pytest scripts/test_package.py  (needs node + npm on PATH,
like frontend/ development already does)."""
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

FRAMEWORK = Path(__file__).resolve().parent.parent
MANIFEST = FRAMEWORK / "scripts" / "release-manifest.json"

pytestmark = pytest.mark.skipif(
    shutil.which("npm") is None or shutil.which("node") is None,
    reason="npm/node not on PATH",
)


@pytest.fixture(scope="module")
def package_dir(tmp_path_factory):
    """npm pack with a stamped release manifest, extracted — the artifact an
    npx user actually runs."""
    tmp = tmp_path_factory.mktemp("pack")
    stamped_here = not MANIFEST.exists()
    if stamped_here:
        MANIFEST.write_text(json.dumps({
            "repo": "https://github.com/nathancrtr/agentic-sandbox",
            "ref": "v0.0.0-test",
            "version": "0.0.0-test",
        }))
    try:
        subprocess.run(
            ["npm", "pack", "--pack-destination", str(tmp)],
            cwd=FRAMEWORK, check=True, capture_output=True, text=True,
        )
        tarball = next(tmp.glob("ads-core-*.tgz"))
        with tarfile.open(tarball) as tar:
            tar.extractall(tmp)
    finally:
        if stamped_here:
            MANIFEST.unlink()
    return tmp / "package"


def make_host(tmp_path):
    host = tmp_path / "host"
    host.mkdir()
    subprocess.run(["git", "init", "-q", str(host)], check=True)
    (host / ".claude").mkdir()
    return host


def test_tarball_contents(package_dir):
    # Everything the copy manifest offers must ship, or init fails downstream.
    copy_manifest = json.loads(
        (package_dir / "scripts" / "copy-manifest.json").read_text()
    )
    offered = list(copy_manifest["always"])
    for group in copy_manifest["groups"].values():
        offered += group
    missing = [f for f in offered if not (package_dir / f).exists()]
    assert not missing, "copy-manifest files absent from tarball: %s" % missing

    for required in ("bin/ads-core.js", "adapters/claude-code/manifest.json",
                     "registry/models.yaml", "NOTICE.md",
                     "scripts/release-manifest.json", "docs/INTEGRATION.md"):
        assert (package_dir / required).exists(), "missing %s" % required

    # The W4 exclusion rule, enforced: no working area, no evidence apps,
    # no frontend workspace, no tests, no rendered agents.
    for excluded in ("runs", "apps", "frontend", ".claude", ".github",
                     "scripts/test_integrate.py", "scripts/test_package.py"):
        assert not (package_dir / excluded).exists(), "%s leaked into tarball" % excluded


def test_init_from_tarball_records_release_version(package_dir, tmp_path):
    host = make_host(tmp_path)
    result = subprocess.run(
        [sys.executable, str(package_dir / "scripts" / "integrate.py"),
         "init", str(host), "--provenance", "private", "--take", "sdlc"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    lock = json.loads((host / ".agentic" / "framework-lock.json").read_text())
    # No git metadata in a tarball: the stamped manifest must be the source.
    assert lock["source"]["version"] == "0.0.0-test"
    assert lock["source"]["ref"] == "v0.0.0-test"
    assert lock["source"]["repo"] == "https://github.com/nathancrtr/agentic-sandbox"


def test_shim_init_and_vendored_validate(package_dir, tmp_path):
    """The npx flow end-to-end: node shim runs init from the package, then
    validate from inside the host redirects to the vendored copy."""
    host = make_host(tmp_path)
    init = subprocess.run(
        ["node", str(package_dir / "bin" / "ads-core.js"),
         "init", str(host), "--provenance", "private"],
        capture_output=True, text=True,
    )
    assert init.returncode == 0, init.stdout + init.stderr
    assert (host / ".agentic" / "scripts" / "integrate.py").exists()

    validate = subprocess.run(
        ["node", str(package_dir / "bin" / "ads-core.js"), "validate", str(host)],
        capture_output=True, text=True, cwd=host,
    )
    assert validate.returncode == 0, validate.stdout + validate.stderr
    assert "validate: OK" in validate.stdout


def test_shim_reports_missing_subcommand(package_dir):
    result = subprocess.run(
        ["node", str(package_dir / "bin" / "ads-core.js")],
        capture_output=True, text=True,
    )
    assert result.returncode != 0  # argparse usage error passes through


def test_package_version_is_semver():
    pkg = json.loads((FRAMEWORK / "package.json").read_text())
    assert pkg["name"] == "ads-core"
    major, minor, patch = pkg["version"].split(".")
    assert all(part.isdigit() for part in (major, minor, patch))
