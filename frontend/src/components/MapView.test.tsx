import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';
import {
  WIND_COLOR_OPACITY,
  WIND_COLOR_OPACITY_ON_CHART,
  WIND_COLOR_PANE,
} from './WindColorOverlay';
import { makeForecast, makeLocation, makePoint } from '../test/fixtures';
import leaflet, {
  createdMarkers,
  createdPolylines,
  createdTileLayers,
  currentMap,
  markerAt,
  resetLeafletMock,
} from '../test/leafletMock';
import {
  CHART_BOUNDS,
  CHART_COVERAGE_MAX_LAT,
  CHART_EDGE_PANE,
  CHART_MIN_ZOOM,
  CHART_PANE,
  NONNA_PANE,
} from './mapTiles';
import * as api from '../api/client';

vi.mock('leaflet', () => import('../test/leafletMock'));

// The Seamap style loads MapLibre on demand (SCRUM-206); its own module is covered by
// seamapLayer.test, so here only the mount, the pane and the cleanup matter.
const seamap = vi.hoisted(() => ({ createSeamapLayer: vi.fn(), mountSeamapLayer: vi.fn() }));
vi.mock('./seamapLayer', () => seamap);

// The shared wind grid fetch lives in MapView (SCRUM-122).
vi.mock('../api/client', () => ({
  fetchWindGrid: vi.fn(),
  fetchPointTide: vi.fn(),
  parseQuotaExhausted: vi.fn(),
}));

beforeEach(() => {
  resetLeafletMock();
  vi.mocked(api.fetchWindGrid).mockReset();
  vi.mocked(api.fetchPointTide).mockReset();
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

  it('binds the shared placement options and keeps an edge pop-up inside the panel (SCRUM-252)', () => {
    render(<MapView {...baseProps} locations={[makeLocation({ id: 3 })]} />);

    expect(createdMarkers[0].popupOptions).toMatchObject({ autoPan: true, keepInView: true });
    expect(createdMarkers[0].popupOptions?.autoPanPaddingTopLeft).toEqual([12, 88]);

    const popup = document.createElement('div');
    popup.className = 'leaflet-popup';
    const tip = document.createElement('div');
    tip.className = 'leaflet-popup-tip-container';
    popup.append(tip);
    document.body.append(popup);

    act(() => currentMap().fire('popupopen', { popup: { getElement: () => popup } }));

    // jsdom reports every rect as empty, so the card looks like it sits in the top-left corner.
    expect(popup.style.marginLeft).toBe('12px');
    expect(popup.style.marginTop).toBe('88px');
    expect(tip.style.display).toBe('none');

    popup.remove();
  });
});

