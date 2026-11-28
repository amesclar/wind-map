<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for AI coding tools

You must follow every rule below for every task, without waiting to be asked. These are the same rules
Kiro reads from `.kiro/steering/`.

---
<!-- from .kiro/steering/commit-rules.md -->

# Git and PR Requirements
- **Ticket Enforcement:** You are strictly required to include a project ticket number (e.g., `SCRUM-123`) in all Git branch names, commit messages, and PR titles.
- **Branch Naming:** Format branches as `feature/SCRUM-123-description` or `fix/SCRUM-123-description`.
- **Commit Messages:** Prefix every commit message with the ticket number, followed by a colon (e.g., `SCRUM-123: Add user authentication`).
- **PR Titles:** Prefix all PR titles with the ticket number in brackets (e.g., `[SCRUM-123] Implement secure login flow`).

## Ticket-First Workflow (SCRUM-111)
- **A ticket first:** every repository change — code, documentation, configuration and steering rules — has a Jira ticket. If it has none, create one with a story point estimate before creating the branch.
- **"Create ticket to ..." means plan, not do.** Create it with a thorough plan: scope, steps, decisions needed, tests, acceptance criteria and an estimate, and put the same plan in your reply. Creating the ticket itself, its links and its child tickets is allowed; questions about unclear scope go in the reply.
- **Then wait for direction.** Do not implement, branch or change files for that ticket until the user explicitly tells you to proceed (for example "implement SCRUM-123" or "go ahead").
- **Every change goes on a branch:** a dedicated `feature/SCRUM-xxx-<description>` (or `fix/...`) branch from an up-to-date `develop`, verified with the tests and linters, merged through a PR into `develop`.
- **No direct commits** to `develop` or `master`, even for one-line or rules-only changes. If you notice you are on `develop` or `master` with uncommitted work, create the branch first and commit there.

## Delete Feature Branches After Merging (SCRUM-94)
- **When:** Right after a `feature/...` or `fix/...` branch is merged into `develop` or `master`, delete it both locally and on `origin`. This is part of completing the merge; don't wait to be asked.
- **Verify first:** only delete a branch that is fully merged: `git fetch origin && git merge-base --is-ancestor <branch> origin/<target>`, then `git branch -d <branch>` (never `-D`) and `git push origin --delete <branch>`, then `git fetch --prune`. If the check fails, or the branch has commits that aren't merged, don't delete it; report this and ask.
- **Stacked PRs:** If another open PR uses the branch as its base, retarget that PR to `develop` (`gh pr edit <n> --base develop`) before deleting the branch. Otherwise GitHub closes the dependent PR.
- **Never delete** `develop` or `master`. Merging `develop` into `master` deletes no branch.
- **Report** the deleted branches in the summary of the merge.

## Mark the Ticket Done When the PR Succeeds (SCRUM-129, SCRUM-141)
- **When:** As soon as `gh pr checks <n>` shows every required check passing (Backend, Frontend, Docker image and both CodeQL analyses) and the PR is mergeable, transition the ticket in the PR title to Done with `python scripts/jira_agent.py transition SCRUM-123 --to Done --resolution Done`. Don't wait for the merge.
- **Exceptions:** Skip tickets that are already Done. Don't mark a ticket Done when the PR only partly delivers it (e.g. follow-up work remains); comment why instead.
- **If it stops succeeding:** If a check fails or the PR is closed unmerged afterwards, move the ticket back to In Progress and say why.
- **Record the merge hash after merging:** right after the PR is merged into `develop` or `master`, comment on the ticket with the merge commit hash. This completes the merge; don't wait to be asked.
- **Which hash:** the merge commit on the target branch, not the feature branch commit: `gh pr view <n> --json mergeCommit -q '.mergeCommit.oid'` after `git fetch origin`, then the 7-character short hash (e.g., `95cf243`).
- **Comment format:** `Merged PR #<n> into <target> as <short-hash>` followed by the PR URL.
- **Which tool:** `python scripts/jira_agent.py comment SCRUM-123 --body "Merged PR #42 into develop as 95cf243"`; the transition comment field can be dropped silently.
- **Merging `develop` into `master`:** Comment on each ticket included in the merge, or on the release ticket if one exists, using the merge hash on `master`, and mark any of them that are not yet Done as Done.
- **Report** the checks result, the ticket's status, the hash and the Jira comment.

