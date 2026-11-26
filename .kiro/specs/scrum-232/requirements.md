# Requirements: SCRUM-232 — remove the model guide button and static table

## 1. Removed UI

1.1 WHEN the top bar is rendered THEN the system shall not show a model guide button.

1.2 WHEN the app is loaded THEN no model guide modal or static model table shall exist, and the toolbar order shall be feedback · export · gear with export immediately left of the gear.

## 2. Retained live information

2.1 WHEN a model is selected THEN the footer line under the forecast time selector shall still show its name, update cadence, time horizon and last/next run from `GET /api/weather/models`.

2.2 WHEN `/api/weather/models` is requested THEN its response shall be unchanged by this ticket.

## 3. Configuration as source of truth

3.1 WHEN cadence and horizon are needed THEN `MODEL_METADATA` shall be the only source of truth, with each entry naming the Open-Meteo doc page it comes from.

3.2 WHEN the horizon tests run THEN they shall assert the configured values directly, without reading a markdown file.

3.3 WHEN documentation is read THEN it shall describe the removed guide and point at the footer line and `MODEL_METADATA` instead.
