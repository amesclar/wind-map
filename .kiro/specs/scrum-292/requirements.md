# SCRUM-292 Wave glyph: counted wavy lines

## User stories

1. As a sailor with the wave and current layers on together, I want the two to look different at a
   glance, so I never misread a swell for a set.
2. As a sailor reading the wave layer, I want the height in the glyph's shape as well as its colour,
   so the tiers still separate on a busy chart and for colour-blind readers.

## Acceptance criteria (EARS)

**1.1** WHEN a point's significant height falls in 0–1 m THEN the map shall draw one wavy line ending
in one chevron head.

**1.2** WHEN the height falls in 1–2 m THEN the map shall draw two wavy lines, in 2–4 m three, and at
4 m or above four, each line ending in one chevron head.

**1.3** WHEN a wave glyph is drawn THEN its heads shall point where the waves travel, that is the API
`wave_direction` plus 180°.

**1.4** WHEN a wave glyph is drawn THEN its fill shall be the tier colour from `WAVE_TIERS` and its
size shall be 28, 34, 40 or 46 px by tier.

**1.5** WHEN a wave glyph is drawn THEN every path shall be drawn over the dark rim
`WAVE_TIER_OUTLINE`, and the rims of neighbouring lines and heads shall not merge.

**1.6** WHEN the wave layer is on THEN the map key shall show the four tiers generated from
`WAVE_TIERS`, one to four lines, with each range in the user's unit.

**1.7** WHEN the wave and current layers are both on THEN the currents shall still draw open chevrons,
with head count and colour for speed and orientation for flow.

**1.8** WHEN a wave marker is clicked THEN the existing pop-up shall open unchanged: height in the
user's unit, period, the direction the waves come from, the Marine source, the selected hour and the
next 48 hours from `/api/waves/point`.

**1.9** WHEN the glyph draws four lines THEN the marker shall keep at least a 32 px hit area and the
glyph shall stay centred in its icon box.

**1.10** WHEN a screen reader meets a wave marker THEN its label shall still announce the height and
the direction the waves come from.

## Out of scope

- The current chevrons and the wind barbs.
- Height thresholds, backend, cache, API and pop-up content.
