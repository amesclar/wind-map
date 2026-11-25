import L from 'leaflet';
import type { CurrentPoint, WindSpeedUnit } from '../types';
import { CURRENT_SOURCE, CURRENT_TIER_OUTLINE, currentTier } from '../utils/currentTiers';
import { degreesToCardinal, formatKnotsInUnit } from '../utils/units';
import { escapeHtml } from '../utils/html';

const CHEVRON_VIEWBOX = 40;
const CENTRE = CHEVRON_VIEWBOX / 2;

/** A chevron pointing north (up) before rotation: an open V. */
function chevronPath(offsetY: number): string {
  return `M 11 ${20 + offsetY} L 20 ${10 + offsetY} L 29 ${20 + offsetY}`;
}

/**
 * SVG for one current glyph (SCRUM-99, SCRUM-237).
 *
 * The glyph points where the water flows (the API's direction is already "towards"), with one
 * chevron for light water and two for everything stronger; strong and extreme also get a heavier
 * stroke. Every glyph is drawn twice: a dark rim underneath (`CURRENT_TIER_OUTLINE`), then the
 * opaque tier colour on top, so it stays visible on light bases and over the wind gradient.
 */
export function generateCurrentChevronSvg(
  velocityKnots: number,
  directionDeg: number,
  size: number = 28,
): string {
  const tier = currentTier(velocityKnots);
  const strokeWidth = tier.bold ? 4.5 : 3;
  const paths = [chevronPath(0), ...(tier.chevrons === 2 ? [chevronPath(-8)] : [])]
    .map((d) => `<path d="${d}" />`)
    .join('');
  const rotation = `transform="rotate(${directionDeg}, ${CENTRE}, ${CENTRE})" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const label = `${formatKnotsInUnit(velocityKnots, 'knots')} current toward ${Math.round(directionDeg)}°`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${CHEVRON_VIEWBOX} ${CHEVRON_VIEWBOX}" role="img" aria-label="${escapeHtml(label)}" style="display:block;overflow:visible;">
    <g ${rotation} stroke="${CURRENT_TIER_OUTLINE}" stroke-width="${strokeWidth + 2}">${paths}</g><g ${rotation} stroke="${tier.color}" stroke-width="${strokeWidth}">${paths}</g>
  </svg>`;
}

export const CURRENT_CHEVRON_SIZE = 28;

/** Leaflet icon for a current chevron; the data attributes make the tier testable. */
export function buildCurrentChevronIcon(pt: CurrentPoint, size: number = CURRENT_CHEVRON_SIZE): L.DivIcon {
  const tier = currentTier(pt.velocity_knots);
  return L.divIcon({
    className: 'water-current-marker',
    html: `<div data-current-chevron data-tier="${tier.id}" style="line-height:0;cursor:pointer;">${generateCurrentChevronSvg(pt.velocity_knots, pt.direction_deg, size)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Pop-up for a clicked chevron (SCRUM-99): speed in the user's unit, the direction the water
 * flows towards, the source and the selected hour. No request is made to open it.
 */
export function buildCurrentPopup(
  pt: CurrentPoint,
  speedUnit: WindSpeedUnit = 'knots',
  timeLabel: string | null = null,
): string {
  const speed = formatKnotsInUnit(pt.velocity_knots, speedUnit);
  const direction = `${degreesToCardinal(pt.direction_deg)} (${Math.round(pt.direction_deg)}°)`;
  return `
    <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
      <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">Water current</div>
      <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">${pt.latitude.toFixed(2)}°, ${pt.longitude.toFixed(2)}°</div>
      <div style="display: flex; gap: 8px; font-weight: 600;">
        <span style="color: #38bdf8;">🌊 ${escapeHtml(speed)}</span>
      </div>
      <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px;">🧭 ${escapeHtml(direction)} toward</div>
      <div style="margin-top: 2px; color: #6b7280; font-size: 10px;">${escapeHtml(CURRENT_SOURCE)}</div>
      ${timeLabel ? `<div style="margin-top: 2px; color: #9ca3af; font-size: 11px;">🕒 ${escapeHtml(timeLabel)}</div>` : ''}
    </div>
  `;
}
