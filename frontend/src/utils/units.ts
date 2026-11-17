/** Display formatting for forecast values (SCRUM-92). Used by the drawer and map popups. */
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

/** Temperature rounded to a whole degree, e.g. "54°F" or "12°C". */
export function formatTemperature(
  pt: Pick<WeatherForecastPoint, 'temperature_f' | 'temperature_c'>,
  system: UnitSystem,
): string {
  return system === 'imperial' ? `${Math.round(pt.temperature_f)}°F` : `${Math.round(pt.temperature_c)}°C`;
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

/**
 * Forecast slice label such as "Mon 9 PM". Open-Meteo returns local wall-clock times
 * without an offset ("2026-11-16T21:00") in the requested timezone; parsing and
 * formatting both in the browser's zone keeps that wall-clock time.
 */
export function formatSliceTime(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time;
  return date.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', hour12: true });
}
