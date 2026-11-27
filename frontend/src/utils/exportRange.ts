/**
 * Planning for a time-lapsed export of "Download map image" (SCRUM-155, SCRUM-332): the times the
 * user ticked, whether they are valid inside the forecast window, what the export will cost a tile
 * provider, and the summary the dialog shows. Pure, so the cap, the tile budget and the window
 * limits are unit tested.
 */

/** The ticket's hard cap on one time-lapsed export (SCRUM-155). */
export const MAX_RANGE_CAPTURES = 24;

/**
 * The most base-map tiles one export may ask a provider for (SCRUM-299). A time-lapsed export is
 * the one part of the app that fetches tiles nobody is looking at, so it is bounded by the traffic
 * it causes rather than by its frame count: 3,000 is the smallest published per-download cap we
 * priced (OpenFreeMap's), and at 1080p the 24-capture cap binds long before it does.
 */
export const EXPORT_TILE_BUDGET = 3_000;

/** Base layers ask for 256 px tiles, so a viewport needs this many. */
export const BASE_TILE_SIZE_PX = 256;

/**
 * The minimum gap between two captured frames (SCRUM-332). SCRUM-299 bounded how many tiles an
 * export asks for; this bounds how fast it asks for them. At 0.75 s a 16-frame export takes at
 * least 11 s, and a 1080p frame's 40 tiles become at most ~53 tile requests a second instead of
 * whatever the renderer manages - the difference between a gallery and a scraper.
 */
export const RANGE_PACE_MS = 750;

/** Tiles one captured frame of this CSS size asks for; 0 when the size is not known yet. */
export function tilesForViewport(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  return Math.ceil(width / BASE_TILE_SIZE_PX) * Math.ceil(height / BASE_TILE_SIZE_PX);
}

/** Thousands separators, so a tile count reads the same in every locale's test. */
const thousands = (value: number) => value.toLocaleString('en-US');

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

export interface ExportTimesInput {
  /** The times the user ticked, in any order. */
  times: string[];
  /** First and last selectable times: now floored to the hour through now + the model horizon. */
  windowStart: string;
  windowEnd: string;
  /** Tiles one frame asks for, from `tilesForViewport`; absent or 0 skips the tile budget. */
  tilesPerFrame?: number;
}

export type ExportTimesPlan =
  | { ok: true; times: string[]; summary: string }
  | { ok: false; message: string; times: string[] };

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

/** "Thu 14:00 PST" for one time, in the user's timezone. */
export function formatRangeBoundary(iso: string, timezone: string): string {
  const parts = BOUNDARY_FORMAT(timezone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const zone =
    ZONE_FORMAT(timezone)
      .formatToParts(new Date(iso))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${get('weekday')} ${get('hour')}:${get('minute')} ${zone}`.trim();
}

/**
 * "3 captures: Mon 14:00, Mon 15:00, Mon 16:00 PST". The times are listed rather than described as
 * a span (SCRUM-332): once the user picks times, a range's "from A to B" would claim gaps that are
 * not there. Lists longer than four are cut after the fourth, so the line stays one line.
 */
export function formatTimesSummary(times: string[], timezone: string): string {
  if (times.length === 0) return 'No captures';
  const labels = times.map((iso) => formatRangeBoundary(iso, timezone));
  const zone = labels[0].split(' ').slice(-1)[0];
  const strip = (label: string) => label.replace(/ [A-Za-z0-9+/-]+$/, '');
  if (times.length === 1) return `1 capture at ${labels[0]}`;
  const shown = labels.slice(0, 4).map(strip).join(', ');
  const more = labels.length > 4 ? ', …' : '';
  return `${times.length} captures: ${shown}${more} ${zone}`;
}

/**
 * Validate the chosen times against the model window, the capture cap and the tile budget.
 * Duplicates are dropped and the times are sorted, so the frames always run forward in time.
 */
export function planExportTimes(input: ExportTimesInput, timezone: string): ExportTimesPlan {
  const { windowStart, windowEnd } = input;
  const times = [...new Set(input.times)].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (times.length === 0) {
    return { ok: false, message: 'Choose at least one time to capture.', times: [] };
  }
  if (!times.every(isHourAligned)) {
    return { ok: false, message: 'Every chosen time must be a whole hour.', times };
  }
  if (!isHourAligned(windowStart) || !isHourAligned(windowEnd)) {
    return { ok: false, message: 'The forecast window is not ready yet.', times };
  }
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (times.some((time) => Date.parse(time) < startMs || Date.parse(time) > endMs)) {
    return {
      ok: false,
      message: `Times must be between ${formatRangeBoundary(windowStart, timezone)} and ${formatRangeBoundary(windowEnd, timezone)}.`,
      times,
    };
  }
  if (times.length > MAX_RANGE_CAPTURES) {
    return {
      ok: false,
      message: `Too many captures (${times.length}). The maximum is ${MAX_RANGE_CAPTURES}; choose fewer times.`,
      times,
    };
  }
  const tiles = times.length * (input.tilesPerFrame ?? 0);
  if (tiles > EXPORT_TILE_BUDGET) {
    return {
      ok: false,
      message: `Too many tiles (${thousands(tiles)}). One export captures at most ${thousands(EXPORT_TILE_BUDGET)}; choose fewer times or a smaller window.`,
      times,
    };
  }
  return { ok: true, times, summary: formatTimesSummary(times, timezone) };
}
