# SCRUM-302 — Tasks

- [x] `tileWatcher` factory in `useBaseLayers`, shared by the chart and base counters.
- [x] `BASE_TILE_FAILURE_THRESHOLD`, `BASE_TILE_FAILURE_WINDOW_MS`, `baseTileFailureNotice`.
- [x] `mountSubstrate(watch)`; the chart's substrate unwatched, Seamap and Google watched.
- [x] `baseTilesFailed`, `retryBase`, reset on base change / retry.
- [x] `base-tile-error-notice` in `MapView` with Retry, Map settings and Dismiss; `onOpenMapSettings`.
- [x] `App` passes `onOpenMapSettings`.
- [x] Five MapView tests: failed batch, stray tile, clean batch and dismissal, retry remount, base
      change and chart isolation.
- [x] `requirements.md`.
