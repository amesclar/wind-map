import { formatRunTime } from './forecastWindow';

/** The refresh button's hover hint: a headline plus an optional second line (SCRUM-257). */
export interface RefreshHint {
  /** What the button will do, or why it is disabled. */
  text: string;
  /** The next published run, already formatted, or the "unknown" wording; null when neither applies. */
  detail: string | null;
}

export interface RefreshHintInput {
  refreshing: boolean;
  canRefresh: boolean;
  /** Newest server `cached_at` among the responses on screen, or null before anything has loaded. */
  dataAsOf: number | null;
  /** Next run the source has published (ISO 8601 UTC), or null when it has no single run. */
  nextRunUtc: string | null;
  /** The Preferences timezone, so the hint and the footer always read the same instant alike. */
  timezone: string;
}

/**
 * The copy on the disabled refresh button (SCRUM-257). It answers one question — when will a click
 * be worth a call — and never claims the latest run is loaded before a response has landed.
 */
export function buildRefreshHint({ refreshing, canRefresh, dataAsOf, nextRunUtc, timezone }: RefreshHintInput): RefreshHint {
  if (refreshing) return { text: 'Refreshing…', detail: null };
  if (canRefresh) return { text: 'Refresh data now', detail: null };
  // The first response is still on its way, so there is no run to compare against yet.
  if (dataAsOf === null) return { text: 'Waiting for the first forecast', detail: null };
  const at = nextRunUtc && !Number.isNaN(Date.parse(nextRunUtc)) ? formatRunTime(nextRunUtc, timezone) : null;
  return {
    text: 'Latest run already loaded',
    detail: at ? `Next run available ~${at}` : 'Next run time unknown',
  };
}
