# Design: SCRUM-226 — replace `ecmwf_ifs04` with `ecmwf_ifs`

## Overview

Rename the ECMWF entry in the backend model list and metadata, and normalise the retired id in the one place every endpoint reads its `model` parameter. No frontend change: the selector and the export prefix read the id from `/api/weather/models`, and the guide row already describes the 9 km HRES grid.

## Root cause

`config.AVAILABLE_MODELS` still offers `ecmwf_ifs04` ("ECMWF IFS 0.4°"). Open-Meteo's open-data ECMWF product moved to the 9 km HRES grid, served as `ecmwf_ifs`; the retired id answers with null variables, which SCRUM-225 now correctly renders as no data rather than a fake calm. The id, not the parser, is the defect.

## Approach

1. `backend/app/config.py`
   - `AVAILABLE_MODELS`: `ecmwf_ifs` / "ECMWF IFS HRES 9 km".
   - `MODEL_METADATA`: same key, unchanged values (6-hourly, 360 h).
   - `MODEL_ALIASES = {"ecmwf_ifs04": "ecmwf_ifs"}` with a comment that it is for one release.
2. `backend/app/dependencies.py`: `model_param` normalises through `MODEL_ALIASES` before the `MODEL_IDS` check, so validation, cache keys, horizons and upstream requests all see the canonical id.
3. Tests: model list and alias in `test_api.py`; renamed ids in `test_grid.py` and `test_forecast_time.py` (including the table-vs-config check, whose row name was already "ECMWF IFS (HRES 9 km)").
4. Docs: `requirements.md` model list and alias note; `README.md` selector list.

## Correctness properties

- P1 (2.1): `/api/weather/models` contains `ecmwf_ifs` (name, 360 h) and not `ecmwf_ifs04`.
- P2 (2.2, 3.1, 3.3): a non-default model forwards `models=<canonical id>`; cache keys use the canonical id.
- P3 (2.4): `model=ecmwf_ifs04` returns 200 and forwards `models=ecmwf_ifs`.
- P4 (3.2): any other unknown id still returns 422.
- P5 (3.4): the guide table row still matches `MODEL_METADATA` through `test_model_table_horizons_match_config`.

## Files

- `backend/app/config.py`, `backend/app/dependencies.py`
- `backend/tests/test_api.py`, `backend/tests/test_grid.py`, `backend/tests/test_forecast_time.py`
- `requirements.md`, `README.md`
