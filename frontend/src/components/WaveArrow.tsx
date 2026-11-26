import L from 'leaflet';
import type { UnitSystem, WavePoint, WaveSeriesPoint } from '../types';
import { degreesToCardinal } from '../utils/units';
import { escapeHtml } from '../utils/html';
import { WAVE_SOURCE, WAVE_TIER_OUTLINE, formatWaveHeight, waveTier } from '../utils/waveTiers';

const ARROW_VIEWBOX = 40;
const CENTRE = ARROW_VIEWBOX / 2;

/**
 * Where the waves travel: the API's `wave_direction` is where they come **from**, so an arrow
 * rotates by direction + 180° (SCRUM-234).
 */
export function travelDirection(directionDeg: number): number {
  return (((directionDeg + 180) % 360) + 360) % 360;
}

/**
 * SVG for one wave glyph (SCRUM-234): an arrow pointing where the waves travel, sized and
 * coloured by height tier and drawn over a dark rim so it stays visible on light bases and over
 * the wind gradient. The arrow is a line with a head, deliberately unlike the current chevrons,
 * so both layers can be on at once.
 */
export function generateWaveArrowSvg(
  heightM: number,
  directionDeg: number,
  size: number = waveTier(heightM).size,
): string {
  const tier = waveTier(heightM);
  const strokeWidth = tier.bold ? 2.75 : 2;
  const rotation = `transform="rotate(${travelDirection(directionDeg)}, ${CENTRE}, ${CENTRE})" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const shaft = 'M 20 31 L 20 12';
  const head = 'M 13 18 L 20 9 L 27 18';
  const label = `${formatWaveHeight(heightM, 'metric')} waves from ${Math.round(directionDeg)}°`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}" role="img" aria-label="${escapeHtml(label)}" style="display:block;overflow:visible;">
    <g ${rotation} stroke="${WAVE_TIER_OUTLINE}" stroke-width="${strokeWidth + 2}"><path d="${shaft}" /><path d="${head}" /></g><g ${rotation} stroke="${tier.color}" stroke-width="${strokeWidth}"><path d="${shaft}" /><path d="${head}" /></g>
  </svg>`;
}

/** Leaflet icon for a wave arrow; the data attributes make the tier and size testable. */
export function buildWaveArrowIcon(pt: WavePoint): L.DivIcon {
  const tier = waveTier(pt.height_m);
  return L.divIcon({
    className: 'wave-arrow-marker',
    html: `<div data-wave-arrow data-tier="${tier.id}" style="line-height:0;cursor:pointer;">${generateWaveArrowSvg(pt.height_m, pt.direction_deg, tier.size)}</div>`,
    iconSize: [tier.size, tier.size],
    iconAnchor: [tier.size / 2, tier.size / 2],
  });
}

function seriesRow(row: WaveSeriesPoint, unitSystem: UnitSystem): string {
  const time = row.time.length >= 16 ? `${row.time.slice(5, 10)} ${row.time.slice(11, 16)}` : row.time;
  const direction = degreesToCardinal(row.direction_deg);
  return `<div style="display:flex;justify-content:space-between;gap:6px;color:#d1d5db;">
    <span style="width:5.2em;">${escapeHtml(time)}</span>
    <span style="width:4.2em;text-align:right;color:#7dd3fc;">${escapeHtml(formatWaveHeight(row.height_m, unitSystem))}</span>
    <span style="width:2.8em;text-align:right;">${row.period_s.toFixed(0)} s</span>
    <span style="width:3.6em;text-align:right;">${escapeHtml(direction)}</span>
  </div>`;
}

/** The next-48-hours table body, or a plain explanation when there is nothing to show. */
export function buildWaveSeriesHtml(
  series: WaveSeriesPoint[] | null,
  unitSystem: UnitSystem,
  failed = false,
): string {
  if (failed) {
    return `<div data-wave-series style="color:#9ca3af;">Hourly wave data unavailable.</div>`;
  }
  if (series === null) {
    return `<div data-wave-series style="color:#9ca3af;">Loading the next 48 h…</div>`;
  }
  if (series.length === 0) {
    return `<div data-wave-series style="color:#9ca3af;">No hourly wave data for this point.</div>`;
  }
  return `<div data-wave-series data-wave-count="${series.length}" style="max-height:150px;overflow-y:auto;margin-top:4px;border-top:1px solid #374151;padding-top:4px;">
    <div style="display:flex;justify-content:space-between;gap:6px;color:#6b7280;font-size:10px;position:sticky;top:0;background:#1f2937;">
      <span style="width:5.2em;">Hour</span><span style="width:4.2em;text-align:right;">Height</span><span style="width:2.8em;text-align:right;">Period</span><span style="width:3.6em;text-align:right;">From</span>
    </div>
    ${series.map((row) => seriesRow(row, unitSystem)).join('')}
  </div>`;
}

/**
 * Pop-up for a clicked wave arrow (SCRUM-234): height in the user's unit, period, the direction
 * the waves come from and the selected hour, then the next 48 hours from `/api/waves/point`.
 * `series` is null until the overlay's request lands, so the first paint explains the wait.
 */
export function buildWavePopup(
  pt: WavePoint,
  unitSystem: UnitSystem = 'imperial',
  timeLabel: string | null = null,
  series: WaveSeriesPoint[] | null = null,
  failed = false,
): string {
  const height = formatWaveHeight(pt.height_m, unitSystem);
  const direction = `${degreesToCardinal(pt.direction_deg)} (${Math.round(pt.direction_deg)}°) from`;
  return `
    <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
      <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">Waves</div>
      <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">${pt.latitude.toFixed(2)}°, ${pt.longitude.toFixed(2)}°</div>
      <div style="display: flex; gap: 8px; font-weight: 600;">
        <span style="color: #38bdf8;">🌊 ${escapeHtml(height)}</span>
        <span style="color: #e5e7eb;">⏱️ ${pt.period_s.toFixed(0)} s</span>
      </div>
      <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px;">🧭 ${escapeHtml(direction)}</div>
      <div style="margin-top: 2px; color: #6b7280; font-size: 10px;">${escapeHtml(WAVE_SOURCE)}</div>
      ${timeLabel ? `<div style="margin-top: 2px; color: #9ca3af; font-size: 11px;">🕒 ${escapeHtml(timeLabel)}</div>` : ''}
      <div style="margin-top: 5px; font-size: 10px; color: #9ca3af;">Next 48 h</div>
      ${buildWaveSeriesHtml(series, unitSystem, failed)}
    </div>
  `;
}
