import { useCallback, useEffect, useState } from 'react';
import { fetchAllWeather, fetchPointWeather, fetchWeather } from '../api/client';
import type { SavedLocation, WeatherForecastResponse } from '../types';
import { useLatest } from './useLatest';

/** What the drawer shows: a saved location or an ad-hoc map point (grid barb click). */
export type Selection =
  | { kind: 'saved'; location: SavedLocation }
  | { kind: 'point'; latitude: number; longitude: number };

/** Stable identity for a selection, used as an effect dependency. */
export function selectionKey(selection: Selection | null): string | null {
  if (!selection) return null;
  return selection.kind === 'saved'
    ? `saved:${selection.location.id}`
    : `point:${selection.latitude},${selection.longitude}`;
}

/**
 * Current forecasts for every saved location (map markers), reloaded when the model or
 * timezone changes. Single forecasts loaded elsewhere can be merged in with `put`.
 */
export function useAllWeather(model: string, timezone: string) {
  const [weatherMap, setWeatherMap] = useState<Record<number, WeatherForecastResponse>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchAllWeather(model, timezone, { signal: controller.signal })
      .then((all) => {
        if (controller.signal.aborted) return;
        setWeatherMap((prev) => {
          const next = { ...prev };
          all.forEach((w) => {
            next[w.location_id] = w;
          });
          return next;
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error('Failed to load weather for all locations:', err);
      });
    return () => controller.abort();
  }, [model, timezone]);

  const put = useCallback((forecast: WeatherForecastResponse) => {
    setWeatherMap((prev) => ({ ...prev, [forecast.location_id]: forecast }));
  }, []);

  const remove = useCallback((locationId: number) => {
    setWeatherMap((prev) => {
      const next = { ...prev };
      delete next[locationId];
      return next;
    });
  }, []);

  return { weatherMap, put, remove };
}

/**
 * The drawer's forecast for `selection`. Reloads when the selection, model, timezone or
 * `refreshToken` changes. A newer request aborts the previous one, so a slow response can
 * never replace the forecast of a later selection.
 */
export function useDrawerForecast(
  selection: Selection | null,
  model: string,
  timezone: string,
  {
    refreshToken = 0,
    onSavedForecast,
  }: { refreshToken?: number; onSavedForecast?: (forecast: WeatherForecastResponse) => void } = {},
) {
  const [forecast, setForecast] = useState<WeatherForecastResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const selectionRef = useLatest(selection);
  const onSavedRef = useLatest(onSavedForecast);
  const key = selectionKey(selection);

  useEffect(() => {
    const current = selectionRef.current;
    if (!current) {
      setForecast(null);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    const options = { signal: controller.signal };
    setIsLoading(true);

    const request =
      current.kind === 'saved'
        ? fetchWeather(current.location.id, model, timezone, options)
        : fetchPointWeather(current.latitude, current.longitude, model, timezone, options);

    request
      .then((data) => {
        if (controller.signal.aborted) return;
        setForecast(data);
        if (current.kind === 'saved') onSavedRef.current?.(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error('Failed to load forecast:', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
    // `key` identifies the selection; the object itself is read through selectionRef.
  }, [key, model, timezone, refreshToken, selectionRef, onSavedRef]);

  return { forecast, isLoading };
}
