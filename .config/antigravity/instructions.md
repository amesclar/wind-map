# Antigravity IDE Workflow Constraints

You must strictly adhere to the following three quality rules for every task execution without requiring explicit prompting:

## 1. Git Commit & Ticket Rules
- Every single git commit message and PR title generated must be prefixed with a valid project ticket number (e.g., `PROJ-123:` or `[PROJ-123]`).
- Extract the ticket number from the user's initial prompt or active branch name.
- After a `feature/...` or `fix/...` branch is merged into `develop` or `master`, delete it locally (`git branch -d`) and on `origin` (`git push origin --delete`). First confirm it is fully merged (`git merge-base --is-ancestor <branch> origin/<target>`), and retarget any PR that uses it as its base. Never delete `develop` or `master`; if a branch isn't fully merged, don't delete it and ask.

- After a PR is merged into `develop` or `master`, add a comment to the Jira ticket named in the PR title: `Merged PR #<n> into <target> as <short-hash>` plus the PR URL. Use the merge commit hash on the target branch (`gh pr view <n> --json mergeCommit`), not the feature branch commit.
## 1b. Jira Ticket Rules
- **Story points:** Every Jira ticket you create must have its "Story point estimate" field (`customfield_10016`) set. Use Fibonacci values (1, 2, 3, 5, 8, 13); 1 point is a small change of about 10 to 20 lines including tests. Lines of code are a reference point; also weigh complexity, uncertainty and non-code work. Split anything above 8 points. Put a one-line rationale at the end of the description. Epics are not pointed.
- **Dependencies:** When a ticket must wait for another, create a Jira `Blocks` link (blocker = inward issue, blocked ticket = outward issue) in addition to mentioning it in the description. Use `Relates` for loose or parallel connections. Epic membership uses the `parent` field, not a link. Create the tickets first, then link and verify them. Before starting a ticket, check its "is blocked by" links; if a blocker is not Done, tell the user first.
## 2. Automated Testing Policy
- For every code modification, you must automatically create or update the corresponding tests.
- **Backend (FastAPI):** Write async unit/integration tests using `pytest` and `pytest-asyncio` inside the `tests/` directory. Mock external Open-Meteo API requests.
- **Frontend (React/TypeScript):** Write component/integration tests using `Vitest` and `React Testing Library` inline using `.test.tsx` naming. Mock Leaflet.js map containers.
- **Execution:** Run `pytest` and `npm run test -- --run` to verify all tests pass successfully before declaring a task finished.

## 3. Continuous Requirements Sync
- Keep the `requirements.md` file in the project root continuously updated. 
- If a feature introduction alters or expands dependencies, tech stacks, or endpoint designs, rewrite the respective Backend, Frontend, or Infrastructure sections of `requirements.md` before finalizing your code commits.

