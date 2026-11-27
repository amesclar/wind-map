# SCRUM-302 — Design

## Where the counting lives

`useBaseLayers` already owned the chart's per-batch counter. It becomes a small factory,
`tileWatcher(setFailed, threshold, windowMs)`, so the base map gets the identical rule without a
second implementation: a failure count, a window start, `error()` resetting the window when it has
expired, `loaded()` clearing only when the batch had no failures (a failed batch's `load` arrives
after its errors and must not hide the message).

Two watchers are made per effect run: one on `setChartTilesFailed` with the CHART constants, one on
`setBaseTilesFailed` with the new `BASE_TILE_FAILURE_THRESHOLD` (3) and
`BASE_TILE_FAILURE_WINDOW_MS` (10 s).

## Which layer is watched

- The plain base branch (`carto_dark`, `osm_*`, `seamap_light`) attaches both handlers to its xyz layer.
- The Seamap and Google branches mount a CARTO substrate through the same code, so the mount moved
  into `mountSubstrate(watch)`: the substrate is the base map there and is watched.
- The paper chart's substrate is mounted with `watch = false`. If CARTO fails under the chart, the
  chart's own notice is the honest one and a second notice would double-report.

This also removed three copies of the substrate mount.

## State, reset and retry

`baseTilesFailed` plus `baseRetryCount`, mirroring the chart: `retryBase()` clears the flag and bumps
the count, and the count is an effect dependency, so the layer remounts. The effect also clears the
flag when it starts, which covers a base change without a second effect.

`MapView` renders the notice only when `!chartBase && baseTilesFailed && !baseNoticeDismissed`. The
dismissal resets on `[tileLayerType, baseTilesFailed]`, so it expires with the failure cycle it
dismissed. Map Settings is opened through a new optional `onOpenMapSettings` prop, which `App` wires
to the existing modal state — the notice lives inside the map, which has no business owning that.

## Copy

`baseTileFailureNotice(layer)` in `mapTiles.ts`, so the name comes from `tileLayerName` and cannot
drift from the settings label. Copy: "The CARTO base map is not loading — try another base map."
