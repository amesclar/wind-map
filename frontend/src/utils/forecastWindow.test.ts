import { describe, expect, it } from 'vitest';
import {
  addHours,
  buildSteps,
  dayMarks,
  floorToHour,
  formatHorizon,
  formatRunTime,
  formatStepLabel,
  indexFromFraction,
  stepIndex,
} from './forecastWindow';

const START = '2026-11-23T12:00:00.000Z'; // Monday

describe('forecast window maths (SCRUM-127)', () => {
  it('floors to the hour in UTC', () => {
    expect(floorToHour(new Date('2026-11-23T12:47:33.512Z')).toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });

  it('builds one step per hour to the horizon, inclusive', () => {
    const steps = buildSteps(START, 6);
    expect(steps).toHaveLength(7);
    expect(steps[0]).toBe(START);
    expect(steps.at(-1)).toBe(addHours(START, 6));

    const threeHourly = buildSteps(START, 6, 3);
    expect(threeHourly).toEqual([START, addHours(START, 3), addHours(START, 6)]);
  });

  it('maps now and off-grid times to the nearest step', () => {
    const steps = buildSteps(START, 6);
    expect(stepIndex(steps, null)).toBe(0);
    expect(stepIndex(steps, addHours(START, 3))).toBe(3);
    expect(stepIndex(steps, '2026-11-23T15:40:00.000Z')).toBe(4);
    // Beyond the window: clamp to the end.
    expect(stepIndex(steps, '2026-11-25T00:00:00.000Z')).toBe(steps.length - 1);
  });

  it('snaps a track fraction to an index and clamps', () => {
    expect(indexFromFraction(0, 7)).toBe(0);
    expect(indexFromFraction(0.5, 7)).toBe(3);
    expect(indexFromFraction(1, 7)).toBe(6);
    expect(indexFromFraction(-2, 7)).toBe(0);
    expect(indexFromFraction(2, 7)).toBe(6);
    expect(indexFromFraction(0.5, 1)).toBe(0);
  });

  it('labels a step with the weekday, date, time and zone', () => {
    expect(formatStepLabel(START, 'UTC')).toBe('Mon 23 Nov 12:00 UTC');
  });

  it('labels the model horizon and run times', () => {
    expect(formatHorizon(384)).toBe('16 days');
    expect(formatHorizon(180)).toBe('7.5 days');
    expect(formatRunTime('2026-11-23T12:00:00Z', 'UTC')).toBe('12:00 UTC');
  });

  it('places one weekday mark per local day, starting at the window start', () => {
    const marks = dayMarks(START, 48, 'UTC');
    expect(marks.map((m) => m.label)).toEqual(['M', 'T', 'W']);
    expect(marks[0].fraction).toBe(0);
    expect(marks[1].fraction).toBeCloseTo(12 / 48, 5);
    expect(marks[2].fraction).toBeCloseTo(36 / 48, 5);
  });
});