## Story Point Estimates on Jira Tickets (SCRUM-105)
- **When:** Every Jira ticket you create must have a story point estimate set at creation. If you pick up a ticket that has none, estimate it first. Epics are not pointed; estimate their child tickets.
- **Field:** Jira's field is named "Story point estimate" (`customfield_10016`) in the SCRUM project, not "Story Points". Set it with `additional_fields: {"customfield_10016": <n>}` on `createJiraIssue` or `editJiraIssue`.
- **Scale:** Fibonacci values only: 1, 2, 3, 5, 8, 13. Line count is an anchor, not the definition: weigh complexity, uncertainty and work that is not code (infrastructure, manual verification, documentation) — a 1 is a small change with its tests, an 8 is a new service with endpoints, cache and tests. Split anything above 8 points into smaller tickets.
- **Rationale:** Put a one-line reason for the estimate at the end of the ticket description (e.g., "Estimate: 2 points. One component and its test, about 30 lines.").
- **Report** the estimate in the summary when you create a ticket.

## Epic for a Split With No Fitting Parent (SCRUM-247)
- **When:** Any time a ticket is split into two or more tickets — by estimate, by phase (a spike and the build it unblocks) or by area — and no existing epic describes the resulting work.
- **Create the epic:** one `createJiraIssue` with `issueType: "Epic"`, unpointed, titled for the outcome rather than for one of its parts (e.g. `Epic: second forecast provider — NOAA NWS NDFD`). Its description lists every child with its estimate, the scope boundary and what is out of scope.
- **Parent every result:** set the `parent` field on each ticket the split produced, the spike included. Boards and filters read `parent`, so a `Relates` link between the pieces of one split does not replace it.
- **A fitting epic wins:** if an existing epic already covers the work, put the children under it and create nothing new. Do not force the pieces into an unrelated epic just to avoid making one.
- **Report** the epic, its children and their estimates in the summary.

## Jira Writes Use the Agent's Own Account (SCRUM-310)
- **Who writes:** every Jira write — issue, comment, transition, link, estimate, resolution — goes through `python scripts/jira_agent.py` (`create`, `comment`, `transition`, `set`, `link`, `myself`), authenticated as the service account, so the history shows what the agent did. Do not make these writes through the Jira integration, which acts as Fred.
- **Reads** (search, get issue, permissions) may keep using the integration tools.
- **Credentials (SCRUM-313):** the token is read from `FREEBUFF_JIRA_KEY` by default, or from the variable named with `--key-variable` — use `KIRO_JIRA_KEY` when Kiro is the tool writing, so each bot authors its own writes. Never write a token, or part of one, into the repository, a command line, a log or a ticket.
- **Which identity:** `python scripts/jira_agent.py myself` (add `--key-variable KIRO_JIRA_KEY` for the second) prints the account a key belongs to; check it before claiming who authored something.
- **Environment:** a non-interactive agent shell does not read the profile, so run it as `zsh -ic 'python scripts/jira_agent.py comment SCRUM-123 --body "Merged in abc1234"'`, through the project venv when the shell's `python` is older than 3.14.
- **Errors:** the script prints one line naming the rejected fields and exits non-zero; it never prints the token or Jira's response body. Its docstring documents the rest.

