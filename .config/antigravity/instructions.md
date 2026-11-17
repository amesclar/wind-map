# Antigravity IDE Workflow Constraints

You must strictly adhere to the following three quality rules for every task execution without requiring explicit prompting:

## 1. Git Commit & Ticket Rules
- Every single git commit message and PR title generated must be prefixed with a valid project ticket number (e.g., `PROJ-123:` or `[PROJ-123]`).
- Extract the ticket number from the user's initial prompt or active branch name.
- After a `feature/...` or `fix/...` branch is merged into `develop` or `master`, delete it locally (`git branch -d`) and on `origin` (`git push origin --delete`). First confirm it is fully merged (`git merge-base --is-ancestor <branch> origin/<target>`), and retarget any PR that uses it as its base. Never delete `develop` or `master`; if a branch isn't fully merged, don't delete it and ask.

## 2. Automated Testing Policy
- For every code modification, you must automatically create or update the corresponding tests.
- **Backend (FastAPI):** Write async unit/integration tests using `pytest` and `pytest-asyncio` inside the `tests/` directory. Mock external Open-Meteo API requests.
- **Frontend (React/TypeScript):** Write component/integration tests using `Vitest` and `React Testing Library` inline using `.test.tsx` naming. Mock Leaflet.js map containers.
- **Execution:** Run `pytest` and `npm run test -- --run` to verify all tests pass successfully before declaring a task finished.

## 3. Continuous Requirements Sync
- Keep the `requirements.md` file in the project root continuously updated. 
- If a feature introduction alters or expands dependencies, tech stacks, or endpoint designs, rewrite the respective Backend, Frontend, or Infrastructure sections of `requirements.md` before finalizing your code commits.

