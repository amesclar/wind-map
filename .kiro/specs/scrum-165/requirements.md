# SCRUM-165 export legend requirements

## Problem

With the wind colour gradient on, the screen shows the wind-speed colour scale while the exported image always draws temperature bands. The two legends describe different maps.

## Requirements

1. WHEN the gradient is on THEN the export legend shall draw the wind speed scale (canvas gradient from `COLOR_STOPS`, ticks from `legendTicks`) in the user's speed unit, and no temperature swatch row.
2. WHEN the gradient is on THEN the barb glyph row shall keep its glyphs and carry the caption `Wind barbs (<speed unit>) · colour = temperature (<temperature unit>)`.
3. WHEN the gradient is off THEN the export legend shall stay exactly as today (barb glyphs plus temperature bands), and no colour scale shall be drawn.
4. BOTH legends shall share one source: `legendTicks` moves to `utils/windColorScale.ts` (re-exported by `WindColorLegend`), colours come only from `COLOR_STOPS`, and positions are the knot fractions of `MAX_WIND_KNOTS`.
5. The export shall receive the scale as an optional `windColorScale` field on `CaptureContent` (built by `buildWindColorScale`); it shall not read settings itself.
6. Narrow-screen label dropping stays on-screen only; the export always draws every tick. Header, footer and `LEGEND_PX` are unchanged.

## Acceptance criteria

- A gradient-on export matches the screen strip for knots, km/h, mph and m/s: same stops at the same positions and the same tick labels.
- A gradient-off export is unchanged.
- A sync-guard test compares exported captions/colours with `legendTicks(unit)` and `COLOR_STOPS` for all four units.
- Lint, typecheck, coverage and build pass.
