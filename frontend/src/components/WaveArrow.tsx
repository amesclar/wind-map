import L from 'leaflet';
import type { UnitSystem, WavePoint, WaveSeriesPoint } from '../types';
import { degreesToCardinal } from '../utils/units';
import { escapeHtml } from '../utils/html';
import { WAVE_SOURCE, WAVE_TIER_OUTLINE, formatWaveHeight, waveTier } from '../utils/waveTiers';

const ARROW_VIEWBOX = 40;
const CENTRE = ARROW_VIEWBOX / 2;

/**
 * Where the waves travel: the API's `wave_direction` is where they come **from**, so the glyph
 * rotates by direction + 180° (SCRUM-234).
 */
export function travelDirection(directionDeg: number): number {
  return (((directionDeg + 180) % 360) + 360) % 360;
}

/**
 * Distance between neighbouring lines, by line count (SCRUM-292). Four lines share one glyph, so
 * the spacing tightens as the count rises and the stroke, wave amplitude and head width tighten
 * with it; that keeps every rim clear of the next line at 28 px.
 */
const LINE_SPACING: Record<number, number> = { 1: 0, 2: 10, 3: 8.5, 4: 7.6 };

/** Wave amplitude by line count: the fuller the glyph, the shallower the S. */
const LINE_AMPLITUDE: Record<number, number> = { 1: 3.2, 2: 2.4, 3: 1.9, 4: 1.4 };

/** Stroke by line count, so a four-line glyph stays open instead of filling in at 28 px. */
const LINE_STROKE: Record<number, number> = { 1: 2.9, 2: 2.4, 3: 2.1, 4: 1.9 };

/** A single line has room for the widest head; crowded glyphs narrow it to keep a gap. */
const HEAD_HALF_WIDTH = 4;

/** Centres of the parallel lines, symmetric about 0 and perpendicular to the travel direction. */
export function lineOffsets(count: number): number[] {
  if (count <= 1) return [0];
  const spacing = LINE_SPACING[count] ?? LINE_SPACING[4];
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing);
}

/** One wavy shaft ending under one chevron head, both centred on `x`. */
function waveLinePaths(x: number, amplitude: number, headHalfWidth: number): string {
  const control = amplitude * 1.15;
  const shaft = `M ${x} 31 C ${x + control} 28.2 ${x + control} 25 ${x} 22.2 C ${x - control} 19.4 ${x - control} 16.2 ${x} 12.6`;
  const head = `M ${x - headHalfWidth} 12 L ${x} 5.5 L ${x + headHalfWidth} 12`;
  return `<path d="${shaft}" /><path d="${head}" />`;
}

const round = (value: number): number => Number(value.toFixed(2));

interface WaveGlyph {
  tier: ReturnType<typeof waveTier>;
  paths: string;
  strokeWidth: number;
  rimWidth: number;
  /** Horizontal bounds of the ink, in viewBox units, including half the widest stroke. */
  left: number;
  right: number;
}

/** One glyph's paths and the horizontal bounds of its ink, shared by the map glyph and the key. */
function waveGlyph(heightM: number): WaveGlyph {
  const tier = waveTier(heightM);
  const count = tier.lines;
  const spacing = LINE_SPACING[count] ?? LINE_SPACING[4];
  const strokeWidth = (LINE_STROKE[count] ?? 2) + (tier.bold ? 0.15 : 0);
  const headHalfWidth = count === 1 ? HEAD_HALF_WIDTH : Math.min(HEAD_HALF_WIDTH, spacing / 2 - 1.1);
  const offsets = lineOffsets(count);
  const paths = offsets
    .map((x) => waveLinePaths(x, LINE_AMPLITUDE[count] ?? 2, headHalfWidth))
    .join('');
  // One line has room for the full 2-unit rim; crowded glyphs take a thinner one so the rims of
  // neighbouring lines and heads cannot merge.
  const rimWidth = count === 1 ? 2 : 1.6;
  // Half the widest stroke, so the rim itself is inside the box rather than clipped.
  const pad = (strokeWidth + rimWidth) / 2;
  return {
    tier,
    paths,
    strokeWidth,
    rimWidth,
    left: (offsets[0] ?? 0) - headHalfWidth - pad,
    right: (offsets[offsets.length - 1] ?? 0) + headHalfWidth + pad,
  };
}

