# SCRUM-294 Map key orientation copy design

## Overview

`MapLegend` explains how much each glyph means — barbs add feathers, chevrons count heads, wavy
lines count height, colour carries temperature or tier — but not which way a glyph points. The three
layers use three different conventions, so the key needs one short line each.

## Copy

| Row | Line | What the code does |
| :--- | :--- | :--- |
| Wind (kt) | `staff points where the wind comes from` | `WindBarb` rotates the staff to the API's `from` direction, feathers at that end |
| Currents (kt) | `chevron points where the water flows` | `ocean_current_direction` is flow-towards; the chevron rotates by it directly |
| Waves (ft/m) | `heads point where the waves travel` | `wave_direction` is where waves come from; `travelDirection()` adds 180° |

The three lines share one grammar — subject, verb, direction — and avoid jargon such as "upwind",
"towards" or "meteorological convention".

## Architecture

- `frontend/src/components/MapLegend.tsx`
  - `MAP_KEY_ORIENTATION` exports the three strings so the component, its tests and the
    `aria-label` cannot drift.
  - The wind line joins the existing `colour = temperature` note in
    `data-testid="map-legend-wind-note"`; the wind line itself carries
    `data-testid="map-legend-wind-direction"`.
  - The currents and waves lines render at the foot of their own blocks
    (`map-legend-currents-note`, `map-legend-waves-note`), so they appear only while the layer is on.
  - `aria-label` gains the same phrases after each layer's unit.
- No change to `WindColorLegend`, the map layers, the export footer or the tier tables.

## Correctness properties

- **P1**: while the key is mounted, `map-legend-wind-direction` shows `MAP_KEY_ORIENTATION.wind`
  (1.1).
- **P2**: `map-legend-currents-note` and `map-legend-waves-note` exist only with their rows and show
  the matching string (1.2–1.4).
- **P3**: the `aria-label` contains all three phrases, in row order, each after its unit (1.5).
- **P4**: glyph counts, ranges, the colour note and `pointer-events-none` are untouched (1.6).
- **P5**: each line is under 42 characters, so it stays on one line at 9 px in the 248 px card
  (1.7).
