import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';
import { makeLocation } from '../test/fixtures';
import leaflet, {
  createdMarkers,
  createdTileLayers,
  currentMap,
  markerAt,
  resetLeafletMock,
} from '../test/leafletMock';
import {
  CHART_COVERAGE_MAX_LAT,
  CHART_MIN_ZOOM,
  CHART_PANE,
  NONNA_PANE,
} from './mapTiles';
import * as api from '../api/client';

vi.mock('leaflet', () => import('../test/leafletMock'));

// The shared wind grid fetch lives in MapView (SCRUM-122).
vi.mock('../api/client', () => ({ fetchWindGrid: vi.fn(), parseQuotaExhausted: vi.fn() }));

beforeEach(() => {
  resetLeafletMock();
  vi.mocked(api.fetchWindGrid).mockReset();
});

const baseProps = {
  selectedLocation: null,
  onSelectLocation: () => {},
  weatherMap: {},
  tileLayerType: 'osm_dark' as const,
  cartoApiKey: '',
  selectedModel: 'best_match',
  windOverlayVisible: false,
  windColorOverlayVisible: false,
  selectedGridPoint: null,
  onGridPointSelect: () => {},
};

describe('MapView popups (SCRUM-92)', () => {
  it('escapes location text so it cannot inject HTML', () => {
    const evil = makeLocation({
      id: 9,
      name: '<img src=x onerror="alert(1)">',
      admin1: '<b>bold</b>',
      country: 'A & B',
      is_default: false,
    });
    render(<MapView {...baseProps} locations={[evil]} />);

    expect(createdMarkers).toHaveLength(1);
    const html = createdMarkers[0].popupHtml!;
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;, A &amp; B');

    // Parsed as HTML, the name is plain text, not an element.
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});

describe('MapView shared wind grid (SCRUM-122)', () => {
  it('fetches once per view change while the barbs are shown', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    render(<MapView {...baseProps} locations={[]} windOverlayVisible />);

    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    const map = currentMap();

    // Same viewport: the overlay and the map both re-render, but nothing refetches.
    map.fire('moveend');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(1);

    map.bounds = { south: 46, north: 50, west: -124, east: -120 };
    map.fire('moveend');
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
  });

  it('does not fetch the grid when no layer needs it', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    render(<MapView {...baseProps} locations={[]} windOverlayVisible={false} />);

    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).not.toHaveBeenCalled();
  });
});

describe('MapView seamark overlay (SCRUM-175)', () => {
  const seamarkCalls = () =>
    leaflet.tileLayer.mock.calls.filter(
      ([, options]) => (options as { pane?: string } | undefined)?.pane === 'seamarkPane',
    );

  it('adds the OpenSeaMap layer into its own pane while the overlay is on, and removes it', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    const { rerender } = render(<MapView {...baseProps} locations={[]} seamarksVisible />);

    await waitFor(() => expect(seamarkCalls()).toHaveLength(1));
    expect(currentMap().createPane).toHaveBeenCalledWith('seamarkPane');
    expect(seamarkCalls()[0][0]).toContain('tiles.openseamap.org/seamark');
    const layer = leaflet.tileLayer.mock.results[
      leaflet.tileLayer.mock.calls.indexOf(seamarkCalls()[0])
    ].value as { remove: ReturnType<typeof vi.fn> };

    rerender(<MapView {...baseProps} locations={[]} seamarksVisible={false} />);
    await waitFor(() => expect(layer.remove).toHaveBeenCalled());
  });

  it('draws no seamarks on the paper chart and brings them back on another base (SCRUM-214)', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    const { rerender } = render(
      <MapView {...baseProps} locations={[]} tileLayerType="paper_chart" seamarksVisible />,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(seamarkCalls()).toHaveLength(0);

    // Another base honours the stored preference without a reload.
    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" seamarksVisible />);
    await waitFor(() => expect(seamarkCalls()).toHaveLength(1));

    // Back on the chart the layer goes again; the preference itself is untouched.
    rerender(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" seamarksVisible />);
    await waitFor(() =>
      expect(
        createdTileLayers.filter(
          (layer) => layer.options?.pane === 'seamarkPane' && layer.remove.mock.calls.length === 0,
        ),
      ).toHaveLength(0),
    );
  });

  it('adds no seamark layer when the overlay is off', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    render(<MapView {...baseProps} locations={[]} />);

    await new Promise((r) => setTimeout(r, 0));
    expect(seamarkCalls()).toHaveLength(0);
  });
});

