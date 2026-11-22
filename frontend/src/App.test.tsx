import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import type { WeatherForecastResponse } from './types';
import type { GridWindPoint } from './api/client';
import { STORAGE_KEYS } from './constants';
import { makeForecast, makeLocation } from './test/fixtures';
import { currentMap, markerAt, resetLeafletMock, type MockMarker } from './test/leafletMock';

vi.mock('leaflet', () => import('./test/leafletMock'));

vi.mock('./api/client', () => ({
  fetchLocations: vi.fn(),
  addLocation: vi.fn(),
  deleteLocation: vi.fn(),
  fetchModels: vi.fn(),
  fetchWeather: vi.fn(),
  fetchAllWeather: vi.fn(),
  fetchAppConfig: vi.fn(),
  searchGeocode: vi.fn(),
  fetchWindGrid: vi.fn(),
  fetchPointWeather: vi.fn(),
}));

import * as api from './api/client';

const mockLocations = [
  makeLocation(),
  makeLocation({ id: 2, name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, is_default: false }),
];

const mockForecast1 = makeForecast({}, { speed: 14, gust: 22 });

const mockForecast2 = makeForecast(
  { location_id: 2, location_name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, cached: true },
  { speed: 20, gust: 30 },
);

const pointForecast = makeForecast(
  { location_id: 0, location_name: '48.78°N, 121.94°W', latitude: 48.78, longitude: -121.94 },
  { speed: 14, gust: 20 },
);

/** Open the Preferences pop-up from the navbar gear (SCRUM-107). */
function openPreferences() {
  fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
}

/** Requests are cancellable: every data call receives `{ signal }`. */
const withSignal = expect.objectContaining({ signal: expect.any(AbortSignal) });

/** Pan the map so WindOverlay reloads the grid with `point`, then click that point's barb. */
async function clickGridPoint(point: GridWindPoint): Promise<MockMarker> {
  vi.mocked(api.fetchWindGrid).mockResolvedValue([point]);
  const map = currentMap();
  // New bounds give a new fetch key, so the grid reloads.
  map.bounds = { south: 46.0, north: 50.0, west: -124.0, east: -120.0 };
  map.fire('moveend');
  let marker: MockMarker | undefined;
  await waitFor(() => {
    marker = markerAt(point.latitude, point.longitude);
    expect(marker).toBeDefined();
  });
  marker!.fire('click');
  return marker!;
}

