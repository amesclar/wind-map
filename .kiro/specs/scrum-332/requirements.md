# SCRUM-332 — Pick the times, and pace the capture

## Why

SCRUM-299 bounded how many tiles an export asks a provider for. It could not touch the other half of
the shape a provider reads as scraping: the loop runs as fast as frames settle, so one export is a
burst. And start/end/interval makes the user describe the frames they want as a slice of hours with a
multiplier doing the real work — the owner's direction (2026-11-27) was a checkbox of times.

## Requirements

- R1 Range mode lists the forecast window's times, one checkbox each, with All, None and a live count;
  a fresh dialog ticks the first three (the old default).
- R2 The plan sorts and de-duplicates, validates whole hours and window membership, keeps the
  24-capture cap and the 3,000-tile budget, and summarises the times as a list rather than a span.
- R3 `captureRange` waits `RANGE_PACE_MS` (750 ms) between frames, not after the last, and a cancel
  during that wait stops before the next frame.
- R4 The OSM restriction is unaffected: the mode is still disabled on `osm_dark` and `osm_standard`
  with `Time-lapsed exports not supported`, and the fallback to the current view still holds.
- R5 The current-view export, the formats, the ZIP/PDF outputs and the 60 s per-frame deadline are
  unchanged.

## Decisions, with numbers

- **Granularity**: the window's hourly list (49 rows for a 48 h horizon), in a scrollable box rather
  than the model's 3-hour slices, so the list is the same data the selector shows and no new plumbing
  can drift from it.
- **Pace**: a fixed minimum gap, not a token bucket. 750 ms turns a 16-frame export into ≥ 11 s and
  caps a 1080p frame's 40 tiles at ~53 requests a second; a bucket would bound the same traffic but
  needs the capture loop to see tile requests, which the renderer owns.

## Acceptance

A time-lapsed export captures exactly the ticked times, gaps included, at a bounded rate; the cap and
tile budget still refuse; the OSM copy and restriction are unchanged; the view export is untouched.
