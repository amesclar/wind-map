# Design: SCRUM-232 — remove the model guide

## Overview

Delete the static model reference table and its entry point. The same live facts already come from `/api/weather/models` into the model line under the forecast time selector, so nothing replaces the modal; the work is mostly deletions plus re-pointing one backend test and the docs.

## Approach

1. `Navbar.tsx`: drop the refresh-icon button, the `onOpenModelGuide` prop and the asset import; the right group is feedback · export · gear.
2. `App.tsx`: drop `isModelGuideOpen`, the prop wiring and the modal element.
3. Delete `WeatherModelGuideModal.tsx` and its test, `utils/modelGuide.ts` and its test, `assets/weather-models.md` and `assets/refresh-icon.png`.
4. `backend/app/config.py`: `MODEL_METADATA` becomes the documented source of truth — a comment per model naming its Open-Meteo doc page.
5. `backend/app/services/model_info.py`: docstring no longer references the markdown table.
6. `backend/tests/test_forecast_time.py`: replace the table-parsing test with direct assertions over `MODEL_METADATA` (keys match `MODEL_IDS`, cadence ≥ 1, cycles are hours 0–23, horizon > 0, `best_match` stays 168 h).
7. Docs: `requirements.md` replaces the SCRUM-110 section with the removal note, drops the table reference from the forecast-window line and the `ModelGuideRow` sentence, and fixes the toolbar order; `README.md` drops the guide feature and tree entries.

## Correctness properties

- P1 (1.1, 1.2): no guide button or modal exists; the toolbar order is feedback · export · gear.
- P2 (2.1, 2.2): the footer line keeps rendering cadence, horizon and run times; the models endpoint is untouched.
- P3 (3.1, 3.2): `MODEL_METADATA` is validated directly and matches `MODEL_IDS`.
- P4 (3.3): no code reference to `weather-models.md`, `refresh-icon` or `modelGuide` remains outside release notes and the requirement note.

## Files

- `frontend/src/components/Navbar.tsx`, `frontend/src/App.tsx`, `frontend/src/components/Navbar.test.tsx`
- Deleted: `WeatherModelGuideModal.*`, `utils/modelGuide.*`, `assets/weather-models.md`, `assets/refresh-icon.png`
- `backend/app/config.py`, `backend/app/services/model_info.py`, `backend/tests/test_forecast_time.py`
- `requirements.md`, `README.md`
