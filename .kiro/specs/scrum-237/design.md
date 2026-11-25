# Design: SCRUM-237 — a high-contrast current chevron

## Overview

Follow the wind barbs' pattern (SCRUM-218): one dark outline under every glyph, on every base, and a brighter, fully opaque tier palette. The outline carries visibility on light bases and over the gradient; the fill carries the tier. A contrast test derives every background from the real sources (base water colours and `COLOR_STOPS` at both overlay opacities) so the guarantee cannot drift.

## Why a palette change as well as an outline

A single fill cannot clear 3:1 on both a near-black and a near-white base, and the wind gradient covers purple, blue, green, yellow, orange and red. A near-black outline clears it on any light or mid background while a near-white fill clears it on the dark ones. The two together bound the worst case: for every background at least one component is far from it. The old partial opacities (0.6 and 0.85) let the background through the fill and broke that bound, so they are removed.

## Palette

| Tier | Fill | Note |
| :--- | :--- | :--- |
| Light | `#e0f2fe` pale ice | one chevron |
| Moderate | `#67e8f9` cyan | two chevrons |
| Strong | `#ffffff` white | two chevrons, 4.5 px |
| Extreme | `#ff9ceb` pink | two chevrons, 4.5 px |

Outline `CURRENT_TIER_OUTLINE = #0b1220`, drawn at the fill width + 2 px. The ticket's `#ff4fd8` magenta was measured at 2.69 to 2.91:1 over the gradient at 0.35 and 0.55, so the extreme tier was lightened until its worst case cleared the floor (3.26:1).

## Correctness properties

- P1 (2.1, 2.3): each glyph has exactly two groups — outline then fill — and the contrast test passes for every tier, base and gradient case.
- P2 (2.4): the legend swatch uses `tier.color` and `CURRENT_TIER_OUTLINE`.
- P3 (2.5): `chevrons` and `bold` are unchanged, so shape still separates tiers.
- P4 (3.1–3.4): no pop-up, fetch, rotation or export code changes.

## Files

- `frontend/src/utils/currentTiers.ts` — palette, `CURRENT_TIER_OUTLINE`, no `opacity`.
- `frontend/src/components/WaterCurrentChevron.tsx` — outline always on, halo option removed.
- `frontend/src/components/CurrentOverlay.tsx`, `MapView.tsx` — the `halo` prop is gone.
- `frontend/src/components/CurrentLegend.tsx` — opaque swatch with the outline.
- Tests: `utils/currentTiers.test.ts` (contrast), `components/WaterCurrentChevron.test.ts`, `components/CurrentLegend.test.tsx`.
- `requirements.md`.
