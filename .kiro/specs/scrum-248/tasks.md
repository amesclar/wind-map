# Tasks: SCRUM-248

- [x] 1. Split startup focus from selection
  - `focus` state set by startup on all three paths; `selectSaved` and `handleGridPointSelect` clear it; delete clears the selection and a matching focus.
  - _Requirements: 2.1, 2.2, 2.4_
  - _Files: frontend/src/App.tsx_

- [x] 2. Fly without selecting
  - `MapView` takes `focusLocation`; the fly effect uses `selectedLocation ?? focusLocation` and opens a pop-up only for a selection, keeping the zoom rule.
  - _Requirements: 2.1, 2.3, 2.5, 2.6, 3.2_
  - _Files: frontend/src/components/MapView.tsx_

- [x] 3. Tests
  - App: startup with and without geolocation focuses but opens nothing; modal, marker, barb and search selection still open a pop-up; deleting the selected location clears it.
  - MapView: a focus change flies without a pop-up; a selection change flies and opens it.
  - _Requirements: 2.1–2.6, 3.2, 3.5_
  - _Files: frontend/src/App.test.tsx, frontend/src/components/MapView.test.tsx_

- [x] 4. Requirements
  - Note the pop-up rule in `requirements.md`.
  - _Requirements: 2.1–2.4_
  - _Files: requirements.md_

- [x] 5. CI and merge
  - Run the `ci-checks` skill, open the PR into `develop`, merge on green, comment the hash, delete the branch and rebuild the container.
  - _Requirements: all_