describe('MapView wind color gradient (SCRUM-124)', () => {
  beforeEach(() => {
    // jsdom has no canvas backend, so the gradient layer draws nothing here; the drawing
    // itself is covered by WindColorOverlay.test.tsx.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => vi.restoreAllMocks());

  it('draws the gradient, shows the legend, and shares the grid fetch', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    render(<MapView {...baseProps} locations={[]} windColorOverlayVisible />);

    expect(screen.getByTestId('wind-color-legend')).toBeTruthy();
    // The barbs are off but the gradient still needs the grid, and asks for it once.
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
  });

  it('hides the barbs when only the gradient is on, and shows them again when toggled back (SCRUM-185)', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
    ]);
    const { rerender } = render(
      <MapView {...baseProps} locations={[]} windColorOverlayVisible />,
    );

    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    // The gradient keeps the shared grid alive, but the barbs have their own toggle.
    await new Promise((r) => setTimeout(r, 0));
    expect(createdMarkers).toHaveLength(0);
    expect(screen.getByTestId('wind-color-legend')).toBeTruthy();

    rerender(<MapView {...baseProps} locations={[]} windColorOverlayVisible windOverlayVisible />);
    await waitFor(() => expect(createdMarkers).toHaveLength(1));
  });

  it('keeps the legend hidden and fetches nothing when both layers are off', async () => {
    render(<MapView {...baseProps} locations={[]} />);

    expect(screen.queryByTestId('wind-color-legend')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).not.toHaveBeenCalled();
  });

  it('keeps the crisp outline on the barbs while the gradient is on', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      {
        latitude: 48,
        longitude: -122,
        wind_speed_knots: 12,
        wind_direction_deg: 180,
        temperature_f: 55,
      },
    ]);
    render(<MapView {...baseProps} locations={[]} windOverlayVisible windColorOverlayVisible />);

    await waitFor(() => expect(createdMarkers).toHaveLength(1));
    const html = (createdMarkers[0].icon as { html: string }).html;
    expect(html).toContain('data-barb-outline="true"');
    expect(html).not.toContain('wind-barb-halo');
  });
});

describe('MapView B.C. depth overlay (SCRUM-205)', () => {
  const nonnaCalls = () =>
    leaflet.tileLayer.wms.mock.calls.filter(
      ([, options]) => (options as { pane?: string } | undefined)?.pane === NONNA_PANE,
    );

  it('adds NONNA in its own pane between the chart and the seamarks, and removes it', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    const { rerender } = render(<MapView {...baseProps} locations={[]} bcDepthVisible />);

    await waitFor(() => expect(nonnaCalls()).toHaveLength(1));
    expect(nonnaCalls()[0][0]).toContain('nonna-geoserver.data.chs-shc.ca');
    const pane = currentMap().panes[NONNA_PANE];
    expect(pane.style.zIndex).toBe('208');
    expect(pane.style.pointerEvents).toBe('none');

    const layer = leaflet.tileLayer.wms.mock.results[
      leaflet.tileLayer.wms.mock.calls.indexOf(nonnaCalls()[0])
    ].value as { remove: ReturnType<typeof vi.fn> };

    rerender(<MapView {...baseProps} locations={[]} bcDepthVisible={false} />);
    await waitFor(() => expect(layer.remove).toHaveBeenCalled());
  });

  it('leaves the seamark layer alone when the depth overlay toggles', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    const { rerender } = render(<MapView {...baseProps} locations={[]} seamarksVisible />);
    const seamark = createdTileLayers.find((layer) => layer.options?.pane === 'seamarkPane')!;

    rerender(<MapView {...baseProps} locations={[]} seamarksVisible bcDepthVisible />);
    await waitFor(() => expect(nonnaCalls()).toHaveLength(1));
    expect(seamark.remove).not.toHaveBeenCalled();

    rerender(<MapView {...baseProps} locations={[]} seamarksVisible bcDepthVisible={false} />);
    await waitFor(() => expect(nonnaCalls()).toHaveLength(1));
    expect(seamark.remove).not.toHaveBeenCalled();
  });

  it('adds no depth layer when it is off', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
    render(<MapView {...baseProps} locations={[]} />);

    await new Promise((r) => setTimeout(r, 0));
    expect(nonnaCalls()).toHaveLength(0);
  });
});

