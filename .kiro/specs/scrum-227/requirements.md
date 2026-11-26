# Requirements: SCRUM-227 — add the ECMWF AIFS (AI) weather model

## 1. Model availability

1.1 WHEN the model list is requested THEN the system shall offer `ecmwf_aifs025_single` as "ECMWF AIFS (AI)" alongside the existing models.

1.2 WHEN the metadata for AIFS is reported THEN the system shall report `update_hours` 6, `update_cycles_utc` `[0, 6, 12, 18]` and `horizon_hours` 360, matching the "ECMWF AIFS (AI)" row of `frontend/src/assets/weather-models.md`.

1.3 WHEN a request names `ecmwf_aifs025_single` THEN the system shall forward `models=ecmwf_aifs025_single` to Open-Meteo.

## 2. Missing gusts

2.1 WHEN Open-Meteo returns no wind gust for AIFS THEN the system shall keep `wind_gust_knots`, `wind_gust_kmh`, `wind_gust_mph` and `wind_gust_ms` null rather than zero.

2.2 WHEN a barb pop-up is built for a point without a gust THEN the pop-up shall omit the gust line instead of showing a fake calm value.

## 3. Unchanged behaviour

3.1 WHEN the map grid, saved-location markers or the forecast window are requested for AIFS THEN they shall use the same endpoints, caches and horizon validation as every other model.

3.2 WHEN another model is selected THEN its behaviour, metadata and exported model prefix shall be unchanged.

3.3 WHEN a request names an unknown model THEN the system shall still answer 422.
