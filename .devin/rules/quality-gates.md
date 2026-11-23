---
trigger: glob
globs: backend/**, frontend/**, .github/**, requirements*.txt, Dockerfile, scripts/**
description: Testing policy, CI parity, branch protection and pinned dependencies.
---

<!-- Generated from .kiro/steering/quality-gates.md. Run: python scripts/sync-ai-rules.py -->

# Automated Testing Policies

You must automatically create or update unit tests for every functional code change you make. Do not wait for explicit user instructions to write tests. Follow the specific frameworks, directory structures, and verification loops below:

## 1. Backend (Python / FastAPI)
- **Frameworks:** Use `pytest` and `pytest-asyncio` for all backend unit and integration tests.
- **Location:** Place tests inside the `tests/` directory mirroring the `app/` folder structure.
- **Mocking:** Always mock external network calls (such as `httpx` requests to the Open-Meteo API) and use SQLite test fixtures or memory databases to avoid altering production cache states.
- **Verification Loop:** Run your backend tests autonomously before completing a task by executing:
  ```bash
  pytest
  ```

## 2. Frontend (React / TypeScript)
- **Frameworks:** Use `Vitest` and `React Testing Library` for component and integration testing.
- **Location:** Place tests in the same directory as the component using the `.test.tsx` or `.spec.tsx` naming convention.
- **Leaflet & Maps Mocking:** If a component renders `Leaflet.js` maps, ensure the map container or tiles are mocked properly to prevent DOM measurement runtime errors during test execution.
- **Verification Loop:** Run your frontend tests autonomously before completing a task by executing:
  ```bash
  npm run test -- --run  # or 'yarn test' / 'vitest run' depending on package.json setup
  ```

## 3. Strict Task Completion Gate
- A task is not considered complete unless the relevant test files are created/modified, and the verification commands exit with a code `0` (success).


## 4. CI Checks and Branch Protection (SCRUM-108, SCRUM-119)
- **Before pushing,** run the same checks CI runs and make sure they pass:
  ```bash
  ruff check . && ruff format --check .          # Python lint, security and formatting
  pytest --cov                                   # backend tests, minimum coverage in .coveragerc
  cd frontend && npm run lint && npm run typecheck && npm run test:coverage
  ```
  Run `pip-audit -r requirements.txt` and `npm audit --omit=dev` when you change dependencies.
- **Branch protection:** `develop` and `master` require the CI checks (Backend, Frontend, Docker image, and the two CodeQL analyses) to pass. Merge a PR only after `gh pr checks <n>` shows every check passing. Do not push directly to `develop` or `master`, and do not use an admin bypass, without asking the user first.
- **Fix findings, don't hide them:** Do not make a check pass by disabling it, lowering a coverage threshold, or adding a blanket suppression. A suppression needs a one-line reason in the code or config.
- **Docker image:** The Trivy scan fails on fixable HIGH or CRITICAL vulnerabilities. Fix them in the Dockerfile or the pinned dependencies.

## 5. Pinned Python Dependencies (SCRUM-103)
- `requirements.txt` and `requirements-dev.txt` are generated and pinned with `==`. Never edit them by hand.
- To add or upgrade a package, edit `requirements.in` (runtime) or `requirements-dev.in` (tests and tools), then regenerate both files with `pip-compile` in a `python:3.14-alpine` container, as described in the README ("Updating Python dependencies"). Run the tests and commit all changed files together.

## 6. Shared Rules for All AI Tools (SCRUM-119, SCRUM-139)
- `.kiro/steering/*.md` is the single source of truth for the project rules.
- `.config/antigravity/instructions.md`, `GEMINI.md`, `AGENTS.md` and `.devin/rules/*.md` are generated from these files. Do not edit them by hand: change a steering file, then run `python scripts/sync-ai-rules.py` and commit all of them. The rules are tiered (SCRUM-160): `AGENTS.md` holds only the always-on guardrails under a 14,000-byte budget, the situational files become `.devin/rules/*.md` with `trigger: glob` front matter (12,000 characters each), and `GEMINI.md`, the Antigravity file and `.freebuff/rules.md` keep the complete body. A pytest test fails when a generated file is out of date or a budget is exceeded.
- Freebuff (SCRUM-139): Freebuff Desktop reads the root `AGENTS.md` and the skills in `.agents/skills/`. `.freebuff/rules.md` is generated from the same steering files plus a workflow inventory (the skills and the post-task hooks), so changing a steering file, a skill in `.agents/skills/` or a hook in `.kiro/hooks/` or `.devin/hooks.v1.json` requires running `python scripts/sync-ai-rules.py` and committing the regenerated files. Do not copy skills into `.freebuff/skills/`, because Freebuff already loads `.agents/skills/`. Freebuff has no project hooks, so the post-task container rebuild follows `release-versioning.md`.
- Reusable workflows live as Devin skills in `.agents/skills/<name>/SKILL.md` (specs, CI checks, releases, container rebuild). Keep them consistent with the steering files; they explain how, the steering files say what is required.
