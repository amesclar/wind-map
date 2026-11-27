import { describe, expect, it } from 'vitest';
import {
  EXPORT_TILE_BUDGET,
  MAX_RANGE_CAPTURES,
  RANGE_PACE_MS,
  formatRangeBoundary,
  formatTimesSummary,
  isHourAligned,
  planExportTimes,
  tilesForViewport,
} from './exportRange';

const TZ = 'America/Los_Angeles';
const WINDOW_START = '2026-11-23T20:00:00.000Z';
const WINDOW_END = '2026-11-30T20:00:00.000Z';

const plan = (times: string[], tilesPerFrame?: number) =>
  planExportTimes({ times, windowStart: WINDOW_START, windowEnd: WINDOW_END, tilesPerFrame }, TZ);

/** `count` consecutive UTC hours from 22:00Z on 23 Nov 2026. */
const hours = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(2026, 10, 23, 22 + i)).toISOString(),
  );

describe('isHourAligned (SCRUM-155)', () => {
  it('accepts whole UTC hours only', () => {
    expect(isHourAligned('2026-11-23T22:00:00.000Z')).toBe(true);
    expect(isHourAligned('2026-11-23T22:30:00.000Z')).toBe(false);
    expect(isHourAligned('2026-11-23T22:00:30.000Z')).toBe(false);
    expect(isHourAligned('not a date')).toBe(false);
  });
});

describe('formatRangeBoundary (SCRUM-155)', () => {
  it('names the weekday, the hour and the zone', () => {
    expect(formatRangeBoundary('2026-11-23T22:00:00.000Z', TZ)).toBe('Mon 14:00 PST');
  });
});

describe('tilesForViewport (SCRUM-299)', () => {
  it('counts 256 px tiles for a CSS size', () => {
    expect(tilesForViewport(1920, 1080)).toBe(40);
    expect(tilesForViewport(3840, 2160)).toBe(135);
  });

  it('returns 0 when the size is not known yet', () => {
    expect(tilesForViewport(0, 1080)).toBe(0);
    expect(tilesForViewport(1920, 0)).toBe(0);
  });
});

describe('RANGE_PACE_MS (SCRUM-332)', () => {
  it('leaves a visible gap between frames', () => {
    expect(RANGE_PACE_MS).toBe(750);
  });
});

describe('formatTimesSummary (SCRUM-332)', () => {
  it('uses a singular line for one time', () => {
    expect(formatTimesSummary(hours(1), TZ)).toBe('1 capture at Mon 14:00 PST');
  });

  it('lists the times rather than claiming a span', () => {
    expect(formatTimesSummary([...hours(1), ...hours(3).slice(2)], TZ)).toBe(
      '2 captures: Mon 14:00, Mon 16:00 PST',
    );
  });

  it('cuts a long list after four times so the line stays one line', () => {
    expect(formatTimesSummary(hours(6), TZ)).toBe(
      '6 captures: Mon 14:00, Mon 15:00, Mon 16:00, Mon 17:00, … PST',
    );
  });

  it('says so when nothing is chosen', () => {
    expect(formatTimesSummary([], TZ)).toBe('No captures');
  });
});

describe('planExportTimes (SCRUM-332)', () => {
  it('sorts and de-duplicates the chosen times, and summarises them', () => {
    const result = plan([hours(3)[2], hours(3)[0], hours(3)[1], hours(3)[2]]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.times).toEqual(hours(3));
    expect(result.summary).toBe('3 captures: Mon 14:00, Mon 15:00, Mon 16:00 PST');
  });

  it('refuses an empty selection', () => {
    const result = plan([]);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe('Choose at least one time to capture.');
  });

  it('refuses a time that is not a whole hour', () => {
    const result = plan(['2026-11-23T22:30:00.000Z']);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe('Every chosen time must be a whole hour.');
  });

  it('refuses a time outside the forecast window', () => {
    const before = plan(['2026-11-23T19:00:00.000Z']);
    const after = plan(['2026-12-01T20:00:00.000Z']);

    expect(before.ok).toBe(false);
    expect(before.ok ? '' : before.message).toContain('Mon 12:00 PST');
    expect(after.ok).toBe(false);
    expect(after.ok ? '' : after.message).toContain('Times must be between');
  });

  it('says the window is not ready instead of guessing', () => {
    const result = planExportTimes(
      { times: hours(1), windowStart: '', windowEnd: '' },
      TZ,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe('The forecast window is not ready yet.');
  });

  it('accepts the 24-capture cap and refuses the 25th', () => {
    const allowed = plan(hours(MAX_RANGE_CAPTURES));
    const refused = plan(hours(MAX_RANGE_CAPTURES + 1));

    expect(allowed.ok).toBe(true);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.message).toBe(
      'Too many captures (25). The maximum is 24; choose fewer times.',
    );
  });
});

describe('planExportTimes tile budget (SCRUM-299, SCRUM-332)', () => {
  it('accepts a full day at 1080p: 24 x 40 tiles', () => {
    const result = plan(hours(24), tilesForViewport(1920, 1080));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('24 captures');
  });

  it('refuses the same day on a 4K window and names both numbers', () => {
    const result = plan(hours(24), tilesForViewport(3840, 2160));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toBe(
      'Too many tiles (3,240). One export captures at most 3,000; choose fewer times or a smaller window.',
    );
    expect(result.ok ? [] : result.times).toHaveLength(24);
  });

  it('refuses exactly one tile over the budget', () => {
    expect(plan(hours(24), EXPORT_TILE_BUDGET / 24).ok).toBe(true); // 125
    expect(plan(hours(24), EXPORT_TILE_BUDGET / 24 + 1).ok).toBe(false); // 126
  });

  it('skips the tile budget when the viewport size is unknown', () => {
    expect(plan(hours(24), 0).ok).toBe(true);
    expect(plan(hours(24)).ok).toBe(true);
  });

  it('reports the capture cap before the tile budget', () => {
    // 30 frames at 135 tiles breaks both; the cap is the one the user can fix by choosing fewer.
    const result = plan(hours(30), 135);
    expect(result.ok ? '' : result.message).toContain('Too many captures (30)');
  });
});