describe('MapView popup tide block (SCRUM-316)', () => {
  const tide = {
    latitude: 48.19,
    longitude: -122.74,
    datum: 'msl',
    unit: 'm',
    hour: '2026-11-25T12:00',
    points: [{ time: '2026-11-25T12:00', height_m: 1.4 }],
    last_extreme: { type: 'low' as const, time: '2026-11-25T03:40', height_m: 0.2 },
    next_extreme: { type: 'high' as const, time: '2026-11-25T15:38', height_m: 2.3 },
    next_extreme_after: null,
  };

  /** A minimal pop-up element carrying the slot the builders write, opened on the map. */
  function openPopupWithSlot(latitude: number, longitude: number) {
    const popup = document.createElement('div');
    popup.className = 'leaflet-popup';
    popup.innerHTML = `<div data-tide-slot data-tide-lat="${latitude}" data-tide-lon="${longitude}"></div>`;
    document.body.append(popup);
    act(() => currentMap().fire('popupopen', { popup: { getElement: () => popup } }));
    return { popup, slot: popup.querySelector<HTMLElement>('[data-tide-slot]')! };
  }

  it('fills the slot when the tide loads', async () => {
    vi.mocked(api.fetchPointTide).mockResolvedValueOnce(tide);
    render(<MapView {...baseProps} locations={[]} />);
    const { popup, slot } = openPopupWithSlot(48.19, -122.74);

    await waitFor(() => expect(slot.textContent).toContain('Tide · above MSL'));
    expect(api.fetchPointTide).toHaveBeenCalledWith(48.19, -122.74, null);
    popup.remove();
  });

  it('says the tide is unavailable when the request fails', async () => {
    vi.mocked(api.fetchPointTide).mockRejectedValueOnce(new Error('502'));
    render(<MapView {...baseProps} locations={[]} />);
    const { popup, slot } = openPopupWithSlot(48.23, -122.71);

    await waitFor(() => expect(slot.textContent).toContain('Tide unavailable'));
    expect(slot.textContent).not.toContain('Not for navigation');
    popup.remove();
  });

  it('stays silent over land', async () => {
    vi.mocked(api.fetchPointTide).mockResolvedValueOnce({
      ...tide,
      points: [],
      last_extreme: null,
      next_extreme: null,
    });
    render(<MapView {...baseProps} locations={[]} />);
    const { popup, slot } = openPopupWithSlot(48.26, -122.68);

    await waitFor(() => expect(api.fetchPointTide).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(slot.innerHTML).toBe('');
    popup.remove();
  });

  it('asks for no tide when the pop-up has no slot', () => {
    render(<MapView {...baseProps} locations={[]} />);
    const popup = document.createElement('div');
    document.body.append(popup);

    act(() => currentMap().fire('popupopen', { popup: { getElement: () => popup } }));

    expect(api.fetchPointTide).not.toHaveBeenCalled();
    popup.remove();
  });
});

describe('MapView startup focus (SCRUM-248)', () => {
  const focus = makeLocation({ id: 7, name: 'My Current Location', latitude: 48.1, longitude: -122.4 });

  it('flies to the focus without selecting the marker or opening its pop-up', () => {
    render(<MapView {...baseProps} locations={[focus]} focusLocation={focus} />);

    const marker = markerAt(focus.latitude, focus.longitude)!;
    expect(currentMap().flyTo).toHaveBeenCalledWith([focus.latitude, focus.longitude], 9, expect.any(Object));
    expect(marker.openPopup).not.toHaveBeenCalled();
    expect((marker.icon as { html?: string }).html ?? '').not.toContain('scale-110');
  });

  it('flies to a selected location and opens its pop-up', () => {
    const location = makeLocation();
    render(<MapView {...baseProps} locations={[location]} selectedLocation={location} />);

    const marker = markerAt(location.latitude, location.longitude)!;
    expect(currentMap().flyTo).toHaveBeenCalledWith([location.latitude, location.longitude], 9, expect.any(Object));
    expect(marker.openPopup).toHaveBeenCalledTimes(1);
    expect((marker.icon as { html?: string }).html ?? '').toContain('scale-110');
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

  it('draws the chart’s lighter gradient on any base when high contrast is on (SCRUM-213)', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
    ]);
    // jsdom has no canvas backend; the opacity is written on each paint, so give it a 2D context.
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    const { rerender } = render(<MapView {...baseProps} locations={[]} windColorOverlayVisible />);

    const canvas = () =>
      currentMap().panes[WIND_COLOR_PANE].querySelector('canvas') as HTMLCanvasElement;
    await waitFor(() => expect(canvas().style.opacity).toBe(String(WIND_COLOR_OPACITY)));

    rerender(
      <MapView {...baseProps} locations={[]} windColorOverlayVisible windColorHighContrast />,
    );
    expect(canvas().style.opacity).toBe(String(WIND_COLOR_OPACITY_ON_CHART));
    context.mockRestore();
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

describe('MapView chart declutter (SCRUM-211)', () => {
  const barbs = () =>
    createdMarkers.filter((marker) =>
      ((marker.icon as { html?: string }).html ?? '').includes('data-wind-barb'),
    );

  it('drops grid barbs under a saved-location marker so its labelled barb reads', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48.5, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
      { latitude: 48, longitude: -121, wind_speed_knots: 20, wind_direction_deg: 90, temperature_f: 50 },
    ]);
    const location = makeLocation({ id: 3, latitude: 48.5, longitude: -122 });
    render(
      <MapView {...baseProps} locations={[location]} tileLayerType="paper_chart" windOverlayVisible />,
    );

    await waitFor(() => expect(barbs()).toHaveLength(1));
    expect(barbs()[0].latlng).toEqual([48, -121]);
    expect(markerAt(48.5, -122)).toBeDefined(); // the location marker itself stays
  });

  it('draws every grid barb on the other bases, keep-outs and thinning included', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48.5, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
      { latitude: 48, longitude: -121, wind_speed_knots: 20, wind_direction_deg: 90, temperature_f: 50 },
    ]);
    const location = makeLocation({ id: 3, latitude: 48.5, longitude: -122 });
    render(<MapView {...baseProps} locations={[location]} windOverlayVisible />);

    await waitFor(() => expect(barbs()).toHaveLength(2));
  });
});

