import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';
import { makeLocation } from '../test/fixtures';
import { createdMarkers, currentMap, markerAt, resetLeafletMock } from '../test/leafletMock';
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

  it('gives the barbs a dark halo while the gradient is on', async () => {
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
    expect(html).toContain('wind-barb-halo');
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
