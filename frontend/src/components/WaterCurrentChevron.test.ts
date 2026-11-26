import { describe, expect, it } from 'vitest';
import {
  buildCurrentChevronIcon,
  buildCurrentPopup,
  CURRENT_CHEVRON_SIZE,
  generateCurrentChevronSvg,
} from './WaterCurrentChevron';
import { CURRENT_TIER_OUTLINE } from '../utils/currentTiers';

const parse = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

const point = {
  latitude: 47.9,
  longitude: -124.6,
  velocity_knots: 1.3,
  direction_deg: 333,
};

describe('generateCurrentChevronSvg (SCRUM-99)', () => {
  it('points the glyph where the water flows, without a 180° flip', () => {
    expect(generateCurrentChevronSvg(1.3, 333)).toContain('rotate(333, 20, 20)');
    expect(generateCurrentChevronSvg(1.3, 0)).toContain('rotate(0, 20, 20)');
  });

  it('draws one chevron for light water and two above 0.5 kt', () => {
    // The outline repeats the paths, so count the fill layer (the second group).
    const paths = (kt: number) =>
      parse(generateCurrentChevronSvg(kt, 90)).querySelectorAll('g')[1].querySelectorAll('path').length;

    expect(paths(0.2)).toBe(1);
    expect(paths(0.5)).toBe(2);
    expect(paths(2)).toBe(2);
  });

  it('uses the tier colour and a heavier stroke for strong water', () => {
    const stroke = (kt: number) => parse(generateCurrentChevronSvg(kt, 90)).querySelectorAll('g')[1];

    expect(stroke(0.2).getAttribute('stroke')).toBe('#e0f2fe');
    expect(stroke(1.0).getAttribute('stroke')).toBe('#67e8f9');
    expect(stroke(2.0).getAttribute('stroke')).toBe('#ffffff');
    expect(stroke(2.0).getAttribute('stroke-width')).toBe('4.5');
    expect(stroke(1.0).getAttribute('stroke-width')).toBe('3');
    expect(stroke(3.5).getAttribute('stroke')).toBe('#ff9ceb');
  });

  it('draws the dark outline under every tier, on every base (SCRUM-237)', () => {
    const groups = parse(generateCurrentChevronSvg(1.3, 333)).querySelectorAll('g');

    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute('stroke')).toBe(CURRENT_TIER_OUTLINE);
    expect(groups[0].getAttribute('stroke-width')).toBe('5'); // the 3 px fill plus 2 px
    expect(groups[1].getAttribute('stroke')).toBe('#67e8f9');
    expect(groups[1].getAttribute('stroke-width')).toBe('3');
    // Fully opaque: the rim, not transparency, carries the contrast.
    expect(groups[1].getAttribute('opacity')).toBeNull();

    // Bold tiers keep the heavier fill and get the matching rim.
    const bold = parse(generateCurrentChevronSvg(2, 90)).querySelectorAll('g');
    expect(bold[0].getAttribute('stroke-width')).toBe('6.5');
    expect(bold[1].getAttribute('stroke-width')).toBe('4.5');
  });

  it('labels the glyph for screen readers with the speed and direction', () => {
    const svg = parse(generateCurrentChevronSvg(1.3, 333)).querySelector('svg')!;

    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('1.3 kt current toward 333°');
  });
});

describe('buildCurrentChevronIcon (SCRUM-99)', () => {
  it('builds a 28px icon carrying its tier for styling and tests', () => {
    const icon = buildCurrentChevronIcon(point);
    const html = icon.options.html as string;

    expect(icon.options.iconSize).toEqual([CURRENT_CHEVRON_SIZE, CURRENT_CHEVRON_SIZE]);
    expect(icon.options.iconAnchor).toEqual([CURRENT_CHEVRON_SIZE / 2, CURRENT_CHEVRON_SIZE / 2]);
    expect(html).toContain('data-current-chevron');
    expect(html).toContain('data-tier="moderate"');
    expect(html).toContain(generateCurrentChevronSvg(1.3, 333, CURRENT_CHEVRON_SIZE));
  });
});

describe('buildCurrentPopup (SCRUM-99)', () => {
  it('shows speed, flow direction, source and the selected hour', () => {
    const el = parse(buildCurrentPopup(point, 'knots', 'Mon 23 Nov 12:00 PST'));

    expect(el.textContent).toContain('Water current');
    expect(el.textContent).toContain('47.90°, -124.60°');
    expect(el.textContent).toContain('1.3 kt');
    expect(el.textContent).toContain('NNW (333°) toward');
    expect(el.textContent).toContain('Copernicus Marine (via Open-Meteo)');
    expect(el.textContent).toContain('Mon 23 Nov 12:00 PST');
  });

  it('converts knots into the chosen speed unit', () => {
    expect(parse(buildCurrentPopup(point, 'kmh')).textContent).toContain('2.4 km/h');
    expect(parse(buildCurrentPopup(point, 'mph')).textContent).toContain('1.5 mph');
    expect(parse(buildCurrentPopup(point, 'ms')).textContent).toContain('0.7 m/s');
  });

  it('omits the hour line when no hour is selected', () => {
    expect(parse(buildCurrentPopup(point)).textContent).not.toContain('🕒');
  });
});
