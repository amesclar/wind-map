/**
 * Ocean-current speed tiers (SCRUM-99), shared with the layer legend so the two can never
 * disagree. Thresholds are in knots; the API serves knots, like the wind endpoints.
 *
 * `ocean_current_direction` is where the water flows **towards**, so a chevron rotates by the
 * value directly. Wind barbs show where the wind comes *from*, which is why they need the
 * opposite convention.
 */
export type CurrentTierId = 'light' | 'moderate' | 'strong' | 'extreme';

export interface CurrentTier {
  id: CurrentTierId;
  label: string;
  /** Inclusive lower bound in knots; the tier runs up to the next tier's `minKnots`. */
  minKnots: number;
  color: string;
  opacity: number;
  /** Chevrons drawn in the glyph. */
  chevrons: 1 | 2;
  /** Heavier stroke for stronger water. */
  bold: boolean;
}

export const CURRENT_TIERS: readonly CurrentTier[] = [
  { id: 'light', label: 'Light', minKnots: 0, color: '#38bdf8', opacity: 0.6, chevrons: 1, bold: false },
  { id: 'moderate', label: 'Moderate', minKnots: 0.5, color: '#06b6d4', opacity: 0.85, chevrons: 2, bold: false },
  { id: 'strong', label: 'Strong', minKnots: 1.5, color: '#0284c7', opacity: 1, chevrons: 2, bold: true },
  { id: 'extreme', label: 'Extreme', minKnots: 3, color: '#f59e0b', opacity: 1, chevrons: 2, bold: true },
];

/** The tier a speed falls in; negative or missing speeds read as light. */
export function currentTier(velocityKnots: number): CurrentTier {
  let tier = CURRENT_TIERS[0];
  for (const candidate of CURRENT_TIERS) {
    if (velocityKnots >= candidate.minKnots) tier = candidate;
  }
  return tier;
}

/** Where the numbers come from, shown in the chevron pop-up (SCRUM-99). */
export const CURRENT_SOURCE = 'Copernicus Marine (via Open-Meteo)';
