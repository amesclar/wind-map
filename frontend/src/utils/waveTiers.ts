/**
 * Ocean-wave height tiers (SCRUM-234), shared by the wave glyph, the legend and the export credit.
 *
 * The API serves significant wave height in metres; the imperial display converts to feet. The
 * direction it serves is where the waves come **from** (meteorological, like wind), so the arrow
 * adds 180° to point where they travel.
 */
import type { UnitSystem } from '../types';

export type WaveTierId = 'calm' | 'moderate' | 'rough' | 'high';

export interface WaveTier {
  id: WaveTierId;
  /** Human label, e.g. "1–2 m". */
  label: string;
  /** Inclusive lower bound in metres; the tier runs up to the next tier's `minMetres`. */
  minMetres: number;
  color: string;
  /** Parallel wavy lines in the glyph: the height cue (SCRUM-292). */
  lines: number;
  /** Glyph size in px; rougher water draws larger. */
  size: number;
  /** Heavier stroke for the top tiers. */
  bold: boolean;
}

/**
 * Dark rim under every arrow, like the current chevrons' `CURRENT_TIER_OUTLINE`: the fill carries
 * the tier and the rim carries the contrast on light bases and over the wind gradient.
 */
export const WAVE_TIER_OUTLINE = '#0b1220';

// Sizes grew in SCRUM-263 (they were 20/24/28/32): at the old size a 2–4 m arrow read as a speck
// beside a wind barb, and the tier is easier to tell apart from the swell it sits on.
export const WAVE_TIERS: readonly WaveTier[] = [
  { id: 'calm', label: '0–1 m', minMetres: 0, color: '#93c5fd', lines: 1, size: 28, bold: false },
  { id: 'moderate', label: '1–2 m', minMetres: 1, color: '#38bdf8', lines: 2, size: 34, bold: false },
  { id: 'rough', label: '2–4 m', minMetres: 2, color: '#f59e0b', lines: 3, size: 40, bold: true },
  { id: 'high', label: '4+ m', minMetres: 4, color: '#ef4444', lines: 4, size: 46, bold: true },
];

const METRIC_LABELS = ['0–1 m', '1–2 m', '2–4 m', '4+ m'];
const IMPERIAL_LABELS = ['0–3 ft', '3–6 ft', '6–13 ft', '13+ ft'];

/** The tier a height falls in; a missing or negative height reads as the lightest tier. */
export function waveTier(heightM: number): WaveTier {
  let tier = WAVE_TIERS[0];
  for (const candidate of WAVE_TIERS) {
    if (heightM >= candidate.minMetres) tier = candidate;
  }
  return tier;
}

/** The tier's range for the legend, in the user's unit system (SCRUM-234). */
export function waveRangeLabel(tier: WaveTier, unitSystem: UnitSystem): string {
  const labels = unitSystem === 'imperial' ? IMPERIAL_LABELS : METRIC_LABELS;
  return labels[WAVE_TIERS.indexOf(tier)] ?? tier.label;
}

/** A height in the user's unit, e.g. "5.2 ft" or "1.6 m". */
export function formatWaveHeight(heightM: number, unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? `${(heightM * 3.28084).toFixed(1)} ft` : `${heightM.toFixed(1)} m`;
}

/** Where the numbers come from, shown in the arrow pop-up and the export footer (SCRUM-234). */
export const WAVE_SOURCE = 'Copernicus Marine (via Open-Meteo)';
export const WAVE_ATTRIBUTION_TEXT = `Wave data: ${WAVE_SOURCE}`;
