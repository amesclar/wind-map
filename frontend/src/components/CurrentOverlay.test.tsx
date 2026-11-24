import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { CurrentOverlay } from './CurrentOverlay';
import { createdMarkers, liveMarkers, resetLeafletMock } from '../test/leafletMock';
import type { CurrentPoint } from '../types';

vi.mock('leaflet', () => import('../test/leafletMock'));

const points: CurrentPoint[] = [
  { latitude: 47.9, longitude: -124.6, velocity_knots: 1.3, direction_deg: 333 },
  { latitude: 48.2, longitude: -125.0, velocity_knots: 3.4, direction_deg: 10 },
];

function makeMap() {
  return L.map(document.createElement('div'));
}

beforeEach(() => {
  resetLeafletMock();
});

describe('CurrentOverlay (SCRUM-99)', () => {
  it('draws one chevron marker per point', () => {
    const map = makeMap();

    render(<CurrentOverlay map={map} points={points} />);

    expect(liveMarkers()).toHaveLength(2);
    expect(createdMarkers[0].latlng).toEqual([47.9, -124.6]);
    expect(createdMarkers[1].latlng).toEqual([48.2, -125.0]);
  });

  it('binds a pop-up with the point values, units and selected hour', () => {
    const map = makeMap();

    render(<CurrentOverlay map={map} points={points} speedUnit="kmh" timeLabel="Mon 23 Nov 12:00 PST" />);

    const html = createdMarkers[0].popupHtml ?? '';
    expect(html).toContain('Water current');
    expect(html).toContain('2.4 km/h');
    expect(html).toContain('NNW (333°)');
    expect(html).toContain('Mon 23 Nov 12:00 PST');
    expect(createdMarkers[1].popupHtml).toContain('6.3 km/h');
  });

  it('removes every marker on unmount', () => {
    const map = makeMap();

    const { unmount } = render(<CurrentOverlay map={map} points={points} />);
    expect(liveMarkers()).toHaveLength(2);

    unmount();
    expect(liveMarkers()).toHaveLength(0);
  });

  it('draws nothing without points or a map', () => {
    render(<CurrentOverlay map={null} points={points} />);
    expect(createdMarkers).toHaveLength(0);

    const map = makeMap();
    render(<CurrentOverlay map={map} points={[]} />);
    expect(createdMarkers).toHaveLength(0);
  });
});
