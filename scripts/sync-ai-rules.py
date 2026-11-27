"""Generate the AI tool rule files from the Kiro steering files (SCRUM-119, SCRUM-111, SCRUM-128, SCRUM-139, SCRUM-160).

`.kiro/steering/*.md` is the single source of truth. This script renders it in three tiers:

  - `AGENTS.md` (Devin and Freebuff) gets only the always-on guardrails, because Devin auto-injects
    the first 16 KiB and truncates the rest. It is held to AGENTS_MD_BUDGET_BYTES (14,000 bytes) so
    a new rule has headroom instead of landing on the truncation edge.
  - `.devin/rules/*.md` (Devin) gets the situational rules, one file per steering file, with
    `trigger: glob` front matter so Devin loads them only when a matching file is in play. Each file
    must stay under DEVIN_RULE_LIMIT_CHARS (12,000).
  - `.config/antigravity/instructions.md`, `GEMINI.md` and `.freebuff/rules.md` get the complete
    body, because those tools do not share Devin's injection cap. The Freebuff file also mirrors
    `.agents/skills/*/SKILL.md` and the post-task hooks.

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

# Tier 1 (SCRUM-160): injected by Devin at session start, so it holds only the hard guardrails.
ALWAYS_ON = ["commit-rules.md", "documentation.md"]
# Tier 2: loaded by Devin through .devin/rules triggers, with the globs that make them relevant.
SITUATIONAL = {
    "quality-gates.md": {
        "description": "Testing policy, CI parity, branch protection and pinned dependencies.",
        "globs": ["backend/**", "frontend/**", ".github/**", "requirements*.txt", "Dockerfile", "scripts/**"],
    },
    "release-versioning.md": {
        "description": "Version source of truth, build hash, releases, container rebuilds and Google Cloud deploys.",
        "globs": [
            "VERSION",
            "frontend/package.json",
            "frontend/package-lock.json",
            "release-notes/**",
            "Dockerfile",
            "scripts/rebuild-container.sh",
            ".github/workflows/**",
        ],
    },
}
# Fixed order, so the output does not depend on file system ordering.
SOURCES = [*ALWAYS_ON, *SITUATIONAL]

# Full-body targets: no 16 KiB injection cap like Devin's.
TARGETS = [
    ROOT / ".config" / "antigravity" / "instructions.md",
    ROOT / "GEMINI.md",
]
AGENTS_TARGET = ROOT / "AGENTS.md"
FREEBUFF_TARGETS = [ROOT / ".freebuff" / "rules.md"]
DEVIN_RULES_DIR = ROOT / ".devin" / "rules"

# Budgets (SCRUM-160). Devin injects the first 16 KiB of AGENTS.md, so the budget keeps 2.4 KiB of
# headroom; Devin caps each workspace rule file at 12,000 characters.
DEVIN_INJECTION_LIMIT_BYTES = 16 * 1024
AGENTS_MD_BUDGET_BYTES = 14_000
DEVIN_RULE_LIMIT_CHARS = 12_000
# Freebuff Desktop includes up to 64,000 characters of the instruction file.
FREEBUFF_CHARACTER_LIMIT = 64_000

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


def _steering_text(name: str) -> str:
    """Return one steering file's text, without surrounding whitespace."""
    return (STEERING_DIR / name).read_text(encoding="utf-8").strip()


def _steering_body(names: list[str]) -> str:
    """Return the named steering files as one Markdown body, in the order given."""
    return "".join(f"\n---\n<!-- from .kiro/steering/{name} -->\n\n{_steering_text(name)}\n" for name in names)


def build_rules() -> str:
    """Return the complete rule body (GEMINI.md and Antigravity read this)."""
    return HEADER + _steering_body(SOURCES)


def build_agents() -> str:
    """Return the always-on rules Devin injects, plus a pointer to the situational rule files."""
    pointers = [
        "\n---\n\n# Situational rules (Devin)\n",
        "\nDevin loads these from `.devin/rules/` when their trigger matches. When a task touches "
        "those files, read the rule before editing:\n\n",
    ]
    for name, config in SITUATIONAL.items():
        pointers.append(f"- `.devin/rules/{Path(name).stem}.md` — {config['description']}\n")
    return HEADER + _steering_body(ALWAYS_ON) + "".join(pointers)


def build_devin_rule(name: str, config: dict[str, object]) -> str:
    """Return one generated Devin rule: glob trigger front matter plus the steering text."""
    globs = ", ".join(str(glob) for glob in config["globs"])  # type: ignore[union-attr]
    front_matter = f"---\ntrigger: glob\nglobs: {globs}\ndescription: {config['description']}\n---\n"
    note = f"\n<!-- Generated from .kiro/steering/{name}. Run: python scripts/sync-ai-rules.py -->\n\n"
    return front_matter + note + _steering_text(name) + "\n"


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
    """Return the Freebuff rules file: the full steering body plus the workflow inventory."""
    parts = [FREEBUFF_HEADER, _steering_body(SOURCES), "\n---\n\n# Workflow inventory for Freebuff\n"]
    parts.append("\nFreebuff loads skills from `.agents/skills/`; do not copy them into `.freebuff/skills/`.\n")
    parts.append("\n## Skills\n\nLoad a skill when the task matches its description.\n\n")
    for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        fields = read_skill(path)
        name = fields.get("name", path.parent.name)
        description = fields.get("description", "")
        parts.append(f"- `{name}` — {description} (`.agents/skills/{path.parent.name}/SKILL.md`)\n")
    parts.append("\n## Situational rules for Devin\n\n")
    for name, config in SITUATIONAL.items():
        parts.append(f"- `.devin/rules/{Path(name).stem}.md` — {config['description']}\n")
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
    outputs = dict.fromkeys(TARGETS, rules)
    outputs[AGENTS_TARGET] = build_agents()
    outputs.update(dict.fromkeys(FREEBUFF_TARGETS, build_freebuff()))
    for name, config in SITUATIONAL.items():
        outputs[DEVIN_RULES_DIR / f"{Path(name).stem}.md"] = build_devin_rule(name, config)
    return outputs


def budget_problems(outputs: dict[Path, str]) -> list[str]:
    """Return every size or character budget the generated files break (SCRUM-160)."""
    problems = []
    agents = outputs.get(AGENTS_TARGET)
    if agents is not None:
        size = len(agents.encode("utf-8"))
        if size > AGENTS_MD_BUDGET_BYTES:
            problems.append(
                f"AGENTS.md is {size} bytes; budget is {AGENTS_MD_BUDGET_BYTES} "
                f"(Devin injects {DEVIN_INJECTION_LIMIT_BYTES}). Move a section to .devin/rules or a skill."
            )
    for path, content in outputs.items():
        if path.parent == DEVIN_RULES_DIR and len(content) > DEVIN_RULE_LIMIT_CHARS:
            problems.append(f"{_label(path)} is {len(content)} characters; limit is {DEVIN_RULE_LIMIT_CHARS}.")
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
