/**
 * WindChevron — compact wind direction indicator for the grid overlay.
 *
 * Speed is encoded as the number of chevron stripes:
 *   calm   < 2 kt  → filled dot, no direction
 *   light  2–9 kt  → 1 chevron
 *   mod   10–19 kt → 2 chevrons
 *   fresh 20–33 kt → 3 chevrons
 *   strong ≥ 34 kt → 3 chevrons + filled arrowhead
 *
 * Direction is the meteorological convention (0° = from North).
 * Color transitions from cool blue (calm) through green → amber → red (strong).
 */

export type SpeedTier = 'calm' | 'light' | 'moderate' | 'fresh' | 'strong';

export function getSpeedTier(knots: number): SpeedTier {
  if (knots < 2) return 'calm';
  if (knots < 10) return 'light';
  if (knots < 20) return 'moderate';
  if (knots < 34) return 'fresh';
  return 'strong';
}

export function getChevronColor(tier: SpeedTier): string {
  switch (tier) {
    case 'calm':     return '#60a5fa'; // blue-400
    case 'light':    return '#34d399'; // emerald-400
    case 'moderate': return '#fbbf24'; // amber-400
    case 'fresh':    return '#f97316'; // orange-500
    case 'strong':   return '#ef4444'; // red-500
  }
}

/**
 * Returns an SVG string for a wind chevron icon.
 * @param speedKnots     Wind speed in knots
 * @param directionDeg   Meteorological wind direction (degrees from North, clockwise)
 * @param size           Overall SVG size in pixels (default 28)
 */
export function generateWindChevronSvg(
  speedKnots: number,
  directionDeg: number,
  size: number = 28,
): string {
  const tier = getSpeedTier(speedKnots);
  const color = getChevronColor(tier);

  // Calm: just a small dot
  if (tier === 'calm') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="3" fill="${color}" opacity="0.7"/>
    </svg>`;
  }

  const chevronCount = tier === 'light' ? 1 : tier === 'moderate' ? 2 : 3;
  const hasArrowhead = tier === 'strong';

  // Chevron geometry — drawn pointing "up" (toward 0°), then rotated.
  // Each chevron is a V-shape stacked vertically, tip at top.
  // Rotation: directionDeg rotates the whole group around the centre.
  const cx = 14;
  const cy = 14;

  const halfW = 6;   // half-width of the V
  const chevH = 4;   // height of one V
  const gap = 3.5;   // vertical spacing between V tips
  const totalH = (chevronCount - 1) * gap + chevH;

  const startY = cy - totalH / 2;

  let paths = '';
  for (let i = 0; i < chevronCount; i++) {
    const tipY = startY + i * gap;
    const baseY = tipY + chevH;
    paths += `<polyline
      points="${cx - halfW},${baseY} ${cx},${tipY} ${cx + halfW},${baseY}"
      fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    />`;
  }

  let arrowhead = '';
  if (hasArrowhead) {
    const arrowTipY = startY + chevronCount * gap + 1.5;
    const arrowBaseY = arrowTipY + 4;
    const arrowHalfW = 4;
    arrowhead = `<polygon
      points="${cx},${arrowTipY} ${cx - arrowHalfW},${arrowBaseY} ${cx + arrowHalfW},${arrowBaseY}"
      fill="${color}" opacity="0.9"
    />`;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${directionDeg}, ${cx}, ${cy})">
      ${paths}
      ${arrowhead}
    </g>
  </svg>`;
}

/**
 * Returns an SVG string for the selected-chevron state: a diamond shape
 * in the tier color, indicating the active grid point in the drawer.
 * @param speedKnots   Wind speed in knots (determines color)
 * @param size         Overall SVG size in pixels (default 28)
 */
export function generateSelectedChevronSvg(
  speedKnots: number,
  size: number = 28,
): string {
  const tier = getSpeedTier(speedKnots);
  const color = getChevronColor(tier);
  const cx = 14;
  const cy = 14;
  const half = 7; // half-width/height of the diamond

  // Diamond: top, right, bottom, left points
  return `<svg width="${size}" height="${size}" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <polygon
      points="${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}"
      fill="${color}"
      opacity="0.9"
      stroke="white"
      stroke-width="1.5"
    />
  </svg>`;
}
