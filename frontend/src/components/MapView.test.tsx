import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from './MapView';
import { makeLocation } from '../test/fixtures';
import { createdMarkers, currentMap, resetLeafletMock } from '../test/leafletMock';
import * as api from '../api/client';

vi.mock('leaflet', () => import('../test/leafletMock'));

// The shared wind grid fetch lives in MapView (SCRUM-122).
vi.mock('../api/client', () => ({ fetchWindGrid: vi.fn() }));

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
