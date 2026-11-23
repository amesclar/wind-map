/**
 * Wind speed color scale and grid interpolation (SCRUM-123).
 *
 * Stops were sampled from the reference legend attached to SCRUM-121; between stops the
 * blend is linear (blue to green passes through teal at 7.5 kt, as the legend does).
 */

export interface WindColorStop {
  /** Wind speed in knots. */
  knots: number;
  /** Six-digit hex color. */
  hex: string;
}

/** Single source of truth for the overlay and the legend (SCRUM-124). */
export const COLOR_STOPS: ReadonlyArray<WindColorStop> = [
  { knots: 0, hex: '#9f01c8' },
  { knots: 5, hex: '#3233fa' },
  { knots: 10, hex: '#36c624' },
  { knots: 15, hex: '#ddda07' },
  { knots: 20, hex: '#ff7e00' },
  { knots: 25, hex: '#fe0100' },
  { knots: 40, hex: '#640100' },
  { knots: 45, hex: '#330101' },
  { knots: 50, hex: '#646464' },
];

/** The scale ends here: slower is the first stop, faster is the last (50+ is gray). */
export const MAX_WIND_KNOTS = 50;

export type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

/** Lookup step in knots; drawing reads the table instead of blending per pixel. */
const LUT_STEP = 0.25;
const LUT_SIZE = Math.round(MAX_WIND_KNOTS / LUT_STEP) + 1;

const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * t),
  Math.round(from[1] + (to[1] - from[1]) * t),
  Math.round(from[2] + (to[2] - from[2]) * t),
];

/** Straight linear blend between the two stops around `knots`, clamped to the scale. */
export function blendWindColor(knots: number): Rgb {
  const clamped = Math.min(Math.max(knots, 0), MAX_WIND_KNOTS);
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const prev = COLOR_STOPS[i - 1];
    const next = COLOR_STOPS[i];
    if (clamped <= next.knots) {
      const t = (clamped - prev.knots) / (next.knots - prev.knots);
      return mix(hexToRgb(prev.hex), hexToRgb(next.hex), t);
    }
  }
  return hexToRgb(COLOR_STOPS[COLOR_STOPS.length - 1].hex);
}

const LUT: Uint8Array = (() => {
  const table = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = blendWindColor(i * LUT_STEP);
    table.set([r, g, b, 255], i * 4);
  }
  return table;
})();

/** Color for a speed in knots; a NaN or missing speed is transparent. */
export function windSpeedToColor(knots: number): Rgba {
  if (!Number.isFinite(knots)) return [0, 0, 0, 0];
  const index = Math.round(Math.min(Math.max(knots, 0), MAX_WIND_KNOTS) / LUT_STEP);
  const o = index * 4;
  return [LUT[o], LUT[o + 1], LUT[o + 2], LUT[o + 3]];
}

/** CSS gradient for the same stops, so the legend can never drift from the overlay. */
export function windColorCssGradient(): string {
  const stops = COLOR_STOPS.map(({ knots, hex }) => `${hex} ${(knots / MAX_WIND_KNOTS) * 100}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export interface WindGrid {
  /** Distinct latitudes, ascending. */
  lats: number[];
  /** Distinct longitudes, ascending. */
  lons: number[];
  /** Speeds by [latIndex][lonIndex]; null where a point has no value. */
  speeds: (number | null)[][];
}

const uniqueSorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** Build the regular grid from API points; null unless it is at least 2 by 2. */
export function buildWindGrid(
  points: ReadonlyArray<{ latitude: number; longitude: number; wind_speed_knots: number }>,
): WindGrid | null {
  if (points.length < 4) return null;
  const lats = uniqueSorted(points.map((p) => p.latitude));
  const lons = uniqueSorted(points.map((p) => p.longitude));
  if (lats.length < 2 || lons.length < 2) return null;

  const latIndex = new Map(lats.map((value, i) => [value, i]));
  const lonIndex = new Map(lons.map((value, i) => [value, i]));
  const speeds: (number | null)[][] = lats.map(() => new Array<number | null>(lons.length).fill(null));
  for (const point of points) {
    const y = latIndex.get(point.latitude);
    const x = lonIndex.get(point.longitude);
    if (y === undefined || x === undefined) continue;
    speeds[y][x] = Number.isFinite(point.wind_speed_knots) ? point.wind_speed_knots : null;
  }
  return { lats, lons, speeds };
}

/** Index of the lower bound plus the fraction between the two, or null when outside. */
function bracket(values: number[], value: number): [number, number] | null {
  if (values.length < 2 || value < values[0] || value > values[values.length - 1]) return null;
  for (let i = 1; i < values.length; i++) {
    if (value <= values[i]) {
      const lo = values[i - 1];
      const hi = values[i];
      return [i - 1, hi === lo ? 0 : (value - lo) / (hi - lo)];
    }
  }
  return null;
}

/**
 * Bilinear wind speed (knots) at a coordinate. Null outside the grid, or when any of the
 * four surrounding points has no value.
 */
export function interpolateWindSpeed(grid: WindGrid | null, lat: number, lon: number): number | null {
  if (!grid) return null;
  const yb = bracket(grid.lats, lat);
  const xb = bracket(grid.lons, lon);
  if (!yb || !xb) return null;

  const [y0, fy] = yb;
  const [x0, fx] = xb;
  const v00 = grid.speeds[y0][x0];
  const v01 = grid.speeds[y0][x0 + 1];
  const v10 = grid.speeds[y0 + 1][x0];
  const v11 = grid.speeds[y0 + 1][x0 + 1];
  if (v00 === null || v01 === null || v10 === null || v11 === null) return null;

  const top = v00 + (v01 - v00) * fx;
  const bottom = v10 + (v11 - v10) * fx;
  return top + (bottom - top) * fy;
}
