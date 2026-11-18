# Git and PR Requirements
- **Ticket Enforcement:** You are strictly required to include a project ticket number (e.g., `PROJ-123`) in all Git branch names, commit messages, and PR titles.
- **Branch Naming:** Format branches as `feature/PROJ-123-description` or `fix/PROJ-123-description`.
- **Commit Messages:** Prefix every commit message with the ticket number, followed by a colon (e.g., `PROJ-123: Add user authentication`).
- **PR Titles:** Prefix all PR titles with the ticket number in brackets (e.g., `[PROJ-123] Implement secure login flow`).

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

## Record Merge Hash in Jira After Merging
- **When:** Right after a PR is merged into `develop` or `master`, add a comment to the Jira ticket with the merge commit hash. This is part of completing the merge; don't wait to be asked.
- **Which hash:** The merge commit on the target branch, not the feature branch commit. Get it after `git fetch origin`:
  ```bash
  gh pr view <n> --json mergeCommit -q '.mergeCommit.oid'
  ```
  Use the 7-character short hash (e.g., `95cf243`).
- **Comment format:** `Merged PR #<n> into <target> as <short-hash>` followed by the PR URL.
- **Which ticket:** The ticket number in the PR title. Use `addOrEditJiraIssueComment`, not the transition comment field, which can be dropped silently.
- **Merging `develop` into `master`:** Comment on each ticket included in the merge, or on the release ticket if one exists, using the merge hash on `master`.
- **Report** the hash and the Jira comment in the summary of the merge.

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
