import React from 'react';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import type { WeatherForecastPoint, WeatherForecastResponse, SavedLocation } from './types';

// Mock Leaflet
const mockMarkerInstances: Record<string, any> = {};
vi.mock('leaflet', () => {
  const layer = () => ({
    addTo: vi.fn(),
    remove: vi.fn(),
  });
  return {
    default: {
      map: vi.fn(() => ({
        remove: vi.fn(),
        flyTo: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getBounds: vi.fn(() => ({
          getSouth: () => 47.0,
          getNorth: () => 49.0,
          getWest: () => -123.0,
          getEast: () => -121.0,
        })),
        getSize: vi.fn(() => ({ x: 800, y: 600 })),
      })),
      control: {
        zoom: vi.fn(() => ({ addTo: vi.fn() })),
      },
      tileLayer: vi.fn(layer),
      divIcon: vi.fn((opts: any) => ({ ...opts })),
      marker: vi.fn((coords: [number, number]) => {
        const key = `${coords[0]},${coords[1]}`;
        const instance = {
          addTo: vi.fn().mockReturnThis(),
          bindPopup: vi.fn().mockReturnThis(),
          on: vi.fn(function (this: any, event: string, handler: Function) {
            instance._handlers = instance._handlers || {};
            instance._handlers[event] = handler;
            return this;
          }),
          remove: vi.fn(),
          setIcon: vi.fn(),
          openPopup: vi.fn(),
          _handlers: {} as Record<string, Function>,
        };
        mockMarkerInstances[key] = instance;
        return instance;
      }),
    },
  };
});

function createMockPoint(index: number, speed = 12, gust = 18): WeatherForecastPoint {
  return {
    time: `2026-11-15T${String((index * 3) % 24).padStart(2, '0')}:00`,
    temperature_c: 12,
    temperature_f: 53.6,
    wind_speed_knots: speed,
    wind_speed_kmh: Math.round(speed * 1.852 * 10) / 10,
    wind_speed_mph: Math.round(speed * 1.15078 * 10) / 10,
    wind_speed_ms: Math.round(speed * 0.514444 * 10) / 10,
    wind_gust_knots: gust,
    wind_gust_kmh: Math.round(gust * 1.852 * 10) / 10,
    wind_gust_mph: Math.round(gust * 1.15078 * 10) / 10,
    wind_gust_ms: Math.round(gust * 0.514444 * 10) / 10,
    wind_direction_deg: 220,
    wind_direction_cardinal: 'SW',
    humidity: 64,
    weather_code: 1,
  };
}

const mockLocations: SavedLocation[] = [
  {
    id: 1,
    name: 'Oak Harbor, WA',
    latitude: 48.2939,
    longitude: -122.6064,
    admin1: 'Washington',
    country: 'United States',
    is_default: true,
  },
  {
    id: 2,
    name: 'Seattle, WA',
    latitude: 47.6062,
    longitude: -122.3321,
    admin1: 'Washington',
    country: 'United States',
    is_default: false,
  },
];

const mockForecast1: WeatherForecastResponse = {
  location_id: 1,
  location_name: 'Oak Harbor, WA',
  latitude: 48.2939,
  longitude: -122.6064,
  model: 'best_match',
  timezone: 'America/Los_Angeles',
  cached: false,
  cached_at: 0,
  current: createMockPoint(0, 14, 22),
  forecast: Array.from({ length: 16 }, (_, i) => createMockPoint(i, 14, 22)),
};

const mockForecast2: WeatherForecastResponse = {
  location_id: 2,
  location_name: 'Seattle, WA',
  latitude: 47.6062,
  longitude: -122.3321,
  model: 'best_match',
  timezone: 'America/Los_Angeles',
  cached: true,
  cached_at: 0,
  current: createMockPoint(0, 20, 30),
  forecast: Array.from({ length: 16 }, (_, i) => createMockPoint(i, 20, 30)),
};

