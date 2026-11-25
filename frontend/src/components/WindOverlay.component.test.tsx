import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { WindOverlay } from './WindOverlay';
import type { GridWindPoint } from '../types';
import { createdMarkers as created, resetLeafletMock } from '../test/leafletMock';

// SCRUM-122: the overlay only draws the points MapView hands it; fetching is covered by
// hooks/useWindGrid.test.ts.
vi.mock('leaflet', () => import('../test/leafletMock'));

function fakeMap() {
  const handlers: Record<string, () => void> = {};
  const state = { zoom: 13 };
  const map = {
    getBounds: () => ({ getSouth: () => 47, getNorth: () => 49, getWest: () => -123, getEast: () => -121 }),
    getSize: () => ({ x: 800, y: 600 }),
    getZoom: () => state.zoom,
    latLngToContainerPoint: ([lat, lon]: [number, number]) => ({
      x: ((lon + 123) / 2) * 800,
      y: ((49 - lat) / 2) * 600,
    }),
    on: vi.fn((event: string, fn: () => void) => {
      handlers[event] = fn;
    }),
    off: vi.fn(),
  };
  return { map: map as unknown as L.Map, state };
}

const point = (lat: number, lon = -122): GridWindPoint => ({
  latitude: lat,
  longitude: lon,
  wind_speed_knots: 10,
  wind_direction_deg: 90,
  temperature_f: 60,
});

const htmlOf = (marker: (typeof created)[number]) => (marker.icon as { html: string }).html;

beforeEach(() => resetLeafletMock());

describe('WindOverlay drawing (SCRUM-122)', () => {
  it('draws one barb per shared grid point and nothing without points', () => {
    const { map } = fakeMap();
    const props = { map, selectedPoint: null, onGridPointSelect: () => {} };
    const { rerender } = render(<WindOverlay {...props} points={[]} />);
    expect(created).toHaveLength(0);

    rerender(<WindOverlay {...props} points={[point(48), point(49)]} />);
    expect(created.map((m) => m.latlng)).toEqual([
      [48, -122],
      [49, -122],
    ]);
  });

  it('selects the clicked grid point', () => {
    const { map } = fakeMap();
    const onSelect = vi.fn();
    const pt = point(48);
    render(<WindOverlay map={map} points={[pt]} selectedPoint={null} onGridPointSelect={onSelect} />);

    created[0].fire('click');
    expect(onSelect).toHaveBeenCalledWith(pt);
  });

  it('highlights the selected point without recreating markers', () => {
    const { map } = fakeMap();
    const points = [point(48)];
    const props = { map, points, onGridPointSelect: () => {} };
    const { rerender } = render(<WindOverlay {...props} selectedPoint={null} />);
    const marker = created[0];
    expect(htmlOf(marker)).toContain('data-selected="false"');

    rerender(<WindOverlay {...props} selectedPoint={{ latitude: 48, longitude: -122 }} />);
    expect(created).toHaveLength(1);
    expect(marker.setIcon).toHaveBeenCalled();
    expect(htmlOf(marker)).toContain('data-selected="true"');
    expect(htmlOf(marker)).toContain('box-shadow:0 0 0 2px #ffffff');
  });

  it('gives every barb the crisp outline, gradient or not (SCRUM-218)', () => {
    const { map } = fakeMap();
    const points = [point(48)];
    const props = { map, points, selectedPoint: null, onGridPointSelect: () => {} };
    const { rerender } = render(<WindOverlay {...props} />);
    const marker = created[0];
    expect(htmlOf(marker)).toContain('data-barb-outline="true"');
    expect(htmlOf(marker)).not.toContain('wind-barb-halo');

    rerender(<WindOverlay {...props} selectedPoint={{ latitude: 48, longitude: -122 }} />);
    expect(created).toHaveLength(1); // the icon changes, the marker does not
    expect(htmlOf(marker)).toContain('data-barb-outline="true"');
  });

  it('replaces the markers when new points arrive', () => {
    const { map } = fakeMap();
    const props = { map, selectedPoint: null, onGridPointSelect: () => {} };
    const { rerender } = render(<WindOverlay {...props} points={[point(48)]} />);
    const firstMarker = created[0];

    rerender(<WindOverlay {...props} points={[point(47), point(46)]} />);
    expect(firstMarker.remove).toHaveBeenCalled();
    expect(created.map((m) => m.latlng)).toEqual([
      [48, -122],
      [47, -122],
      [46, -122],
    ]);
  });

  it('thins the chart grid at its native zoom and draws every point deeper in (SCRUM-211)', () => {
    const { map, state } = fakeMap();
    const props = { map, selectedPoint: null, onGridPointSelect: () => {} };
    const points = [point(48, -122), point(48, -121.5), point(47.5, -122), point(47.5, -121.5)];

    state.zoom = 12;
    const { rerender } = render(<WindOverlay {...props} points={points} declutter />);
    // Checkerboard: the even row + even column pair survives, its neighbours do not.
    expect(created.map((m) => m.latlng)).toEqual([
      [48, -122],
      [47.5, -121.5],
    ]);

    state.zoom = 13;
    rerender(<WindOverlay {...props} points={[...points]} declutter />);
    expect(created).toHaveLength(6); // the two thinned markers plus the four redrawn
    expect(created.slice(2).map((m) => m.latlng)).toHaveLength(4);
  });

  it('leaves a saved location clear of grid barbs on the chart (SCRUM-211)', () => {
    const { map } = fakeMap();
    render(
      <WindOverlay
        map={map}
        points={[point(48, -122), point(48, -121)]}
        selectedPoint={null}
        onGridPointSelect={() => {}}
        declutter
        keepOut={[{ latitude: 48, longitude: -122 }]}
      />,
    );

    expect(created.map((m) => m.latlng)).toEqual([[48, -121]]);
  });

  it('removes its markers when the points are cleared and on unmount', () => {
    const { map } = fakeMap();
    const props = { map, selectedPoint: null, onGridPointSelect: () => {} };
    const { rerender, unmount } = render(<WindOverlay {...props} points={[point(48)]} />);
    const marker = created[0];

    rerender(<WindOverlay {...props} points={[]} />);
    expect(marker.remove).toHaveBeenCalled();

    rerender(<WindOverlay {...props} points={[point(47)]} />);
    const latest = created[1];
    unmount();
    expect(latest.remove).toHaveBeenCalled();
  });
});
