import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ApiError,
  addLocation,
  deleteLocation,
  fetchAppConfig,
  fetchPointWeather,
  fetchWeather,
  fetchWindGrid,
  parseQuotaExhausted,
  searchGeocode,
} from './client';

// ---------------------------------------------------------------------------
// fetchWindGrid
// ---------------------------------------------------------------------------

const BASE_PARAMS = {
  min_lat: 47.0,
  max_lat: 49.0,
  min_lon: -123.0,
  max_lon: -121.0,
  cols: 3,
  rows: 2,
};

const MOCK_GRID = [
  { latitude: 47.0, longitude: -123.0, wind_speed_knots: 10.0, wind_direction_deg: 180.0 },
  { latitude: 47.0, longitude: -122.0, wind_speed_knots: 12.5, wind_direction_deg: 220.0 },
  { latitude: 47.0, longitude: -121.0, wind_speed_knots: 8.0,  wind_direction_deg: 90.0  },
  { latitude: 49.0, longitude: -123.0, wind_speed_knots: 15.0, wind_direction_deg: 270.0 },
  { latitude: 49.0, longitude: -122.0, wind_speed_knots: 20.0, wind_direction_deg: 0.0   },
  { latitude: 49.0, longitude: -121.0, wind_speed_knots: 5.0,  wind_direction_deg: 45.0  },
];

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('fetchWindGrid', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the correct endpoint', async () => {
    const spy = mockFetch(MOCK_GRID);
    vi.stubGlobal('fetch', spy);

    await fetchWindGrid(BASE_PARAMS);

    expect(spy).toHaveBeenCalledOnce();
    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('/api/weather/grid');
  });

  it('encodes all bbox and grid params in the query string', async () => {
    const spy = mockFetch(MOCK_GRID);
    vi.stubGlobal('fetch', spy);

    await fetchWindGrid(BASE_PARAMS);

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('min_lat=47');
    expect(url).toContain('max_lat=49');
    expect(url).toContain('min_lon=-123');
    expect(url).toContain('max_lon=-121');
    expect(url).toContain('cols=3');
    expect(url).toContain('rows=2');
  });

  it('defaults model to best_match when not provided', async () => {
    const spy = mockFetch(MOCK_GRID);
    vi.stubGlobal('fetch', spy);

    await fetchWindGrid(BASE_PARAMS);

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('model=best_match');
  });

  it('forwards a custom model param', async () => {
    const spy = mockFetch(MOCK_GRID);
    vi.stubGlobal('fetch', spy);

    await fetchWindGrid({ ...BASE_PARAMS, model: 'gfs_seamless' });

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('model=gfs_seamless');
  });

  it('returns the parsed JSON array on success', async () => {
    vi.stubGlobal('fetch', mockFetch(MOCK_GRID));

    const result = await fetchWindGrid(BASE_PARAMS);

    expect(result).toHaveLength(MOCK_GRID.length);
    expect(result[0]).toMatchObject({
      latitude: 47.0,
      longitude: -123.0,
      wind_speed_knots: 10.0,
      wind_direction_deg: 180.0,
    });
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'Bad Gateway' }, 502));

    await expect(fetchWindGrid(BASE_PARAMS)).rejects.toThrow('Failed to fetch wind grid');
  });

  it('throws on a 422 validation error', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'Validation error' }, 422));

    await expect(fetchWindGrid(BASE_PARAMS)).rejects.toThrow('Failed to fetch wind grid');
  });

  it('carries the structured quota detail and reset time (SCRUM-170)', async () => {
    const detail = {
      code: 'open_meteo_quota_exhausted',
      message: 'Open-Meteo request limit reached',
      reset_at: '2026-11-24T00:00:29+00:00',
    };
    vi.stubGlobal('fetch', mockFetch({ detail }, 503));

    const err = await fetchWindGrid(BASE_PARAMS).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.detail).toEqual(detail);
    expect(parseQuotaExhausted(err)).toEqual({ resetAt: detail.reset_at });
  });

  it('returns null for quota errors that do not carry the marker (SCRUM-170)', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'Bad Gateway' }, 502));
    const err = await fetchWindGrid(BASE_PARAMS).catch((e) => e);
    expect(parseQuotaExhausted(err)).toBeNull();
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));

    await expect(fetchWindGrid(BASE_PARAMS)).rejects.toThrow('Network failure');
  });

  it('forwards an AbortSignal to fetch (SCRUM-92)', async () => {
    const spy = mockFetch(MOCK_GRID);
    vi.stubGlobal('fetch', spy);
    const controller = new AbortController();

    await fetchWindGrid(BASE_PARAMS, { signal: controller.signal });

    expect(spy.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});

// ---------------------------------------------------------------------------
// fetchPointWeather
// ---------------------------------------------------------------------------

const MOCK_POINT_FORECAST = {
  location_id: 0,
  location_name: '48.29°N, 122.60°W',
  latitude: 48.29,
  longitude: -122.60,
  model: 'best_match',
  timezone: 'America/Los_Angeles',
  cached: false,
  cached_at: 0,
  current: {
    time: '2026-11-15T12:00',
    temperature_c: 10,
    temperature_f: 50,
    wind_speed_knots: 12,
    wind_speed_kmh: 22.2,
    wind_speed_mph: 13.8,
    wind_speed_ms: 6.2,
    wind_gust_knots: 18,
    wind_gust_kmh: 33.3,
    wind_gust_mph: 20.7,
    wind_gust_ms: 9.3,
    wind_direction_deg: 220,
    wind_direction_cardinal: 'SW',
    humidity: 64,
    weather_code: 1,
  },
  forecast: [],
};

describe('fetchPointWeather', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the correct endpoint', async () => {
    const spy = mockFetch(MOCK_POINT_FORECAST);
    vi.stubGlobal('fetch', spy);

    await fetchPointWeather(48.29, -122.60);

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('/api/weather/point');
  });

  it('encodes lat and lon in the query string', async () => {
    const spy = mockFetch(MOCK_POINT_FORECAST);
    vi.stubGlobal('fetch', spy);

    await fetchPointWeather(48.29, -122.60);

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('lat=48.29');
    expect(url).toContain('lon=-122.6');
  });

  it('defaults model to best_match', async () => {
    const spy = mockFetch(MOCK_POINT_FORECAST);
    vi.stubGlobal('fetch', spy);

    await fetchPointWeather(48.29, -122.60);

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('model=best_match');
  });

  it('forwards custom model and timezone', async () => {
    const spy = mockFetch(MOCK_POINT_FORECAST);
    vi.stubGlobal('fetch', spy);

    await fetchPointWeather(48.29, -122.60, 'gfs_seamless', 'America/New_York');

    const url: string = spy.mock.calls[0][0];
    expect(url).toContain('model=gfs_seamless');
    expect(url).toContain('timezone=America%2FNew_York');
  });

  it('returns parsed forecast on success', async () => {
    vi.stubGlobal('fetch', mockFetch(MOCK_POINT_FORECAST));

    const result = await fetchPointWeather(48.29, -122.60);

    expect(result.location_id).toBe(0);
    expect(result.location_name).toBe('48.29°N, 122.60°W');
    expect(result.current.wind_speed_knots).toBe(12);
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'error' }, 502));

    await expect(fetchPointWeather(48.29, -122.60)).rejects.toThrow('Failed to fetch point weather');
  });

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));

    await expect(fetchPointWeather(48.29, -122.60)).rejects.toThrow('Network failure');
  });
});

