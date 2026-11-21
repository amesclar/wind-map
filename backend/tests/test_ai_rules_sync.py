"""The AI tool rule files must be generated from .kiro/steering (SCRUM-119, SCRUM-111, SCRUM-128)."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_script():
    spec = importlib.util.spec_from_file_location("sync_ai_rules", ROOT / "scripts" / "sync-ai-rules.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_generated_rule_files_are_up_to_date():
    sync = _load_script()
    expected = sync.build()
    for target in sync.TARGETS:
        committed = target.read_text(encoding="utf-8")
        assert committed == expected, f"{target.name} is stale. Run: python scripts/sync-ai-rules.py and commit"


def test_gemini_md_exists_at_the_project_root():
    sync = _load_script()
    assert ROOT / "GEMINI.md" in sync.TARGETS
    assert (ROOT / "GEMINI.md").is_file()


def test_agents_md_exists_at_the_project_root_and_fits_devin_limit():
    sync = _load_script()
    assert ROOT / "AGENTS.md" in sync.TARGETS
    size = len((ROOT / "AGENTS.md").read_bytes())
    assert size <= sync.AGENTS_MD_LIMIT_BYTES, (
        f"AGENTS.md is {size} bytes; Devin only auto-includes {sync.AGENTS_MD_LIMIT_BYTES}. "
        "Move situational guidance into .agents/skills/"
    )


def test_generated_file_contains_every_steering_file():
    sync = _load_script()
    content = sync.build()
    steering_files = sorted(p.name for p in sync.STEERING_DIR.glob("*.md"))
    assert sorted(sync.SOURCES) == steering_files, "Add new steering files to SOURCES in the script"
    for name in steering_files:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content


def test_check_mode_reports_every_stale_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    first, second = tmp_path / "a" / "instructions.md", tmp_path / "GEMINI.md"
    first.parent.mkdir()
    first.write_text("old", encoding="utf-8")
    second.write_text("old", encoding="utf-8")
    monkeypatch.setattr(sync, "TARGETS", [first, second])
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    assert sync.main(["--check"]) == 1
    output = capsys.readouterr().out
    assert output.count("out of date") == 2
    assert sync.main([]) == 0
    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8") == sync.build()
    assert sync.main(["--check"]) == 0


def test_check_mode_reports_a_missing_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    monkeypatch.setattr(sync, "TARGETS", [tmp_path / "GEMINI.md"])
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    assert sync.main(["--check"]) == 1
    assert "GEMINI.md is out of date" in capsys.readouterr().out
