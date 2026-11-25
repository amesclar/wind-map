import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import App from './App';
import { RANGE_FRAME_TIMEOUT_MS } from './hooks/useMapExport';
import type { GridWindPoint } from './api/client';
import { STORAGE_KEYS } from './constants';
import { makeForecast, makeLocation } from './test/fixtures';
import { currentMap, markerAt, resetLeafletMock, type MockMarker } from './test/leafletMock';

vi.mock('leaflet', () => import('./test/leafletMock'));

// The capture itself is covered by captureMap.test; here only the wiring matters (SCRUM-116).
vi.mock('./utils/captureMap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/captureMap')>()),
  saveMapImage: vi.fn().mockResolvedValue(undefined),
  captureMapCanvas: vi.fn().mockResolvedValue({ width: 10, height: 10 }),
}));
// jsdom has no map tiles; the range loop's tile wait is the wiring under test, not tile timing.
vi.mock('./utils/captureDom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/captureDom')>()),
  waitForTiles: vi.fn().mockResolvedValue(undefined),
}));
import { captureMapCanvas, saveMapImage } from './utils/captureMap';

// The page layout is covered by pdfExport.test; here only the wiring matters (SCRUM-117).
vi.mock('./utils/pdfExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/pdfExport')>()),
  saveMapPdf: vi.fn().mockResolvedValue(undefined),
}));
import { saveMapPdf } from './utils/pdfExport';

// Whole-range outputs are covered by rangeOutput.test; here only the wiring (SCRUM-156).
vi.mock('./utils/rangeOutput', () => ({
  saveRangeImages: vi.fn().mockResolvedValue(undefined),
  saveRangePdf: vi.fn().mockResolvedValue(undefined),
}));
import { saveRangeImages, saveRangePdf } from './utils/rangeOutput';
import { buildWindColorScale } from './utils/windColorScale';
import { formatQuotaReset } from './components/QuotaWarningDialog';

// The drawer's per-selection forecast calls are gone (SCRUM-126), so the app must not need
// fetchWeather/fetchPointWeather at all.
vi.mock('./api/client', () => ({
  fetchLocations: vi.fn(),
  addLocation: vi.fn(),
  deleteLocation: vi.fn(),
  fetchModels: vi.fn(),
  fetchModelAvailability: vi.fn(),
  fetchAllWeather: vi.fn(),
  fetchAppConfig: vi.fn(),
  searchGeocode: vi.fn(),
  fetchWindGrid: vi.fn(),
  parseQuotaExhausted: vi.fn(),
  submitFeedback: vi.fn(),
}));

import * as api from './api/client';

const mockLocations = [
  makeLocation(),
  makeLocation({ id: 2, name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, is_default: false }),
];

const oakForecast = makeForecast({}, { speed: 14, gust: 22 });
const seattleForecast = makeForecast(
  { location_id: 2, location_name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321, cached: true },
  { speed: 20, gust: 30 },
);

const [oak, seattle] = mockLocations;

/** Open the Preferences pop-up from the navbar gear (SCRUM-107). */
function openPreferences() {
  fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
}

/** Requests are cancellable: every data call receives `{ signal }`. */
const withSignal = expect.objectContaining({ signal: expect.any(AbortSignal) });

/** The icon HTML currently on a marker: the mock keeps it in step with setIcon. */
const iconHtml = (marker?: MockMarker) => ((marker?.icon as { html?: string } | undefined)?.html ?? '');

/** Pan so the overlay reloads the grid with `point`, then click that point's barb. */
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

const gridPoint = {
  latitude: 48.78,
  longitude: -121.94,
  wind_speed_knots: 14,
  wind_direction_deg: 220,
  temperature_f: 53.6,
};

