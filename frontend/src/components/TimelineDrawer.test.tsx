import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineDrawer } from './TimelineDrawer';
import { MapView } from './MapView';
import type { WeatherForecastResponse } from '../types';
import { makeForecast } from '../test/fixtures';

vi.mock('leaflet', () => import('../test/leafletMock'));

const forecast = makeForecast();

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
    // Humidity is not shown in the drawer (SCRUM-97)
    expect(screen.queryByText('64%')).toBeNull();
  });

  it.each(['barb', 'cardinal', 'deg'] as const)(
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
    }
  );

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

  it('publishes the visible drawer height so the color legend can sit above it (SCRUM-144)', () => {
    const { unmount } = render(
      <TimelineDrawer
        weatherData={forecast}
        isLoading={false}
        unitSystem="imperial"
        speedUnit="knots"
        dirDisplay="barb"
      />
    );
    const root = document.documentElement;
    const toggle = screen.getByRole('button', { name: /48-Hour Forecast Timeline/ });
    const drawer = screen.getByTestId('timeline-drawer');

    // Expanded: jsdom has no layout, so offsetHeight is the value that gets published.
    expect(root.style.getPropertyValue('--drawer-height')).toBe('0px');

    fireEvent.click(toggle);
    expect(root.style.getPropertyValue('--drawer-height')).toBe('42px');

    Object.defineProperty(drawer, 'offsetHeight', { configurable: true, value: 300 });
    fireEvent.click(toggle);
    expect(root.style.getPropertyValue('--drawer-height')).toBe('300px');

    unmount();
    expect(root.style.getPropertyValue('--drawer-height')).toBe('');
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
        windColorOverlayVisible={false}
        selectedGridPoint={null}
        onGridPointSelect={() => {}}
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