describe('MapView chart edge treatment (SCRUM-215)', () => {
  // The effect can be invoked twice by the test renderer; only the rule still on the map counts.
  const liveBoundary = () => createdPolylines.filter((line) => line.remove.mock.calls.length === 0);

  it('draws the 49.6 N rule across the coverage box, only while the chart is selected', async () => {
    const { rerender } = render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);

    await waitFor(() => expect(liveBoundary()).toHaveLength(1));
    const boundary = liveBoundary()[0];
    expect(boundary.latlngs).toEqual([
      [CHART_BOUNDS.north, CHART_BOUNDS.west],
      [CHART_BOUNDS.north, CHART_BOUNDS.east],
    ]);
    expect(boundary.options.pane).toBe(CHART_EDGE_PANE);
    expect(boundary.options.dashArray).toBe('6 6');
    expect(boundary.options.interactive).toBe(false);
    // Above the tiles and below the depth shading, so soundings stay under the gradient only.
    expect(currentMap().panes[CHART_EDGE_PANE].style.zIndex).toBe('206');
    expect(currentMap().panes[CHART_EDGE_PANE].style.pointerEvents).toBe('none');

    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);
    expect(boundary.remove).toHaveBeenCalled();
  });

  it('names the limit while the view crosses it, and stays quiet on either side', async () => {
    render(<MapView {...baseProps} locations={[]} tileLayerType="paper_chart" />);
    const map = currentMap();

    // The mock view (47-49 N) sits entirely on charted water.
    await waitFor(() => expect(liveBoundary()).toHaveLength(1));
    expect(screen.queryByTestId('chart-edge-notice')).toBeNull();

    act(() => {
      map.bounds = { south: 48.5, north: 50.5, west: -124, east: -122 };
      map.fire('moveend');
    });
    expect(screen.getByTestId('chart-edge-notice').textContent).toContain('49.6° N');
    expect(screen.queryByTestId('chart-coverage-notice')).toBeNull();

    // Fully north of the clip: the coverage chip already explains that, so the edge one steps aside.
    act(() => {
      map.bounds = { south: 50, north: 51, west: -124, east: -122 };
      map.fire('moveend');
    });
    expect(screen.queryByTestId('chart-edge-notice')).toBeNull();
    expect(screen.getByTestId('chart-coverage-notice')).toBeTruthy();
  });

  it('shows no edge rule or notice on the other bases', async () => {
    render(<MapView {...baseProps} locations={[]} />);

    await new Promise((r) => setTimeout(r, 0));
    expect(liveBoundary()).toHaveLength(0);
    expect(screen.queryByTestId('chart-edge-notice')).toBeNull();
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

describe('MapView Seamap base (SCRUM-206)', () => {
  let glLayer: {
    addTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    getMaplibreMap: () => { loaded: () => boolean };
  };
  let unregister: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    glLayer = {
      addTo: vi.fn(),
      remove: vi.fn(),
      getMaplibreMap: () => ({ loaded: () => true }),
    };
    glLayer.addTo.mockReturnValue(glLayer);
    unregister = vi.fn();
    seamap.createSeamapLayer.mockReset();
    seamap.mountSeamapLayer.mockReset();
    seamap.createSeamapLayer.mockResolvedValue(glLayer);
    seamap.mountSeamapLayer.mockImplementation(
      (map: unknown, layer: { addTo: (target: unknown) => unknown }) => {
        layer.addTo(map);
        return unregister;
      },
    );
    vi.mocked(api.fetchWindGrid).mockResolvedValue([]);
  });

  it('mounts the keyless substrate and one GL layer in the chart pane, then removes both', async () => {
    const { rerender } = render(<MapView {...baseProps} locations={[]} tileLayerType="seamap" />);

    await waitFor(() => expect(seamap.mountSeamapLayer).toHaveBeenCalledTimes(1));
    const substrate = createdTileLayers.find((layer) => layer.kind === 'xyz')!;
    expect(substrate.url).toContain('tile.openstreetmap.org');
    expect(substrate.options?.className).toBe('osm-dark-tiles');
    // The same pane as the chart: above the base tiles, below the depth shading and the aids.
    expect(currentMap().panes[CHART_PANE].style.zIndex).toBe('205');

    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);

    await waitFor(() => expect(glLayer.remove).toHaveBeenCalled());
    expect(unregister).toHaveBeenCalled();
    expect(substrate.remove).toHaveBeenCalled();
    // No GL layer is left behind and the plain base took its place.
    expect(
      createdTileLayers.filter(
        (layer) => layer.options?.className === 'osm-dark-tiles' && layer.remove.mock.calls.length === 0,
      ),
    ).toHaveLength(1);
  });

  it('removes the GL layer when the map goes away', async () => {
    const { unmount } = render(<MapView {...baseProps} locations={[]} tileLayerType="seamap" />);
    await waitFor(() => expect(seamap.mountSeamapLayer).toHaveBeenCalled());

    unmount();

    expect(unregister).toHaveBeenCalled();
    expect(glLayer.remove).toHaveBeenCalled();
  });

  it('never mounts the layer on a map that went away while the renderer loaded', async () => {
    let finish!: (layer: typeof glLayer) => void;
    seamap.createSeamapLayer.mockReturnValue(
      new Promise<typeof glLayer>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<MapView {...baseProps} locations={[]} tileLayerType="seamap" />);
    await waitFor(() => expect(seamap.createSeamapLayer).toHaveBeenCalled());

    unmount();
    finish(glLayer);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(glLayer.addTo).not.toHaveBeenCalled();
    expect(seamap.mountSeamapLayer).not.toHaveBeenCalled();
  });

  it('gives the barbs the light-base ring and the gradient the attenuated wash', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      {
        latitude: 48,
        longitude: -122,
        wind_speed_knots: 12,
        wind_direction_deg: 180,
        temperature_f: 55,
      },
    ]);
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(
      <MapView
        {...baseProps}
        locations={[]}
        tileLayerType="seamap"
        windOverlayVisible
        windColorOverlayVisible
        selectedGridPoint={{ latitude: 48, longitude: -122 }}
      />,
    );

    await waitFor(() => expect(createdMarkers).toHaveLength(1));
    const html = (createdMarkers[0].icon as { html: string }).html;
    expect(html).toContain('data-barb-outline="true"');
    expect(html).toContain('box-shadow:0 0 0 2px #161b22');

    const canvas = currentMap().panes[WIND_COLOR_PANE].querySelector('canvas') as HTMLCanvasElement;
    await waitFor(() => expect(canvas.style.opacity).toBe(String(WIND_COLOR_OPACITY_ON_CHART)));
    context.mockRestore();
  });

  it('draws every grid barb on Seamap: the chart declutter is chart-only', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48.5, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
      { latitude: 48, longitude: -121, wind_speed_knots: 20, wind_direction_deg: 90, temperature_f: 50 },
    ]);
    render(<MapView {...baseProps} locations={[]} tileLayerType="seamap" windOverlayVisible />);

    const barbs = () =>
      createdMarkers.filter((marker) =>
        ((marker.icon as { html?: string }).html ?? '').includes('data-wind-barb'),
      );
    await waitFor(() => expect(barbs()).toHaveLength(2));
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

