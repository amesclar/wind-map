# Git and PR Requirements
- **Ticket Enforcement:** You are strictly required to include a project ticket number (e.g., `PROJ-123`) in all Git branch names, commit messages, and PR titles.
- **Branch Naming:** Format branches as `feature/PROJ-123-description` or `fix/PROJ-123-description`.
- **Commit Messages:** Prefix every commit message with the ticket number, followed by a colon (e.g., `PROJ-123: Add user authentication`).
- **PR Titles:** Prefix all PR titles with the ticket number in brackets (e.g., `[PROJ-123] Implement secure login flow`).

## Feature Branch Requirement for All Changes (SCRUM-111)
- **Every change goes on a branch:** All repository changes, including code, documentation, configuration and steering rules, are made on a dedicated ticket branch named `feature/SCRUM-xxx-<description>` (or `fix/...`) created from an up-to-date `develop`. Verify it with the tests and linters, then merge it through a PR into `develop`.
- **No direct commits** to `develop` or `master`, even for one-line or rules-only changes. If you notice you are on `develop` or `master` with uncommitted work, create the branch first and commit there.
- **A ticket first:** If the change has no ticket, create one (with a story point estimate) before creating the branch.

## Ticket Creation Is Not Execution (SCRUM-111)
- **"Create ticket to ..." means plan, not do.** When the user asks you to create a ticket, create it with a thorough plan: scope, steps, decisions needed, tests, acceptance criteria and an estimate. Put the same plan in your reply.
- **Wait for direction.** Do not start implementing, branching or changing files for that ticket until the user explicitly tells you to proceed (for example "implement SCRUM-123" or "go ahead").
- **Creating the ticket itself is allowed**, including the Jira links, the estimate and the epic and child tickets the user asked for. Questions about unclear scope can go in the reply.

## Delete Feature Branches After Merging (SCRUM-94)
- **When:** Right after a `feature/...` or `fix/...` branch is merged into `develop` or `master`, delete it both locally and on `origin`. This is part of completing the merge; don't wait to be asked.
- **Verify first:** Only delete a branch that is fully merged:
  ```bash
  git fetch origin
  git merge-base --is-ancestor <branch> origin/<target>   # must succeed
  git branch -d <branch>                                   # -d, never -D
  git push origin --delete <branch>
  git fetch --prune
  ```
  If the check fails, or the branch has commits that aren't merged, don't delete it; report this and ask.
- **Stacked PRs:** If another open PR uses the branch as its base, retarget that PR to `develop` (`gh pr edit <n> --base develop`) before deleting the branch. Otherwise GitHub closes the dependent PR.
- **Never delete** `develop` or `master`. Merging `develop` into `master` deletes no branch.
- **Report** the deleted branches in the summary of the merge.

## Mark the Ticket Done When the PR Succeeds (SCRUM-129, SCRUM-141)
- **When:** As soon as `gh pr checks <n>` shows every required check passing (Backend, Frontend, Docker image and both CodeQL analyses) and the PR is mergeable, transition the ticket in the PR title to Done with `transitionJiraIssue` (find the Done transition ID with `getTransitionsForJiraIssue`). Don't wait for the merge.
- **Exceptions:** Skip tickets that are already Done. Don't mark a ticket Done when the PR only partly delivers it (e.g. follow-up work remains); comment why instead.
- **If it stops succeeding:** If a check fails or the PR is closed unmerged afterwards, move the ticket back to In Progress and say why.
- **Record the merge hash after merging:** right after the PR is merged into `develop` or `master`, comment on the ticket with the merge commit hash. This completes the merge; don't wait to be asked.
- **Which hash:** The merge commit on the target branch, not the feature branch commit. Get it after `git fetch origin`:
  ```bash
  gh pr view <n> --json mergeCommit -q '.mergeCommit.oid'
  ```
  Use the 7-character short hash (e.g., `95cf243`).
- **Comment format:** `Merged PR #<n> into <target> as <short-hash>` followed by the PR URL.
- **Which tool:** `addOrEditJiraIssueComment`; the transition comment field can be dropped silently.
- **Merging `develop` into `master`:** Comment on each ticket included in the merge, or on the release ticket if one exists, using the merge hash on `master`, and mark any of them that are not yet Done as Done.
- **Report** the checks result, the ticket's status, the hash and the Jira comment.

