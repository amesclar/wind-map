import { describe, expect, it } from 'vitest';
import type { TidePointResponse } from '../types';
import { buildLocationPopup } from '../components/MapView';
import { buildGridPointPopup } from '../components/WindOverlay';
import { makeLocation } from '../test/fixtures';
import { buildTideBlockHtml, formatTideHeight, formatTideTime } from './tideBlock';

const tide: TidePointResponse = {
  latitude: 48.4,
  longitude: -122.7,
  datum: 'msl',
  unit: 'm',
  hour: '2026-11-25T12:00',
  points: [{ time: '2026-11-25T12:00', height_m: 1.4 }],
  last_extreme: { type: 'low', time: '2026-11-25T03:40', height_m: 0.2 },
  next_extreme: { type: 'high', time: '2026-11-25T15:38', height_m: 2.3 },
};

describe('tide heights and times', () => {
  it('shows feet for imperial and metres for metric', () => {
    expect(formatTideHeight(1.0, 'imperial')).toBe('3.3 ft');
    expect(formatTideHeight(-0.2, 'metric')).toBe('-0.2 m');
  });

  it('formats a UTC stamp as local HH:mm', () => {
    expect(formatTideTime('2026-11-25T15:38')).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTideTime('2026-11-25T15:38Z')).toBe(formatTideTime('2026-11-25T15:38'));
  });
});

describe('tide block (SCRUM-195)', () => {
  it('names the datum and the caveat, and shows now with the last low and next high', () => {
    const html = buildTideBlockHtml(tide, 'imperial', true, null);

    expect(html).toContain('Tide · above MSL');
    expect(html).toContain('Not for navigation');
    expect(html).toContain('4.6 ft');
    expect(html).toContain('now');
    expect(html).toContain('last low');
    expect(html).toContain('next high');
    expect(html).toContain('▲');
    expect(html).toContain('▼');
    expect(html).not.toContain('⬆');
    expect(html).not.toContain('⬇');
    expect(html).toContain('aria-hidden="true"');
  });

  it('names the selected hour instead of now for a forecast hour', () => {
    const html = buildTideBlockHtml(tide, 'metric', false, 'Wed 25 Nov 12:00 PST');

    expect(html).toContain('1.4 m');
    expect(html).toContain('Wed 25 Nov 12:00 PST');
    expect(html).not.toContain('>now<');
  });

  it('renders nothing over land', () => {
    expect(
      buildTideBlockHtml({ ...tide, points: [], last_extreme: null, next_extreme: null }, 'metric', true, null),
    ).toBe('');
  });
});

describe('popup tide slots', () => {
  it('puts an empty tide slot in a saved-location popup', () => {
    const html = buildLocationPopup(makeLocation(), undefined, 'imperial', 'knots', null);
    expect(html).toContain('data-tide-slot');
    expect(html).toContain('data-tide-lat=');
    expect(html).toContain('data-tide-lon=');
  });

  it('puts the same slot in a grid-point popup', () => {
    const html = buildGridPointPopup({
      latitude: 48.4,
      longitude: -122.7,
      wind_speed_knots: 10,
      wind_direction_deg: 90,
      temperature_f: 55,
    });
    expect(html).toContain('data-tide-slot');
  });
});