vi.mock('./api/client', () => ({
  fetchLocations: vi.fn(),
  addLocation: vi.fn(),
  deleteLocation: vi.fn(),
  fetchModels: vi.fn(),
  fetchWeather: vi.fn(),
  fetchAllWeather: vi.fn(),
  fetchAppConfig: vi.fn(),
  searchGeocode: vi.fn(),
  fetchWindGrid: vi.fn().mockResolvedValue([]),
  fetchPointWeather: vi.fn().mockResolvedValue({
    location_id: 0,
    location_name: '48.78°N, 121.94°W',
    latitude: 48.78,
    longitude: -121.94,
    model: 'best_match',
    timezone: 'America/Los_Angeles',
    cached: false,
    cached_at: 0,
    current: {
      time: '2026-11-15T17:00',
      temperature_c: 10,
      temperature_f: 50,
      wind_speed_knots: 14,
      wind_speed_kmh: 26,
      wind_speed_mph: 16,
      wind_speed_ms: 7.2,
      wind_gust_knots: 20,
      wind_gust_kmh: 37,
      wind_gust_mph: 23,
      wind_gust_ms: 10.3,
      wind_direction_deg: 220,
      wind_direction_cardinal: 'SW',
      humidity: 65,
      weather_code: 1,
    },
    forecast: Array.from({ length: 16 }, (_, i) => ({
      time: `2026-11-15T${String((17 + i * 3) % 24).padStart(2, '0')}:00`,
      temperature_c: 10,
      temperature_f: 50,
      wind_speed_knots: 14,
      wind_speed_kmh: 26,
      wind_speed_mph: 16,
      wind_speed_ms: 7.2,
      wind_gust_knots: 20,
      wind_gust_kmh: 37,
      wind_gust_mph: 23,
      wind_gust_ms: 10.3,
      wind_direction_deg: 220,
      wind_direction_cardinal: 'SW',
      humidity: 65,
      weather_code: 1,
    })),
  }),
}));

import * as api from './api/client';