## Jira Dependency Links (SCRUM-118)
- **Make dependencies explicit:** when a ticket cannot start or finish before another one, create a Jira issue link as well as mentioning it; boards and filters only see links.
- **Blocks:** Use link type `Blocks` when one ticket must be done first. The blocker is the `inwardIssue` and the blocked ticket is the `outwardIssue` (`createJiraIssueLink`, run through `executeWrite`; use `discover` if the tool is not loaded). The blocked ticket then shows "is blocked by" the blocker.
- **Relates:** Use link type `Relates` for loose or optional connections, and for tickets that can run in parallel but touch the same area. Do not hard-block work that can proceed on its own.
- **Not for hierarchy:** Epic and child relationships use the `parent` field when creating the ticket, not a link.
- **Order of work:** create the tickets, then link them, then check with `getJiraIssue` or a JQL search such as `issue in linkedIssues(SCRUM-117)`.
- **When picking up a ticket:** Check its "is blocked by" links. If a blocker is not Done, tell the user before starting and ask how to proceed.
- **When finishing a ticket:** If it blocks other tickets, mention them in the summary so the user knows what is unblocked.
- **Report** the links you created in the summary.

## Rebuild Container After Merge for User Verification (SCRUM-132)
- **When:** Right after a PR is merged into `develop` or `master` (and the branch is deleted, merge hash commented, and ticket transitioned), rebuild and restart the local Docker container so the user can verify changes on http://localhost:5005.
- **How:** `zsh -ic './scripts/rebuild-container.sh'`. A non-interactive agent shell (bash, an IDE task, a Kiro hook) never reads `~/.zshrc`, so the script must run through the user's interactive shell to see `CARTO_API_KEY`, the Jira variables and the feedback limits (SCRUM-262). Never write those values or a profile path into these rules. Build details: `rebuild-container` skill.
- **Verify the environment survived (SCRUM-262):** after the rebuild, `GET /api/config` must still report `feedback_enabled: true` and a CARTO key when the user has them configured. A rebuild that answers `{"carto_api_key":"","feedback_enabled":false}` has lost them: restart the container with the variables and report that, instead of calling the build verified.
- **Report:** Confirm in the summary that the container was rebuilt and is running on http://localhost:5005.

---
<!-- from .kiro/steering/documentation.md -->

# Requirements & Documentation Maintenance

- **Live Requirements Updates:** As new features are requested, API integrations change, or structural requirements evolve during a task, you must automatically update the `requirements.md` file in the project root.
- **Timing:** Perform the documentation update *before* or *simultaneously* with writing the code changes, ensuring the requirements file remains the single source of truth for the codebase.
- **Format Consistency:** `requirements.md` is unnumbered `# ` sections in file order: the requirement in prose, then its `+` implementation notes, each naming the ticket that added it. Keep that shape and these titles: the request itself in `summary`, `weather data`, `map data`, `location` and `data presentation`; one section per feature (`ocean currents`, `ocean waves`, `tides in the pop-ups`, `nautical seamarks`, `nautical paper chart`, `Seamap base style`, `B.C. depth context`); then the cross-cutting sections (`data persistence`, `units`, `ui design`, `containerization`, `quality and security checks`, `access control`, `database replication`, `cloud infrastructure`, `self-hosted Open-Meteo fallback`, `deployment`, `deployment trigger`, `versioning`, `git and code layout`, `testing and documentation`, `performance`). A new capability gets its own section in the matching group, not a new top-level group, and `pytest backend/tests/test_docs.py` fails when a `# ` heading is not in this list.
- **Verification Rule:** Never complete a task that alters functional scope or technical dependencies without committing an updated `requirements.md` alongside the code.

---
<!-- from .kiro/steering/quality-gates.md -->

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

