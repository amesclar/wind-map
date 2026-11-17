/** Shared test data builders (SCRUM-92 phase 2). */
import type { SavedLocation, WeatherForecastPoint, WeatherForecastResponse } from '../types';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One forecast slice. `index` sets the time (index * 3 hours) and the unit fields are
 * derived from `speed` and `gust` in knots, the same way the backend does.
 */
export function makePoint(
  index = 0,
  speed = 12,
  gust = 18,
  overrides: Partial<WeatherForecastPoint> = {},
): WeatherForecastPoint {
  return {
    time: `2026-11-15T${String((index * 3) % 24).padStart(2, '0')}:00`,
    temperature_c: 12,
    temperature_f: 53.6,
    wind_speed_knots: speed,
    wind_speed_kmh: round1(speed * 1.852),
    wind_speed_mph: round1(speed * 1.15078),
    wind_speed_ms: round1(speed * 0.514444),
    wind_gust_knots: gust,
    wind_gust_kmh: round1(gust * 1.852),
    wind_gust_mph: round1(gust * 1.15078),
    wind_gust_ms: round1(gust * 0.514444),
    wind_direction_deg: 220,
    wind_direction_cardinal: 'SW',
    humidity: 64,
    weather_code: 1,
    ...overrides,
  };
}

/** A 16-slice forecast response. Use `speed`/`gust` for every slice, or override fields. */
export function makeForecast(
  overrides: Partial<WeatherForecastResponse> = {},
  { speed = 12, gust = 18 }: { speed?: number; gust?: number } = {},
): WeatherForecastResponse {
  return {
    location_id: 1,
    location_name: 'Oak Harbor, WA',
    latitude: 48.2939,
    longitude: -122.6064,
    model: 'best_match',
    timezone: 'America/Los_Angeles',
    cached: false,
    cached_at: 0,
    current: makePoint(0, speed, gust),
    forecast: Array.from({ length: 16 }, (_, i) => makePoint(i, speed, gust)),
    ...overrides,
  };
}

export function makeLocation(overrides: Partial<SavedLocation> = {}): SavedLocation {
  return {
    id: 1,
    name: 'Oak Harbor, WA',
    latitude: 48.2939,
    longitude: -122.6064,
    admin1: 'Washington',
    country: 'United States',
    is_default: true,
    ...overrides,
  };
}