describe('App map integration (SCRUM-126)', () => {
  it('allows each range hour 60 s for its grid data (SCRUM-164)', () => {
    expect(RANGE_FRAME_TIMEOUT_MS).toBe(60_000);
  });
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
    (api.fetchModels as any).mockResolvedValue([
      {
        id: 'best_match',
        name: 'Open-Meteo',
        update_hours: 1,
        update_cycles_utc: Array.from({ length: 24 }, (_, i) => i),
        horizon_hours: 168,
        last_run_utc: '2026-11-23T12:00:00Z',
        next_run_utc: '2026-11-23T18:00:00Z',
      },
    ]);
    // best_match has no single upstream run, so the run line keeps the derived cycle (SCRUM-256).
    (api.fetchModelAvailability as any).mockResolvedValue({
      model: 'best_match',
      run_utc: null,
      available_utc: null,
      next_available_utc: null,
    });
    (api.fetchAppConfig as any).mockResolvedValue({});
    (api.fetchAllWeather as any).mockResolvedValue([oakForecast, seattleForecast]);
    vi.mocked(api.parseQuotaExhausted).mockReturnValue(null);
    // The range loop's readiness signal needs points that name the hour that was requested; the
    // live view starts with no barbs so the grid-click tests control their own responses.
    (api.fetchWindGrid as any).mockImplementation(async (params: { time?: string | null }) =>
      params.time ? [{ ...gridPoint, time: params.time }] : [],
    );
    (captureMapCanvas as any).mockReset();
    (captureMapCanvas as any).mockResolvedValue({ width: 10, height: 10 });
    vi.mocked(saveRangeImages).mockClear();
    vi.mocked(saveRangePdf).mockClear();
  });

  it('opens without selecting a location or opening a pop-up (SCRUM-248)', async () => {
    render(<App />);

    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    // Without geolocation the first saved location is only focused, never selected.
    await waitFor(() =>
      expect(currentMap().flyTo).toHaveBeenCalledWith([oak.latitude, oak.longitude], 9, expect.any(Object)),
    );
    expect(iconHtml(markerAt(oak.latitude, oak.longitude))).not.toContain('scale-110');
    expect(iconHtml(markerAt(seattle.latitude, seattle.longitude))).not.toContain('scale-110');
    expect(markerAt(oak.latitude, oak.longitude)!.openPopup).not.toHaveBeenCalled();
    expect(markerAt(seattle.latitude, seattle.longitude)!.openPopup).not.toHaveBeenCalled();

    // The timeline drawer is gone (SCRUM-126).
    expect(screen.queryByTestId('timeline-drawer')).toBeNull();

    const mapWrapper = screen.getByTestId('map-canvas').parentElement as HTMLElement;
    expect(mapWrapper.className.split(/\s+/)).toContain('isolate');
  });

  it('centres on the current location without selecting it (SCRUM-248)', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition: (ok: (position: unknown) => void) =>
          ok({ coords: { latitude: 48.1, longitude: -122.4 } }),
      },
      configurable: true,
      writable: true,
    });
    const here = makeLocation({
      id: 3,
      name: 'My Current Location',
      latitude: 48.1,
      longitude: -122.4,
      is_default: false,
    });
    vi.mocked(api.addLocation).mockResolvedValue(here);

    render(<App />);

    await waitFor(() =>
      expect(currentMap().flyTo).toHaveBeenCalledWith([48.1, -122.4], 9, expect.any(Object)),
    );
    await waitFor(() => expect(markerAt(48.1, -122.4)).toBeDefined());
    expect(markerAt(48.1, -122.4)!.openPopup).not.toHaveBeenCalled();
    expect(iconHtml(markerAt(48.1, -122.4))).not.toContain('scale-110');
    expect(markerAt(oak.latitude, oak.longitude)!.openPopup).not.toHaveBeenCalled();
  });

  it('shows the feedback button only when the server enables it, and opens the form (SCRUM-179)', async () => {
    (api.fetchAppConfig as any).mockResolvedValue({ feedback_enabled: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send feedback' }));
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Send feedback' })).toBeNull();
  });

  it('hides the feedback button when the server has no Jira configuration (SCRUM-179)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
  });

  it('warns once when the grid quota is exhausted, naming the reset time (SCRUM-170)', async () => {
    localStorage.setItem(STORAGE_KEYS.windColorOverlayVisible, 'true');
    vi.mocked(api.parseQuotaExhausted).mockReturnValue({ resetAt: '2026-11-24T00:00:29Z' });
    vi.mocked(api.fetchWindGrid).mockRejectedValue(new Error('quota reached'));

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('quota-warning')).toBeTruthy());
    const reset = formatQuotaReset('2026-11-24T00:00:29Z', 'America/Los_Angeles');
    expect(reset).toContain('4:00 PM');
    expect(screen.getByText(`Wind data should return at ${reset}.`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('quota-warning')).toBeNull());

    // The same quota window must not reopen the dismissed dialog on the next grid failure.
    const map = currentMap();
    map.bounds = { south: 46.0, north: 50.0, west: -124.0, east: -120.0 };
    map.fire('moveend');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('quota-warning')).toBeNull();
  });

  it('selects a location from the saved-locations modal', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(seattle.latitude, seattle.longitude)).toBeDefined());

    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByText('Seattle, WA'));

    await waitFor(() => expect(iconHtml(markerAt(seattle.latitude, seattle.longitude))).toContain('scale-110'));
    expect(iconHtml(markerAt(oak.latitude, oak.longitude))).not.toContain('scale-110');
    expect(markerAt(seattle.latitude, seattle.longitude)!.openPopup).toHaveBeenCalledTimes(1);
  });

  it('selects a saved location when its map marker is clicked', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(seattle.latitude, seattle.longitude)).toBeDefined());

    markerAt(seattle.latitude, seattle.longitude)!.fire('click');

    await waitFor(() => expect(iconHtml(markerAt(seattle.latitude, seattle.longitude))).toContain('scale-110'));
    expect(iconHtml(markerAt(oak.latitude, oak.longitude))).not.toContain('scale-110');
    expect(markerAt(seattle.latitude, seattle.longitude)!.openPopup).toHaveBeenCalledTimes(1);
  });

  it('highlights the clicked barb and opens its pop-up without another request (SCRUM-88)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    const marker = await clickGridPoint(gridPoint);

    await waitFor(() => expect(iconHtml(marker)).toContain('data-selected="true"'));
    // The pop-up comes from the grid response the overlay already holds.
    expect(marker.popupHtml).toContain('Wind point');
    expect(marker.popupHtml).toContain('14 kt');
    expect(marker.popupHtml).toContain('54°F');

    // Clicking again (or any other barb) reuses that grid response: no new request.
    const gridFetches = vi.mocked(api.fetchWindGrid).mock.calls.length;
    marker.fire('click');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(gridFetches);
  });

  it('clears the barb highlight when a saved location is selected after it (SCRUM-88 regression)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    const marker = await clickGridPoint(gridPoint);
    await waitFor(() => expect(iconHtml(marker)).toContain('data-selected="true"'));

    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByText('Seattle, WA'));

    await waitFor(() => expect(iconHtml(marker)).toContain('data-selected="false"'));
    expect(iconHtml(markerAt(seattle.latitude, seattle.longitude))).toContain('scale-110');
  });

  it('shows barb pop-ups in the chosen units (SCRUM-126)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    await clickGridPoint(gridPoint);
    await waitFor(() => expect(markerAt(48.78, -121.94)?.popupHtml).toContain('14 kt'));

    openPreferences();
    fireEvent.click(screen.getByRole('radio', { name: '°C' }));
    fireEvent.change(screen.getByLabelText('Wind speed'), { target: { value: 'kmh' } });

    await waitFor(() => {
      const popup = markerAt(48.78, -121.94)?.popupHtml ?? '';
      expect(popup).toContain('25.9 km/h');
      expect(popup).toContain('12°C');
    });
  });

  it('moves the whole map to the chosen forecast hour (SCRUM-127)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toBeNull();

    fireEvent.click(screen.getByLabelText('Next hour'));

    await waitFor(() =>
      expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toMatch(/T\d{2}:00:00\.000Z$/),
    );
    const time = vi.mocked(api.fetchWindGrid).mock.calls.at(-1)![0].time as string;
    await waitFor(() => expect(vi.mocked(api.fetchAllWeather).mock.calls.at(-1)?.[2]?.time).toBe(time));
    // Both pop-ups name the hour the values describe.
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('🕒'));

    fireEvent.click(screen.getByText('Now'));
    await waitFor(() => expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toBeNull());
  });

  it('saves the visible hour as an image with its header, legend and footer (SCRUM-116)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByLabelText('Next hour'));
    await waitFor(() =>
      expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toMatch(/T\d{2}:00:00\.000Z$/),
    );

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1));
    const [element, content, options] = vi.mocked(saveMapImage).mock.calls[0];
    expect(element).toBe(screen.getByTestId('map-canvas'));
    expect(options).toEqual({ format: 'png', quality: 0.92 });
    expect(content.fileName).toMatch(/^best_match_\d{4}-\d{2}-\d{2}_\d{4}[A-Za-z0-9]+\.png$/);
    expect(content.header.lines[0].startsWith('Forecast hour')).toBe(true);
    expect(content.header.lines[1]).toContain('Open-Meteo');
    expect(content.footer).toContain('Wind Map v');
    expect(content.barbs.map((entry) => entry.knots)).toEqual([0, 5, 10, 15, 20, 50]);
    expect(content.temperatures.length).toBeGreaterThan(0);
    expect(content.windColorScale).toBeUndefined(); // the gradient is off by default
    // The dialog closes once the file is handed to the browser.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('passes the shared wind speed scale to the export when the gradient is on (SCRUM-165)', async () => {
    localStorage.setItem(STORAGE_KEYS.windColorOverlayVisible, 'true');
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1));
    const [, content] = vi.mocked(saveMapImage).mock.calls[0];
    expect(content.windColorScale).toEqual(buildWindColorScale('knots'));
  });

  it('exports with the edited file name, cleaned of reserved characters (SCRUM-162)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'my/map: 2026.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1));
    const [, content] = vi.mocked(saveMapImage).mock.calls[0];
    expect(content.fileName).toBe('mymap 2026.png');
  });

  it('exports the darker chart ramp in the legend on the Seamap base (SCRUM-206)', async () => {
    localStorage.setItem(STORAGE_KEYS.tileLayer, 'seamap');
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveMapImage)).toHaveBeenCalledTimes(1));
    const [, content] = vi.mocked(saveMapImage).mock.calls[0];
    const [{ temperatureBands }] = await Promise.all([import('./utils/mapExport')]);
    expect(content.temperatures).toEqual(temperatureBands('imperial', true));
  });

  it('exports the current view as a single-page PDF in the chosen size and orientation (SCRUM-117)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect((screen.getByTestId('export-file-name') as HTMLInputElement).value).toMatch(/\.pdf$/);

    fireEvent.click(screen.getByRole('radio', { name: /A4/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveMapPdf)).toHaveBeenCalledTimes(1));
    const [element, content, options] = vi.mocked(saveMapPdf).mock.calls[0];
    expect(element).toBe(screen.getByTestId('map-canvas'));
    expect(options).toEqual({ fileName: content.fileName, pageSize: 'a4', orientation: 'landscape' });
    expect(content.fileName).toMatch(/^best_match_\d{4}-\d{2}-\d{2}_\d{4}[A-Za-z0-9]+\.pdf$/);
    expect(vi.mocked(saveMapImage)).not.toHaveBeenCalled();
  });

  it('reports a failed single-view export in the dialog and keeps its options (SCRUM-241)', async () => {
    vi.mocked(saveMapPdf).mockRejectedValueOnce(
      new Error('The PDF library could not be loaded. Reload the page and try again.'),
    );
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    const name = (screen.getByTestId('export-file-name') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Reload the page and try again');
    // The dialog stays open with the chosen options, and Export is usable again without a retry.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByTestId('export-file-name') as HTMLInputElement).value).toBe(name);
    expect(screen.getByRole('radio', { name: /PDF/ }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false);
    expect(vi.mocked(saveMapPdf)).toHaveBeenCalledTimes(1);
  });

  it('captures one frame per hour for a range, saves one ZIP and restores the hour (SCRUM-155, SCRUM-156)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /^Range/ }));
    const start = (screen.getByLabelText('Start') as HTMLSelectElement).value;
    const end = new Date(Date.parse(start) + 2 * 3_600_000).toISOString();
    fireEvent.change(screen.getByLabelText('End'), { target: { value: end } });

    expect(screen.getByTestId('range-summary').textContent).toMatch(/^3 captures from /);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveRangeImages)).toHaveBeenCalledTimes(1));
    const [frames, options] = vi.mocked(saveRangeImages).mock.calls[0];
    expect(frames).toHaveLength(3);
    expect(options).toEqual({
      modelId: 'best_match',
      timezone: 'America/Los_Angeles',
      format: 'png',
      jpegQuality: 0.92,
    });
    expect(vi.mocked(saveRangePdf)).not.toHaveBeenCalled();

    // One composed frame per hour, each with that hour's header; the capture saw each hour once.
    const contents = vi.mocked(captureMapCanvas).mock.calls.map(([, content]) => content);
    expect(contents).toHaveLength(3);
    expect(new Set(contents.map((content) => content.header.title)).size).toBe(3);
    expect(contents.every((content) => content.header.lines[0].startsWith('Forecast hour'))).toBe(true);
    expect(contents.every((content) => content.fileName.startsWith('best_match_'))).toBe(true);

    // Back on the live hour that was showing before the export.
    await waitFor(() => expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves a range as one multi-page PDF with the chosen page size (SCRUM-156)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /^Range/ }));
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    fireEvent.click(screen.getByRole('radio', { name: /A4/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(vi.mocked(saveRangePdf)).toHaveBeenCalledTimes(1));
    const [frames, options] = vi.mocked(saveRangePdf).mock.calls[0];
    expect(frames).toHaveLength(3);
    expect(options).toEqual({
      modelId: 'best_match',
      timezone: 'America/Los_Angeles',
      pageSize: 'a4',
      orientation: 'landscape',
    });
    expect(vi.mocked(saveRangeImages)).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stops a range on cancel, downloads nothing and restores the original hour (SCRUM-155)', async () => {
    vi.mocked(captureMapCanvas).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ width: 10, height: 10 } as unknown as HTMLCanvasElement), 50)),
    );
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /^Range/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Stop capturing' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop capturing' })).toBeNull());
    expect(vi.mocked(saveRangeImages)).not.toHaveBeenCalled();
    expect(vi.mocked(saveRangePdf)).not.toHaveBeenCalled();
    await waitFor(() => expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toBeNull());
  });

  it('names a failing range hour, offers the captured frames and restores the hour (SCRUM-155)', async () => {
    vi.mocked(captureMapCanvas)
      .mockResolvedValueOnce({ width: 10, height: 10 } as unknown as HTMLCanvasElement)
      .mockRejectedValueOnce(new Error('canvas failed'));
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    fireEvent.click(screen.getByTitle('Export map image'));
    fireEvent.click(screen.getByRole('radio', { name: /^Range/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    const error = await screen.findByTestId('range-error');
    expect(error.textContent).toContain('Could not capture');
    expect(error.textContent).toContain('canvas failed');
    expect(vi.mocked(saveRangeImages)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save captured frames (1)' }));
    await waitFor(() => expect(vi.mocked(saveRangeImages)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRangeImages).mock.calls[0][0]).toHaveLength(1);
    await waitFor(() => expect(vi.mocked(api.fetchWindGrid).mock.calls.at(-1)?.[0].time).toBeNull());
  });

  it('fetches every saved location once on initial load (SCRUM-92)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('14 kt'));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
  });

  it('refreshes every saved location when the timezone changes (SCRUM-92)', async () => {
    render(<App />);
    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'America/Los_Angeles', withSignal));
    vi.mocked(api.fetchAllWeather).mockClear();

    openPreferences();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });

    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC', withSignal));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
  });

  it('does not rebuild saved-location markers when App re-renders with unchanged data (SCRUM-92)', async () => {
    const L = vi.mocked((await import('leaflet')).default);
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    openPreferences(); // opening the modal re-renders App too
    const markerCalls = L.marker.mock.calls.length;

    // Changing the direction display re-renders App (new handler identities) but changes
    // nothing about the saved-location markers.
    fireEvent.change(screen.getByLabelText('Wind direction display'), { target: { value: 'cardinal' } });
    await waitFor(() =>
      expect((screen.getByLabelText('Wind direction display') as HTMLSelectElement).value).toBe('cardinal'),
    );

    expect(L.marker.mock.calls.length).toBe(markerCalls);
  });

  it('clears the selection when the selected location is deleted (SCRUM-248)', async () => {
    vi.mocked(api.deleteLocation).mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    markerAt(oak.latitude, oak.longitude)!.fire('click');
    await waitFor(() => expect(iconHtml(markerAt(oak.latitude, oak.longitude))).toContain('scale-110'));

    fireEvent.click(screen.getAllByTitle('List saved locations')[0]);
    fireEvent.click(await screen.findByLabelText('Remove Oak Harbor, WA'));

    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)!.remove).toHaveBeenCalled());
    // Deleting never selects the location that becomes first.
    expect(iconHtml(markerAt(seattle.latitude, seattle.longitude))).not.toContain('scale-110');
    expect(markerAt(seattle.latitude, seattle.longitude)!.openPopup).not.toHaveBeenCalled();
    expect(api.deleteLocation).toHaveBeenCalledWith(1);
  });

  it('adds a location from the search box and selects it (SCRUM-92)', async () => {
    const geocode = {
      name: 'Miami',
      latitude: 25.7617,
      longitude: -80.1918,
      admin1: 'Florida',
      country: 'United States',
      display_name: 'Miami, Florida, United States',
    };
    const savedMiami = makeLocation({
      id: 3,
      name: 'Miami',
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      admin1: 'Florida',
      is_default: false,
    });
    vi.mocked(api.searchGeocode).mockResolvedValue([geocode]);
    vi.mocked(api.addLocation).mockResolvedValue(savedMiami);

    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());

    const input = screen.getByPlaceholderText('Add location (e.g. Seattle, Paris)...');
    fireEvent.change(input, { target: { value: 'Miami' } });
    fireEvent.click(await screen.findByText('Miami'));

    await waitFor(() => expect(iconHtml(markerAt(geocode.latitude, geocode.longitude))).toContain('scale-110'));
    expect(markerAt(geocode.latitude, geocode.longitude)!.openPopup).toHaveBeenCalledTimes(1);
    expect(api.addLocation).toHaveBeenCalledTimes(1);
    // Selecting a location no longer triggers a per-location forecast request (SCRUM-126).
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
  });

  it('shows saved-location popups in the selected units (SCRUM-92)', async () => {
    render(<App />);
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
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)?.popupHtml).toContain('25.9 km/h'));
    expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC', withSignal);
  });

  it('opens and closes the Preferences pop-up from the navbar gear (SCRUM-107)', async () => {
    render(<App />);
    await waitFor(() => expect(markerAt(oak.latitude, oak.longitude)).toBeDefined());
    expect(screen.queryByLabelText('Timezone')).toBeNull();

    openPreferences();
    expect(screen.getByLabelText('Timezone')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByLabelText('Timezone')).toBeNull();
  });

  it('shows the app version from the VERSION file in the navbar (SCRUM-91)', async () => {
    const { APP_VERSION } = await import('./version');
    render(<App />);
    const badge = await screen.findByTestId('app-version');
    expect(badge.textContent?.trim()).toBe(`v${APP_VERSION}`);
  });
});
