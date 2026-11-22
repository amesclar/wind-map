"""Generate the AI tool rule files from the Kiro steering files (SCRUM-119, SCRUM-111, SCRUM-128, SCRUM-139).

`.kiro/steering/*.md` is the single source of truth. This script combines those files into the
files other tools read, so every tool follows the same rules:
  - `.config/antigravity/instructions.md`
  - `GEMINI.md` at the project root (Antigravity reads it from there)
  - `AGENTS.md` at the project root (Devin and Freebuff read it from there)
  - `.freebuff/rules.md` (Freebuff rules, plus the workflow inventory it cannot discover)

The Freebuff file also mirrors `.agents/skills/*/SKILL.md` and the post-task hooks in
`.kiro/hooks/` and `.devin/hooks.v1.json`, so a change to any of those rule sources regenerates it.

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
DEVIN_HOOKS = ROOT / ".devin" / "hooks.v1.json"
# Every generated rules file gets identical content.
TARGETS = [
    ROOT / ".config" / "antigravity" / "instructions.md",
    ROOT / "GEMINI.md",
    ROOT / "AGENTS.md",
]
# Freebuff gets its own file, because it also lists the skills and hooks.
FREEBUFF_TARGETS = [ROOT / ".freebuff" / "rules.md"]

# Devin includes only the first 16 KiB of AGENTS.md automatically.
AGENTS_MD_LIMIT_BYTES = 16 * 1024
# Freebuff Desktop includes up to 64,000 characters of the instruction file.
FREEBUFF_CHARACTER_LIMIT = 64_000

# Fixed order, so the output does not depend on file system ordering.
SOURCES = ["commit-rules.md", "documentation.md", "quality-gates.md", "release-versioning.md"]

# A repo-relative script path inside a hook command, e.g. "$(git rev-parse --show-toplevel)/scripts/x.sh".
SCRIPT_PATH = re.compile(r"scripts/[\w./-]+")

HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for AI coding tools

You must follow every rule below for every task, without waiting to be asked. These are the same rules
Kiro follows; they come from the files in `.kiro/steering/`.
"""

FREEBUFF_HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md, .agents/skills/*/SKILL.md and the hook files.
     After changing any of them, run: python scripts/sync-ai-rules.py -->

# Project rules for Freebuff

Freebuff Desktop reads the root `AGENTS.md` as its instruction file, up to 64,000 characters. This
file is the Freebuff copy of the same rules: it carries the identical steering body plus the workflow
inventory Freebuff cannot discover on its own (skills and post-task hooks). If this file and
`AGENTS.md` disagree, run `python scripts/sync-ai-rules.py`.
"""


def _steering_body() -> str:
    """Return every steering file as one Markdown body, in the fixed source order."""
    parts = []
    for name in SOURCES:
        text = (STEERING_DIR / name).read_text(encoding="utf-8").strip()
        parts.append(f"\n---\n<!-- from .kiro/steering/{name} -->\n\n{text}\n")
    return "".join(parts)


def build_rules() -> str:
    """Return the full content of the shared rules file read by Kiro, Devin and Antigravity."""
    return HEADER + _steering_body()


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


def _devin_hook_lines(path: Path) -> list[str]:
    """Describe each Devin hook by its trigger and the repo-relative script it runs."""
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = []
    for trigger, entries in data.items():
        for entry in entries:
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                scripts = SCRIPT_PATH.findall(command)
                lines.append(f"- `{_label(path)}` ({trigger}): runs `{scripts[0] if scripts else command}`.")
    return lines


def build_freebuff() -> str:
    """Return the Freebuff rules file: the steering body plus the workflow inventory."""
    parts = [FREEBUFF_HEADER, _steering_body(), "\n---\n\n# Workflow inventory for Freebuff\n"]
    parts.append("\nFreebuff loads skills from `.agents/skills/`; do not copy them into `.freebuff/skills/`.\n")
    parts.append("\n## Skills\n\nLoad a skill when the task matches its description.\n\n")
    for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        fields = read_skill(path)
        name = fields.get("name", path.parent.name)
        description = fields.get("description", "")
        parts.append(f"- `{name}` — {description} (`.agents/skills/{path.parent.name}/SKILL.md`)\n")
    parts.append("\n## Post-task hooks\n\n")
    parts.extend(f"{line}\n" for line in _kiro_hook_lines(KIRO_HOOKS))
    parts.extend(f"{line}\n" for line in _devin_hook_lines(DEVIN_HOOKS))
    parts.append(
        "\nFreebuff has no project hooks: follow the rebuild rule in `release-versioning.md` and run "
        "`scripts/rebuild-container.sh` after a merge or a version bump.\n"
    )
    return "".join(parts)


def build_outputs() -> dict[Path, str]:
    """Return the expected content of every generated file."""
    rules = build_rules()
    freebuff = build_freebuff()
    outputs = dict.fromkeys(TARGETS, rules)
    outputs.update(dict.fromkeys(FREEBUFF_TARGETS, freebuff))
    return outputs


def main(argv: list[str]) -> int:
    outputs = build_outputs()
    if "--check" in argv:
        stale = [t for t, content in outputs.items() if not t.exists() or t.read_text(encoding="utf-8") != content]
        for target in stale:
            print(f"{_label(target)} is out of date. Run: python scripts/sync-ai-rules.py")
        return 1 if stale else 0
    for target, content in outputs.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"Wrote {_label(target)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
