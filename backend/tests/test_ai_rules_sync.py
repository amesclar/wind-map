"""The AI tool rule files must be generated from the shared rule sources.

Covers SCRUM-119, SCRUM-111, SCRUM-128, SCRUM-139 and SCRUM-337: every generated target carries the
complete rule body, there is no always-on/situational tier and no byte budget on `AGENTS.md`, and the
Freebuff file still lists the skills and the Kiro hook.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The tiering SCRUM-160 introduced and SCRUM-337 removed; none of it may come back by accident.
REMOVED_TIERING = (
    "ALWAYS_ON",
    "SITUATIONAL",
    "DEVIN_RULES_DIR",
    "DEVIN_HOOKS",
    "AGENTS_MD_BUDGET_BYTES",
    "DEVIN_RULE_LIMIT_CHARS",
    "DEVIN_INJECTION_LIMIT_BYTES",
)


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


def test_agents_md_carries_the_complete_rule_body():
    sync = _load_script()
    agents = ROOT / "AGENTS.md"
    assert agents in sync.build_outputs()
    assert agents.read_text(encoding="utf-8") == sync.build_rules()
    assert agents.read_text(encoding="utf-8") == sync.build_agents()


def test_no_always_on_tier_or_agents_budget_remains():
    sync = _load_script()
    for name in REMOVED_TIERING:
        assert not hasattr(sync, name), f"{name} belongs to the removed Devin tiering (SCRUM-337)"


def test_no_devin_rule_files_are_generated():
    sync = _load_script()
    assert not any(".devin" in sync._label(path) for path in sync.build_outputs())
    assert not (ROOT / ".devin").exists(), "SCRUM-337 removed the Devin rules and hook"


def test_full_rules_contain_every_steering_file():
    sync = _load_script()
    content = sync.build_rules()
    steering_files = sorted(p.name for p in sync.STEERING_DIR.glob("*.md"))
    assert sorted(sync.SOURCES) == steering_files, "Add new steering files to SOURCES in the script"
    for name in steering_files:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content


def test_gemini_md_and_antigravity_keep_the_complete_rule_body():
    sync = _load_script()
    gemini = ROOT / "GEMINI.md"
    assert gemini in sync.TARGETS
    assert gemini.read_text(encoding="utf-8") == sync.build_rules()
    assert (ROOT / ".config" / "antigravity" / "instructions.md").read_text(encoding="utf-8") == sync.build_rules()


def test_freebuff_rules_exist_and_fit_the_freebuff_limit():
    sync = _load_script()
    target = ROOT / ".freebuff" / "rules.md"
    assert target in sync.FREEBUFF_TARGETS
    assert target.is_file()
    assert len(target.read_text(encoding="utf-8")) <= sync.FREEBUFF_CHARACTER_LIMIT


def test_freebuff_rules_contain_every_rule_source_and_the_kiro_hook():
    sync = _load_script()
    content = sync.build_freebuff()
    for name in sync.SOURCES:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content
    for path in sorted(sync.SKILLS_DIR.glob("*/SKILL.md")):
        fields = sync.read_skill(path)
        assert fields["name"] in content
        assert fields["description"] in content
    assert ".kiro/hooks/rebuild-wind-map.json" in content
    assert ".devin" not in content


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


def test_budget_problems_flag_an_oversized_freebuff_file(monkeypatch):
    sync = _load_script()
    monkeypatch.setattr(sync, "FREEBUFF_CHARACTER_LIMIT", 5)
    target = sync.FREEBUFF_TARGETS[0]
    problems = sync.budget_problems({target: "x" * 6})
    assert len(problems) == 1
    assert "limit is 5" in problems[0]


def test_budget_problems_leave_agents_md_uncapped():
    sync = _load_script()
    assert sync.budget_problems({sync.AGENTS_TARGET: "x" * 100_000}) == []


def test_check_mode_reports_every_stale_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    first, second = tmp_path / "a" / "instructions.md", tmp_path / "GEMINI.md"
    first.parent.mkdir()
    first.write_text("old", encoding="utf-8")
    second.write_text("old", encoding="utf-8")
    monkeypatch.setattr(sync, "build_outputs", lambda: {first: "new", second: "new"})
    assert sync.main(["--check"]) == 1
    output = capsys.readouterr().out
    assert output.count("out of date") == 2
    assert sync.main([]) == 0
    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8") == "new"
    assert sync.main(["--check"]) == 0


def test_check_mode_reports_a_missing_file(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    monkeypatch.setattr(sync, "build_outputs", lambda: {tmp_path / "GEMINI.md": "new"})
    assert sync.main(["--check"]) == 1
    assert "GEMINI.md is out of date" in capsys.readouterr().out


def test_main_fails_on_a_budget_break(tmp_path, monkeypatch, capsys):
    sync = _load_script()
    target = tmp_path / "rules.md"
    monkeypatch.setattr(sync, "FREEBUFF_TARGETS", [target])
    monkeypatch.setattr(sync, "FREEBUFF_CHARACTER_LIMIT", 10)
    monkeypatch.setattr(sync, "build_outputs", lambda: {target: "x" * 11})
    assert sync.main([]) == 1
    assert "limit is 10" in capsys.readouterr().err
    assert target.read_text(encoding="utf-8") == "x" * 11