## Story Point Estimates on Jira Tickets (SCRUM-105)
- **When:** Every Jira ticket you create must have a story point estimate set at creation. If you pick up a ticket that has none, estimate it first. Epics are not pointed; estimate their child tickets.
- **Field:** Jira's field is named "Story point estimate" (`customfield_10016`) in the SCRUM project, not "Story Points". Set it with `additional_fields: {"customfield_10016": <n>}` on `createJiraIssue` or `editJiraIssue`.
- **Scale:** Fibonacci values only: 1, 2, 3, 5, 8, 13.
  - **1 point** = a small bug fix or feature change touching about 10 to 20 lines of code, including its tests.
  - Lines of code are a calibration anchor, not the definition. Also weigh complexity, uncertainty, and work that is not code (infrastructure, manual verification, documentation).
  - Split anything above 8 points into smaller tickets.
- **Rationale:** Put a one-line reason for the estimate at the end of the ticket description (e.g., "Estimate: 2 points. One component and its test, about 30 lines.").
- **Calibration examples from this project:**

  | Points | Example |
  | :--- | :--- |
  | 1 | SCRUM-97: remove humidity from the drawer (13 changed lines) |
  | 1 | SCRUM-101: add a rule section (12 lines) |
  | 2 | SCRUM-102: Alpine runtime and split requirements (about 30 lines, plus image verification) |
  | 5 | SCRUM-100: map toggles and drawer card and timeline row (about 150 lines) |
  | 8 | SCRUM-96: backend currents service, endpoints, cache and tests (about 350 lines) |
  | 8 | SCRUM-104: Cloud Run deploy (about 100 lines of code, plus a lot of cloud setup) |

- **Report** the estimate in the summary when you create a ticket.

## Jira Dependency Links (SCRUM-118)
- **Make dependencies explicit:** When a ticket cannot start or finish before another one, create a Jira issue link in addition to mentioning it in the description. Text alone is not enough, because Jira boards and filters only see links.
- **Blocks:** Use link type `Blocks` when one ticket must be done first. The blocker is the `inwardIssue` and the blocked ticket is the `outwardIssue` (`createJiraIssueLink`, run through `executeWrite`; use `discover` if the tool is not loaded). The blocked ticket then shows "is blocked by" the blocker.
- **Relates:** Use link type `Relates` for loose or optional connections, and for tickets that can run in parallel but touch the same area. Do not hard-block work that can proceed on its own.
- **Not for hierarchy:** Epic and child relationships use the `parent` field when creating the ticket, not a link.
- **Order of work:** Create all the tickets first, then link them, then check the links with `getJiraIssue` (view `evidence`) or a JQL search such as `issue in linkedIssues(SCRUM-117)`.
- **When picking up a ticket:** Check its "is blocked by" links. If a blocker is not Done, tell the user before starting and ask how to proceed.
- **When finishing a ticket:** If it blocks other tickets, mention them in the summary so the user knows what is unblocked.
- **Report** the links you created in the summary.

## Rebuild Container After Merge for User Verification (SCRUM-132)
- **When:** Right after a PR is merged into `develop` or `master` (and the branch is deleted, merge hash commented, and ticket transitioned), rebuild and restart the local Docker container so the user can verify changes on http://localhost:5005.
- **Command:** Run `scripts/rebuild-container.sh`.
- The script builds the `wind-map` image, restarts the `wind-map` container with the `wind_data` volume on port 5005, and waits for `GET /api/health` to respond.
- **Report:** Confirm in the summary that the container was rebuilt and is running on http://localhost:5005.

## Google Cloud Deploys Are Deliberate (SCRUM-223)
- **Default:** Google Cloud is touched only when `develop` is merged into `master` for a release. A `develop` or feature-branch merge rebuilds the local container and stops there.
- **Exception:** a feature the user asks to test publicly may be deployed from the branch they name, through Actions → Deploy to Cloud Run (`workflow_dispatch`). Never deploy a branch the user did not name.
- **Never** add an automatic deploy trigger for `develop` or a feature branch, and report every Google Cloud deploy with its branch and image tag. Mechanics: `release-versioning.md`.