## 6. Shared Rules for All AI Tools (SCRUM-119, SCRUM-139, SCRUM-337)
- `.kiro/steering/*.md` is the single source of truth for the project rules, and Kiro reads it directly.
- `AGENTS.md` (Freebuff and Codebuff), `GEMINI.md` and `.config/antigravity/instructions.md` (Antigravity) are generated from these files. Do not edit them by hand: change a steering file, then run `python scripts/sync-ai-rules.py` and commit all of them. A pytest test fails when a generated file is out of date.
- Every generated file carries the complete rule body. There is no always-on/situational split and no byte budget on `AGENTS.md`: the tools in use do not truncate it, and Freebuff reads up to 64,000 characters. The only size check is Freebuff's own limit.
- Freebuff (SCRUM-139): Freebuff Desktop reads the root `AGENTS.md` and the skills in `.agents/skills/`. `.freebuff/rules.md` is generated from the same steering files plus a workflow inventory (the skills and the Kiro post-task hook), so changing a steering file, a skill in `.agents/skills/` or the hook in `.kiro/hooks/` requires running `python scripts/sync-ai-rules.py` and committing the regenerated files. Do not copy skills into `.freebuff/skills/`, because Freebuff already loads `.agents/skills/`. Freebuff has no project hooks, so the post-task container rebuild follows `release-versioning.md`.
- Reusable workflows live as skills in `.agents/skills/<name>/SKILL.md` (specs, CI checks, releases, container rebuild). Keep them consistent with the steering files and tool-neutral; they explain how, the steering files say what is required.

---
<!-- from .kiro/steering/release-versioning.md -->

# Release Versioning (SCRUM-91, SCRUM-130, SCRUM-132)

The app version must always match the release version.

- **Single source of truth:** the `VERSION` file in the project root, plain semver `MAJOR.MINOR.PATCH` with no "v" (e.g. `0.2.0`).
- **Keep in sync:** `frontend/package.json` (and `package-lock.json`) `version` must equal `VERSION`. Update both with:
  ```bash
  echo "X.Y.Z" > VERSION
  (cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
  ```
- **Displayed version includes the build hash (SCRUM-159):** the navbar badge and `GET /api/health` show `X.Y.Z-<short-hash>` while `VERSION`, `package.json` and tags stay `X.Y.Z` / `vX.Y.Z`. User-testing builds also bump `PATCH` (no notes, no tag: not a release). Mechanics: `rebuild-container` skill.
- **Release notes:** every release needs notes covering features, fixes, performance and rules, saved as `release-notes/x-x-x.md` (dots as hyphens) and committed with the version bump.
- **Rebuild container on version bump and release (SCRUM-132):** after a version bump or a release merged to `master`, run `scripts/rebuild-container.sh` so user verification happens on http://localhost:5005.
- **Never hardcode the version** in UI or API code. The backend reads `VERSION` (`backend/app/config.py` → `APP_VERSION`); the frontend gets it at build time as `__APP_VERSION__` (`frontend/appVersion.ts`, `src/version.ts`).
- **When creating a release `vX.Y.Z`:** bump both files, write `release-notes/x-x-x.md`, merge `develop` into `master`, then publish the tag from `master` with the notes (see the `release` skill).
- If asked to create a release without a version bump, ask whether to bump `VERSION` first instead of tagging a mismatched version.
- Tests (`version.test.ts`, `test_version.py`) fail if `VERSION`, `package.json`, the badge or `/api/health` disagree, or if the version is not `X.Y.Z[-<hash>]`.

## Google Cloud Deploys Are Deliberate (SCRUM-223)
- **What counts:** anything that reaches the running Google Cloud service or its image registry — the `deploy-cloud-run.yml` workflow, `gcloud builds submit`, `gcloud run deploy` and a manual push to Artifact Registry.
- **Only from `master`, and only for a release:** a `develop` merge rebuilds the local container (`scripts/rebuild-container.sh`) and stops there. Production changes when `develop` is merged into `master` for a version bump.
- **Exception — user testing:** a feature may be deployed from its own branch only when the user asks for it and names the branch. Trigger it from the Actions tab (`workflow_dispatch`); its `VERSION-<sha>` tag keeps that build identifiable, and the next release replaces it.
- **Never** add an automatic deploy trigger for `develop` or a feature branch, and never deploy a branch the user did not name.
- **Report** every Google Cloud deploy in the summary, with the branch and the image tag.
