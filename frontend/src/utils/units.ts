/** Display formatting for forecast values (SCRUM-92). Used by the map and barb popups. */
import type { UnitSystem, WeatherForecastPoint, WindSpeedUnit } from '../types';

export const SPEED_UNIT_LABEL: Record<WindSpeedUnit, string> = {
  knots: 'kt',
  kmh: 'km/h',
  mph: 'mph',
  ms: 'm/s',
};

type SpeedPoint = Pick<
  WeatherForecastPoint,
  `wind_${'speed' | 'gust'}_${WindSpeedUnit}`
>;

/** Wind speed or gust in the chosen unit, e.g. "14 kt" or "25.9 km/h". */
export function formatSpeed(pt: SpeedPoint, kind: 'speed' | 'gust', unit: WindSpeedUnit): string {
  return `${pt[`wind_${kind}_${unit}`]} ${SPEED_UNIT_LABEL[unit]}`;
}

/** Knots per one unit of each display unit (1 kt = 1.852 km/h = 1.15078 mph = 0.514444 m/s). */
const KNOTS_PER_UNIT: Record<WindSpeedUnit, number> = { knots: 1, kmh: 1.852, mph: 1.15078, ms: 0.514444 };

/** A speed in knots converted to the display unit (SCRUM-124). */
export function knotsToUnit(knots: number, unit: WindSpeedUnit): number {
  return knots * KNOTS_PER_UNIT[unit];
}

/** Knots converted and rounded, matching the whole-number legend ticks (SCRUM-124). */
export function roundKnotsInUnit(knots: number, unit: WindSpeedUnit): number {
  return Math.round(knotsToUnit(knots, unit));
}

/**
 * A knot value converted for display, e.g. "12.8 kt" or "14 kt" (SCRUM-126). Grid barbs carry
 * only knots, unlike a full forecast point which already has every unit.
 */
export function formatKnotsInUnit(knots: number, unit: WindSpeedUnit): string {
  return `${Number(knotsToUnit(knots, unit).toFixed(1))} ${SPEED_UNIT_LABEL[unit]}`;
}

/** Temperature rounded to a whole degree, e.g. "54°F" or "12°C". */
export function formatTemperature(
  pt: Pick<WeatherForecastPoint, 'temperature_f' | 'temperature_c'>,
  system: UnitSystem,
): string {
  return system === 'imperial' ? `${Math.round(pt.temperature_f)}°F` : `${Math.round(pt.temperature_c)}°C`;
}

/** Temperature from a source that only carries °F, e.g. "54°F" or "12°C" (SCRUM-126). */
export function formatTemperatureFromF(tempF: number, system: UnitSystem): string {
  return system === 'imperial' ? `${Math.round(tempF)}°F` : `${Math.round(((tempF - 32) * 5) / 9)}°C`;
}

const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** 16-point cardinal for a direction in degrees, e.g. "SW" for 220° (SCRUM-126). */
export function degreesToCardinal(deg: number): string {
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Wind direction in whole degrees true, normalized to 0–359, e.g. "220°T". */
export function formatDegreesTrue(deg: number): string {
  const rounded = Math.round(((deg % 360) + 360) % 360);
  return `${rounded >= 360 ? 0 : rounded}°T`;
}

/** Cardinal plus degrees, e.g. "SW (220°)". */
export function formatDirection(pt: Pick<WeatherForecastPoint, 'wind_direction_cardinal' | 'wind_direction_deg'>): string {
  return `${pt.wind_direction_cardinal} (${Math.round(pt.wind_direction_deg)}°)`;
}
