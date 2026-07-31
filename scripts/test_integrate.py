"""Tests for integrate.py — run with: pytest scripts/test_integrate.py"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

FRAMEWORK = Path(__file__).resolve().parent.parent
INTEGRATE = FRAMEWORK / "scripts" / "integrate.py"

sys.path.insert(0, str(FRAMEWORK / "scripts"))
integrate = __import__("integrate")


def run(args, cwd=None):
    return subprocess.run(
        [sys.executable] + [str(a) for a in args],
        capture_output=True, text=True, cwd=cwd,
    )


def make_host(tmp_path, runners=(".claude",)):
    host = tmp_path / "host"
    host.mkdir()
    subprocess.run(["git", "init", "-q", str(host)], check=True)
    for runner in runners:
        (host / runner).mkdir(parents=True, exist_ok=True)
    return host


def init(host, *extra):
    return run([INTEGRATE, "init", host, "--provenance", "private"] + list(extra))


def validate(host):
    return run([host / ".gateline" / "scripts" / "integrate.py", "validate", host])


def test_init_and_validate_prefixed_private(tmp_path):
    host = make_host(tmp_path)
    result = init(host, "--take", "sdlc")
    assert result.returncode == 0, result.stdout + result.stderr

    lock = json.loads((host / ".gateline" / "framework-lock.json").read_text())
    schema = json.loads((FRAMEWORK / "scripts" / "framework-lock.schema.json").read_text())
    for key in schema["required"]:
        assert key in lock
    assert lock["provenance_mode"] == "private"
    assert ".gateline/roles/integrator.md" in lock["files"]

    assert (host / ".claude" / "agents" / "analyst.md").exists()
    assert (host / ".gateline" / "LICENSE.framework.md").exists()
    assert "framework-lock.json" in (host / "NOTICE.md").read_text()
    assert (host / ".github" / "workflows" / "gateline-render-check.yml").exists()

    check = validate(host)
    assert check.returncode == 0, check.stdout + check.stderr


def test_validate_catches_in_place_edit(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    role = host / ".gateline" / "roles" / "analyst.md"
    role.write_text(role.read_text() + "\nEDITED\n")
    check = validate(host)
    assert check.returncode == 1
    assert "edited in place" in check.stdout


def test_fork_flow(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    rel = ".gateline/contracts/state.yaml"
    forked = run([INTEGRATE, "fork", rel, "--reason", "non-SDLC gates",
                  "--target", host])
    assert forked.returncode == 0, forked.stdout + forked.stderr
    target = host / rel
    target.write_text(target.read_text() + "\n# host-local extension\n")
    check = validate(host)
    assert check.returncode == 0, check.stdout + check.stderr
    lock = json.loads((host / ".gateline" / "framework-lock.json").read_text())
    assert lock["forks"][rel]["reason"] == "non-SDLC gates"
    assert (host / ".gateline" / "upstream" / rel).exists()


def test_fork_refuses_already_edited_file(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    rel = ".gateline/roles/analyst.md"
    (host / rel).write_text((host / rel).read_text() + "drift\n")
    forked = run([INTEGRATE, "fork", rel, "--reason", "x", "--target", host])
    assert forked.returncode != 0
    assert "already been edited" in forked.stderr + forked.stdout


def test_root_layout_redistribute_two_adapters(tmp_path):
    host = make_host(tmp_path, runners=(".claude", ".github/agents"))
    result = init(host, "--layout", "root", "--provenance", "redistribute")
    # --provenance passed twice (init() adds private); last one wins in argparse
    assert result.returncode == 0, result.stdout + result.stderr
    assert (host / "roles" / "analyst.md").exists()
    assert (host / ".github" / "agents" / "analyst.agent.md").exists()
    assert "Apache License 2.0" in (host / "NOTICE.md").read_text()
    check = run([host / "scripts" / "integrate.py", "validate", host])
    assert check.returncode == 0, check.stdout + check.stderr


def test_reinit_preserves_project_and_seeded_layers(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    overlay = host / ".gateline" / "overlays" / "_all.md"
    overlay.write_text("House rule: run the linter.\n")
    registry = host / ".gateline" / "registry" / "models.yaml"
    registry.write_text(registry.read_text() + "# host binding note\n")
    again = init(host)
    assert again.returncode == 0, again.stdout + again.stderr
    assert overlay.read_text() == "House rule: run the linter.\n"
    assert "# host binding note" in registry.read_text()
    check = validate(host)
    assert check.returncode == 0, check.stdout + check.stderr


def test_init_refuses_silent_drift(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    role = host / ".gateline" / "roles" / "reviewer.md"
    original = role.read_text()
    role.write_text(original + "drift\n")
    again = init(host)
    assert again.returncode != 0
    assert "edited in place" in again.stderr + again.stdout
    assert role.read_text() == original + "drift\n"  # never clobbered


def test_overlay_splice_lands_in_rendered_agents(tmp_path):
    host = make_host(tmp_path)
    assert init(host).returncode == 0
    rendered = host / ".claude" / "agents" / "analyst.md"
    assert "OVERLAY" not in rendered.read_text()  # comment-only stubs splice nothing
    (host / ".gateline" / "overlays" / "_all.md").write_text("Run tests first.\n")
    render = run([host / ".gateline" / "scripts" / "render-agents.py"])
    assert render.returncode == 0
    text = rendered.read_text()
    assert "OVERLAY from overlays/_all.md" in text
    assert "Run tests first." in text


def test_resolve_take_rejects_unknown_files():
    manifest = json.loads((FRAMEWORK / "scripts" / "copy-manifest.json").read_text())
    with pytest.raises(SystemExit):
        integrate.resolve_take(manifest, "roles/nonexistent.md")
