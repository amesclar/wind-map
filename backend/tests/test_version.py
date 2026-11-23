"""SCRUM-91: app version comes from the project-root VERSION file.

SCRUM-159: the reported version adds the short commit hash (`X.Y.Z-<hash>`) from the GIT_SHA
build arg; VERSION itself stays plain semver and release tags stay `vX.Y.Z`.
"""

import json
import re
from pathlib import Path

from backend.app.config import (
    APP_VERSION,
    VERSION_FILE,
    compose_version,
    read_app_version,
    read_git_sha,
)
from backend.app.main import app

ROOT = Path(__file__).resolve().parents[2]


def _version_file() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def test_version_file_is_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", _version_file())


def test_backend_reads_version_file():
    assert VERSION_FILE == ROOT / "VERSION"
    assert _version_file() == read_app_version()
    assert app.version == APP_VERSION


def test_reported_version_is_the_base_version_plus_the_build_hash():
    assert compose_version(_version_file(), read_git_sha()) == APP_VERSION
    assert re.fullmatch(r"\d+\.\d+\.\d+(-[0-9a-f]{4,40})?", APP_VERSION)


def test_health_endpoint_reports_version(client):
    body = client.get("/api/health").json()
    assert body == {"status": "ok", "version": APP_VERSION}


def test_frontend_package_version_matches():
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == _version_file()


def test_read_app_version_falls_back_when_missing(tmp_path):
    assert read_app_version(tmp_path / "missing") == "0.0.0"
    f = tmp_path / "VERSION"
    f.write_text(" 1.2.3\n", encoding="utf-8")
    assert read_app_version(f) == "1.2.3"


def test_compose_version_appends_a_short_commit_hash():
    assert compose_version("0.7.1", "db9f569") == "0.7.1-db9f569"
    assert compose_version(" 0.7.1 ", " db9f569 ") == "0.7.1-db9f569"


def test_compose_version_stays_plain_without_a_usable_hash():
    assert compose_version("0.7.1", "") == "0.7.1"
    assert compose_version("0.7.1", "   ") == "0.7.1"
    assert compose_version("0.7.1", "not-a-sha") == "0.7.1"
    assert compose_version("0.7.1", "db9f569-dirty") == "0.7.1"


def test_read_git_sha_prefers_the_build_arg(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "db9f569")
    assert read_git_sha() == "db9f569"
    assert read_git_sha("abc1234") == "abc1234"


def test_read_git_sha_ignores_a_missing_or_malformed_value(monkeypatch):
    monkeypatch.delenv("GIT_SHA", raising=False)
    assert read_git_sha() == ""
    monkeypatch.setenv("GIT_SHA", "  ")
    assert read_git_sha() == ""
    assert read_git_sha("not-a-sha") == ""
