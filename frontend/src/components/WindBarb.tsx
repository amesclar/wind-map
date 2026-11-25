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

export interface WindBarbOptions {
  speedKnots: number;
  directionDeg: number;
  tempF: number;
  size?: number;
  showLabel?: boolean;
  colorOverride?: string;
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
  } = options;

  const color = colorOverride ?? getTemperatureColor(tempF);
  const { calm, pennants, fullBarbs, halfBarbs } = barbFeatures(speedKnots);

  // Calm conditions (< 2 knots)
  if (calm) {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
        <circle cx="25" cy="25" r="9" stroke="${color}" stroke-width="2.5" fill="none"/>
        <circle cx="25" cy="25" r="4" fill="${color}"/>
        ${
          showLabel
            ? `<text x="25" y="44" fill="#f3f4f6" font-size="9" font-family="monospace" text-anchor="middle" font-weight="bold">${Math.round(
                tempF
              )}°</text>`
            : ''
        }
      </svg>
    `;
  }

  // Build feather SVG paths along staff
  // Staff runs from (25, 25) base to (25, 6) top in local coordinates
  let featherPaths = '';
  let yPos = 6;

  // Pennants (triangles)
  for (let i = 0; i < pennants; i++) {
    featherPaths += `<polygon points="25,${yPos} 37,${yPos + 4} 25,${yPos + 8}" fill="${color}" stroke="${color}" stroke-width="1"/>`;
    yPos += 8;
  }

  // Full barbs (lines)
  for (let i = 0; i < fullBarbs; i++) {
    featherPaths += `<line x1="25" y1="${yPos}" x2="37" y2="${yPos - 4}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
    yPos += 5;
  }

  // Half barbs (shorter line)
  if (halfBarbs > 0) {
    featherPaths += `<line x1="25" y1="${yPos}" x2="31" y2="${yPos - 2}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
  }

  // Staff and center circle
  const barbContent = `
    <g transform="rotate(${directionDeg}, 25, 25)">
      <line x1="25" y1="25" x2="25" y2="6" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
      ${featherPaths}
      <circle cx="25" cy="25" r="3.5" fill="${color}" stroke="#0d1117" stroke-width="1"/>
    </g>
  `;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
      ${barbContent}
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
