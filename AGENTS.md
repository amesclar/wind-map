<!-- GENERATED FILE. Do not edit by hand. -->
<!-- Source of truth: .kiro/steering/*.md. After changing a steering file, run: python scripts/sync-ai-rules.py -->

# Project rules for AI coding tools

You must follow every rule below for every task, without waiting to be asked. These are the same rules
Kiro follows; they come from the files in `.kiro/steering/`.

---
<!-- from .kiro/steering/commit-rules.md -->

# Git and PR Requirements
- **Ticket Enforcement:** You are strictly required to include a project ticket number (e.g., `PROJ-123`) in all Git branch names, commit messages, and PR titles.
- **Branch Naming:** Format branches as `feature/PROJ-123-description` or `fix/PROJ-123-description`.
- **Commit Messages:** Prefix every commit message with the ticket number, followed by a colon (e.g., `PROJ-123: Add user authentication`).
- **PR Titles:** Prefix all PR titles with the ticket number in brackets (e.g., `[PROJ-123] Implement secure login flow`).

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
- **When:** As soon as `gh pr checks <n>` shows every required check passing (Backend, Frontend, Docker image and both CodeQL analyses) and the PR is mergeable, transition the ticket in the PR title to Done with `transitionJiraIssue` (find the Done transition ID with `getTransitionsForJiraIssue`). Don't wait for the merge.
- **Exceptions:** Skip tickets that are already Done. Don't mark a ticket Done when the PR only partly delivers it (e.g. follow-up work remains); comment why instead.
- **If it stops succeeding:** If a check fails or the PR is closed unmerged afterwards, move the ticket back to In Progress and say why.
- **Record the merge hash after merging:** right after the PR is merged into `develop` or `master`, comment on the ticket with the merge commit hash. This completes the merge; don't wait to be asked.
- **Which hash:** the merge commit on the target branch, not the feature branch commit: `gh pr view <n> --json mergeCommit -q '.mergeCommit.oid'` after `git fetch origin`, then the 7-character short hash (e.g., `95cf243`).
- **Comment format:** `Merged PR #<n> into <target> as <short-hash>` followed by the PR URL.
- **Which tool:** `addOrEditJiraIssueComment`; the transition comment field can be dropped silently.
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
- **How:** `zsh -ic './scripts/rebuild-container.sh'`. A non-interactive agent shell (bash, an IDE task, a Kiro or Devin hook) never reads `~/.zshrc`, so the script must run through the user's interactive shell to see `CARTO_API_KEY`, the Jira variables and the feedback limits (SCRUM-262). Never write those values or a profile path into these rules. Build details: `rebuild-container` skill.
- **Verify the environment survived (SCRUM-262):** after the rebuild, `GET /api/config` must still report `feedback_enabled: true` and a CARTO key when the user has them configured. A rebuild that answers `{"carto_api_key":"","feedback_enabled":false}` has lost them: restart the container with the variables and report that, instead of calling the build verified.
- **Report:** Confirm in the summary that the container was rebuilt and is running on http://localhost:5005.

## Deploying to Google Cloud (SCRUM-223)
- **Only for a release:** Google Cloud is touched when `develop` is merged into `master` for a version bump; a `develop` or feature-branch merge rebuilds the local container and stops there.
- **Exception — user testing:** deploy from the branch the user names, through Actions → Deploy to Cloud Run. Never add an automatic deploy trigger for `develop` or a feature branch, and report every deploy with its branch and image tag. Mechanics: `release-versioning.md`.

---
<!-- from .kiro/steering/documentation.md -->

# Requirements & Documentation Maintenance

- **Live Requirements Updates:** As new features are requested, API integrations change, or structural requirements evolve during a task, you must automatically update the `requirements.md` file in the project root.
- **Timing:** Perform the documentation update *before* or *simultaneously* with writing the code changes, ensuring the requirements file remains the single source of truth for the codebase.
- **Format Consistency:** Keep the existing structure of `requirements.md` (e.g., maintaining the split between Backend, Frontend, Data Sources, and Infrastructure).
- **Verification Rule:** Never complete a task that alters functional scope or technical dependencies without committing an updated `requirements.md` alongside the code.

---

# Situational rules (Devin)

Devin loads these from `.devin/rules/` when their trigger matches. When a task touches those files, read the rule before editing:

- `.devin/rules/quality-gates.md` — Testing policy, CI parity, branch protection and pinned dependencies.
- `.devin/rules/release-versioning.md` — Version source of truth, build hash, releases, container rebuilds and Google Cloud deploys.
