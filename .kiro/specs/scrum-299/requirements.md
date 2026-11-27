# SCRUM-299 — Bound the tiles the range export requests

Epic: SCRUM-297, base maps the app is allowed to use at scale.

The range export walks the selected hours, moves the map and captures a frame per hour. Every step
is a fresh viewport of base tiles, requested as fast as the frames settle, which is the shape every
provider treats as bulk downloading: CARTO's Basemaps Terms Section 9 forbids "downloading or
extracting map content in bulk", OpenStreetMap's policy calls it "pre-emptive fetching of tiles other
than those a user is actively viewing", and OpenFreeMap caps a download at 3,000 tiles.

## Decision: a tile budget, not a pace

The ticket offered three mechanisms — a minimum interval between frames, a token bucket over tile
requests, or `maxNativeZoom` for the export. SCRUM-330 measured what the export actually costs
(40 tiles a frame at 1920 × 1080, 135 at 3840 × 2160, so 2,160 for a 16-step 4K export) and showed
the volume is trivial against CARTO's 5M-a-month free allowance; what a provider objects to is the
burst, and a count is the only part of it this ticket can bound without redesigning the export.

So this ticket bounds **tiles per export**, and deliberately leaves pacing to the redesign the owner
wants next (see Deferred). A budget also scales with display density where a flat frame cap cannot:
a 1080p window keeps all 24 captures, a 4K window is held to 22.

## Requirements

### 1. The plan knows its tile cost

1.1 WHEN the export dialog plans a range THEN the system shall count the base-map tiles one frame
asks for from the map's CSS size in 256 px tiles, rounding each axis up.
1.2 WHEN the map size is not known yet, or is zero THEN the tile budget shall be skipped rather than
refusing the range, so the dialog opens as it did before.

### 2. The budget refuses an oversized export

2.1 WHEN captures multiplied by tiles per frame exceeds `EXPORT_TILE_BUDGET` (3,000) THEN the plan
shall be refused, the message shall name the tile count, the budget and the three ways out (longer
interval, shorter range, smaller window), and Export shall stay disabled.
2.2 WHEN the product is exactly at the budget THEN the plan shall be accepted.

### 3. Unchanged behaviour

3.1 The 24-capture cap shall stay, and shall be reported before the budget when both would fail,
because it is the limit the user can act on with the interval field.
3.2 A viewport that fits the budget shall behave exactly as today: same hours, same summary, same
frames, same ZIP/PDF output.
3.3 The single-view ("Current view") export shall not be affected.

## Deferred to the export redesign

Recorded here so the reason is not lost:

- **Pacing** (a minimum interval between frames, or a token bucket the capture loop waits on) needs
  the capture loop reshaped, and it is the part that makes the burst read as browsing rather than
  scraping. Owner's direction: address the range export's shape later.
- **A checkbox of chosen times** instead of a start/end/interval range, so a user picks the frames
  they want rather than a slice of hours. That redesign is where pacing and any provider-specific
  limit would land; the budget here survives it unchanged, since it is expressed per export.
