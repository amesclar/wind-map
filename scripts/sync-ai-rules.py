"""Generate the Antigravity rules file from the Kiro steering files (SCRUM-119).

`.kiro/steering/*.md` is the single source of truth. This script combines those files into
`.config/antigravity/instructions.md`, so both tools follow the same rules.

Usage:
    python scripts/sync-ai-rules.py           # rewrite the generated file
    python scripts/sync-ai-rules.py --check   # exit 1 if the generated file is out of date
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEERING_DIR = ROOT / ".kiro" / "steering"
TARGET = ROOT / ".config" / "antigravity" / "instructions.md"

# Fixed order, so the output does not depend on file system ordering.
SOURCES = ["commit-rules.md", "documentation.md", "quality-gates.md", "release-versioning.md"]

HEADER = """\
<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for Antigravity

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


def main(argv: list[str]) -> int:
    content = build()
    if "--check" in argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != content:
            print(f"{TARGET.relative_to(ROOT)} is out of date. Run: python scripts/sync-ai-rules.py")
            return 1
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(content, encoding="utf-8")
    print(f"Wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
