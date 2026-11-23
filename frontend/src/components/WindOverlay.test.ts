import { describe, it, expect } from 'vitest';
import {
  buildGridBarbIcon,
  buildGridPointPopup,
  generateGridBarbSvg,
  GRID_BARB_FALLBACK_COLOR,
} from './WindOverlay';
import { generateWindBarbSvg, getTemperatureColor } from './WindBarb';

const parse = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

const pt = (speed: number, dir = 0, temperature_f: number | null = 60) => ({
  latitude: 48.78,
  longitude: -121.94,
  wind_speed_knots: speed,
  wind_direction_deg: dir,
  temperature_f,
});

// Colors used in the barb, ignoring the fixed dark outline of the center dot.
const colorsIn = (svg: string) =>
  [...new Set((svg.match(/#[0-9a-f]{6}/gi) ?? []).filter((c) => c !== '#0d1117'))];

describe('generateGridBarbSvg (SCRUM-89)', () => {
  it('draws exactly the same barb as the drawer, including temperature color', () => {
    expect(generateGridBarbSvg(27, 305, 50, 32)).toBe(
      generateWindBarbSvg({ speedKnots: 27, directionDeg: 305, tempF: 50, size: 32, showLabel: false })
    );
  });

  it('colors the barb by temperature like the drawer', () => {
    for (const tempF of [20, 45, 60, 75, 85, 95]) {
      expect(colorsIn(generateGridBarbSvg(14, 90, tempF))).toEqual([getTemperatureColor(tempF)]);
    }
  });

  it('falls back to green when the temperature is missing', () => {
    expect(colorsIn(generateGridBarbSvg(14, 90, null))).toEqual([GRID_BARB_FALLBACK_COLOR]);
    expect(colorsIn(generateGridBarbSvg(14, 90, undefined))).toEqual([GRID_BARB_FALLBACK_COLOR]);
  });

  it('encodes speed by the number of barbs', () => {
    const count = (speed: number) => {
      const g = parse(generateGridBarbSvg(speed, 0, 60)).querySelector('g')!;
      return { pennants: g.querySelectorAll('polygon').length, lines: g.querySelectorAll('line').length - 1 };
    };
    expect(count(5)).toEqual({ pennants: 0, lines: 1 }); // half barb
    expect(count(10)).toEqual({ pennants: 0, lines: 1 }); // one full barb
    expect(count(27)).toEqual({ pennants: 0, lines: 3 }); // 2 full + 1 half
    expect(count(55)).toEqual({ pennants: 1, lines: 1 }); // pennant + half
  });

  it('draws calm (< 2 kt) as a circle with no staff', () => {
    const el = parse(generateGridBarbSvg(1, 90, 60));
    expect(el.querySelectorAll('line').length).toBe(0);
    expect(el.querySelectorAll('circle').length).toBe(2);
  });

  it('rotates the barb to the wind direction', () => {
    expect(generateGridBarbSvg(15, 220, 60)).toContain('rotate(220, 25, 25)');
  });
});

describe('buildGridBarbIcon (SCRUM-89)', () => {
  it('builds an unselected 32px icon without a highlight ring, colored by temperature', () => {
    const icon = buildGridBarbIcon(pt(15, 90, 85), false);
    const html = icon.options.html as string;
    expect(icon.options.iconSize).toEqual([32, 32]);
    expect(icon.options.iconAnchor).toEqual([16, 16]);
    expect(html).toContain('data-selected="false"');
    expect(html).not.toContain('box-shadow');
    expect(html).toContain('rotate(90, 25, 25)');
    expect(html).toContain(getTemperatureColor(85));
  });

  it('adds the dark halo class only when asked (SCRUM-123)', () => {
    const plain = buildGridBarbIcon(pt(15, 90, 85), false).options.html as string;
    expect(plain).not.toContain('wind-barb-halo');

    const haloed = buildGridBarbIcon(pt(15, 90, 85), false, true).options.html as string;
    expect(haloed).toContain('wind-barb-halo');
    expect(haloed).toContain(generateGridBarbSvg(15, 90, 85, 32));
  });

  it('builds a larger selected icon with a white highlight ring and the same barb', () => {
    const icon = buildGridBarbIcon(pt(15, 90, 85), true);
    const html = icon.options.html as string;
    expect(icon.options.iconSize).toEqual([40, 40]);
    expect(icon.options.iconAnchor).toEqual([20, 20]);
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('box-shadow:0 0 0 2px #ffffff');
    expect(html).toContain(generateGridBarbSvg(15, 90, 85, 40));
  });
});

describe('buildGridPointPopup (SCRUM-126)', () => {
  const point = {
    latitude: 48.78,
    longitude: -121.94,
    wind_speed_knots: 12.8,
    wind_direction_deg: 220,
    temperature_f: 53.6,
  };

  it('shows the coordinates and the point values in the user units', () => {
    const el = parse(buildGridPointPopup(point, 'imperial', 'knots', 'deg'));
    expect(el.textContent).toContain('Wind point');
    expect(el.textContent).toContain('48.78°, -121.94°');
    expect(el.textContent).toContain('12.8 kt');
    expect(el.textContent).toContain('54°F');
    expect(el.textContent).toContain('220°T');
  });

  it('converts the knots and °F it was given to metric and the chosen speed unit', () => {
    const el = parse(buildGridPointPopup(point, 'metric', 'kmh', 'cardinal'));
    expect(el.textContent).toContain('23.7 km/h');
    expect(el.textContent).toContain('12°C');
    expect(el.textContent).toContain('SW (220°)');
    expect(el.textContent).not.toContain('°F');
  });

  it('draws the barb when barb display is chosen, and shows -- without a temperature', () => {
    const el = parse(buildGridPointPopup({ ...point, temperature_f: null }, 'imperial', 'knots'));
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toContain('🌡️ --');
    expect(el.textContent).not.toContain('°F');
    expect(el.textContent).not.toContain('°T');
  });
});
