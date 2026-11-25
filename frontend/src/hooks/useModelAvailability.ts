import { useEffect, useState } from 'react';
import { fetchModelAvailability } from '../api/client';
import type { ModelAvailability } from '../types';

/** How often the publication times are re-read: they move a handful of times a day (SCRUM-256). */
export const AVAILABILITY_REFRESH_MS = 10 * 60 * 1000;

/**
 * Publication times for the selected model (SCRUM-256).
 *
 * Null until the API answers, for a model with no single upstream run (`best_match`, the seamless
 * blends) and after a failed request. Every one of those cases leaves the derived cycle clock on
 * screen, so a freshness hint can never turn into an error or an empty line.
 */
export function useModelAvailability(model: string): ModelAvailability | null {
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Another model must not keep showing the previous model's times while it loads.
    setAvailability(null);
    const load = () => {
      fetchModelAvailability(model)
        .then((next) => {
          if (!cancelled) setAvailability(next.available_utc ? next : null);
        })
        .catch(() => {
          // The cycle line is the fallback; a failed hint changes nothing else on screen.
        });
    };
    load();
    const timer = setInterval(load, AVAILABILITY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [model]);

  return availability;
}
