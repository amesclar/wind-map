import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineDrawer } from './TimelineDrawer';
import { MapView } from './MapView';
import type { WeatherForecastPoint, WeatherForecastResponse } from '../types';

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
      marker: vi.fn(() => ({
        addTo: vi.fn().mockReturnThis(),
        bindPopup: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        openPopup: vi.fn(),
      })),
    },
  };
});

function point(index: number): WeatherForecastPoint {
  return {
    time: `2026-11-15T${String(index * 3).padStart(2, '0')}:00`,
    temperature_c: 12,
    temperature_f: 53.6,
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
  };
}

const forecast: WeatherForecastResponse = {
  location_id: 1,
  location_name: 'Oak Harbor, WA',
  latitude: 48.2939,
  longitude: -122.6064,
  model: 'best_match',
  timezone: 'America/Los_Angeles',
  cached: false,
  cached_at: 0,
  current: point(0),
  forecast: Array.from({ length: 16 }, (_, index) => point(index)),
};

describe('timeline drawer forecast', () => {
  it('renders every 3-hour forecast point', () => {
    render(
      <TimelineDrawer
        weatherData={forecast}
        isLoading={false}
        unitSystem="imperial"
        speedUnit="knots"
        dirDisplay="cardinal"
      />
    );

    expect(screen.getByTestId('timeline-drawer')).toBeTruthy();
    expect(screen.getByText('Oak Harbor, WA')).toBeTruthy();
    expect(screen.getByText('48.29°, -122.61°')).toBeTruthy();
    expect(screen.getAllByTestId('forecast-point')).toHaveLength(16);
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getAllByText('12 kt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('G 18 kt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('54°F').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SW').length).toBeGreaterThan(0);
    expect(screen.getAllByText('64%').length).toBeGreaterThan(0);
  });

  it('stays hidden until a location forecast exists', () => {
    const { container } = render(
      <TimelineDrawer
        weatherData={null}
        isLoading={false}
        unitSystem="imperial"
        speedUnit="knots"
        dirDisplay="barb"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('keeps Leaflet layers from painting over the drawer', () => {
    render(
      <MapView
        locations={[]}
        selectedLocation={null}
        onSelectLocation={() => {}}
        weatherMap={{}}
        tileLayerType="osm_dark"
        cartoApiKey=""
      />
    );

    // Leaflet's .leaflet-pane is z-index 400 and .leaflet-top is z-index 1000.
    // The map root must create a stacking context or those layers cover the drawer.
    const canvas = screen.getByTestId('map-canvas');
    expect(canvas.className.split(/\s+/)).toContain('isolate');
  });
});
