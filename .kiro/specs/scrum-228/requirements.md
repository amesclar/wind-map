# Requirements: SCRUM-228 — add the CMC GEM weather model

## 1. Model availability

1.1 WHEN the model list is requested THEN the system shall offer `gem_seamless` as "CMC GEM Seamless" alongside the existing models.

1.2 WHEN the metadata for GEM is reported THEN the system shall report `update_hours` 6, `update_cycles_utc` `[0, 6, 12, 18]` and `horizon_hours` 240.

1.3 WHEN the model guide table is read THEN the CMC GEM row shall state the same 10-day horizon and 6-hour cadence as the config.

1.4 WHEN a request names `gem_seamless` THEN the system shall forward `models=gem_seamless` to Open-Meteo.

## 2. Forecast window

2.1 WHEN a forecast hour beyond 240 h is requested for GEM THEN the system shall answer 422 naming the horizon, without calling Open-Meteo.

2.2 WHEN an hour inside 240 h is requested for GEM THEN the system shall serve it from the same grid, marker and point paths as every other model.

## 3. Unchanged behaviour

3.1 WHEN another model is selected THEN its metadata, values and export prefix shall be unchanged.

3.2 WHEN a request names an unknown model THEN the system shall still answer 422.
