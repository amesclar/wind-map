"""The project documentation must keep up with the code (SCRUM-341).

The README review in SCRUM-340 found a phantom `docker-compose.yml`, two of nine scripts and four
undocumented routes, all of which had passed CI because nothing read the docs. These tests are the
guard: they fail when the architecture map, the REST API table or the requirements section list
drift from the code they describe.
"""

import re
from pathlib import Path

from backend.app.main import app

ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"
REQUIREMENTS = ROOT / "requirements.md"
DOCUMENTATION_RULE = ROOT / ".kiro" / "steering" / "documentation.md"

# What the product is made of: every module here belongs in the README's architecture map.
MODULE_GLOBS = (
    "backend/app/*.py",
    "backend/app/routers/*.py",
    "backend/app/services/*.py",
    "frontend/src/components/*.ts",
    "frontend/src/components/*.tsx",
    "frontend/src/hooks/*.ts",
    "frontend/src/utils/*.ts",
    "frontend/src/api/*.ts",
)
NOT_A_MODULE = {"__init__", "vite-env.d"}

# The single-page-app fallback: it serves index.html for client routes, so nobody calls it by name.
UNDOCUMENTED_PATHS = {"/{full_path}"}
# FastAPI serves these itself and keeps them out of its schema, so the table may name them.
FRAMEWORK_PATHS = {"/docs", "/redoc", "/openapi.json"}

PARAMETER = re.compile(r"\{[^}]*\}")
TABLE_ROW = re.compile(r"^\| `(GET|POST|DELETE)`\s*\|\s*`([^`]+)`", re.MULTILINE)
TOP_LEVEL_TREE_ROW = re.compile(r"^(?:├|└)── (\S+)", re.MULTILINE)
HEADING = re.compile(r"^# (.+)$", re.MULTILINE)
TICKET_SUFFIX = re.compile(r"\s*\(SCRUM-[^)]*\)$")
BACKTICKED = re.compile(r"`([^`]+)`")


def readme() -> str:
    return README.read_text(encoding="utf-8")


def normalise(path: str) -> str:
    """A route with its parameter names and query removed, so `{id}` matches `{location_id}`."""
    return PARAMETER.sub("{}", path.split("?", 1)[0]).rstrip("/")


def architecture_tree() -> str:
    """The fenced tree under `## Architecture`."""
    text = readme()
    start = text.index("## Architecture")
    return text[start:].split("```", 2)[1]


def test_every_production_module_is_in_the_architecture_map():
    text = readme()
    missing = sorted(
        str(path.relative_to(ROOT))
        for pattern in MODULE_GLOBS
        for path in ROOT.glob(pattern)
        if not path.name.endswith((".test.ts", ".test.tsx")) and path.stem not in NOT_A_MODULE and path.stem not in text
    )
    assert missing == [], f"Name these in the README architecture map: {missing}"


def architecture_tree_entries() -> list[str]:
    """Every top-level file or directory the README's tree draws."""
    return [entry.rstrip("/") for entry in TOP_LEVEL_TREE_ROW.findall(architecture_tree())]


def test_architecture_tree_lists_only_paths_that_exist():
    entries = architecture_tree_entries()
    assert entries, "the README architecture map lists no top-level entries"
    missing = sorted(entry for entry in entries if not (ROOT / entry).exists())
    assert missing == [], f"The README architecture map lists paths that are not in the repo: {missing}"


def rest_table_rows() -> list[tuple[str, str]]:
    """The `(method, path)` cells of the README's REST API table."""
    return TABLE_ROW.findall(readme())


def test_every_api_route_is_in_the_rest_table():
    documented = {normalise(path) for _, path in rest_table_rows()}
    missing = sorted(
        path for path in app.openapi()["paths"] if path not in UNDOCUMENTED_PATHS and normalise(path) not in documented
    )
    assert missing == [], f"Add these to the README's REST API table: {missing}"


def test_the_rest_table_names_only_routes_the_app_serves():
    served = {normalise(path) for path in app.openapi()["paths"]} | FRAMEWORK_PATHS
    rows = rest_table_rows()
    assert rows, "the README's REST API table has no rows"
    unknown = sorted({path for _, path in rows if normalise(path) not in served})
    assert unknown == [], f"The README documents routes the app does not serve: {unknown}"


def test_every_requirements_section_is_named_in_the_documentation_rule():
    rule = DOCUMENTATION_RULE.read_text(encoding="utf-8")
    headings = [
        TICKET_SUFFIX.sub("", heading).strip() for heading in HEADING.findall(REQUIREMENTS.read_text(encoding="utf-8"))
    ]
    assert headings, "requirements.md has no top-level `# ` sections"
    missing = [heading for heading in headings if f"`{heading}`" not in rule]
    assert missing == [], f"Add these to the Format Consistency rule in documentation.md: {missing}"
