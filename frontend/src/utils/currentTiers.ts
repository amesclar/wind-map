/**
 * Ocean-current speed tiers (SCRUM-99), shared with the layer legend so the two can never
 * disagree. Thresholds are in knots; the API serves knots, like the wind endpoints.
 *
 * `ocean_current_direction` is where the water flows **towards**, so a chevron rotates by the
 * value directly. Wind barbs show where the wind comes *from*, which is why they need the
 * opposite convention.
 */
import type { WindSpeedUnit } from '../types';
import { knotsToUnit } from './units';

export type CurrentTierId = 'light' | 'moderate' | 'strong' | 'extreme';

export interface CurrentTier {
  id: CurrentTierId;
  label: string;
  /** Inclusive lower bound in knots; the tier runs up to the next tier's `minKnots`. */
  minKnots: number;
  color: string;
  /** Chevrons drawn in the glyph. */
  chevrons: 1 | 2;
  /** Heavier stroke for stronger water. */
  bold: boolean;
}

/**
 * Dark rim under every chevron (SCRUM-237), like the wind barbs' `BARB_OUTLINES`: the fill carries
 * the tier and the rim carries the contrast on light bases and over the wind gradient. One rim is
 * used on every base, so the old chart-only white halo is gone.
 */
export const CURRENT_TIER_OUTLINE = '#0b1220';

/**
 * Fills are fully opaque and get brighter/warmer with the current, so the rim and the glyph's own
 * shape do the separating. Extreme is a light pink rather than magenta: the darker #ff4fd8 fell
 * below 3:1 over the wind gradient at both overlay opacities (SCRUM-237).
 */
export const CURRENT_TIERS: readonly CurrentTier[] = [
  { id: 'light', label: 'Light', minKnots: 0, color: '#e0f2fe', chevrons: 1, bold: false },
  { id: 'moderate', label: 'Moderate', minKnots: 0.5, color: '#67e8f9', chevrons: 2, bold: false },
  { id: 'strong', label: 'Strong', minKnots: 1.5, color: '#ffffff', chevrons: 2, bold: true },
  { id: 'extreme', label: 'Extreme', minKnots: 3, color: '#ff9ceb', chevrons: 2, bold: true },
];

/** The tier a speed falls in; negative or missing speeds read as light. */
export function currentTier(velocityKnots: number): CurrentTier {
  let tier = CURRENT_TIERS[0];
  for (const candidate of CURRENT_TIERS) {
    if (velocityKnots >= candidate.minKnots) tier = candidate;
  }
  return tier;
}

/**
 * The tier's knot range for the legend, converted to the user's speed unit (SCRUM-100).
 * The last tier is open-ended, e.g. "3+".
 */
export function tierRangeLabel(tier: CurrentTier, unit: WindSpeedUnit): string {
  const next = CURRENT_TIERS.find((candidate) => candidate.minKnots > tier.minKnots);
  const inUnit = (knots: number) => Number(knotsToUnit(knots, unit).toFixed(1));
  return next ? `${inUnit(tier.minKnots)}–${inUnit(next.minKnots)}` : `${inUnit(tier.minKnots)}+`;
}

/** Where the numbers come from, shown in the chevron pop-up (SCRUM-99). */
export const CURRENT_SOURCE = 'Copernicus Marine (via Open-Meteo)';
