# Design: SCRUM-195

## Backend

`services/tide_service.py` mirrors `currents_service.py`:

- `TIDE_VARIABLE = "sea_level_height_msl"`, `DATUM = "msl"`.
- `window_hours(moment)` returns the 72 hour keys from midnight UTC of the previous day.
- `get_point_tide(lat, lon, at)` reads the window from `tide_point_cache`; if any hour is missing
  it makes one marine request (`start_date`/`end_date`, `timezone=UTC`) and stores every hour,
  including nulls. The response carries the full series and the extremes.
- `derive_extremes` compares each sample with its neighbours (high: above previous and at least
  the following; low: below previous and at most the following), then `_refine` uses the parabola
  through the three samples: `offset = 0.5*(y0-y2)/(y0-2y1+y2)`, height
  `y1 - 0.25*(y0-y2)*offset`, time rounded to the minute. Edges are not extrapolated.
- `routers/tides.py` validates the hour with `validate_current_time`, reuses `quota_exhausted`
  from the currents router, and maps `httpx.HTTPError` to 502.
- `database.py`: `TIDE_CACHE_DDL` added to `CACHE_TABLE_DDL`, `SCHEMA_VERSION = 8`.

## Frontend

- `types.ts`: `TideSample`, `TideExtreme`, `TidePointResponse`.
- `api/client.ts`: `fetchPointTide(lat, lon, hour)`.
- `utils/tideBlock.ts`: `loadPointTide` (promise cache, max 100 entries, failures evicted),
  `formatTideHeight`, `formatTideTime`, `buildTideBlockHtml`.
- `MapView` adds `[data-tide-slot]` (lat/lon only) to `buildLocationPopup`, and an effect bound to
  `mapInstance`, `unitSystem`, `validTime` and `validTimeLabel` that listens for `popupopen`, reads
  the slot and fills it. `WindOverlay.buildGridPointPopup` gets the same slot.
- A point with no points renders `''`, so nothing changes for inland clicks; a failed request is
  swallowed and not cached.

## Tests

`backend/tests/test_tides.py` covers window shape, sub-hour refinement, bracketing, flat series,
series/cache/land, malformed payload, endpoint 200/422/502/503. `frontend/src/utils/tideBlock.test.ts`
covers formatting, labels, markers, the navigation caveat, empty land, and both slots.