/**
 * SVG for one wave glyph (SCRUM-234, SCRUM-292): the swell drawn as counted wavy lines, each
 * ending in one chevron head, pointing where the waves travel.
 *
 * The line count is the height cue — one line at 0–1 m, two at 1–2 m, three at 2–4 m and four at
 * 4+ m — while the fill keeps the tier colour and the glyph keeps its size ramp. A wavy shaft
 * plus a head is deliberately different from an open current chevron (which counts heads and has
 * no shaft), so both layers can be on at once without being read for each other. Every path is
 * drawn twice: a dark rim underneath, then the opaque tier colour on top.
 */
export function generateWaveArrowSvg(
  heightM: number,
  directionDeg: number,
  size: number = waveTier(heightM).size,
): string {
  const glyph = waveGlyph(heightM);
  const rotation = `transform="rotate(${travelDirection(directionDeg)}, ${CENTRE}, ${CENTRE})" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const label = `${formatWaveHeight(heightM, 'metric')} waves from ${Math.round(directionDeg)}°`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${ARROW_VIEWBOX} ${ARROW_VIEWBOX}" role="img" aria-label="${escapeHtml(label)}" style="display:block;overflow:visible;">
    <g ${rotation} stroke="${WAVE_TIER_OUTLINE}" stroke-width="${glyph.strokeWidth + glyph.rimWidth}">${glyph.paths}</g><g ${rotation} stroke="${glyph.tier.color}" stroke-width="${glyph.strokeWidth}">${glyph.paths}</g>
  </svg>`;
}

/**
 * The map key's wave glyph (SCRUM-305): the same ink at the same scale, but with the viewBox and
 * width cropped to the glyph itself and no rotation, so the heads point up and the key value can
 * sit right against the symbol. In the square viewBox a one-line glyph left most of its box empty,
 * which is why its value floated away from the line while a four-line glyph hugged its own.
 */
export function generateWaveKeySvg(heightM: number, size: number = 20): string {
  const glyph = waveGlyph(heightM);
  const width = glyph.right - glyph.left;
  const scale = size / ARROW_VIEWBOX;
  const label = `${formatWaveHeight(heightM, 'metric')} waves`;
  return `<svg width="${round(width * scale)}" height="${size}" viewBox="${round(glyph.left)} 0 ${round(width)} ${ARROW_VIEWBOX}" role="img" aria-label="${escapeHtml(label)}" style="display:block;overflow:visible;">
    <g stroke="${WAVE_TIER_OUTLINE}" stroke-width="${glyph.strokeWidth + glyph.rimWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph.paths}</g><g stroke="${glyph.tier.color}" stroke-width="${glyph.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph.paths}</g>
  </svg>`;
}

/** Every arrow keeps at least this square of clickable area (SCRUM-263). */
export const WAVE_ARROW_MIN_HIT_PX = 32;

/**
 * Leaflet icon for a wave arrow; the data attributes make the tier and hit area testable.
 *
 * The smallest tier draws a 28 px glyph, so its icon box grows to the 32 px minimum and the glyph
 * is centred in it rather than stretched: the pointer target grows, the arrow does not.
 */
export function buildWaveArrowIcon(pt: WavePoint): L.DivIcon {
  const tier = waveTier(pt.height_m);
  const box = Math.max(tier.size, WAVE_ARROW_MIN_HIT_PX);
  return L.divIcon({
    className: 'wave-arrow-marker',
    html: `<div data-wave-arrow data-tier="${tier.id}" data-hit="${box}" style="width:${box}px;height:${box}px;line-height:0;cursor:pointer;display:flex;align-items:center;justify-content:center;">${generateWaveArrowSvg(pt.height_m, pt.direction_deg, tier.size)}</div>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
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
