import React from 'react';
import { render, screen, within, cleanup } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineDrawer, formatDegreesTrue } from './TimelineDrawer';
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

  it.each(['barb', 'cardinal', 'degrees'] as const)(
    'shows degrees true below the barb and above the wind speed on every card (%s display) (SCRUM-90)',
    (dirDisplay) => {
      const data: WeatherForecastResponse = {
        ...forecast,
        forecast: forecast.forecast.map((p, i) => (i === 0 ? { ...p, wind_direction_deg: 305.4 } : p)),
      };
      const { container } = render(
        <TimelineDrawer
          weatherData={data}
          isLoading={false}
          unitSystem="imperial"
          speedUnit="knots"
          dirDisplay={dirDisplay}
        />
      );

      const cards = within(container).getAllByTestId('forecast-point');
      expect(cards).toHaveLength(16);
      cards.forEach((card) => {
        const directionDisplay = within(card).getByTestId('wind-direction-display');
        const degrees = within(card).getByTestId('wind-direction-true');
        const speed = within(card).getByTestId('wind-speed');
        // Order: barb/direction display → degrees true → wind speed
        expect(directionDisplay.nextElementSibling).toBe(degrees);
        expect(degrees.nextElementSibling).toBe(speed);
      });
      expect(within(cards[0]).getByTestId('wind-direction-true').textContent).toBe('305°T');
      expect(within(cards[1]).getByTestId('wind-direction-true').textContent).toBe('220°T');
      cleanup();
    }
  );

  it('formats degrees true as whole numbers, normalized to 0–359 (SCRUM-90)', () => {
    expect(formatDegreesTrue(220)).toBe('220°T');
    expect(formatDegreesTrue(7.5)).toBe('8°T');
    expect(formatDegreesTrue(305.4)).toBe('305°T');
    expect(formatDegreesTrue(0)).toBe('0°T');
    expect(formatDegreesTrue(360)).toBe('0°T');
    expect(formatDegreesTrue(359.6)).toBe('0°T');
    expect(formatDegreesTrue(-10)).toBe('350°T');
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
        selectedModel="best_match"
        windOverlayVisible={false}
      />
    );

    // Leaflet's .leaflet-pane is z-index 400 and .leaflet-top is z-index 1000.
    // The map root must create a stacking context or those layers cover the drawer.
    // isolate is now on the MapView wrapper, not the inner map-canvas div.
    const canvas = screen.getByTestId('map-canvas');
    const wrapper = canvas.parentElement as HTMLElement;
    expect(wrapper.className.split(/\s+/)).toContain('isolate');
  });
});
