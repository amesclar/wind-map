import {
  AppConfig,
  CurrentGridResponse,
  ModelAvailability,
  FeedbackPayload,
  FeedbackResult,
  GeocodeResult,
  GridWindPoint,
  NewLocation,
  SavedLocation,
  TidePointResponse,
  WeatherForecastResponse,
  WeatherModelInfo,
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
    /** The response's `detail` when it was JSON, for structured API errors (SCRUM-170). */
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface QuotaExhausted {
  /** ISO instant when Open-Meteo's limit resets, or null when it did not say. */
  resetAt: string | null;
}

/** Read the grid API's quota-exhausted error, or null for every other failure (SCRUM-170). */
export function parseQuotaExhausted(err: unknown): QuotaExhausted | null {
  if (!(err instanceof ApiError) || err.status !== 503) return null;
  const detail = err.detail;
  if (!detail || typeof detail !== 'object') return null;
  const { code, reset_at: resetAt } = detail as { code?: unknown; reset_at?: unknown };
  if (code !== 'open_meteo_quota_exhausted') return null;
  return { resetAt: typeof resetAt === 'string' ? resetAt : null };
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Request options for the forecast endpoints plus the selected forecast hour (SCRUM-115). */
export interface ForecastRequestOptions extends RequestOptions {
  /** ISO 8601 hour; omitted means current conditions. */
  time?: string | null;
  /**
   * One-shot refresh (SCRUM-113): the server refetches only the rows older than the model's
   * newest published run, so a pan, zoom, hour or model change never sends it.
   */
  refresh?: boolean;
}

type Params = Record<string, string | number | boolean>;

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
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = ((await res.json()) as { detail?: unknown })?.detail;
    } catch {
      // A non-JSON error body (proxy page, empty response) keeps the generic message.
    }
    throw new ApiError(errorMessage, res.status, detail);
  }
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

/** Sea level and the nearest high/low at one point (SCRUM-195). `time` is an ISO hour or null. */
export function fetchPointTide(
  latitude: number,
  longitude: number,
  time: string | null,
  { signal }: RequestOptions = {},
): Promise<TidePointResponse> {
  const params: Params = { lat: latitude, lon: longitude };
  if (time) params.hour = time;
  return request('/tides/point', 'Failed to load tide data', { params, signal });
}

export function fetchModels(): Promise<WeatherModelInfo[]> {
  return request('/weather/models', 'Failed to load weather models');
}

/** Publication times of the model's newest run (SCRUM-256); null fields when it has none. */
export function fetchModelAvailability(model: string): Promise<ModelAvailability> {
  return request(`/weather/models/${encodeURIComponent(model)}/availability`, 'Failed to load model availability');
}

export function fetchWeather(
  locationId: number,
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal, refresh = false }: ForecastRequestOptions = {},
): Promise<WeatherForecastResponse> {
  const params: Params = { location_id: locationId, model, timezone };
  if (refresh) params.refresh = true;
  return request('/weather', 'Failed to load weather data', { params, signal });
}

export function fetchAllWeather(
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal, time, refresh = false }: ForecastRequestOptions = {},
): Promise<WeatherForecastResponse[]> {
  const params: Params = { model, timezone };
  if (time) params.time = time;
  if (refresh) params.refresh = true;
  return request('/weather/all', 'Failed to load all weather data', { params, signal });
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

/** File feedback as a Jira issue (SCRUM-179). Never retried automatically: a retry could duplicate the ticket. */
export function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
  return request('/feedback', 'Failed to send feedback', {
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  });
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
    /** ISO 8601 hour inside the model's horizon; omitted means current (SCRUM-115). */
    time?: string | null;
  },
  { signal, refresh = false }: ForecastRequestOptions = {},
): Promise<GridWindPoint[]> {
  const { time, ...box } = params;
  const query: Params = { ...box, model: params.model ?? DEFAULT_MODEL };
  if (time) query.time = time;
  if (refresh) query.refresh = true;
  return request('/weather/grid', 'Failed to fetch wind grid', { params: query, signal });
}

/** Ocean-current grid for a viewport at the selected hour (SCRUM-96/99). */
export function fetchCurrentGrid(
  params: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
    cols: number;
    rows: number;
    /** ISO 8601 hour inside the 240-hour current horizon; omitted means live values. */
    time?: string | null;
  },
  { signal }: RequestOptions = {},
): Promise<CurrentGridResponse> {
  const { time, ...box } = params;
  const query: Params = { ...box };
  if (time) query.time = time;
  return request('/currents/grid', 'Failed to fetch ocean current grid', { params: query, signal });
}

export function fetchPointWeather(
  lat: number,
  lon: number,
  model: string = DEFAULT_MODEL,
  timezone: string = DEFAULT_TIMEZONE,
  { signal, refresh = false }: ForecastRequestOptions = {},
): Promise<WeatherForecastResponse> {
  const params: Params = { lat, lon, model, timezone };
  if (refresh) params.refresh = true;
  return request('/weather/point', 'Failed to fetch point weather', { params, signal });
}