// ---------------------------------------------------------------------------
// Shared request helper behaviour (SCRUM-92)
// ---------------------------------------------------------------------------

describe('API client errors and search (SCRUM-92)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws an ApiError carrying the HTTP status', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'not found' }, 404));
    const err = await fetchWeather(9999).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Failed to load weather data');
  });

  it('sends JSON when adding a location', async () => {
    const spy = mockFetch({ id: 3 });
    vi.stubGlobal('fetch', spy);
    await addLocation({ name: 'Miami', latitude: 25.76, longitude: -80.19 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/locations');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ name: 'Miami', latitude: 25.76, longitude: -80.19 });
  });

  it('does not parse a body for a 204 delete', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json }));
    await expect(deleteLocation(3)).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('searchGeocode returns [] without a request for short queries', async () => {
    const spy = mockFetch([]);
    vi.stubGlobal('fetch', spy);
    expect(await searchGeocode(' a ')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('searchGeocode returns [] when the geocoder is down (502)', async () => {
    vi.stubGlobal('fetch', mockFetch({ detail: 'Failed to search locations with Open-Meteo' }, 502));
    expect(await searchGeocode('Seattle')).toEqual([]);
  });

  it('searchGeocode trims and encodes the query', async () => {
    const spy = mockFetch([]);
    vi.stubGlobal('fetch', spy);
    await searchGeocode('  São Paulo ');
    expect(spy.mock.calls[0][0]).toBe('/api/geocode?q=S%C3%A3o+Paulo');
  });

  it('fetchAppConfig returns {} on any failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchAppConfig()).toEqual({});
  });
});
