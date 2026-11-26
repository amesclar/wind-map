# Requirements: SCRUM-195 — tide height and high/low in the pop-ups

## Problem

The map shows wind and (optionally) currents, but a click on a coastal point says nothing about
the water level. Boaters deciding whether to enter a marina want the tide at the selected hour and
the nearest low and high around it, without leaving the map or opening another site.

## Scope

- In: one tide block in the existing saved-location and wind-point pop-ups, for the hour the
  app's time selector shows.
- Out: tide curves/charts, tide stations, chart-datum conversion, navigation use, a separate tide
  layer, and tides for the currents chevrons.

## Requirements

### 1. Data and API

1.1 Sea level comes from Open-Meteo's Marine API (`sea_level_height_msl`), the MeteoFrance SMOC
series already used for currents, and does not depend on the selected weather model.

1.2 `GET /api/tides/point` accepts `lat`, `lon` and an optional `hour`, validated like the
currents (ISO 8601 with offset, hour-aligned, from the current hour to the 240-hour horizon;
violations are 422).

1.3 The response is `{latitude, longitude, datum, unit, hour, points, last_extreme,
next_extreme}`. `points` is the three-day hourly series in metres; `datum` is `msl`; an inland
point or one outside the model returns no points and no extremes.

1.4 `last_extreme` is the nearest high/low at or before the selected hour; `next_extreme` is the
first one after it and `next_extreme_after` the following one (SCRUM-250). Each is
`{type: high|low, time, height_m}` with the time refined to the minute.

1.5 Upstream network/HTTP failures are 502; a persistent 429 keeps the currents' 503
`open_meteo_quota_exhausted` shape, without leaking the upstream URL.

### 2. Caching

2.1 One request covers the previous, selected and following UTC day; every hour of that window
is cached in `tide_point_cache` under (rounded lat, lon, hour) with the shared 30-minute TTL.

2.2 An empty row (null height) records "checked, no water here", so inland points and points
outside the model are not refetched.

2.3 Schema version becomes 8 with the new table; the upgrade recreates cache tables and keeps
saved locations.

### 3. Frontend pop-up

3.1 Both pop-up builders emit an empty tide slot carrying the point's coordinates. No request is
made until a pop-up opens.

3.2 On `popupopen`, the slot is filled for the hour the pop-up shows (`validTime`; null means the
current hour). A module-level cache de-duplicates requests per rounded point and hour, including
in-flight ones; failures are not cached and leave the rest of the pop-up unchanged.

3.3 The block reads `Tide · above MSL`, the selected hour's height, then the last, next and
following high/low with local `HH:mm` times; the fourth row is omitted when
`next_extreme_after` is null. The first row's state reads `now` for the current hour and otherwise
the same label as the 🕒 row.

3.4 Heights are metres in the metric display and feet in the imperial one, one decimal.

3.5 Markers are `▲`/`▼` in the single accent `#cbd5e1`, `aria-hidden`; no emoji arrows. A point
with no tide renders nothing.

3.6 The block carries `Not for navigation`, because MSL is not a chart datum.

### 4. Docs and verification

4.1 `requirements.md` and `README.md` describe the endpoint, cache, datum caveat and block.

4.2 Backend tests cover the window, refinement, land, cache reuse, validation, 502 and 503;
frontend tests cover the block, the slots and formatting. CI passes and the container is rebuilt.
