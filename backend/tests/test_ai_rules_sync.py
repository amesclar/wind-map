"""The AI tool rule files must be generated from the shared rule sources.

Covers SCRUM-119, SCRUM-111, SCRUM-128, SCRUM-139 and the tiering in SCRUM-160: AGENTS.md carries
only the always-on rules inside a 14,000-byte budget, the situational rules live in generated
`.devin/rules/*.md` files, and the full body still reaches Gemini, Antigravity and Freebuff.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEVIN_INJECTION_LIMIT_BYTES = 16 * 1024


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


def test_agents_md_fits_the_budget_with_headroom_under_devin_injection():
    sync = _load_script()
    assert sync.AGENTS_MD_BUDGET_BYTES == 14_000
    assert sync.AGENTS_MD_BUDGET_BYTES < DEVIN_INJECTION_LIMIT_BYTES
    assert sync.DEVIN_INJECTION_LIMIT_BYTES == DEVIN_INJECTION_LIMIT_BYTES
    size = len((ROOT / "AGENTS.md").read_bytes())
    assert size <= sync.AGENTS_MD_BUDGET_BYTES, (
        f"AGENTS.md is {size} bytes; budget is {sync.AGENTS_MD_BUDGET_BYTES}. "
        "Move a section to .devin/rules or a skill."
    )


def test_agents_md_carries_the_always_on_rules_and_points_at_the_rest():
    sync = _load_script()
    content = sync.build_agents()
    for name in sync.ALWAYS_ON:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in content
    for name in sync.SITUATIONAL:
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() not in content
        assert f".devin/rules/{Path(name).stem}.md" in content


def test_devin_rules_hold_the_situational_rules_with_glob_triggers():
    sync = _load_script()
    assert sorted(sync.SITUATIONAL) == sorted(set(sync.SOURCES) - set(sync.ALWAYS_ON))
    for name, config in sync.SITUATIONAL.items():
        path = sync.DEVIN_RULES_DIR / f"{Path(name).stem}.md"
        assert path.is_file()
        text = path.read_text(encoding="utf-8")
        assert len(text) <= sync.DEVIN_RULE_LIMIT_CHARS
        assert text.startswith("---\ntrigger: glob\n")
        assert f"globs: {', '.join(config['globs'])}" in text
        assert f"description: {config['description']}" in text
        assert (sync.STEERING_DIR / name).read_text(encoding="utf-8").strip() in text


def test_gemini_md_keeps_the_complete_rule_body():
    sync = _load_script()
    gemini = ROOT / "GEMINI.md"
    assert gemini in sync.TARGETS
    assert gemini.read_text(encoding="utf-8") == sync.build_rules()
    assert (ROOT / ".config" / "antigravity" / "instructions.md").read_text(encoding="utf-8") == sync.build_rules()


def test_full_rules_contain_every_steering_file():
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
    for name in sync.SITUATIONAL:
        assert f".devin/rules/{Path(name).stem}.md" in content
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


def test_budget_problems_flag_an_oversized_agents_file(monkeypatch):
    sync = _load_script()
    monkeypatch.setattr(sync, "AGENTS_MD_BUDGET_BYTES", 10)
    problems = sync.budget_problems({sync.AGENTS_TARGET: "x" * 11})
    assert len(problems) == 1
    assert "budget is 10" in problems[0]


def test_budget_problems_flag_an_oversized_devin_rule(monkeypatch):
    sync = _load_script()
    monkeypatch.setattr(sync, "DEVIN_RULE_LIMIT_CHARS", 5)
    problems = sync.budget_problems({sync.DEVIN_RULES_DIR / "quality-gates.md": "x" * 6})
    assert len(problems) == 1
    assert "limit is 5" in problems[0]


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
    target = tmp_path / "AGENTS.md"
    monkeypatch.setattr(sync, "AGENTS_TARGET", target)
    monkeypatch.setattr(sync, "AGENTS_MD_BUDGET_BYTES", 10)
    monkeypatch.setattr(sync, "build_outputs", lambda: {target: "x" * 11})
    assert sync.main([]) == 1
    assert "budget is 10" in capsys.readouterr().err
    assert target.read_text(encoding="utf-8") == "x" * 11
