/**
 * Wind barb geometry shared by the map barbs and the image legend (SCRUM-116).
 *
 * Feather counts follow the meteorological convention the SVG uses: a pennant for every 50 kt,
 * a full barb for every 10, a half barb for the remaining 5 or more, and a circle when calm.
 */
export interface BarbFeatures {
  /** Speed rounded to whole knots, as drawn. */
  rounded: number;
  /** Below 2 kt the barb is a calm circle. */
  calm: boolean;
  pennants: number;
  fullBarbs: number;
  halfBarbs: number;
}

export function barbFeatures(speedKnots: number): BarbFeatures {
  const rounded = Math.round(speedKnots);
  if (rounded < 2) {
    return { rounded, calm: true, pennants: 0, fullBarbs: 0, halfBarbs: 0 };
  }
  let remaining = rounded;
  const pennants = Math.floor(remaining / 50);
  remaining %= 50;
  const fullBarbs = Math.floor(remaining / 10);
  remaining %= 10;
  const halfBarbs = remaining >= 3 ? 1 : 0;
  return { rounded, calm: false, pennants, fullBarbs, halfBarbs };
}