describe('MapView missing wind data (SCRUM-225)', () => {
  const barbMarkers = () =>
    createdMarkers.filter((marker) =>
      ((marker.icon as { html?: string }).html ?? '').includes('data-wind-barb'),
    );

  it('draws no barb and names the model when the whole view has no data', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48, longitude: -122, wind_speed_knots: null, wind_direction_deg: null, temperature_f: null },
      { latitude: 49, longitude: -121, wind_speed_knots: null, wind_direction_deg: null, temperature_f: null },
    ]);
    render(<MapView {...baseProps} locations={[]} modelName="ECMWF IFS" windOverlayVisible />);

    await waitFor(() => expect(screen.getByTestId('no-wind-data-notice')).toBeTruthy());
    expect(screen.getByTestId('no-wind-data-notice').textContent).toContain('ECMWF IFS');
    expect(barbMarkers()).toHaveLength(0);
  });

  it('shows no notice when the view has wind data', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([
      { latitude: 48, longitude: -122, wind_speed_knots: 12, wind_direction_deg: 180, temperature_f: 55 },
    ]);
    render(<MapView {...baseProps} locations={[]} windOverlayVisible />);

    await waitFor(() => expect(barbMarkers()).toHaveLength(1));
    expect(screen.queryByTestId('no-wind-data-notice')).toBeNull();
  });

  it('shows a no-data marker and "No data" values for a location without wind', () => {
    const location = makeLocation({ id: 5 });
    const weather = makeForecast({
      location_id: 5,
      current: makePoint(0, 0, 0, {
        wind_speed_knots: null,
        wind_direction_deg: null,
        wind_gust_knots: null,
        temperature_c: null,
        temperature_f: null,
      }),
    });
    render(<MapView {...baseProps} locations={[location]} weatherMap={{ 5: weather }} />);

    const marker = createdMarkers.find(
      (entry) => ((entry.icon as { html?: string }).html ?? '').includes('No wind data'),
    );
    expect(marker).toBeTruthy();
    expect(marker!.popupHtml).toContain('No data');
    expect(marker!.popupHtml).not.toContain('32°F');
  });
});

