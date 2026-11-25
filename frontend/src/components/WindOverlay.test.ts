import { describe, it, expect } from 'vitest';
import {
  BARB_KEEP_OUT_RADIUS_PX,
  BARB_OUTLINES,
  buildGridBarbIcon,
  buildGridPointPopup,
  generateGridBarbSvg,
  declutterGridPoints,
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
    expect(icon.options.iconSize).toEqual([40, 40]);
    expect(icon.options.iconAnchor).toEqual([20, 20]);
    expect(html).toContain('data-selected="false"');
    expect(html).not.toContain('box-shadow');
    expect(html).toContain('rotate(90, 25, 25)');
    expect(html).toContain(getTemperatureColor(85));
  });

  it('draws the crisp outline on every base, with no CSS halo left (SCRUM-218)', () => {
    const html = buildGridBarbIcon(pt(15, 90, 85), false).options.html as string;
    expect(html.match(/data-barb-outline="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain('#161b22');
    expect(html).not.toContain('wind-barb-halo');
    expect(html).toContain(generateGridBarbSvg(15, 90, 85, 40, BARB_OUTLINES));
  });

  it('keeps the chart rim and inverts only the selected ring on the light base (SCRUM-208)', () => {
    const chart = buildGridBarbIcon(pt(15, 90, 85), false, true).options.html as string;
    expect(chart.match(/data-barb-outline="true"/g) ?? []).toHaveLength(1);

    const darkBase = buildGridBarbIcon(pt(15, 90, 85), false, false).options.html as string;
    expect(darkBase.match(/data-barb-outline="true"/g) ?? []).toHaveLength(1);
  });

  it('builds a larger selected icon with a white highlight ring and the same barb', () => {
    const icon = buildGridBarbIcon(pt(15, 90, 85), true);
    const html = icon.options.html as string;
    expect(icon.options.iconSize).toEqual([48, 48]);
    expect(icon.options.iconAnchor).toEqual([24, 24]);
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('box-shadow:0 0 0 2px #ffffff');
    expect(html).toContain(generateGridBarbSvg(15, 90, 85, 48, BARB_OUTLINES));
  });
});

describe('declutterGridPoints (SCRUM-211)', () => {
  const gridPoint = (latitude: number, longitude: number) => ({
    latitude,
    longitude,
    wind_speed_knots: 10,
    wind_direction_deg: 90,
    temperature_f: 60,
  });
  const grid = (rows: number, cols: number) =>
    Array.from({ length: rows }, (_, row) =>
      Array.from({ length: cols }, (_, col) => gridPoint(50 - row, -125 + col)),
    ).flat();
  // 80 px per degree: the grid's own step on screen, so one cell is one barb spacing.
  const project = (point: { latitude: number; longitude: number }) => ({
    x: (point.longitude + 125) * 80,
    y: (50 - point.latitude) * 80,
  });

  it('returns the same array untouched when there is nothing to declutter', () => {
    const points = grid(2, 2);
    expect(declutterGridPoints(points, project)).toBe(points);
    expect(declutterGridPoints(points, project, { keepOut: [] })).toBe(points);
  });

  it('halves the grid on a checkerboard when thinning', () => {
    const kept = declutterGridPoints(grid(4, 4), project, { thin: true });
    const cells = new Set(kept.map((point) => `${50 - point.latitude}:${point.longitude + 125}`));

    expect(kept).toHaveLength(8);
    expect(cells.has('0:0')).toBe(true);
    expect(cells.has('0:1')).toBe(false); // every other column is gone
    expect(cells.has('1:0')).toBe(false); // and so is every other row
    expect(cells.has('1:1')).toBe(true);
    expect(cells.has('3:3')).toBe(true);
  });

  it('drops the barbs a saved-location marker would cover', () => {
    const kept = declutterGridPoints(
      [gridPoint(49, -124), gridPoint(49, -123.9), gridPoint(49.5, -124)],
      project,
      { keepOut: [{ latitude: 49, longitude: -124 }] },
    );

    // 8 px away is under the marker; 40 px away is clear of its 30 px keep-out.
    expect(kept).toEqual([gridPoint(49.5, -124)]);
  });

  it('keeps the radius in pixels, so the same view always keeps the same barbs', () => {
    const near = { latitude: 49, longitude: -124 };
    expect(BARB_KEEP_OUT_RADIUS_PX).toBe(30);
    expect(declutterGridPoints([gridPoint(49, -124)], project, { keepOut: [near] })).toEqual([]);
  });

  it('applies the checkerboard and the keep-outs together', () => {
    const kept = declutterGridPoints(grid(4, 4), project, {
      thin: true,
      keepOut: [{ latitude: 50, longitude: -125 }], // drops the 0:0 barb that thinning keeps
    });

    expect(kept).toHaveLength(7);
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

  it('shows the gust in the chosen speed unit when the point carries one (SCRUM-210)', () => {
    const imperial = parse(
      buildGridPointPopup({ ...point, wind_gust_knots: 21.4 }, 'imperial', 'knots', 'deg'),
    );
    expect(imperial.textContent).toContain('⚡ G: 21.4 kt');

    const metric = parse(
      buildGridPointPopup({ ...point, wind_gust_knots: 21.4 }, 'metric', 'kmh', 'cardinal'),
    );
    expect(metric.textContent).toContain('⚡ G: 39.6 km/h');
  });

  it('leaves the gust out when the point has none', () => {
    const el = parse(buildGridPointPopup({ ...point, wind_gust_knots: null }, 'imperial', 'knots'));
    expect(el.textContent).not.toContain('⚡');
  });

  it('draws the barb when barb display is chosen, and shows -- without a temperature', () => {
    const el = parse(buildGridPointPopup({ ...point, temperature_f: null }, 'imperial', 'knots'));
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toContain('🌡️ --');
    expect(el.textContent).not.toContain('°F');
    expect(el.textContent).not.toContain('°T');
  });
});
