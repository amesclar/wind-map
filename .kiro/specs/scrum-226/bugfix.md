# Bugfix: the dead ECMWF IFS 0.4° model option (SCRUM-226)

## 1. Current Behavior (Defect)

1.1 WHEN the user picks "ECMWF IFS 0.4°" (`ecmwf_ifs04`) THEN Open-Meteo returns null for every weather variable (probed 2026-11-24 at Oak Harbor and Paris), so the map shows 0 kn calm wind and 32 °F everywhere.
1.2 WHEN the selector lists the model THEN it names a grid and resolution that ECMWF no longer publishes on Open-Meteo's open data; the 9 km HRES grid is served as `ecmwf_ifs`.
1.3 WHEN an old frontend still sends `ecmwf_ifs04` after a rename THEN it would receive a 422 until it is reloaded.

## 2. Expected Behavior (Correct)

2.1 WHEN `/api/weather/models` is requested THEN it shall list `ecmwf_ifs` named "ECMWF IFS HRES 9 km" and shall not list `ecmwf_ifs04`.
2.2 WHEN a forecast, grid or point request names `ecmwf_ifs` THEN Open-Meteo shall be asked for `models=ecmwf_ifs` and the response shall carry real wind and temperature values (confirmed 2026-11-25: 13.4 kn, 157°, 10.6 °C at Oak Harbor).
2.3 WHEN `ecmwf_ifs` metadata is reported THEN it shall be 6-hourly (00/06/12/18 UTC) with a 360-hour (15-day) horizon, so the footer reads "every 6 h · 15 days".
2.4 WHEN a request names the retired `ecmwf_ifs04` THEN it shall be answered as `ecmwf_ifs`, for one release, instead of a 422.

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN `best_match` is selected THEN Open-Meteo shall still be called without a `models` parameter.
3.2 WHEN another model is validated THEN unknown ids shall still be rejected with a 422.
3.3 WHEN grid or forecast values are cached THEN they shall still be keyed by the (normalised) model id and hour.
3.4 WHEN the model guide is opened THEN its ECMWF row ("ECMWF IFS (HRES 9 km)", every 6 h, 15 days) shall still match `MODEL_METADATA`.
3.5 WHEN a file is exported THEN the model-led name shall use whatever id `/api/weather/models` returns.