describe('App prediction drawer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockMarkerInstances).forEach((k) => delete mockMarkerInstances[k]);

    // Ensure geolocation doesn't hang in tests
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    (api.fetchLocations as any).mockResolvedValue(mockLocations);
    (api.fetchModels as any).mockResolvedValue([{ id: 'best_match', name: 'Open-Meteo' }]);
    (api.fetchAppConfig as any).mockResolvedValue({});
    (api.fetchAllWeather as any).mockResolvedValue([mockForecast1, mockForecast2]);
    (api.fetchWeather as any).mockImplementation((id: number) => {
      if (id === 2) return Promise.resolve(mockForecast2);
      return Promise.resolve(mockForecast1);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('displays prediction drawer with forecast points on initial load', async () => {
    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(drawer).toBeTruthy();

    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();
    const forecastPoints = await screen.findAllByTestId('forecast-point');
    expect(forecastPoints).toHaveLength(16);

    const mapCanvas = screen.getByTestId('map-canvas');
    const mapWrapper = mapCanvas.parentElement as HTMLElement;
    expect(mapWrapper.className.split(/\s+/)).toContain("isolate");
  });

  it('updates prediction drawer data when clicking a saved location in modal', async () => {
    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();

    // Open Saved Locations modal
    const locationsBtns = screen.getAllByTitle('List saved locations');
    fireEvent.click(locationsBtns[0]);

    // Find Seattle in modal and click it
    const seattleBtn = await screen.findByText('Seattle, WA');
    fireEvent.click(seattleBtn);

    // Verify drawer updates to Seattle with Seattle's forecast data
    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
    });

    const forecastPoints = screen.getAllByTestId('forecast-point');
    expect(forecastPoints).toHaveLength(16);
    expect(screen.getAllByText('20 kt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('G 30 kt').length).toBeGreaterThan(0);
  });

  it('updates prediction drawer when clicking map marker for a location', async () => {
    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();

    // Wait for markers to be rendered
    const seattleMarkerKey = `${mockLocations[1].latitude},${mockLocations[1].longitude}`;
    await waitFor(() => {
      expect(mockMarkerInstances[seattleMarkerKey]).toBeDefined();
    });

    // Trigger marker click callback
    mockMarkerInstances[seattleMarkerKey]._handlers['click']();

    // Verify drawer displays Seattle predictions
    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
    });
    expect(screen.getAllByText('20 kt').length).toBeGreaterThan(0);
  });

  it('updates prediction drawer when selecting new location added by typing in location box (not previously cached)', async () => {
    const newLocationGeocode = {
      name: 'Miami',
      latitude: 25.7617,
      longitude: -80.1918,
      admin1: 'Florida',
      country: 'United States',
      display_name: 'Miami, Florida, United States',
    };

    const newLocationSaved: SavedLocation = {
      id: 3,
      name: 'Miami',
      latitude: 25.7617,
      longitude: -80.1918,
      admin1: 'Florida',
      country: 'United States',
      is_default: false,
    };

    const mockForecastMiami: WeatherForecastResponse = {
      location_id: 3,
      location_name: 'Miami',
      latitude: 25.7617,
      longitude: -80.1918,
      model: 'best_match',
      timezone: 'America/Los_Angeles',
      cached: false,
      cached_at: 0,
      current: createMockPoint(0, 18, 26),
      forecast: Array.from({ length: 16 }, (_, i) => createMockPoint(i, 18, 26)),
    };

    (api.searchGeocode as any).mockResolvedValue([newLocationGeocode]);
    (api.addLocation as any).mockResolvedValue(newLocationSaved);
    (api.fetchWeather as any).mockImplementation((id: number) => {
      if (id === 3) return Promise.resolve(mockForecastMiami);
      if (id === 2) return Promise.resolve(mockForecast2);
      return Promise.resolve(mockForecast1);
    });

    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();

    // Type 'Miami' in the location box input
    const input = screen.getByPlaceholderText('Add location (e.g. Seattle, Paris)...');
    fireEvent.change(input, { target: { value: 'Miami' } });

    // Wait for autocomplete geocoding results
    const dropdownResult = await screen.findByText('Miami');
    fireEvent.click(dropdownResult);

    // Verify drawer updates to Miami with Miami predictions
    await waitFor(() => {
      expect(within(drawer).getByText('Miami')).toBeTruthy();
    });

    const forecastPoints = screen.getAllByTestId('forecast-point');
    expect(forecastPoints).toHaveLength(16);
    expect(screen.getAllByText('18 kt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('G 26 kt').length).toBeGreaterThan(0);

    // SCRUM-92: the new location's forecast is fetched once, not twice
    await new Promise((r) => setTimeout(r, 0));
    const miamiCalls = (api.fetchWeather as any).mock.calls.filter((c: any[]) => c[0] === 3);
    expect(miamiCalls).toHaveLength(1);
  });

  it('fetches all-locations weather once on initial load (SCRUM-92)', async () => {
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
  });

  it('still refreshes all weather and the drawer when the timezone changes (SCRUM-92)', async () => {
    const { container } = render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    (api.fetchAllWeather as any).mockClear();
    (api.fetchWeather as any).mockClear();

    const timezoneSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'UTC'),
    )!;
    fireEvent.change(timezoneSelect, { target: { value: 'UTC' } });

    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC'));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
    expect(api.fetchWeather).toHaveBeenCalledWith(1, 'best_match', 'UTC');
  });

  it('does not rebuild saved-location markers when App re-renders with unchanged data (SCRUM-92)', async () => {
    const L = (await import('leaflet')).default as any;
    const { container } = render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    const markerCalls = L.marker.mock.calls.length;

    // Changing the speed unit re-renders App (new handler identities) but changes no map data
    const speedSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'mph'),
    )!;
    fireEvent.change(speedSelect, { target: { value: 'mph' } });
    await waitFor(() => expect(screen.getAllByText(/mph/).length).toBeGreaterThan(0));

    expect(L.marker.mock.calls.length).toBe(markerCalls);
  });

  it('updates prediction drawer when clicking a grid barb (SCRUM-88)', async () => {
    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();

    // Verify fetchPointWeather is called with correct params
    expect(api.fetchPointWeather).not.toHaveBeenCalled();

    const gridPoint = { latitude: 48.78, longitude: -121.94, wind_speed_knots: 14, wind_direction_deg: 220 };
    (api.fetchWindGrid as any).mockResolvedValue([gridPoint]);

    // Trigger a grid refresh by invoking the map 'moveend' handler registered by WindOverlay
    const L = (await import('leaflet')).default as any;
    const mapInstance = L.map.mock.results[0].value;
    // Change the bounds so the fetch key differs and the grid reloads
    mapInstance.getBounds.mockReturnValue({
      getSouth: () => 46.0,
      getNorth: () => 50.0,
      getWest: () => -124.0,
      getEast: () => -120.0,
    });
    mapInstance.on.mock.calls.filter((c: any[]) => c[0] === 'moveend').forEach((c: any[]) => c[1]());

    const key = `${gridPoint.latitude},${gridPoint.longitude}`;
    await waitFor(() => expect(mockMarkerInstances[key]).toBeDefined());

    mockMarkerInstances[key]._handlers['click']();

    await waitFor(() => {
      expect(api.fetchPointWeather).toHaveBeenCalledWith(48.78, -121.94, 'best_match', 'America/Los_Angeles');
      expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy();
    });
    // Saved-location name is gone and coordinates come from the point forecast
    expect(within(drawer).queryByText('Oak Harbor, WA')).toBeNull();
    expect(within(drawer).getByText(/48\.78°,\s*-121\.94°/)).toBeTruthy();
  });

  it('ignores a slow saved-location response that resolves after a grid barb click (SCRUM-88)', async () => {
    // Seattle's forecast stays pending until we resolve it manually
    let resolveSeattle!: (w: WeatherForecastResponse) => void;
    (api.fetchWeather as any).mockImplementation((id: number) => {
      if (id === 2) return new Promise<WeatherForecastResponse>((res) => { resolveSeattle = res; });
      return Promise.resolve(mockForecast1);
    });

    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());

    // Select Seattle via the modal; its weather request is now in flight
    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByText('Seattle, WA'));
    await waitFor(() => expect(resolveSeattle).toBeDefined());

    // Load a grid point and click its barb while Seattle is still pending
    const gridPoint = { latitude: 48.78, longitude: -121.94, wind_speed_knots: 14, wind_direction_deg: 220 };
    (api.fetchWindGrid as any).mockResolvedValue([gridPoint]);
    const L = (await import('leaflet')).default as any;
    const mapInstance = L.map.mock.results[0].value;
    mapInstance.getBounds.mockReturnValue({
      getSouth: () => 46.0,
      getNorth: () => 50.0,
      getWest: () => -124.0,
      getEast: () => -120.0,
    });
    mapInstance.on.mock.calls.filter((c: any[]) => c[0] === 'moveend').forEach((c: any[]) => c[1]());

    const key = `${gridPoint.latitude},${gridPoint.longitude}`;
    await waitFor(() => expect(mockMarkerInstances[key]).toBeDefined());
    mockMarkerInstances[key]._handlers['click']();

    await waitFor(() => expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy());

    // The stale Seattle response arrives late and must not overwrite the grid barb forecast
    resolveSeattle(mockForecast2);
    await new Promise((r) => setTimeout(r, 0));

    expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy();
    expect(within(drawer).queryByText('Seattle, WA')).toBeNull();
    expect(within(drawer).queryByText('Oak Harbor, WA')).toBeNull();
  });

  it('shows the saved location name and forecast when selected after a grid barb click (SCRUM-88 regression)', async () => {
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());

    // Click a grid barb first
    const gridPoint = { latitude: 48.78, longitude: -121.94, wind_speed_knots: 14, wind_direction_deg: 220 };
    (api.fetchWindGrid as any).mockResolvedValue([gridPoint]);
    const L = (await import('leaflet')).default as any;
    const mapInstance = L.map.mock.results[0].value;
    mapInstance.getBounds.mockReturnValue({
      getSouth: () => 46.0,
      getNorth: () => 50.0,
      getWest: () => -124.0,
      getEast: () => -120.0,
    });
    mapInstance.on.mock.calls.filter((c: any[]) => c[0] === 'moveend').forEach((c: any[]) => c[1]());

    const key = `${gridPoint.latitude},${gridPoint.longitude}`;
    await waitFor(() => expect(mockMarkerInstances[key]).toBeDefined());
    mockMarkerInstances[key]._handlers['click']();
    await waitFor(() => expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy());

    // Now explicitly select the saved location Seattle
    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByText('Seattle, WA'));

    await waitFor(() => expect(within(drawer).getByText('Seattle, WA')).toBeTruthy());
    expect(within(drawer).queryByText('48.78°N, 121.94°W')).toBeNull();
    expect(screen.getAllByText('20 kt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('G 30 kt').length).toBeGreaterThan(0);

    // Let any lingering async work settle; the grid barb selection must not override Seattle
    await new Promise((r) => setTimeout(r, 0));
    expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
    expect(within(drawer).queryByText('48.78°N, 121.94°W')).toBeNull();
  });

  it('shows the app version from the VERSION file in the navbar (SCRUM-91)', async () => {
    const { APP_VERSION } = await import('./version');
    render(<App />);
    const badge = await screen.findByTestId('app-version');
    expect(badge.textContent?.trim()).toBe(`v${APP_VERSION}`);
  });

  it('selected map wind barb matches the leftmost drawer wind barb (SCRUM-89)', async () => {
    // Grid "current" wind and the point forecast's "Now" slice (= current) agree;
    // later drawer slices differ so the test proves the leftmost card is compared.
    const gridPoint = {
      latitude: 48.78,
      longitude: -121.94,
      wind_speed_knots: 27,
      wind_direction_deg: 305,
      temperature_f: 84,
    };
    const base = await (api.fetchPointWeather as any).getMockImplementation()?.();
    const nowPoint = {
      ...base.forecast[0],
      wind_speed_knots: 27,
      wind_direction_deg: 305,
      wind_direction_cardinal: 'NW',
      temperature_f: 84,
      temperature_c: 28.9,
    };
    (api.fetchPointWeather as any).mockResolvedValueOnce({
      ...base,
      current: nowPoint,
      forecast: [nowPoint, ...base.forecast.slice(1)],
    });

    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());

    (api.fetchWindGrid as any).mockResolvedValue([gridPoint]);
    const L = (await import('leaflet')).default as any;
    const mapInstance = L.map.mock.results[0].value;
    mapInstance.getBounds.mockReturnValue({
      getSouth: () => 46.0,
      getNorth: () => 50.0,
      getWest: () => -124.0,
      getEast: () => -120.0,
    });
    mapInstance.on.mock.calls.filter((c: any[]) => c[0] === 'moveend').forEach((c: any[]) => c[1]());

    const key = `${gridPoint.latitude},${gridPoint.longitude}`;
    await waitFor(() => expect(mockMarkerInstances[key]).toBeDefined());
    const marker = mockMarkerInstances[key];
    marker._handlers['click']();

    await waitFor(() => expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy());

    // The marker icon is switched to the selected (highlighted) barb
    await waitFor(() => expect(marker.setIcon).toHaveBeenCalled());
    const selectedHtml: string = marker.setIcon.mock.calls.at(-1)[0].html;
    expect(selectedHtml).toContain('data-selected="true"');

    const signature = (root: ParentNode) => {
      const g = root.querySelector('svg g[transform]');
      if (!g) throw new Error('barb group not found');
      return {
        rotation: g.getAttribute('transform'),
        pennants: g.querySelectorAll('polygon').length,
        barbs: g.querySelectorAll('line').length, // staff + full/half barbs
        color: g.querySelector('line')?.getAttribute('stroke'),
      };
    };
    const mapBarb = document.createElement('div');
    mapBarb.innerHTML = selectedHtml;

    const leftmostCard = within(drawer).getAllByTestId('forecast-point')[0];
    const drawerSig = signature(leftmostCard);

    expect(signature(mapBarb)).toEqual(drawerSig);
    // 27 kt → staff + 2 full barbs + 1 half barb, pointing 305°, 84 °F → orange
    expect(drawerSig).toEqual({ rotation: 'rotate(305, 25, 25)', pennants: 0, barbs: 4, color: '#fb923c' });
  });
});
