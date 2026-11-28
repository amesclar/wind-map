"""Generate the AI tool rule files from the Kiro steering files (SCRUM-119, SCRUM-139, SCRUM-337).

`.kiro/steering/*.md` is the single source of truth. Kiro reads those files directly; the other
tools get a generated copy with the complete rule body, because none of them truncates it:

  - `AGENTS.md` is Freebuff Desktop's instruction file (it reads up to 64,000 characters) and
    Codebuff injects it.
  - `GEMINI.md` and `.config/antigravity/instructions.md` are read by Antigravity.
  - `.freebuff/rules.md` gets the same body plus the workflow inventory Freebuff cannot discover on
    its own: the skills in `.agents/skills/*/SKILL.md` and the Kiro post-task hook.

There is no always-on/situational split and no byte budget on `AGENTS.md`: the Devin injection cap
that forced both is gone (SCRUM-337). The only size check left is Freebuff's own character limit.

Usage:
    python scripts/sync-ai-rules.py           # rewrite every generated file
    python scripts/sync-ai-rules.py --check   # exit 1 if any generated file is out of date
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEERING_DIR = ROOT / ".kiro" / "steering"
SKILLS_DIR = ROOT / ".agents" / "skills"
KIRO_HOOKS = ROOT / ".kiro" / "hooks" / "rebuild-wind-map.json"

# Fixed order, so the output does not depend on file system ordering.
SOURCES = ["commit-rules.md", "documentation.md", "quality-gates.md", "release-versioning.md"]

TARGETS = [
    ROOT / "GEMINI.md",
    ROOT / ".config" / "antigravity" / "instructions.md",
]
AGENTS_TARGET = ROOT / "AGENTS.md"
FREEBUFF_TARGETS = [ROOT / ".freebuff" / "rules.md"]

# Freebuff Desktop includes up to 64,000 characters of the instruction file (SCRUM-337).
FREEBUFF_CHARACTER_LIMIT = 64_000

# A repo-relative script path inside a hook command, e.g. "$(git rev-parse --show-toplevel)/scripts/x.sh".
SCRIPT_PATH = re.compile(r"scripts/[\w./-]+")

HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for AI coding tools

You must follow every rule below for every task, without waiting to be asked. These are the same rules
Kiro reads from `.kiro/steering/`.
"""

FREEBUFF_HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md, .agents/skills/*/SKILL.md and .kiro/hooks/rebuild-wind-map.json.
     After changing any of them, run: python scripts/sync-ai-rules.py -->

# Project rules for Freebuff

Freebuff Desktop reads the root `AGENTS.md` as its instruction file, up to 64,000 characters. This
file is the Freebuff copy of the same rules: it carries the identical steering body plus the workflow
inventory Freebuff cannot discover on its own (skills and the post-task hook). If this file and
`AGENTS.md` disagree, run `python scripts/sync-ai-rules.py`.
"""


def _steering_text(name: str) -> str:
    """Return one steering file's text, without surrounding whitespace."""
    return (STEERING_DIR / name).read_text(encoding="utf-8").strip()


def _steering_body(names: list[str]) -> str:
    """Return the named steering files as one Markdown body, in the order given."""
    return "".join(f"\n---\n<!-- from .kiro/steering/{name} -->\n\n{_steering_text(name)}\n" for name in names)


def build_rules() -> str:
    """Return the complete rule body, which every generated target carries."""
    return HEADER + _steering_body(SOURCES)


def build_agents() -> str:
    """Return `AGENTS.md`: the complete rule body, with no tier or budget (SCRUM-337)."""
    return build_rules()


def read_skill(path: Path) -> dict[str, str]:
    """Return the `name` and `description` fields of a SKILL.md front matter block."""
    fields: dict[str, str] = {}
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        front = text.split("---", 2)[1]
        for line in front.splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip() in {"name", "description"}:
                fields[key.strip()] = value.strip()
    return fields


def _label(path: Path) -> str:
    """Return the path relative to the project root, or the path itself when it is outside it."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _kiro_hook_lines(path: Path) -> list[str]:
    """Describe each Kiro hook from its own metadata, without copying its absolute-path command."""
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = []
    for hook in data.get("hooks", []):
        name = hook.get("name", "hook")
        trigger = hook.get("trigger", "unknown")
        description = hook.get("description", "")
        lines.append(f"- `{_label(path)}` ({trigger}): {name}. {description}".rstrip())
    return lines


def build_freebuff() -> str:
    """Return the Freebuff rules file: the full steering body plus the workflow inventory."""
    parts = [FREEBUFF_HEADER, _steering_body(SOURCES), "\n---\n\n# Workflow inventory for Freebuff\n"]
    parts.append("\nFreebuff loads skills from `.agents/skills/`; do not copy them into `.freebuff/skills/`.\n")
    parts.append("\n## Skills\n\nLoad a skill when the task matches its description.\n\n")
    for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        fields = read_skill(path)
        name = fields.get("name", path.parent.name)
        description = fields.get("description", "")
        parts.append(f"- `{name}` — {description} (`.agents/skills/{path.parent.name}/SKILL.md`)\n")
    parts.append("\n## Post-task hooks\n\n")
    parts.extend(f"{line}\n" for line in _kiro_hook_lines(KIRO_HOOKS))
    parts.append(
        "\nFreebuff has no project hooks: follow the rebuild rule in `release-versioning.md` and run "
        "`scripts/rebuild-container.sh` after a merge or a version bump.\n"
    )
    return "".join(parts)


def build_outputs() -> dict[Path, str]:
    """Return the expected content of every generated file."""
    rules = build_rules()
    outputs = dict.fromkeys(TARGETS, rules)
    outputs[AGENTS_TARGET] = build_agents()
    outputs.update(dict.fromkeys(FREEBUFF_TARGETS, build_freebuff()))
    return outputs


def budget_problems(outputs: dict[Path, str]) -> list[str]:
    """Return every size budget the generated files break (SCRUM-337)."""
    problems = []
    for path, content in outputs.items():
        if path in FREEBUFF_TARGETS and len(content) > FREEBUFF_CHARACTER_LIMIT:
            problems.append(f"{_label(path)} is {len(content)} characters; limit is {FREEBUFF_CHARACTER_LIMIT}.")
    return problems


def main(argv: list[str]) -> int:
    outputs = build_outputs()
    problems = budget_problems(outputs)
    if "--check" in argv:
        stale = [t for t, content in outputs.items() if not t.exists() or t.read_text(encoding="utf-8") != content]
        for target in stale:
            print(f"{_label(target)} is out of date. Run: python scripts/sync-ai-rules.py")
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1 if stale or problems else 0
    for target, content in outputs.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        size = len(content.encode("utf-8"))
        print(f"Wrote {_label(target)} ({size} bytes)")
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