describe('App prediction drawer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeafletMock();

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
    (api.fetchWindGrid as any).mockResolvedValue([]);
    (api.fetchPointWeather as any).mockResolvedValue(pointForecast);
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
    // Header switches on selection; the forecast arrives a moment later.
    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
      expect(within(drawer).getAllByText('20 kt').length).toBeGreaterThan(0);
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

    // Wait for markers to be rendered, then click Seattle's
    const seattle = mockLocations[1];
    await waitFor(() => expect(markerAt(seattle.latitude, seattle.longitude)).toBeDefined());
    markerAt(seattle.latitude, seattle.longitude)!.fire('click');

    // Verify drawer displays Seattle predictions
    // Header switches on selection; the forecast arrives a moment later.
    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
      expect(within(drawer).getAllByText('20 kt').length).toBeGreaterThan(0);
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

    const miami = { id: 3, name: 'Miami', latitude: 25.7617, longitude: -80.1918 };
    const newLocationSaved = makeLocation({ ...miami, admin1: 'Florida', is_default: false });
    const mockForecastMiami = makeForecast(
      { location_id: 3, location_name: 'Miami', latitude: miami.latitude, longitude: miami.longitude },
      { speed: 18, gust: 26 },
    );

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

    // Verify drawer updates to Miami with Miami predictions. The header switches as soon as
    // the location is selected; the forecast arrives a moment later, so wait for both.
    await waitFor(() => {
      expect(within(drawer).getByText('Miami')).toBeTruthy();
      expect(within(drawer).getAllByText('18 kt').length).toBeGreaterThan(0);
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
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    (api.fetchAllWeather as any).mockClear();
    (api.fetchWeather as any).mockClear();

    openPreferences();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });

    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC', withSignal));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
    expect(api.fetchWeather).toHaveBeenCalledWith(1, 'best_match', 'UTC', withSignal);
  });

  it('does not rebuild saved-location markers when App re-renders with unchanged data (SCRUM-92)', async () => {
    const L = vi.mocked((await import('leaflet')).default);
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    openPreferences(); // opening the modal re-renders App too
    const markerCalls = L.marker.mock.calls.length;

    // Changing the direction display re-renders App (new handler identities) but changes
    // nothing on the map (the speed unit does: popups show it).
    fireEvent.change(screen.getByLabelText('Wind direction display'), { target: { value: 'cardinal' } });
    await waitFor(() => expect(within(drawer).getAllByText('SW').length).toBeGreaterThan(0));

    expect(L.marker.mock.calls.length).toBe(markerCalls);
  });

  it('reloads the forecast when the selected location is chosen again (SCRUM-92)', async () => {
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getAllByText('14 kt').length).toBeGreaterThan(0));
    const before = vi.mocked(api.fetchWeather).mock.calls.filter((c) => c[0] === 1).length;

    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    // The modal row (the drawer header also shows the name).
    const removeButton = await screen.findByLabelText('Remove Oak Harbor, WA');
    fireEvent.click(within(removeButton.parentElement!).getByText('Oak Harbor, WA'));

    await waitFor(() =>
      expect(vi.mocked(api.fetchWeather).mock.calls.filter((c) => c[0] === 1).length).toBe(before + 1),
    );
  });

  it('selects the next location when the selected one is deleted (SCRUM-92)', async () => {
    vi.mocked(api.deleteLocation).mockResolvedValue(undefined);
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());

    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByLabelText('Remove Oak Harbor, WA'));

    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
      expect(within(drawer).getAllByText('20 kt').length).toBeGreaterThan(0);
    });
    expect(api.deleteLocation).toHaveBeenCalledWith(1);
    expect(markerAt(mockLocations[0].latitude, mockLocations[0].longitude)!.remove).toHaveBeenCalled();
  });

  it('shows map popups in the selected units (SCRUM-92)', async () => {
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy());
    const oak = mockLocations[0];
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('14 kt'));

    openPreferences();
    fireEvent.click(screen.getByRole('radio', { name: '°C' }));
    // The temperature unit no longer changes the speed unit (SCRUM-107).
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('°C'));
    expect(markerAt(oak.latitude, oak.longitude)!.popupHtml).toContain('14 kt');
    fireEvent.change(screen.getByLabelText('Wind speed'), { target: { value: 'kmh' } });
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('25.9 km/h'));
    const popup = markerAt(oak.latitude, oak.longitude)!.popupHtml!;
    expect(popup).toContain('°C');
    expect(popup).not.toContain('°F');
    expect(popup).not.toContain(' kt');
  });

  it('applies saved preferences on first render (SCRUM-107)', async () => {
    localStorage.setItem(STORAGE_KEYS.speedUnit, 'kmh');
    localStorage.setItem(STORAGE_KEYS.timezone, 'UTC');
    render(<App />);
    const drawer = await screen.findByTestId('timeline-drawer');
    await waitFor(() => expect(within(drawer).getAllByText('25.9 km/h').length).toBeGreaterThan(0));
    expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC', withSignal);
    expect(api.fetchWeather).not.toHaveBeenCalledWith(1, 'best_match', 'America/Los_Angeles', withSignal);
  });

  it('opens and closes the Preferences pop-up from the navbar gear (SCRUM-107)', async () => {
    render(<App />);
    await screen.findByTestId('timeline-drawer');
    expect(screen.queryByText('Done')).toBeNull();
    openPreferences();
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByLabelText('Timezone')).toBeNull();
  });

  it('opens and closes the model update frequency guide from the navbar (SCRUM-110)', async () => {
    render(<App />);
    await screen.findByTestId('timeline-drawer');
    expect(screen.queryByText('NOAA HRRR')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Model Update Cycles & Frequency' }));
    expect(await screen.findByText('NOAA HRRR')).toBeTruthy();

    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByText('NOAA HRRR')).toBeNull();
  });

  it('updates prediction drawer when clicking a grid barb (SCRUM-88)', async () => {
    render(<App />);

    const drawer = await screen.findByTestId('timeline-drawer');
    expect(within(drawer).getByText('Oak Harbor, WA')).toBeTruthy();

    // Verify fetchPointWeather is called with correct params
    expect(api.fetchPointWeather).not.toHaveBeenCalled();

    const gridPoint = { latitude: 48.78, longitude: -121.94, wind_speed_knots: 14, wind_direction_deg: 220 };
    await clickGridPoint(gridPoint);

    await waitFor(() => {
      expect(api.fetchPointWeather).toHaveBeenCalledWith(48.78, -121.94, 'best_match', 'America/Los_Angeles', withSignal);
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
    await clickGridPoint(gridPoint);

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
    await clickGridPoint(gridPoint);
    await waitFor(() => expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy());

    // Now explicitly select the saved location Seattle
    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByText('Seattle, WA'));

    await waitFor(() => {
      expect(within(drawer).getByText('Seattle, WA')).toBeTruthy();
      expect(within(drawer).getAllByText('20 kt').length).toBeGreaterThan(0);
    });
    expect(within(drawer).queryByText('48.78°N, 121.94°W')).toBeNull();
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

    const marker = await clickGridPoint(gridPoint);

    await waitFor(() => expect(within(drawer).getByText('48.78°N, 121.94°W')).toBeTruthy());

    // The marker icon is switched to the selected (highlighted) barb
    await waitFor(() => expect(marker.setIcon).toHaveBeenCalled());
    const selectedHtml = (marker.setIcon.mock.calls.at(-1)![0] as { html: string }).html;
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
