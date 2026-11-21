"""scripts/rebuild-container.sh, run by the Devin Stop hook, must never block the agent (SCRUM-128)."""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "rebuild-container.sh"
BASH = shutil.which("bash") or "/bin/bash"

FAKE_DOCKER = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1" in
  info) [ -z "$FAKE_DOCKER_DOWN" ] ;;
  build) [ -z "$FAKE_BUILD_FAIL" ] ;;
  *) exit 0 ;;
esac
"""


@pytest.fixture
def fake_env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"docker": FAKE_DOCKER, "curl": "#!/usr/bin/env bash\nexit 0\n"}.items():
        path = bin_dir / name
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if k not in ("WIND_MAP_SKIP_REBUILD", "CARTO_API_KEY")}
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
    result, calls = _run(fake_env, FAKE_BUILD_FAIL="1")
    assert result.returncode == 0
    assert calls == ["info", "build -q -t wind-map ."]
    assert "docker build failed" in result.stderr


def test_success_replaces_the_container_with_the_data_volume(fake_env):
    result, calls = _run(fake_env, CARTO_API_KEY="key")
    assert result.returncode == 0
    assert calls == [
        "info",
        "build -q -t wind-map .",
        "stop wind-map",
        "rm wind-map",
        "run -d --name wind-map -p 5005:5005 -e CARTO_API_KEY -v wind_data:/app/data wind-map",
    ]
    assert "running on http://localhost:5005" in result.stderr
