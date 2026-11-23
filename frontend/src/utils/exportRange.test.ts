import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_CAPTURES,
  RANGE_INTERVAL_HOURS,
  formatRangeBoundary,
  formatRangeSummary,
  isHourAligned,
  planExportRange,
  timeRangeHours,
} from './exportRange';

const TZ = 'America/Los_Angeles';

const plan = (start: string, end: string, intervalHours = 1) =>
  planExportRange(
    {
      start,
      end,
      intervalHours,
      windowStart: '2026-11-23T20:00:00.000Z',
      windowEnd: '2026-11-30T20:00:00.000Z',
    },
    TZ,
  );

describe('timeRangeHours (SCRUM-155)', () => {
  it('returns the start, each interval and the end hour when it lands on a step', () => {
    expect(timeRangeHours('2026-11-23T22:00:00.000Z', '2026-11-24T01:00:00.000Z', 1)).toEqual([
      '2026-11-23T22:00:00.000Z',
      '2026-11-23T23:00:00.000Z',
      '2026-11-24T00:00:00.000Z',
      '2026-11-24T01:00:00.000Z',
    ]);
    expect(timeRangeHours('2026-11-23T22:00:00.000Z', '2026-11-24T04:00:00.000Z', 3)).toEqual([
      '2026-11-23T22:00:00.000Z',
      '2026-11-24T01:00:00.000Z',
      '2026-11-24T04:00:00.000Z',
    ]);
  });

  it('stops at the last step when the interval does not divide the range', () => {
    const hours = timeRangeHours('2026-11-23T22:00:00.000Z', '2026-11-24T03:00:00.000Z', 4);
    expect(hours).toEqual(['2026-11-23T22:00:00.000Z', '2026-11-24T02:00:00.000Z']);
  });

  it('moves cleanly across a spring-forward change (no 02:00 local hour)', () => {
    // 2027-03-14: Los Angeles leaves PST for PDT at 10:00Z.
    const hours = timeRangeHours('2027-03-14T09:00:00.000Z', '2027-03-14T12:00:00.000Z', 1);
    expect(hours).toHaveLength(4);
    expect(formatRangeBoundary(hours[0], TZ)).toBe('Sun 01:00 PST');
    expect(formatRangeBoundary(hours[1], TZ)).toBe('Sun 03:00 PDT');
    expect(formatRangeBoundary(hours[3], TZ)).toBe('Sun 05:00 PDT');
  });

  it('keeps every hour across a fall-back change (01:00 local happens twice)', () => {
    // 2027-11-07: Los Angeles returns to PST at 09:00Z.
    const hours = timeRangeHours('2027-11-07T08:00:00.000Z', '2027-11-07T11:00:00.000Z', 1);
    expect(hours).toHaveLength(4);
    const labels = hours.map((h) => formatRangeBoundary(h, TZ));
    expect(labels).toEqual(['Sun 01:00 PDT', 'Sun 01:00 PST', 'Sun 02:00 PST', 'Sun 03:00 PST']);
  });

  it('returns nothing for an inverted or invalid range and rejects a bad interval', () => {
    expect(timeRangeHours('2026-11-24T01:00:00.000Z', '2026-11-23T22:00:00.000Z', 1)).toEqual([]);
    expect(timeRangeHours('nope', '2026-11-23T22:00:00.000Z', 1)).toEqual([]);
    expect(() => timeRangeHours('2026-11-23T22:00:00.000Z', '2026-11-24T01:00:00.000Z', 0)).toThrow();
  });
});

describe('isHourAligned (SCRUM-155)', () => {
  it('accepts exact UTC hours only', () => {
    expect(isHourAligned('2026-11-23T22:00:00.000Z')).toBe(true);
    expect(isHourAligned('2026-11-23T22:30:00.000Z')).toBe(false);
    expect(isHourAligned('2026-11-23T22:00:30.000Z')).toBe(false);
    expect(isHourAligned('not a date')).toBe(false);
  });
});

describe('planExportRange (SCRUM-155)', () => {
  it('accepts a 5-hour range and summarises it with the zone once', () => {
    const result = plan('2026-11-23T22:00:00.000Z', '2026-11-24T02:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hours).toHaveLength(5);
    expect(result.summary).toBe('5 captures from Mon 14:00 to Mon 18:00 PST');
  });

  it('uses a singular summary for one capture with a 12-hour interval', () => {
    const result = plan('2026-11-23T22:00:00.000Z', '2026-11-24T02:00:00.000Z', 12);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe('1 capture at Mon 14:00 PST');
  });

  it('rejects an end at or before the start', () => {
    expect(plan('2026-11-23T22:00:00.000Z', '2026-11-23T22:00:00.000Z')).toMatchObject({
      ok: false,
      message: 'The end hour must be after the start hour.',
    });
  });

  it('rejects hours that are not aligned', () => {
    expect(plan('2026-11-23T22:30:00.000Z', '2026-11-24T02:00:00.000Z')).toMatchObject({
      ok: false,
      message: 'Start and end must be whole hours.',
    });
  });

  it('rejects a range that leaves the forecast window at either end', () => {
    expect(plan('2026-11-23T18:00:00.000Z', '2026-11-23T22:00:00.000Z')).toMatchObject({
      ok: false,
      message: 'The range cannot start before Mon 12:00 PST.',
    });
    expect(plan('2026-11-30T18:00:00.000Z', '2026-11-30T22:00:00.000Z')).toMatchObject({
      ok: false,
      message: 'The range must end by Mon 12:00 PST.',
    });
  });

  it(`rejects more than ${MAX_RANGE_CAPTURES} captures with the count and the cap`, () => {
    const result = plan('2026-11-23T22:00:00.000Z', '2026-11-25T22:00:00.000Z', 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hours).toHaveLength(49);
    expect(result.message).toBe(
      `Too many captures (49). The maximum is ${MAX_RANGE_CAPTURES}; pick a longer interval or a shorter range.`,
    );
  });

  it('accepts the cap itself and every offered interval', () => {
    expect(RANGE_INTERVAL_HOURS).toEqual([1, 2, 3, 6, 12]);
    const result = plan('2026-11-23T22:00:00.000Z', '2026-11-24T21:00:00.000Z', 1);
    expect(result.ok && result.hours.length).toBe(MAX_RANGE_CAPTURES);
  });

  it('will not plan against a window that is not hour-aligned', () => {
    const result = planExportRange(
      {
        start: '2026-11-23T22:00:00.000Z',
        end: '2026-11-24T02:00:00.000Z',
        intervalHours: 1,
        windowStart: '2026-11-23T20:15:00.000Z',
        windowEnd: '2026-11-30T20:00:00.000Z',
      },
      TZ,
    );
    expect(result).toMatchObject({ ok: false, message: 'The forecast window is not ready yet.' });
  });
});

describe('formatRangeSummary (SCRUM-155)', () => {
  it('handles an empty list', () => {
    expect(formatRangeSummary([], TZ)).toBe('No captures');
  });
});
