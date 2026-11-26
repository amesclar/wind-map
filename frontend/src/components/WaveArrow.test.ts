import { describe, expect, it } from 'vitest';
import { buildWaveArrowIcon, buildWavePopup, generateWaveArrowSvg, travelDirection } from './WaveArrow';
import type { WavePoint, WaveSeriesPoint } from '../types';
import { WAVE_TIER_OUTLINE } from '../utils/waveTiers';

const point: WavePoint = {
  latitude: 48.29,
  longitude: -122.65,
  height_m: 1.6,
  direction_deg: 240,
  period_s: 8,
};

const seriesPoint = (index: number): WaveSeriesPoint => ({
  time: `2026-11-26T${String(index % 24).padStart(2, '0')}:00`,
  height_m: 1.6,
  direction_deg: 240,
  period_s: 8,
});

describe('travelDirection (SCRUM-234)', () => {
  it('adds 180 degrees because the API names where the waves come from', () => {
    expect(travelDirection(240)).toBe(60);
    expect(travelDirection(0)).toBe(180);
    expect(travelDirection(350)).toBe(170);
    expect(travelDirection(180)).toBe(0);
  });
});

describe('generateWaveArrowSvg (SCRUM-234)', () => {
  it('rotates the arrow by direction + 180 and uses the tier colour', () => {
    const svg = generateWaveArrowSvg(1.6, 240);

    expect(svg).toContain('rotate(60, 20, 20)');
    expect(svg).toContain('#38bdf8'); // the 1–2 m tier
    expect(svg).toContain(WAVE_TIER_OUTLINE);
    expect(svg).toContain('aria-label="1.6 m waves from 240°"');
  });

  it('sizes the glyph by the height tier', () => {
    expect(generateWaveArrowSvg(0.5, 0)).toContain('width="28"');
    expect(generateWaveArrowSvg(4.5, 0)).toContain('width="46"');
    expect(generateWaveArrowSvg(4.5, 0)).toContain('#ef4444');
  });
});

describe('buildWaveArrowIcon (SCRUM-263)', () => {
  it('grows the smallest icon box to a 32 px hit area and centres the glyph in it', () => {
    const icon = buildWaveArrowIcon({ ...point, height_m: 0.4 });

    expect(icon.options.iconSize).toEqual([32, 32]);
    expect(icon.options.iconAnchor).toEqual([16, 16]);
    expect(icon.options.html).toContain('data-hit="32"');
    expect(icon.options.html).toContain('width="28"');
  });

  it('keeps the larger tiers at their drawn size', () => {
    const icon = buildWaveArrowIcon({ ...point, height_m: 4.5 });

    expect(icon.options.iconSize).toEqual([46, 46]);
    expect(icon.options.html).toContain('data-tier="high"');
  });
});

describe('buildWavePopup (SCRUM-234)', () => {
  it('shows the height in the user’s unit, the period and where the waves come from', () => {
    const html = buildWavePopup(point, 'imperial', 'Mon 23 Nov 12:00 PST');

    expect(html).toContain('5.2 ft');
    expect(html).toContain('8 s');
    expect(html).toContain('SW (240°) from');
    expect(html).toContain('Copernicus Marine');
    expect(html).toContain('Mon 23 Nov 12:00 PST');
    expect(html).toContain('Loading the next 48 h'); // not yet fetched
    expect(buildWavePopup(point, 'metric')).toContain('1.6 m');
  });

  it('lists all 48 hourly rows once the series arrives', () => {
    const series = Array.from({ length: 48 }, (_, index) => seriesPoint(index));
    const html = buildWavePopup(point, 'metric', null, series);

    expect(html).toContain('data-wave-count="48"');
    expect(html).toContain('11-26 00:00');
    expect(html).not.toContain('Loading the next 48 h');
  });

  it('explains an empty or failed series without hiding the summary', () => {
    expect(buildWavePopup(point, 'metric', null, [])).toContain('No hourly wave data for this point');
    const failed = buildWavePopup(point, 'metric', null, null, true);
    expect(failed).toContain('Hourly wave data unavailable');
    expect(failed).toContain('1.6 m');
  });
});
