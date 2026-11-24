"""scripts/rebuild-container.sh, run by the Devin Stop hook, must never block the agent (SCRUM-128)."""

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "rebuild-container.sh"
KIRO_HOOK = ROOT / ".kiro" / "hooks" / "rebuild-wind-map.json"
DEVIN_HOOK = ROOT / ".devin" / "hooks.v1.json"
BASH = shutil.which("bash") or "/bin/bash"

FAKE_DOCKER = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1" in
  info) [ -z "$FAKE_DOCKER_DOWN" ] ;;
  build) [ -z "$FAKE_BUILD_FAIL" ] ;;
  *) exit 0 ;;
esac
"""


_FEEDBACK_VARS = ("JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_FEEDBACK_PROJECT", "FEEDBACK_MAX_PER_HOUR")
_CLEARED = ("WIND_MAP_SKIP_REBUILD", "CARTO_API_KEY", "GIT_SHA", *_FEEDBACK_VARS)


@pytest.fixture
def fake_env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"docker": FAKE_DOCKER, "curl": "#!/usr/bin/env bash\nexit 0\n"}.items():
        path = bin_dir / name
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if k not in _CLEARED}
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["FAKE_LOG"] = str(tmp_path / "docker.log")
    return env


def _run(env, **extra):
    # Runs the repository's own script with fixed arguments; no untrusted input.
    result = subprocess.run(  # noqa: S603
        [BASH, str(SCRIPT)], env={**env, **extra}, capture_output=True, text=True, timeout=30, check=False
    )
    log = Path(env["FAKE_LOG"])
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, calls


def test_skip_variable_does_nothing(fake_env):
    result, calls = _run(fake_env, WIND_MAP_SKIP_REBUILD="1")
    assert result.returncode == 0
    assert calls == []
    assert "skipped" in result.stderr


def test_unavailable_docker_is_skipped(fake_env):
    result, calls = _run(fake_env, FAKE_DOCKER_DOWN="1")
    assert result.returncode == 0
    assert calls == ["info"]
    assert "Docker is not available" in result.stderr


def test_build_failure_keeps_the_running_container(fake_env):
    result, calls = _run(fake_env, FAKE_BUILD_FAIL="1", GIT_SHA="db9f569")
    assert result.returncode == 0
    assert calls == ["info", "build -q --build-arg GIT_SHA=db9f569 -t wind-map ."]
    assert "docker build failed" in result.stderr


def test_success_replaces_the_container_with_the_data_volume(fake_env):
    result, calls = _run(fake_env, CARTO_API_KEY="key", GIT_SHA="db9f569")
    assert result.returncode == 0
    assert calls == [
        "info",
        "build -q --build-arg GIT_SHA=db9f569 -t wind-map .",
        "stop wind-map",
        "rm wind-map",
        "run -d --name wind-map -p 5005:5005 -e CARTO_API_KEY -v wind_data:/app/data wind-map",
    ]
    assert "running on http://localhost:5005" in result.stderr


def test_jira_settings_are_forwarded_by_name_without_their_values(fake_env):
    secrets = {"JIRA_BASE_URL": "https://x.atlassian.net", "JIRA_EMAIL": "bot@x.com", "JIRA_API_TOKEN": "tok-123"}
    result, calls = _run(fake_env, GIT_SHA="db9f569", **secrets)
    assert result.returncode == 0
    assert calls[-1] == (
        "run -d --name wind-map -p 5005:5005 -e JIRA_BASE_URL -e JIRA_EMAIL -e JIRA_API_TOKEN"
        " -v wind_data:/app/data wind-map"
    )
    assert "tok-123" not in "\n".join(calls)


def _hook_commands(path: Path) -> list[str]:
    """Return every shell command declared in a Kiro standalone hook file or a Devin hooks file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if "hooks" in data:  # Kiro standalone hook file
        return [hook["action"]["command"] for hook in data["hooks"]]
    return [hook["command"] for entries in data.values() for entry in entries for hook in entry.get("hooks", [])]


def test_both_hooks_run_the_rebuild_script_with_the_same_invocation():
    assert _hook_commands(KIRO_HOOK) == _hook_commands(DEVIN_HOOK)
    for command in _hook_commands(KIRO_HOOK):
        assert "scripts/rebuild-container.sh" in command


def test_hook_commands_have_no_machine_specific_paths():
    for path in (KIRO_HOOK, DEVIN_HOOK):
        for command in _hook_commands(path):
            assert "/Users/" not in command, f"{path.name} hardcodes a user path: {command}"
            assert not command.strip('"').startswith("/"), f"{path.name} uses an absolute path: {command}"


def test_kiro_hook_keeps_its_trigger_and_timeout():
    data = json.loads(KIRO_HOOK.read_text(encoding="utf-8"))
    (hook,) = data["hooks"]
    assert data["version"] == "v1"
    assert hook["trigger"] == "PostTaskExec"
    assert hook["action"]["type"] == "command"
    assert hook["action"]["timeout"] == 300
