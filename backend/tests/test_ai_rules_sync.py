"""The Antigravity rules file must be generated from .kiro/steering (SCRUM-119)."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_script():
    spec = importlib.util.spec_from_file_location("sync_ai_rules", ROOT / "scripts" / "sync-ai-rules.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_antigravity_rules_are_up_to_date():
    sync = _load_script()
    committed = sync.TARGET.read_text(encoding="utf-8")
    assert committed == sync.build(), "Run: python scripts/sync-ai-rules.py and commit the result"


def test_generated_file_contains_every_steering_file():
    sync = _load_script()
    content = sync.build()
    steering_files = sorted(p.name for p in sync.STEERING_DIR.glob("*.md"))
    assert sorted(sync.SOURCES) == steering_files, "Add new steering files to SOURCES in the script"
    for name in steering_files:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content


def test_check_mode_reports_a_stale_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    stale = tmp_path / "instructions.md"
    stale.write_text("old", encoding="utf-8")
    monkeypatch.setattr(sync, "TARGET", stale)
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    assert sync.main(["--check"]) == 1
    assert "out of date" in capsys.readouterr().out
    assert sync.main([]) == 0
    assert sync.main(["--check"]) == 0
