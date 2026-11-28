---
name: spec-workflow
description: Plan and implement a SCRUM ticket as a Kiro-style spec in .kiro/specs/<ticket>/ (requirements or bugfix, design, tasks). Use for any feature or bug fix bigger than a one-line change, or when the user asks for a spec, design or task plan.
---

# Spec workflow (Kiro-compatible)

Specs live in `.kiro/specs/<ticket-lowercase>/` (e.g. `.kiro/specs/scrum-88/`) so Kiro and Freebuff share them. `.kiro/specs/scrum-88/` is the reference example.

## 1. Requirements (`requirements.md` for features, `bugfix.md` for bugs)
- Feature: user stories with numbered acceptance criteria in EARS form: `WHEN <condition> THEN the system shall <behavior>`.
- Bug: three numbered sections, as in `scrum-88/bugfix.md`:
  - `1.x` Current Behavior (Defect)
  - `2.x` Expected Behavior (Correct)
  - `3.x` Unchanged Behavior (Regression Prevention)
- Read the Jira ticket first (`getJiraIssue`). Check its "is blocked by" links and tell the user if a blocker is not Done.

## 2. Design (`design.md`)
- Overview, glossary, root cause (bugs) or architecture (features), correctness properties that reference requirement numbers, and the exact files and functions to change.
- Use repository-relative paths, never absolute paths like `/Users/...`.

## 3. Tasks (`tasks.md`)
- Checkbox list `- [ ] N. <task>` with sub-bullets for the change, `_Requirements: x.y_` and `_Files: ..._`.
- Include test tasks (new tests and regression tests) and a final verification task (see the `ci-checks` skill).
- Include a `requirements.md` (project root) update task when scope, endpoints or dependencies change.

## 4. Approval and execution
- If the user only asked to create the ticket or spec, stop after writing it and share the plan; wait for "implement SCRUM-xxx" or "go ahead".
- Implement tasks in order on the ticket branch (`feature/SCRUM-xxx-...` from `develop`). Tick `- [x]` in `tasks.md` as each task is done and commit the spec with the code.
