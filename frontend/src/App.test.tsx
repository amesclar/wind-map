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
      })),
      control: {
        zoom: vi.fn(() => ({ addTo: vi.fn() })),
      },
      tileLayer: vi.fn(layer),
      divIcon: vi.fn(() => ({})),
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
    expect(mapCanvas.className.split(/\s+/)).toContain('isolate');
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
  });
});
