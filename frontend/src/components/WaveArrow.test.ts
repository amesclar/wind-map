import { describe, expect, it } from 'vitest';
import {
  buildWaveArrowIcon,
  buildWavePopup,
  generateWaveArrowSvg,
  generateWaveKeySvg,
  lineOffsets,
  travelDirection,
} from './WaveArrow';
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

const parse = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

/** The paths of the fill layer; the rim group repeats them. */
const fillPaths = (heightM: number) =>
  [...parse(generateWaveArrowSvg(heightM, 0)).querySelectorAll('g')[1].querySelectorAll('path')].map(
    (path) => path.getAttribute('d') ?? '',
  );

const headCount = (heightM: number) => fillPaths(heightM).filter((d) => d.includes(' L ')).length;

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

describe('counted wavy lines (SCRUM-292)', () => {
  it('draws one wavy line and one chevron head per height tier', () => {
    expect(fillPaths(0.5)).toHaveLength(2); // 1 shaft + 1 head
    expect(fillPaths(1.5)).toHaveLength(4);
    expect(fillPaths(3)).toHaveLength(6);
    expect(fillPaths(4.5)).toHaveLength(8);

    expect(headCount(0.5)).toBe(1);
    expect(headCount(1.5)).toBe(2);
    expect(headCount(3)).toBe(3);
    expect(headCount(4.5)).toBe(4);
  });

  it('draws shafts as curves, not the old straight staff', () => {
    const shafts = fillPaths(3).filter((d) => d.includes(' C '));

    expect(shafts).toHaveLength(3);
    expect(fillPaths(3).some((d) => d === 'M 20 31 L 20 12')).toBe(false);
  });

  it('sets the parallel lines symmetrically about the glyph centre', () => {
    const starts = (count: number) =>
      lineOffsets(count).map((offset) => offset.toFixed(2));

    expect(starts(1)).toEqual(['0.00']);
    expect(starts(2)).toEqual(['-5.00', '5.00']);
    expect(starts(3)).toEqual(['-8.50', '0.00', '8.50']);
    expect(starts(4)).toEqual(['-11.40', '-3.80', '3.80', '11.40']);
  });

  it('narrows the head and thins the stroke as the lines multiply', () => {
    const stroke = (heightM: number) =>
      Number(parse(generateWaveArrowSvg(heightM, 0)).querySelectorAll('g')[1].getAttribute('stroke-width'));

    expect(stroke(0.5)).toBeGreaterThan(stroke(4.5));
    // The dark rim is thinner on a crowded glyph so neighbouring rims cannot merge.
    const rim = (heightM: number) =>
      Number(parse(generateWaveArrowSvg(heightM, 0)).querySelectorAll('g')[0].getAttribute('stroke-width'));
    expect(rim(0.5) - stroke(0.5)).toBeCloseTo(2);
    expect(rim(4.5) - stroke(4.5)).toBeCloseTo(1.6);
  });
});

describe('generateWaveKeySvg (SCRUM-305)', () => {
  const keySvg = (heightM: number) => parse(generateWaveKeySvg(heightM)).querySelector('svg')!;
  const keyWidth = (heightM: number) => Number(keySvg(heightM).getAttribute('width'));

  it('crops the key glyph to its ink, widening with the line count', () => {
    expect(keyWidth(0.5)).toBeLessThan(keyWidth(1.5));
    expect(keyWidth(1.5)).toBeLessThan(keyWidth(3));
    expect(keyWidth(3)).toBeLessThan(keyWidth(4.5));

    // Narrower than the old 20 px square at every tier, which is what pushed the values away.
    expect(keyWidth(4.5)).toBeLessThan(20);
    expect(keyWidth(0.5)).toBeLessThan(7);
  });

  it('draws the key glyph upright at 20 px, in the tier colour over the rim', () => {
    const svg = keySvg(4.5);

    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.innerHTML).not.toContain('rotate(');
    expect(svg.innerHTML).toContain('#ef4444');
    expect(svg.innerHTML).toContain(WAVE_TIER_OUTLINE);
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
