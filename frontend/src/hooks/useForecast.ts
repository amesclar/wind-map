import { useEffect, useState } from 'react';
import { fetchAllWeather } from '../api/client';
import type { SavedLocation, WeatherForecastResponse } from '../types';

/** What the map has selected: one saved location or one ad-hoc point (grid barb click). */
export type Selection =
  | { kind: 'saved'; location: SavedLocation }
  | { kind: 'point'; latitude: number; longitude: number };

/**
 * Forecasts for every saved location (map markers) at the selected hour, reloaded when the
 * model, timezone or hour changes (SCRUM-115). Deleted locations are dropped with `remove`.
 */
export function useAllWeather(model: string, timezone: string, validTime: string | null = null) {
  const [weatherMap, setWeatherMap] = useState<Record<number, WeatherForecastResponse>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchAllWeather(model, timezone, { signal: controller.signal, time: validTime })
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
  }, [model, timezone, validTime]);

  const remove = (locationId: number) => {
    setWeatherMap((prev) => {
      const next = { ...prev };
      delete next[locationId];
      return next;
    });
  };

  return { weatherMap, remove };
}
