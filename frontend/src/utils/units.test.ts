import { describe, expect, it } from 'vitest';
import {
  SPEED_UNIT_LABEL,
  formatDegreesTrue,
  formatDirection,
  formatSliceTime,
  formatSpeed,
  formatTemperature,
  knotsToUnit,
  roundKnotsInUnit,
} from './units';
import { makePoint } from '../test/fixtures';
import type { WindSpeedUnit } from '../types';

const pt = makePoint(0, 14, 22, { temperature_f: 53.6, temperature_c: 12.2 });

describe('formatSpeed (SCRUM-92)', () => {
  it.each<[WindSpeedUnit, string, string]>([
    ['knots', '14 kt', '22 kt'],
    ['kmh', '25.9 km/h', '40.7 km/h'],
    ['mph', '16.1 mph', '25.3 mph'],
    ['ms', '7.2 m/s', '11.3 m/s'],
  ])('formats speed and gust in %s', (unit, speed, gust) => {
    expect(formatSpeed(pt, 'speed', unit)).toBe(speed);
    expect(formatSpeed(pt, 'gust', unit)).toBe(gust);
  });

  it('has a label for every unit', () => {
    expect(Object.keys(SPEED_UNIT_LABEL).sort()).toEqual(['kmh', 'knots', 'mph', 'ms']);
  });
});

describe('knotsToUnit (SCRUM-124)', () => {
  it('converts knots to each display unit', () => {
    expect(knotsToUnit(10, 'knots')).toBe(10);
    expect(knotsToUnit(10, 'kmh')).toBeCloseTo(18.52, 5);
    expect(knotsToUnit(10, 'mph')).toBeCloseTo(11.5078, 5);
    expect(knotsToUnit(10, 'ms')).toBeCloseTo(5.14444, 5);
  });

  it('rounds to whole numbers for legend ticks', () => {
    expect(roundKnotsInUnit(10, 'kmh')).toBe(19);
    expect(roundKnotsInUnit(10, 'mph')).toBe(12);
    expect(roundKnotsInUnit(10, 'ms')).toBe(5);
    expect(roundKnotsInUnit(50, 'kmh')).toBe(93);
  });
});

describe('formatTemperature (SCRUM-92)', () => {
  it('rounds to whole degrees in the chosen system', () => {
    expect(formatTemperature(pt, 'imperial')).toBe('54°F');
    expect(formatTemperature(pt, 'metric')).toBe('12°C');
  });
});

describe('formatDegreesTrue (SCRUM-90)', () => {
  it('formats whole numbers, normalized to 0–359', () => {
    expect(formatDegreesTrue(220)).toBe('220°T');
    expect(formatDegreesTrue(7.5)).toBe('8°T');
    expect(formatDegreesTrue(305.4)).toBe('305°T');
    expect(formatDegreesTrue(0)).toBe('0°T');
    expect(formatDegreesTrue(360)).toBe('0°T');
    expect(formatDegreesTrue(359.6)).toBe('0°T');
    expect(formatDegreesTrue(-10)).toBe('350°T');
  });
});

describe('formatDirection', () => {
  it('shows cardinal and rounded degrees', () => {
    expect(formatDirection({ wind_direction_cardinal: 'SW', wind_direction_deg: 220.4 })).toBe('SW (220°)');
  });
});

describe('formatSliceTime', () => {
  it('keeps the wall-clock time Open-Meteo returned', () => {
    expect(formatSliceTime('2026-11-16T21:00')).toBe('Mon 9 PM');
    expect(formatSliceTime('2026-11-17T00:00')).toBe('Tue 12 AM');
  });

  it('returns the input when it is not a date', () => {
    expect(formatSliceTime('not a time')).toBe('not a time');
  });
});
