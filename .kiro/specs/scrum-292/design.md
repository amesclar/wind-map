# SCRUM-292 Wave glyph design

## Overview

The wave layer drew a straight staff with one head, coloured and sized by height. Next to the current
chevrons it could be read as the same symbol family, and above 0.5 kt the chevrons themselves only
differ by colour. This change gives each layer its own shape language:

| Layer | Shape | Speed or height cue | Direction |
| :--- | :--- | :--- | :--- |
| Currents (unchanged) | open chevrons, no shaft | head count (1 or 2) + colour | glyph rotation |
| Waves (new) | parallel wavy lines, one chevron head each | line count (1–4) + colour | glyph rotation |

## Glossary

- **Line**: one wavy shaft plus the single chevron head it ends in. A glyph draws 1, 2, 3 or 4 lines.
- **Spacing**: distance between neighbouring line centres, perpendicular to travel.
- **Rim**: the `WAVE_TIER_OUTLINE` pass drawn under every path at a wider stroke.

## Geometry

One 40-unit square viewBox, rotated about its centre by `travelDirection(direction_deg)`.

| Tier | `lines` | spacing | amplitude | stroke | head half-width | rim |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0–1 m | 1 | — | 3.2 | 2.9 | 4 | +2 |
| 1–2 m | 2 | 10 | 2.4 | 2.4 | 3.9 | +1.6 |
| 2–4 m | 3 | 8.5 | 1.9 | 2.1 | 3.15 | +1.6 |
| 4+ m | 4 | 7.6 | 1.4 | 1.9 | 2.7 | +1.6 |

Crowding is what drives the numbers: as the count rises, the spacing tightens and the stroke,
amplitude, head width and rim all shrink with it, so neighbouring rims keep a clear gap at the
smallest rendering (28 px, about 0.7 px per viewBox unit) and the glyph does not fill in.

Each line is two paths: an S-shaped shaft (`C` curves from y 31 to y 12.6) and a chevron head
(`M x-head 12 L x 5.5 L x+head 12`). The head apex sits above the shaft's end, so the head reads as
the leading point of the line.

## Correctness properties

- **P1 (count maps to tier)**: `waveTier(height).lines` is 1, 2, 3 or 4 for the four tiers and
  `generateWaveArrowSvg` emits exactly two paths per line in the fill layer (requirements 1.1, 1.2).
- **P2 (direction)**: the rotation is `(direction_deg + 180) mod 360`, unchanged from SCRUM-234, so
  the heads point where the waves travel (1.3).
- **P3 (tier identity)**: fill is `tier.color`, size is `tier.size`, stroke widens slightly for bold
  tiers (1.4).
- **P4 (contrast)**: every path appears twice, the rim pass first with the wider stroke (1.5).
- **P5 (key parity)**: the key calls the same generator from `WAVE_TIERS`, so a tier cannot drift
  between the map and the key (1.6).
- **P6 (no regression)**: the current glyph, the icon box and anchor, and the pop-up are untouched
  (1.7, 1.8, 1.9, 1.10).

## Files and functions

- `frontend/src/utils/waveTiers.ts`: `WaveTier.lines` and the four tier rows.
- `frontend/src/components/WaveArrow.tsx`: `LINE_SPACING`, `LINE_AMPLITUDE`, `LINE_STROKE`,
  `HEAD_HALF_WIDTH`, `lineOffsets()`, `waveLinePaths()`, `generateWaveArrowSvg()`.
- `frontend/src/components/MapLegend.tsx`: no change; the waves row follows `WAVE_TIERS`.
- `frontend/src/components/WaveArrow.test.ts`, `frontend/src/utils/waveTiers.test.ts`: tests.
- `requirements.md`: the ocean-waves bullet.
