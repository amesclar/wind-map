import { describe, expect, it, vi } from 'vitest';
import { buildLocationPopup } from './MapView';
import { buildGridPointPopup } from './WindOverlay';
import { makeForecast, makeLocation } from '../test/fixtures';

vi.mock('leaflet', () => import('../test/leafletMock'));

const LABEL = 'Mon 23 Nov 12:00 PST';
const gridPoint = {
  latitude: 48.78,
  longitude: -121.94,
  wind_speed_knots: 14,
  wind_direction_deg: 220,
  temperature_f: 53.6,
};

describe('pop-ups carry the selected forecast hour (SCRUM-127)', () => {
  it('adds the hour to the saved-location pop-up, and omits it for live values', () => {
    const location = makeLocation();
    const weather = makeForecast();

    const timed = buildLocationPopup(location, weather, 'imperial', 'knots', LABEL);
    expect(timed).toContain('🕒');
    expect(timed).toContain(LABEL);

    const live = buildLocationPopup(location, weather, 'imperial', 'knots');
    expect(live).not.toContain('🕒');
  });

  it('adds the hour to the barb pop-up, and omits it for live values', () => {
    const timed = buildGridPointPopup(gridPoint, 'imperial', 'knots', 'deg', LABEL);
    expect(timed).toContain('🕒');
    expect(timed).toContain(LABEL);

    const live = buildGridPointPopup(gridPoint, 'imperial', 'knots', 'deg');
    expect(live).not.toContain('🕒');
  });
});
