import { useCallback, useEffect, useState } from 'react';

/** How often the gate is re-evaluated, so the button wakes up when a run lands (SCRUM-113). */
export const REFRESH_CLOCK_TICK_MS = 30_000;

export interface DataRefreshOptions {
  /** Newest server `cached_at` among the responses on screen, in epoch ms, or null when none. */
  dataAsOf: number | null;
  /** Newest run the source has published for the selected model (ISO 8601 UTC), or null. */
  runUtc: string | null;
  /** Refetch the data in use; the promise settles when those responses have landed. */
  onRefresh: () => Promise<void>;
}

export interface DataRefresh {
  /** True only while a newer run exists than the data on screen, and nothing is in flight. */
  canRefresh: boolean;
  refreshing: boolean;
  /** A short message for a failed click; the old data stays on screen. */
  error: string | null;
  refresh: () => void;
}

/**
 * The refresh gate (SCRUM-113): a click is worth a call only when the source has published a run
 * newer than the data on screen. Within one run Open-Meteo returns the same numbers, so the button
 * stays disabled — and says when the next run is due — instead of spending calls for identical data.
 */
export function useDataRefresh({ dataAsOf, runUtc, onRefresh }: DataRefreshOptions): DataRefresh {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A slow clock: a run landing while the tab sits open must enable the button by itself.
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), REFRESH_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const runAt = runUtc ? Date.parse(runUtc) : Number.NaN;
  const canRefresh = dataAsOf !== null && Number.isFinite(runAt) && dataAsOf < runAt && !refreshing;

  const refresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    onRefresh()
      .catch(() => setError('Refresh failed; showing the data already on screen.'))
      .finally(() => setRefreshing(false));
  }, [onRefresh, refreshing]);

  return { canRefresh, refreshing, error, refresh };
}
