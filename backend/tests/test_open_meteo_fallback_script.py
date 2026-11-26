"""The Open-Meteo fallback must never start billing by accident (SCRUM-265).

`scripts/open-meteo-fallback.sh` creates a VM, so the safety property worth testing is that
every path except `create --yes` / `delete --yes` touches nothing, and that the create command
carries the configuration the ticket agreed on. A stub `gcloud` records each call.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "open-meteo-fallback.sh"
STARTUP = ROOT / "scripts" / "open-meteo-fallback-startup.sh"
BASH = shutil.which("bash") or "/bin/bash"

# $1 $2 $3: `compute instances describe` and `compute firewall-rules describe` answer 404 unless
# FAKE_EXISTS is set, so the create and delete paths can be exercised.
FAKE_GCLOUD = """#!/usr/bin/env bash
echo "$*" >> "${FAKE_LOG:?}"
if [ "$3" = "describe" ]; then
  [ -n "${FAKE_EXISTS:-}" ] || exit 1
  echo "RUNNING"
  exit 0
fi
exit 0
"""


@pytest.fixture
def fake_env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gcloud = bin_dir / "gcloud"
    gcloud.write_text(FAKE_GCLOUD, encoding="utf-8")
    gcloud.chmod(gcloud.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GCP_", "OPEN_METEO_"))}
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["FAKE_LOG"] = str(tmp_path / "gcloud.log")
    return env


def _run(env, *args, **extra):
    # Runs the repository's own script; no untrusted input.
    result = subprocess.run(  # noqa: S603
        [BASH, str(SCRIPT), *args],
        env={**env, **extra},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    log = Path(env["FAKE_LOG"])
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, calls


def test_plan_is_the_default_and_creates_nothing(fake_env):
    result, calls = _run(fake_env)
    assert result.returncode == 0
    assert calls == []
    assert "Nothing has been created" in result.stdout
    assert "58.92" in result.stdout


def test_plan_prints_the_agreed_configuration(fake_env):
    result, _ = _run(fake_env, "plan")
    assert result.returncode == 0
    for expected in ("e2-standard-2", "100 GB pd-balanced", "CACHE_SIZE=32GB", "10.8.0.0/28", "us-west1-b"):
        assert expected in result.stdout


@pytest.mark.parametrize("command", ["create", "delete"])
def test_billable_commands_refuse_without_yes(fake_env, command):
    result, calls = _run(fake_env, command)
    assert result.returncode == 1
    assert calls == []
    assert "--yes" in result.stderr


def test_create_with_yes_builds_the_prepared_instance(fake_env):
    result, calls = _run(fake_env, "create", "--yes")
    assert result.returncode == 0
    joined = "\n".join(calls)
    assert "services enable compute.googleapis.com" in joined
    assert "compute firewall-rules create open-meteo-fallback-8080" in joined
    assert "--source-ranges=10.8.0.0/28" in joined
    assert "--rules=tcp:8080" in joined
    assert "compute instances create open-meteo-fallback" in joined
    assert "--machine-type=e2-standard-2" in joined
    assert "--boot-disk-size=100GB" in joined
    assert "--boot-disk-type=pd-balanced" in joined
    assert "--image-family=cos-stable" in joined
    assert "--tags=open-meteo-fallback" in joined
    assert "--metadata-from-file=startup-script=" in joined
    assert str(STARTUP) in joined
    # The firewall rule must exist before the instance can be reached on 8080.
    assert joined.index("firewall-rules create") < joined.index("instances create")


def test_delete_with_yes_removes_everything_it_created(fake_env):
    result, calls = _run(fake_env, "delete", "--yes", FAKE_EXISTS="1")
    assert result.returncode == 0
    joined = "\n".join(calls)
    assert "compute instances delete open-meteo-fallback" in joined
    assert "compute firewall-rules delete open-meteo-fallback-8080" in joined
    assert "left billing" in result.stdout


def test_status_is_read_only(fake_env):
    result, calls = _run(fake_env, "status", FAKE_EXISTS="1")
    assert result.returncode == 0
    assert calls and all("describe" in call for call in calls)
    assert "present" in result.stdout


def test_unknown_command_prints_usage(fake_env):
    result, calls = _run(fake_env, "apply")
    assert result.returncode == 2
    assert calls == []
    assert "usage:" in result.stderr


def test_both_scripts_are_valid_bash_and_executable():
    for path in (SCRIPT, STARTUP):
        result = subprocess.run(  # noqa: S603
            [BASH, "-n", str(path)], capture_output=True, text=True, timeout=30, check=False
        )
        assert result.returncode == 0, result.stderr
        assert os.access(path, os.X_OK), f"{path.name} is not executable"


def test_startup_script_pins_the_measured_configuration():
    body = STARTUP.read_text(encoding="utf-8")
    assert "ghcr.io/open-meteo/open-meteo@sha256:" in body
    assert "REMOTE_DATA_DIRECTORY=https://openmeteo.s3.amazonaws.com/data/" in body
    assert 'CACHE_SIZE="${CACHE_SIZE:-32GB}"' in body
    assert "--restart=always" in body
    assert "-p 8080:8080" in body
    assert "sleep $WARM_INTERVAL_SECONDS" in body
    assert "/var/lib/open-meteo" in body
