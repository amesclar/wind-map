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
