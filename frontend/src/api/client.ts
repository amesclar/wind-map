import {
  AppConfig,
  GeocodeResult,
  GridWindPoint,
  NewLocation,
  SavedLocation,
  WeatherForecastResponse,
  WeatherModel,
} from '../types';
import { DEFAULT_MODEL, DEFAULT_TIMEZONE } from '../constants';

// Re-exported so existing imports from the client keep working.
export type { GridWindPoint } from '../types';

const API_BASE = '/api';

/** Error for a non-2xx API response. `status` lets callers tell a 404 from a 502. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

type Params = Record<string, string | number>;

function url(path: string, params?: Params): string {
  if (!params) return `${API_BASE}${path}`;
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]),
  );
  return `${API_BASE}${path}?${query}`;
}

/**
 * Fetch JSON from the API. Throws ApiError(`errorMessage`, status) on a non-2xx response;
 * network errors and aborts propagate unchanged.
 */
async function request<T>(
  path: string,
  errorMessage: string,
  { params, init, signal }: { params?: Params; init?: RequestInit; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(url(path, params), { ...init, signal });
  if (!res.ok) throw new ApiError(errorMessage, res.status);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function fetchLocations(): Promise<SavedLocation[]> {
  return request('/locations', 'Failed to load locations');
}

export function addLocation(data: NewLocation): Promise<SavedLocation> {
  return request('/locations', 'Failed to add location', {
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
  });
}

export function deleteLocation(id: number): Promise<void> {
  return request(`/locations/${id}`, 'Failed to delete location', { init: { method: 'DELETE' } });
}

export function fetchModels(): Promise<WeatherModel[]> {
  return request('/weather/models', 'Failed to load weather models');
}

export function fetchWeather(
  locationId: number,
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal }: RequestOptions = {},
): Promise<WeatherForecastResponse> {
  return request('/weather', 'Failed to load weather data', {
    params: { location_id: locationId, model, timezone },
    signal,
  });
}

export function fetchAllWeather(
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal }: RequestOptions = {},
): Promise<WeatherForecastResponse[]> {
  return request('/weather/all', 'Failed to load all weather data', { params: { model, timezone }, signal });
}

/**
 * Place search. Returns [] for short queries and when the search fails (including the
 * backend's 502 when the geocoder is down), so the search box simply shows no results.
 */
export async function searchGeocode(query: string, { signal }: RequestOptions = {}): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    return await request('/geocode', 'Failed to search locations', { params: { q }, signal });
  } catch (err) {
    if (err instanceof ApiError) return [];
    throw err; // network errors and aborts
  }
}

/** App config. Optional: any failure returns {} so the app still starts. */
export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    return await request<AppConfig>('/config', 'Failed to load config');
  } catch {
    return {};
  }
}

export function fetchWindGrid(
  params: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
    cols: number;
    rows: number;
    model?: string;
  },
  { signal }: RequestOptions = {},
): Promise<GridWindPoint[]> {
  return request('/weather/grid', 'Failed to fetch wind grid', {
    params: { ...params, model: params.model ?? DEFAULT_MODEL },
    signal,
  });
}

export function fetchPointWeather(
  lat: number,
  lon: number,
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal }: RequestOptions = {},
): Promise<WeatherForecastResponse> {
  return request('/weather/point', 'Failed to fetch point weather', {
    params: { lat, lon, model, timezone },
    signal,
  });
}
