---
name: ci-checks
description: Run the same checks as GitHub CI (ruff, pytest with coverage, eslint, tsc, vitest with coverage, audits, AI rule sync) before committing or pushing wind-map changes. Use before every push and before saying a task is done.
---

# CI checks

Run from the repository root. Every command must exit 0. Fix findings; never lower coverage thresholds, disable checks or add blanket suppressions.

## Backend
```bash
ruff check .
pytest --cov            # threshold in .coveragerc
```
Python 3.11. If needed, install tools with `pip install -r requirements-dev.txt`.

## Frontend
```bash
cd frontend
npm ci                  # only if node_modules is missing or package-lock.json changed
npm run lint
npm run typecheck
npm run test:coverage   # thresholds in vitest.config.ts
```

## Conditional
- Rules changed (`.kiro/steering/*.md`, `.agents/skills/*/SKILL.md`, `.kiro/hooks/*.json`, `.devin/hooks.v1.json`): `python scripts/sync-ai-rules.py` (regenerates `AGENTS.md`, `GEMINI.md`, `.config/antigravity/instructions.md` and `.freebuff/rules.md`); commit all generated files.
- Python dependencies changed: `pip-audit -r requirements.txt` (edit `requirements*.in` and regenerate with `pip-compile`; never edit the `.txt` files by hand).
- npm dependencies changed: `npm audit --omit=dev --audit-level=high`.
- Dockerfile or runtime changed: `docker build -t wind-map .` and check `curl -fsS http://localhost:5005/api/health` (see the `rebuild-container` skill).

## After pushing
Open the PR into `develop` with title `[SCRUM-xxx] ...`. Merge only after `gh pr checks <n>` shows Backend, Frontend, Docker image and both CodeQL checks passing.
