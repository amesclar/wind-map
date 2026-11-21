"""Generate the AI tool rule files from the Kiro steering files (SCRUM-119, SCRUM-111, SCRUM-128).

`.kiro/steering/*.md` is the single source of truth. This script combines those files into the
files other tools read, so every tool follows the same rules:
  - `.config/antigravity/instructions.md`
  - `GEMINI.md` at the project root (Antigravity reads it from there)
  - `AGENTS.md` at the project root (Devin reads it from there)

Usage:
    python scripts/sync-ai-rules.py           # rewrite the generated file
    python scripts/sync-ai-rules.py --check   # exit 1 if the generated file is out of date
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEERING_DIR = ROOT / ".kiro" / "steering"
# Every generated file gets identical content.
TARGETS = [
    ROOT / ".config" / "antigravity" / "instructions.md",
    ROOT / "GEMINI.md",
    ROOT / "AGENTS.md",
]

# Devin includes only the first 16 KiB of AGENTS.md automatically.
AGENTS_MD_LIMIT_BYTES = 16 * 1024

# Fixed order, so the output does not depend on file system ordering.
SOURCES = ["commit-rules.md", "documentation.md", "quality-gates.md", "release-versioning.md"]

HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for AI coding tools

You must follow every rule below for every task, without waiting to be asked. These are the same rules
Kiro follows; they come from the files in `.kiro/steering/`.
"""


def build() -> str:
    """Return the full content of the generated rules file."""
    parts = [HEADER]
    for name in SOURCES:
        text = (STEERING_DIR / name).read_text(encoding="utf-8").strip()
        parts.append(f"\n---\n<!-- from .kiro/steering/{name} -->\n\n{text}\n")
    return "".join(parts)


def _relative(path: Path) -> str:
    return str(path.relative_to(ROOT))


def main(argv: list[str]) -> int:
    content = build()
    if "--check" in argv:
        stale = [t for t in TARGETS if not t.exists() or t.read_text(encoding="utf-8") != content]
        for target in stale:
            print(f"{_relative(target)} is out of date. Run: python scripts/sync-ai-rules.py")
        return 1 if stale else 0
    for target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"Wrote {_relative(target)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
