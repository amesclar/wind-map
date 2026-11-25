import React from 'react';
import { barbFeatures } from '../utils/windBarb';

/**
 * Returns temperature color code based on Fahrenheit temperature.
 */
export function getTemperatureColor(tempF: number): string {
  if (tempF <= 32) return '#60a5fa'; // Ice blue
  if (tempF <= 50) return '#2dd4bf'; // Teal
  if (tempF <= 68) return '#4ade80'; // Fresh green
  if (tempF <= 80) return '#fbbf24'; // Warm amber
  if (tempF <= 90) return '#fb923c'; // Orange
  return '#ef4444'; // Red
}

/**
 * Chart variant of the temperature colour (SCRUM-216): same hue families as `getTemperatureColor`,
 * stepped darker because the grid barbs sit on white chart water. Each `contrast` was measured on
 * #ffffff with the WCAG relative-luminance formula at 40 px, where all six now clear 3:1.
 *
 * Luminance also falls as temperature rises (0.260 → 0.075), so the bands stay ordered when hue is
 * lost: under the Viénot 1999 deuteranopia simulation the bands run 0.428, 0.384, 0.342, 0.280,
 * 0.234, 0.179 — every neighbouring pair at least 0.043 apart. Keep these numbers in step with the
 * table; the tests compare the recorded contrast against the computed one.
 */
export const CHART_TEMPERATURE_BANDS = [
  { maxF: 32, color: '#528be6', contrast: 3.39 }, // ice blue
  { maxF: 50, color: '#1a9286', contrast: 3.82 }, // teal
  { maxF: 68, color: '#198c43', contrast: 4.31 }, // green
  { maxF: 80, color: '#8f5c14', contrast: 5.66 }, // amber
  { maxF: 90, color: '#9d3d0d', contrast: 6.76 }, // orange
  { maxF: Infinity, color: '#9a1611', contrast: 8.41 }, // red
] as const;

/** The darker ramp used by grid barbs on the paper chart only (SCRUM-216). */
export function getChartTemperatureColor(tempF: number): string {
  return CHART_TEMPERATURE_BANDS.find((band) => tempF <= band.maxF)!.color;
}

export interface WindBarbOutline {
  /** Stroke colour of this pass. */
  color: string;
  /** How far the pass reaches past the glyph, in viewBox units of the 50×50 box. */
  width: number;
}

export interface WindBarbOptions {
  speedKnots: number;
  directionDeg: number;
  tempF: number;
  size?: number;
  showLabel?: boolean;
  colorOverride?: string;
  /**
   * Which temperature table to use (SCRUM-216). `chart` is the darker ramp, drawn on the light
   * chart sheet; everything else keeps the original table.
   */
  colorScheme?: 'standard' | 'chart';
  /**
   * Outline passes drawn behind the glyph, outermost first (SCRUM-208). They are real geometry, not
   * a CSS glow: at 32 px a blurred `drop-shadow` turns the barb into a smudge, while a stroked
   * pass keeps a defined edge.
   */
  outlines?: WindBarbOutline[];
}

const round = (value: number): number => Number(value.toFixed(2));

/** One rendering of the glyph; `grow` pushes every stroke out by that much on each side. */
function barbMarkup(
  color: string,
  grow: number,
  shape: ReturnType<typeof barbFeatures>,
  directionDeg: number,
): string {
  const { calm, pennants, fullBarbs, halfBarbs } = shape;

  // Calm conditions (< 2 knots)
  if (calm) {
    return `
        <circle cx="25" cy="25" r="${round(9 + grow)}" stroke="${color}" stroke-width="${round(
          2.5 + grow * 2,
        )}" fill="none"/>
        <circle cx="25" cy="25" r="${round(4 + grow)}" fill="${color}"/>`;
  }

  // Staff runs from (25, 25) base to (25, 6) top in local coordinates; feathers stack below the top.
  const strokeWidth = round(2.5 + grow * 2);
  let featherPaths = '';
  let yPos = 6;

  // Pennants (triangles)
  for (let i = 0; i < pennants; i++) {
    featherPaths += `<polygon points="25,${yPos} 37,${yPos + 4} 25,${yPos + 8}" fill="${color}" stroke="${color}" stroke-width="${round(
      1 + grow * 2,
    )}" stroke-linejoin="round"/>`;
    yPos += 8;
  }

  // Full barbs (lines)
  for (let i = 0; i < fullBarbs; i++) {
    featherPaths += `<line x1="25" y1="${yPos}" x2="37" y2="${yPos - 4}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
    yPos += 5;
  }

  // Half barbs (shorter line)
  if (halfBarbs > 0) {
    featherPaths += `<line x1="25" y1="${yPos}" x2="31" y2="${yPos - 2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
  }

  // An outline pass must be solid too, or the glyph's dark centre dot punches a hole in it.
  const centreRim =
    grow > 0
      ? `stroke="${color}" stroke-width="${round(1 + grow * 2)}"`
      : 'stroke="#0d1117" stroke-width="1"';

  return `
    <g transform="rotate(${directionDeg}, 25, 25)">
      <line x1="25" y1="25" x2="25" y2="6" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
      ${featherPaths}
      <circle cx="25" cy="25" r="${round(3.5 + grow)}" fill="${color}" ${centreRim}/>
    </g>
  `;
}

/**
 * Generates an SVG string representation of a meteorological wind barb.
 * Direction is in degrees (0 = North, 90 = East, etc.)
 * Speed is in knots.
 */
export function generateWindBarbSvg(options: WindBarbOptions): string {
  const {
    speedKnots,
    directionDeg,
    tempF,
    size = 44,
    showLabel = true,
    colorOverride,
    colorScheme = 'standard',
    outlines = [],
  } = options;

  const color =
    colorOverride ??
    (colorScheme === 'chart' ? getChartTemperatureColor(tempF) : getTemperatureColor(tempF));
  const shape = barbFeatures(speedKnots);

  // Outlines first so the temperature-coloured glyph paints on top of them.
  const passes = [
    ...outlines.map((outline) => ({ color: outline.color, grow: outline.width, outline: true })),
    { color, grow: 0, outline: false },
  ]
    .map(
      (pass) =>
        `<g${pass.outline ? ' data-barb-outline="true"' : ''}>${barbMarkup(
          pass.color,
          pass.grow,
          shape,
          directionDeg,
        )}</g>`,
    )
    .join('');

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
      ${passes}
      ${
        showLabel
          ? `<rect x="10" y="36" width="30" height="13" rx="3" fill="#161b22" opacity="0.85" />
             <text x="25" y="46" fill="#f3f4f6" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle">${Math.round(
               tempF
             )}°</text>`
          : ''
      }
    </svg>
  `;
}

export interface WindBarbProps {
  speedKnots: number;
  directionDeg: number;
  tempF: number;
  size?: number;
  showLabel?: boolean;
}

export const WindBarb: React.FC<WindBarbProps> = ({
  speedKnots,
  directionDeg,
  tempF,
  size = 44,
  showLabel = false,
}) => {
  const svgHtml = generateWindBarbSvg({ speedKnots, directionDeg, tempF, size, showLabel });
  return (
    <div
      className="inline-flex items-center justify-center"
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
};
