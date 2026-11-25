# Design: SCRUM-228 — CMC GEM Seamless

## Overview

One more Open-Meteo model id in the backend model list. `gem_seamless` blends GEM global with the regional RDPS and HRDPS runs, so it returns data worldwide and needs none of the regional-coverage work that HRRR/RRFS required. Selector, forecast bar, export prefix and caches all read the model list and metadata from `/api/weather/models`, so the change is configuration plus tests and docs.

## Evidence (2026-11-25)

- `gem_seamless` returned hourly wind for a 16-day request with non-null values up to index 252 (~10.5 days); `gem_global` matched it; `gem_hrdps` is not a valid id.
- Open-Meteo's GEM API documents a 10-day cap (`forecast_days` 0-10) and GEM Global at 10 days, 3-hourly, every 12 hours; RDPS (3.5 days) and HRDPS (2 days) run every 6 hours, which is why the seamless product is described as 6-hourly.
- The static guide table claimed 16 days for CMC GEM, which the API cannot serve.

## Approach

1. `backend/app/config.py`: add `{"id": "gem_seamless", "name": "CMC GEM Seamless"}` after `gfs_seamless`, and `MODEL_METADATA` `{"update_hours": 6, "update_cycles_utc": [0, 6, 12, 18], "horizon_hours": 240}`.
2. `frontend/src/assets/weather-models.md`: CMC GEM row horizon 16 days → 10 days, with the global run's 12-hour cadence noted.
3. Tests:
   - `test_api.py`: the list contains GEM with its name, 240 h horizon and 6 h cadence.
   - `test_forecast_time.py`: the guide-table row matches config, `model_horizon_days` is 10, and a 250 h request is rejected with a horizon 422.
4. Docs: `requirements.md` window and GEM note; `README.md` selector list and window.

## Correctness properties

- P1 (1.1, 1.2): `/api/weather/models` lists `gem_seamless` / "CMC GEM Seamless" with 6 h cadence and 240 h horizon.
- P2 (1.3): the guide row and config agree through `test_model_table_horizons_match_config`.
- P3 (1.4): a request for GEM forwards `models=gem_seamless`.
- P4 (2.1): 250 h is rejected with a 422 mentioning the horizon and no upstream call.
- P5 (3.1, 3.2): other models and the unknown-model 422 are unchanged.

## Files

- `backend/app/config.py`, `frontend/src/assets/weather-models.md`
- `backend/tests/test_api.py`, `backend/tests/test_forecast_time.py`
- `requirements.md`, `README.md`
