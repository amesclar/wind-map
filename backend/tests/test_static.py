"""Static file containment for the SPA fallback (SCRUM-174)."""

from pathlib import Path

from backend.app.main import cache_control_for, resolve_static_file


def test_serves_a_file_inside_the_build(tmp_path: Path):
    (tmp_path / "assets").mkdir()
    asset = tmp_path / "assets" / "app.js"
    asset.write_text("console.log('wind');", encoding="utf-8")

    resolved = resolve_static_file("assets/app.js", tmp_path)

    assert resolved == asset.resolve()


def test_rejects_a_path_that_escapes_the_build(tmp_path: Path):
    build = tmp_path / "dist"
    build.mkdir()
    (tmp_path / "secret.txt").write_text("not for the browser", encoding="utf-8")

    assert resolve_static_file("../secret.txt", build) is None
    assert resolve_static_file("assets/../../secret.txt", build) is None


def test_rejects_an_absolute_path(tmp_path: Path):
    target = tmp_path / "outside.txt"
    target.write_text("nope", encoding="utf-8")

    assert resolve_static_file(str(target), tmp_path / "dist") is None


def test_rejects_empty_and_missing_paths(tmp_path: Path):
    assert resolve_static_file("", tmp_path) is None
    assert resolve_static_file("missing.js", tmp_path) is None


def test_rejects_a_directory(tmp_path: Path):
    (tmp_path / "assets").mkdir()

    assert resolve_static_file("assets", tmp_path) is None


def test_hashed_assets_never_change_under_the_same_name():
    assert (
        cache_control_for("/assets/index-pWAozy-B.js", "text/javascript; charset=utf-8")
        == "public, max-age=31536000, immutable"
    )


def test_the_shell_must_be_revalidated():
    # The shell names the chunk hashes, so a cached copy would outlive a rebuild (SCRUM-241).
    assert cache_control_for("/", "text/html; charset=utf-8") == "no-cache"
    assert cache_control_for("/some/client/route", "text/html; charset=utf-8") == "no-cache"


def test_api_responses_keep_their_own_policy():
    assert cache_control_for("/api/health", "application/json") is None
