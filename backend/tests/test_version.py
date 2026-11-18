"""SCRUM-91: app version comes from the project-root VERSION file."""

import json
import re
from pathlib import Path

from backend.app.config import APP_VERSION, VERSION_FILE, read_app_version
from backend.app.main import app

ROOT = Path(__file__).resolve().parents[2]


def _version_file() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def test_version_file_is_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", _version_file())


def test_backend_reads_version_file():
    assert VERSION_FILE == ROOT / "VERSION"
    assert _version_file() == APP_VERSION
    assert app.version == _version_file()


def test_health_endpoint_reports_version(client):
    body = client.get("/api/health").json()
    assert body == {"status": "ok", "version": _version_file()}


def test_frontend_package_version_matches():
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == _version_file()


def test_read_app_version_falls_back_when_missing(tmp_path):
    assert read_app_version(tmp_path / "missing") == "0.0.0"
    f = tmp_path / "VERSION"
    f.write_text(" 1.2.3\n", encoding="utf-8")
    assert read_app_version(f) == "1.2.3"
