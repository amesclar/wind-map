import { describe, expect, it } from 'vitest';
import { buildRefreshHint } from './refreshHint';
import { formatRunTime } from './forecastWindow';

const NEXT_RUN = '2026-11-26T00:17:00Z';
const TIMEZONE = 'America/Los_Angeles';

function hint(overrides: Partial<Parameters<typeof buildRefreshHint>[0]> = {}) {
  return buildRefreshHint({
    refreshing: false,
    canRefresh: false,
    dataAsOf: Date.parse('2026-11-25T18:30:00Z'),
    nextRunUtc: NEXT_RUN,
    timezone: TIMEZONE,
    ...overrides,
  });
}

describe('buildRefreshHint (SCRUM-257)', () => {
  it('invites the click while the button is enabled', () => {
    expect(hint({ canRefresh: true })).toEqual({ text: 'Refresh data now', detail: null });
  });

  it('says it is busy while the click`s responses are in flight', () => {
    expect(hint({ refreshing: true, canRefresh: false })).toEqual({ text: 'Refreshing…', detail: null });
  });

  it('waits for the first forecast instead of claiming the latest run is loaded', () => {
    expect(hint({ dataAsOf: null })).toEqual({ text: 'Waiting for the first forecast', detail: null });
    // Disabled before any response: the run times cannot have been compared yet.
    expect(hint({ dataAsOf: null, canRefresh: false, nextRunUtc: null }).text).not.toContain('already loaded');
  });

  it('names the next published run in the Preferences timezone', () => {
    expect(hint()).toEqual({
      text: 'Latest run already loaded',
      detail: `Next run available ~${formatRunTime(NEXT_RUN, TIMEZONE)}`,
    });
  });

  it('follows the timezone, like the footer line does', () => {
    const utc = hint({ timezone: 'UTC' }).detail;
    const pacific = hint({ timezone: TIMEZONE }).detail;
    expect(utc).toContain(formatRunTime(NEXT_RUN, 'UTC'));
    expect(pacific).toContain(formatRunTime(NEXT_RUN, TIMEZONE));
    expect(utc).not.toEqual(pacific);
  });

  it('says the time is unknown rather than inventing one', () => {
    expect(hint({ nextRunUtc: null })).toEqual({
      text: 'Latest run already loaded',
      detail: 'Next run time unknown',
    });
    expect(hint({ nextRunUtc: 'not a date' }).detail).toBe('Next run time unknown');
  });
});