describe('MapView barb pop-ups (SCRUM-126)', () => {
  it('binds the point values to its barb and still selects the point on click', async () => {
    const onGridPointSelect = vi.fn();
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48.75, longitude: -122.5, wind_speed_knots: 14, wind_direction_deg: 220, temperature_f: 53.6 },
    ]);
    render(
      <MapView
        {...baseProps}
        locations={[]}
        windOverlayVisible
        onGridPointSelect={onGridPointSelect}
        speedUnit="mph"
      />,
    );

    await waitFor(() => expect(markerAt(48.75, -122.5)).toBeDefined());
    const marker = markerAt(48.75, -122.5)!;
    // No second request: the pop-up reads the grid response the overlay already has.
    expect(marker.popupHtml).toContain('16.1 mph');
    expect(marker.popupHtml).toContain('54°F');

    marker.fire('click');
    expect(onGridPointSelect).toHaveBeenCalledWith(expect.objectContaining({ latitude: 48.75 }));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(1);
  });
});

describe('MapView paper chart base (SCRUM-203)', () => {
  const chartLayer = () => createdTileLayers.find((layer) => layer.kind === 'wms')!;

  it('mounts a keyless substrate plus one clipped chart layer in its own pane', () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);

    const substrate = createdTileLayers.find((layer) => layer.kind === 'xyz')!;
    expect(substrate.url).toContain('tile.openstreetmap.org');
    expect(substrate.options?.className).toBe('osm-dark-tiles');

    const chart = chartLayer();
    expect(chart.url).toContain('NOAAChartDisplay');
    expect(chart.options?.className).toBe('noaa-chart-tiles');
    expect(chart.options?.pane).toBe(CHART_PANE);
    expect(chart.options?.minZoom).toBe(CHART_MIN_ZOOM);
    const bounds = chart.options?.bounds as { getNorth: () => number };
    expect(bounds.getNorth()).toBe(CHART_COVERAGE_MAX_LAT);

    const pane = currentMap().panes[CHART_PANE];
    expect(pane.style.zIndex).toBe('205');
    expect(pane.style.pointerEvents).toBe('none');
  });

  it('replaces both layers when another base is chosen', () => {
    const { rerender } = render(
      <MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />,
    );
    const substrate = createdTileLayers.find((layer) => layer.kind === 'xyz')!;
    const chart = chartLayer();

    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);

    expect(substrate.remove).toHaveBeenCalled();
    expect(chart.remove).toHaveBeenCalled();
    // No live chart layer is left behind.
    expect(
      createdTileLayers.filter(
        (layer) => layer.kind === 'wms' && layer.remove.mock.calls.length === 0,
      ),
    ).toHaveLength(0);
  });

  it('zooms to the chart floor when the mode is selected below it, and leaves a deeper view alone', () => {
    const { rerender } = render(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);
    const map = currentMap();

    // The app opens around z10, where the chart would not draw at all.
    map.zoom = CHART_MIN_ZOOM - 2;
    rerender(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);
    expect(map.setZoom).toHaveBeenCalledWith(CHART_MIN_ZOOM);

    map.setZoom.mockClear();
    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);
    map.zoom = CHART_MIN_ZOOM + 1;
    rerender(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);
    expect(map.setZoom).not.toHaveBeenCalled();
  });

  it('explains the missing chart north of the clip and below the zoom floor only', () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);
    expect(screen.queryByTestId('chart-coverage-notice')).toBeNull();

    const map = currentMap();
    act(() => {
      map.bounds = { south: 50.2, north: 51.5, west: -124, east: -122 };
      map.fire('moveend');
    });
    expect(screen.getByTestId('chart-coverage-notice')).toBeTruthy();

    act(() => {
      map.bounds = { south: 47, north: 49, west: -123, east: -121 };
      map.zoom = CHART_MIN_ZOOM - 1;
      map.fire('zoomend');
    });
    expect(screen.getByTestId('chart-coverage-notice')).toBeTruthy();

    act(() => {
      map.zoom = CHART_MIN_ZOOM;
      map.fire('zoomend');
    });
    expect(screen.queryByTestId('chart-coverage-notice')).toBeNull();
  });

  it('haloes the barbs and inverts the selected ring on the light base', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      {
        latitude: 48,
        longitude: -122,
        wind_speed_knots: 12,
        wind_direction_deg: 180,
        temperature_f: 55,
      },
    ]);
    render(
      <MapView
        {...baseProps}
        locations={[]}
        tileLayerType="paper_chart"
        windOverlayVisible
        selectedGridPoint={{ latitude: 48, longitude: -122 }}
      />,
    );

    await waitFor(() => expect(createdMarkers).toHaveLength(1));
    const html = (createdMarkers[0].icon as { html: string }).html;
    expect(html).toContain('data-barb-outline="true"');
    // White would disappear on white water: the chart base draws the ring dark (SCRUM-203).
    expect(html).toContain('box-shadow:0 0 0 2px #161b22');
  });
});

