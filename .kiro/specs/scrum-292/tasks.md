# SCRUM-292 Implementation Plan

## Tasks

- [x] 1. Add the line count to the wave tier table
  - Add `lines: number` to `WaveTier` and 1 / 2 / 3 / 4 to the four rows
  - _Requirements: 1.1, 1.2_
  - _Files: `frontend/src/utils/waveTiers.ts`_

- [x] 2. Draw the wave glyph as counted wavy lines
  - Replace the straight shaft and single head with N parallel wavy shafts, each ending in one chevron head
  - Scale spacing, amplitude, stroke, head width and rim width down as the count rises
  - Keep `travelDirection()`, the rim pass, the `aria-label`, the tier colour and the size ramp
  - _Requirements: 1.1–1.5_
  - _Files: `frontend/src/components/WaveArrow.tsx`_

- [x] 3. Confirm the leaflet icon is unchanged
  - `buildWaveArrowIcon()` keeps `max(tier.size, 32)` and the centre anchor
  - _Requirements: 1.9_
  - _Files: `frontend/src/components/WaveArrow.tsx`_

- [x] 4. Test the glyph, the tier table and the key
  - Per-tier path counts (2 / 4 / 6 / 8) and one head per line
  - Curved shafts, symmetric offsets, thinner stroke and rim as the count rises
  - Rotation, colour, size, `aria-label` and the 32 px hit area
  - `WAVE_TIERS.map(tier => tier.lines)` equals `[1, 2, 3, 4]`
  - _Requirements: 1.1–1.10_
  - _Files: `frontend/src/components/WaveArrow.test.ts`, `frontend/src/utils/waveTiers.test.ts`, `frontend/src/components/MapLegend.test.tsx`_

- [x] 5. Update the project requirements
  - The ocean-waves bullet describes counted wavy lines, the line count as the height cue, and the new distinction from the current chevrons
  - _Files: `requirements.md`_

- [x] 6. Run the CI checks
  - `cd frontend && npm run lint && npm run typecheck && npm run test:coverage`
  - `ruff check . && ruff format --check . && pytest --cov`
  - _Requirements: all_
