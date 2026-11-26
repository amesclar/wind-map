# Design: SCRUM-227 — ECMWF AIFS (AI)

## Overview

Add ECMWF's AI model as one more Open-Meteo model id. The selector, the forecast-time bar, the export prefix and the cached grid/forecast paths all read the model list and metadata from the backend, so the change is a configuration entry plus tests and docs.

## Architecture

`config.AVAILABLE_MODELS` drives `GET /api/weather/models` (`services/model_info.py`) and `MODEL_IDS` drives request validation (`dependencies.py`). `MODEL_METADATA` supplies cadence, cycles and horizon; the module raises at import when the two disagree. `open_meteo.forecast_params()` puts the id into `models=`, and the grid and forecast caches key on it, so no cache or endpoint change is needed.

AIFS characteristics that matter:

- 0.25°, global, 6-hourly cycles, 15-day horizon (360 h), with natively 6-hourly steps that Open-Meteo interpolates to hourly.
- No `wind_gusts_10m`. SCRUM-225 already turns an absent value into `None` end to end; the barb pop-up (`WindOverlay.buildGridPointPopup`) omits the gust line when `wind_gust_knots` is not a number, and `formatSpeed` renders "No data" for the saved-location pop-up.

## Approach

1. `backend/app/config.py`: add `{"id": "ecmwf_aifs025_single", "name": "ECMWF AIFS (AI)"}` after `ecmwf_ifs`, and the matching `MODEL_METADATA` entry (6-hourly, `[0, 6, 12, 18]`, 360 h).
2. Tests:
   - `test_api.py`: the list contains AIFS with its name and horizon; a grid request forwards `models=ecmwf_aifs025_single`.
   - `test_forecast_time.py`: the guide-table row matches config (cadence 6 h, 360 h) and `model_horizon_days` is 15.
   - `test_forecast_parser.py`: an AIFS-shaped payload (gust series all null) parses with null gusts and a real wind speed.
3. Docs: `requirements.md` model window and AIFS note; `README.md` selector list and forecast-time window.

## Correctness properties

- P1 (1.1, 1.2): `/api/weather/models` lists `ecmwf_aifs025_single` with "ECMWF AIFS (AI)", 6 h cadence and 360 h horizon.
- P2 (1.3): a grid or point request for AIFS sends `models=ecmwf_aifs025_single`.
- P3 (2.1): a null gust stays null in `WeatherForecastPoint` and `GridWindPoint`.
- P4 (2.2): the pop-up has no gust line for a null gust (existing test, `WindOverlay.test.ts`).
- P5 (3.1–3.3): horizon validation, caching and unknown-model 422 are unchanged.

## Files

- `backend/app/config.py`
- `backend/tests/test_api.py`, `backend/tests/test_forecast_time.py`, `backend/tests/test_forecast_parser.py`
- `requirements.md`, `README.md`