describe('MapView chart tile failures (SCRUM-217)', () => {
  const chartLayerMock = () =>
    createdTileLayers.find(
      (layer) => layer.kind === 'wms' && layer.url?.includes('NOAAChartDisplay'),
    )!;

  it('ignores a single stray tile', () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);

    act(() => {
      chartLayerMock().fire('tileerror');
      chartLayerMock().fire('load');
    });

    expect(screen.queryByTestId('chart-tile-error-notice')).toBeNull();
  });

  it('shows the notice and its retry once a batch fails, and clears it on a clean batch', () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);

    act(() => {
      const chart = chartLayerMock();
      chart.fire('tileerror');
      chart.fire('tileerror');
      chart.fire('tileerror');
      // The load that follows an outage's failed tiles must not hide the notice again.
      chart.fire('load');
    });

    expect(screen.getByTestId('chart-tile-error-notice')).toBeTruthy();
    expect(screen.getByTestId('chart-retry')).toBeTruthy();

    // A recovered service clears it without the user doing anything.
    act(() => chartLayerMock().fire('load'));
    expect(screen.queryByTestId('chart-tile-error-notice')).toBeNull();
  });

  it('rebuilds the chart layer when Retry is clicked', async () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);

    act(() => {
      const chart = chartLayerMock();
      chart.fire('tileerror');
      chart.fire('tileerror');
      chart.fire('tileerror');
    });

    fireEvent.click(screen.getByTestId('chart-retry'));

    await waitFor(() =>
      expect(createdTileLayers.filter((layer) => layer.kind === 'wms')).toHaveLength(2),
    );
    const [first, second] = createdTileLayers.filter((layer) => layer.kind === 'wms');
    expect(first.remove).toHaveBeenCalled();
    expect(second.url).toContain('NOAAChartDisplay');
    expect(screen.queryByTestId('chart-tile-error-notice')).toBeNull();
  });
});

describe('MapView saved-location markers', () => {
  it('calls the latest onSelectLocation when a marker is clicked, without rebuilding markers', () => {
    const loc = makeLocation();
    const locations = [loc]; // same array: only the handler changes between renders
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<MapView {...baseProps} locations={locations} onSelectLocation={first} />);
    expect(createdMarkers).toHaveLength(1);

    // A new handler identity (as App creates on every render) must not recreate markers.
    rerender(<MapView {...baseProps} locations={locations} onSelectLocation={second} />);
    expect(createdMarkers).toHaveLength(1);

    createdMarkers[0].fire('click');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(loc);
  });
});

describe('MapView saved-location marker updates (SCRUM-92)', () => {
  it('updates markers in place, and only adds or removes changed locations', async () => {
    const { makeForecast } = await import('../test/fixtures');
    const oak = makeLocation();
    const seattle = makeLocation({ id: 2, name: 'Seattle, WA', latitude: 47.6, longitude: -122.3 });
    const { rerender } = render(<MapView {...baseProps} locations={[oak, seattle]} />);
    expect(createdMarkers).toHaveLength(2);
    const [oakMarker, seattleMarker] = createdMarkers;

    // New weather updates the existing markers' icon and popup.
    const weatherMap = { 1: makeForecast({}, { speed: 25 }) };
    rerender(<MapView {...baseProps} locations={[oak, seattle]} weatherMap={weatherMap} />);
    expect(createdMarkers).toHaveLength(2);
    expect(oakMarker.setIcon).toHaveBeenCalled();
    expect(oakMarker.popupHtml).toContain('25 kt');

    // Removing a location removes only its marker.
    rerender(<MapView {...baseProps} locations={[oak]} weatherMap={weatherMap} />);
    expect(seattleMarker.remove).toHaveBeenCalled();
    expect(oakMarker.remove).not.toHaveBeenCalled();
    expect(createdMarkers).toHaveLength(2);
  });

  it('removes its markers on unmount', () => {
    const { unmount } = render(<MapView {...baseProps} locations={[makeLocation()]} />);
    unmount();
    expect(createdMarkers[0].remove).toHaveBeenCalled();
  });
});
