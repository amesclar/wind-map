import { describe, expect, it } from 'vitest';
import {
  buildWindColorScale,
  buildWindGrid,
  COLOR_STOPS,
  interpolateWindSpeed,
  legendTicks,
  MAX_WIND_KNOTS,
  windColorCssGradient,
  windSpeedToColor,
} from './windColorScale';
import { knotsToUnit, SPEED_UNIT_LABEL } from './units';

const rgb = (speed: number) => windSpeedToColor(speed).slice(0, 3);

describe('windSpeedToColor (SCRUM-123)', () => {
  it('returns the sampled stop colors at their knots', () => {
    for (const stop of COLOR_STOPS) {
      const r = parseInt(stop.hex.slice(1, 3), 16);
      const g = parseInt(stop.hex.slice(3, 5), 16);
      const b = parseInt(stop.hex.slice(5, 7), 16);
      expect(rgb(stop.knots)).toEqual([r, g, b]);
    }
  });

  it('keeps every stop strictly increasing and inside the scale', () => {
    const knots = COLOR_STOPS.map((s) => s.knots);
    expect(knots).toEqual([...knots].sort((a, b) => a - b));
    expect(new Set(knots).size).toBe(knots.length);
    expect(knots[0]).toBe(0);
    expect(knots[knots.length - 1]).toBe(MAX_WIND_KNOTS);
  });

  it('blends linearly between stops', () => {
    // 2.5 kt is halfway from purple #9f01c8 to blue #3233fa.
    expect(rgb(2.5)).toEqual([105, 26, 225]);
    // 7.5 kt is the teal the legend shows between blue and green (#327e8f sampled).
    const [r, g, b] = rgb(7.5);
    expect(Math.abs(r - 0x32)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 0x7e)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 0x8f)).toBeLessThanOrEqual(2);
  });

  it('clamps below zero to the first stop and above 50 kt to gray', () => {
    expect(rgb(-12)).toEqual(rgb(0));
    expect(rgb(200)).toEqual([0x64, 0x64, 0x64]);
  });

  it('is transparent for a missing speed', () => {
    expect(windSpeedToColor(Number.NaN)).toEqual([0, 0, 0, 0]);
  });

  it('builds a CSS gradient from the same stops', () => {
    const gradient = windColorCssGradient();
    expect(gradient.startsWith('linear-gradient(to right, ')).toBe(true);
    for (const stop of COLOR_STOPS) expect(gradient).toContain(stop.hex);
    expect(gradient).toContain('#646464 100%');
  });
});

describe('legendTicks (SCRUM-124, moved in SCRUM-165)', () => {
  it('uses a round step per unit and never runs past the top of the scale', () => {
    expect(legendTicks('knots')).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    for (const unit of ['kmh', 'mph', 'ms'] as const) {
      const values = legendTicks(unit);
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBeLessThanOrEqual(knotsToUnit(MAX_WIND_KNOTS, unit));
      expect(values[values.length - 1]).toBeGreaterThan(knotsToUnit(MAX_WIND_KNOTS, unit) - 10);
    }
    expect(legendTicks('kmh').slice(0, 3)).toEqual([0, 10, 20]);
  });
});

describe('buildWindColorScale (SCRUM-165)', () => {
  it('derives the export stops and captions from COLOR_STOPS and legendTicks for every unit', () => {
    for (const unit of ['knots', 'kmh', 'mph', 'ms'] as const) {
      const scale = buildWindColorScale(unit);
      const max = knotsToUnit(MAX_WIND_KNOTS, unit);

      expect(scale.stops).toEqual(
        COLOR_STOPS.map(({ knots, hex }) => ({ offset: knots / MAX_WIND_KNOTS, color: hex })),
      );
      expect(scale.ticks.map((tick) => tick.label)).toEqual(legendTicks(unit).map(String));
      expect(scale.ticks.map((tick) => tick.offset)).toEqual(
        legendTicks(unit).map((value) => value / max),
      );
      expect(scale.unitLabel).toBe(SPEED_UNIT_LABEL[unit]);
    }
  });
});

const gridPoint = (lat: number, lon: number, wind_speed_knots: number) => ({
  latitude: lat,
  longitude: lon,
  wind_speed_knots,
});

const square = () => [
  gridPoint(47, -123, 10),
  gridPoint(47, -121, 20),
  gridPoint(49, -123, 30),
  gridPoint(49, -121, 40),
];

describe('interpolateWindSpeed (SCRUM-123)', () => {
  const grid = buildWindGrid(square());

  it('returns the grid values at the corners', () => {
    expect(interpolateWindSpeed(grid, 47, -123)).toBe(10);
    expect(interpolateWindSpeed(grid, 47, -121)).toBe(20);
    expect(interpolateWindSpeed(grid, 49, -123)).toBe(30);
    expect(interpolateWindSpeed(grid, 49, -121)).toBe(40);
  });

  it('averages across a cell', () => {
    expect(interpolateWindSpeed(grid, 48, -122)).toBe(25);
  });

  it('interpolates along one axis only', () => {
    expect(interpolateWindSpeed(grid, 47, -122)).toBe(15); // halfway along the southern edge
    expect(interpolateWindSpeed(grid, 48, -123)).toBe(20); // halfway up the western edge
  });

  it('returns nothing outside the grid', () => {
    expect(interpolateWindSpeed(grid, 46.9, -122)).toBeNull();
    expect(interpolateWindSpeed(grid, 48, -120.5)).toBeNull();
    expect(interpolateWindSpeed(null, 48, -122)).toBeNull();
  });

  it('returns nothing when a surrounding point has no value', () => {
    const sparse = buildWindGrid([
      gridPoint(47, -123, 10),
      gridPoint(47, -121, Number.NaN),
      gridPoint(49, -123, 30),
      gridPoint(49, -121, 40),
    ]);
    expect(interpolateWindSpeed(sparse, 48, -122)).toBeNull();
    expect(interpolateWindSpeed(sparse, 47, -123)).toBeNull(); // the corner itself is missing
  });

  it('needs at least a 2 by 2 grid', () => {
    expect(buildWindGrid([gridPoint(47, -123, 10)])).toBeNull();
    expect(
      buildWindGrid([
        gridPoint(47, -123, 10),
        gridPoint(48, -123, 20),
        gridPoint(49, -123, 30),
        gridPoint(50, -123, 40),
      ]),
    ).toBeNull();
  });
});