describe('MapView container ref (SCRUM-283)', () => {
  it('keeps the ref callback stable across a re-render', () => {
    // A changing ref callback makes React detach and reattach the node on every render, and
    // MapView re-renders on every grid update — the export hook's containerRef went null each time.
    const assignments: (HTMLDivElement | null)[] = [];
    const containerRef = {
      get current() {
        return assignments[assignments.length - 1] ?? null;
      },
      set current(node: HTMLDivElement | null) {
        assignments.push(node);
      },
    };

    const { rerender } = render(
      <MapView {...baseProps} locations={[]} containerRef={containerRef} />,
    );
    const afterMount = assignments.length;
    expect(afterMount).toBe(1);
    expect(assignments[0]).not.toBeNull();

    rerender(<MapView {...baseProps} locations={[]} containerRef={containerRef} />);
    rerender(<MapView {...baseProps} locations={[]} containerRef={containerRef} />);

    expect(assignments.length).toBe(afterMount);
  });

  it('renders the Google logo badge when google_satellite is selected (SCRUM-311)', () => {
    const { rerender } = render(<MapView {...baseProps} locations={[]} tileLayerType="google_satellite" />);
    const badge = screen.getByTestId('google-maps-badge');
    expect(badge.querySelector('img')?.getAttribute('alt')).toBe('Google');

    rerender(<MapView {...baseProps} locations={[]} tileLayerType="osm_dark" />);
    expect(screen.queryByTestId('google-maps-badge')).toBeNull();
  });
});
