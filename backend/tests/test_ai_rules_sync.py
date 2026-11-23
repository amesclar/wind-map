"""The AI tool rule files must be generated from the shared rule sources.

Covers SCRUM-119, SCRUM-111, SCRUM-128 and SCRUM-139.
"""

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
    for target, expected in sync.build_outputs().items():
        committed = target.read_text(encoding="utf-8")
        assert committed == expected, f"{sync._label(target)} is stale. Run: python scripts/sync-ai-rules.py"


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
    content = sync.build_rules()
    steering_files = sorted(p.name for p in sync.STEERING_DIR.glob("*.md"))
    assert sorted(sync.SOURCES) == steering_files, "Add new steering files to SOURCES in the script"
    for name in steering_files:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content


def test_freebuff_rules_exist_and_fit_the_freebuff_limit():
    sync = _load_script()
    target = ROOT / ".freebuff" / "rules.md"
    assert target in sync.FREEBUFF_TARGETS
    assert target.is_file()
    assert len(target.read_text(encoding="utf-8")) <= sync.FREEBUFF_CHARACTER_LIMIT


def test_freebuff_rules_contain_every_rule_source():
    sync = _load_script()
    content = sync.build_freebuff()
    for name in sync.SOURCES:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content
    for path in sorted(sync.SKILLS_DIR.glob("*/SKILL.md")):
        fields = sync.read_skill(path)
        assert fields["name"] in content
        assert fields["description"] in content
    assert "scripts/rebuild-container.sh" in content
    assert ".kiro/hooks/rebuild-wind-map.json" in content
    assert ".devin/hooks.v1.json" in content


def test_freebuff_rules_follow_a_skill_change(tmp_path, monkeypatch):
    sync = _load_script()
    before = sync.build_freebuff()
    skill_dir = tmp_path / "new-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: new-skill\ndescription: A skill added after the last sync.\n---\n\n# New skill\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(sync, "SKILLS_DIR", tmp_path)
    after = sync.build_freebuff()
    assert after != before
    assert "A skill added after the last sync." in after


def test_check_mode_reports_every_stale_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    first, second = tmp_path / "a" / "instructions.md", tmp_path / "GEMINI.md"
    freebuff = tmp_path / ".freebuff" / "rules.md"
    first.parent.mkdir()
    first.write_text("old", encoding="utf-8")
    second.write_text("old", encoding="utf-8")
    monkeypatch.setattr(sync, "TARGETS", [first, second])
    monkeypatch.setattr(sync, "FREEBUFF_TARGETS", [freebuff])
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    assert sync.main(["--check"]) == 1
    output = capsys.readouterr().out
    assert output.count("out of date") == 3
    assert ".freebuff/rules.md is out of date" in output
    assert sync.main([]) == 0
    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8") == sync.build_rules()
    assert freebuff.read_text(encoding="utf-8") == sync.build_freebuff()
    assert sync.main(["--check"]) == 0


def test_check_mode_reports_a_missing_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    monkeypatch.setattr(sync, "TARGETS", [tmp_path / "GEMINI.md"])
    monkeypatch.setattr(sync, "FREEBUFF_TARGETS", [])
    monkeypatch.setattr(sync, "ROOT", tmp_path)
    assert sync.main(["--check"]) == 1
    assert "GEMINI.md is out of date" in capsys.readouterr().out
