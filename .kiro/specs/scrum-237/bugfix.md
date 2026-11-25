# Bugfix: water-current chevrons are hard to see (SCRUM-237)

## 1. Current Behavior (Defect)

1.1 WHEN the chevrons are drawn on OSM standard water or the paper chart THEN the light-blue tiers measure 1.21 to 2.55:1, below the 3:1 graphics floor (WCAG 1.4.11), so the glyphs nearly vanish.
1.2 WHEN the wind colour gradient is on THEN the blues and amber also fall below 3:1 over the 0 to 25 kn gradient (as low as 1.11:1), because the gradient already uses most of the spectrum.
1.3 WHEN the current is strong THEN the darker "strong" tier is the hardest to see on a dark base, so the ordering is inverted.
1.4 WHEN the base is not the paper chart THEN there is no outline at all; only the chart got a white halo.

## 2. Expected Behavior (Correct)

2.1 WHEN a chevron is drawn THEN it shall carry a dark outline on every base, replacing the chart-only white halo.
2.2 WHEN the tier table is used THEN each tier shall have a fully opaque fill that gets brighter or warmer with the current: pale ice light, cyan moderate, white strong and pink extreme; the 0.6 and 0.85 opacities shall be gone.
2.3 WHEN any tier is drawn on any base or over the wind gradient at 0, 5, 10, 15, 20 or 25 kn at both overlay opacities (0.55 and 0.35) THEN either its fill or its outline shall clear 3:1, enforced by a vitest contrast test.
2.4 WHEN the legend is drawn THEN its swatches shall show the same fills and the same outline.
2.5 WHEN a tier is compared with another THEN the chevron count (1 vs 2) and stroke weight (3 vs 4.5 px) shall still tell them apart.

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN a chevron is clicked THEN its pop-up shall still show the speed, direction, source and hour with no extra request.
3.2 WHEN the layer is toggled THEN the persisted `water_currents_visible` setting and the 240-hour horizon handling shall be unchanged.
3.3 WHEN the glyph rotates THEN it shall still use the flow direction directly, with no 180° flip.
3.4 WHEN the export runs THEN the chevrons shall be captured as DOM, with no export-specific palette.
