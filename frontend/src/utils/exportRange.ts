/**
 * Range planning for "Download map image" (SCRUM-155): which hours a start/end/interval choice
 * captures, whether the choice is valid inside the forecast window, and the summary the dialog
 * shows. Pure, so daylight saving, the 24-capture cap and the window limits are unit tested.
 */

/** Intervals offered in the dialog, in hours. 12 h is kept because it still fits. */
export const RANGE_INTERVAL_HOURS = [1, 2, 3, 6, 12] as const;
export type RangeIntervalHours = (typeof RANGE_INTERVAL_HOURS)[number];

/** The ticket's hard cap on one range export. */
export const MAX_RANGE_CAPTURES = 24;

const MS_PER_HOUR = 3_600_000;

/** True for a valid ISO instant on an exact UTC hour (the API steps are UTC hours). */
export function isHourAligned(iso: string): boolean {
  const date = new Date(iso);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * Hour-aligned instants from `start` to `end`, stepping by `intervalHours`, both ends included
 * when the interval lands on them. `1..6` by 4 gives `1, 5`: the end is included only when it is
 * a step, so every returned hour is an exact interval multiple from the start.
 */
export function timeRangeHours(start: string, end: string, intervalHours: number): string[] {
  if (!Number.isInteger(intervalHours) || intervalHours <= 0) {
    throw new Error('The interval must be a positive whole number of hours');
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return [];
  const hours: string[] = [];
  for (let t = startMs; t <= endMs; t += intervalHours * MS_PER_HOUR) {
    hours.push(new Date(t).toISOString());
  }
  return hours;
}

export interface ExportRangeInput {
  start: string;
  end: string;
  intervalHours: number;
  /** First and last selectable hours: now floored to the hour through now + the model horizon. */
  windowStart: string;
  windowEnd: string;
}

export type ExportRangePlan =
  | { ok: true; hours: string[]; summary: string }
  | { ok: false; message: string; hours: string[] };

const BOUNDARY_FORMAT = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });

const ZONE_FORMAT = (timezone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });

/** "Thu 14:00 PST" for a range boundary, in the user's timezone. */
export function formatRangeBoundary(iso: string, timezone: string): string {
  const parts = BOUNDARY_FORMAT(timezone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const zone =
    ZONE_FORMAT(timezone)
      .formatToParts(new Date(iso))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${get('weekday')} ${get('hour')}:${get('minute')} ${zone}`.trim();
}

/** "5 captures from Thu 14:00 to Thu 18:00 PST", with the zone named once. */
export function formatRangeSummary(hours: string[], timezone: string): string {
  if (hours.length === 0) return 'No captures';
  const withZone = (iso: string) => formatRangeBoundary(iso, timezone);
  const first = withZone(hours[0]);
  const last = hours.length === 1 ? first : withZone(hours[hours.length - 1]);
  const zone = first.split(' ').slice(-1)[0];
  const strip = (label: string) => label.replace(/ [A-Za-z0-9+/-]+$/, '');
  const count = hours.length === 1 ? '1 capture' : `${hours.length} captures`;
  return hours.length === 1
    ? `${count} at ${first}`
    : `${count} from ${strip(first)} to ${strip(last)} ${zone}`;
}

/** Validate a range against the model window and the cap; the hours are returned either way. */
export function planExportRange(input: ExportRangeInput, timezone: string): ExportRangePlan {
  const { start, end, intervalHours, windowStart, windowEnd } = input;
  if (!isHourAligned(start) || !isHourAligned(end)) {
    return { ok: false, message: 'Start and end must be whole hours.', hours: [] };
  }
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    return { ok: false, message: 'The end hour must be after the start hour.', hours: [] };
  }
  if (!isHourAligned(windowStart) || !isHourAligned(windowEnd)) {
    return { ok: false, message: 'The forecast window is not ready yet.', hours: [] };
  }
  if (new Date(start).getTime() < new Date(windowStart).getTime()) {
    return {
      ok: false,
      message: `The range cannot start before ${formatRangeBoundary(windowStart, timezone)}.`,
      hours: [],
    };
  }
  if (new Date(end).getTime() > new Date(windowEnd).getTime()) {
    return {
      ok: false,
      message: `The range must end by ${formatRangeBoundary(windowEnd, timezone)}.`,
      hours: [],
    };
  }
  const hours = timeRangeHours(start, end, intervalHours);
  if (hours.length > MAX_RANGE_CAPTURES) {
    return {
      ok: false,
      message: `Too many captures (${hours.length}). The maximum is ${MAX_RANGE_CAPTURES}; pick a longer interval or a shorter range.`,
      hours,
    };
  }
  return { ok: true, hours, summary: formatRangeSummary(hours, timezone) };
}
