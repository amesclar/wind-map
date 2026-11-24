import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { fetchCurrentGrid } from '../api/client';
import type { CurrentPoint } from '../types';
import { gridDimensions } from './useWindGrid';

/** The SMOC current forecast is 10 days; the backend rejects hours beyond this. */
export const CURRENT_HORIZON_HOURS = 240;
/** The ticket's density cap: a full viewport of chevrons would be unreadable. */
export const MAX_CURRENT_MARKERS = 120;

const HOUR_MS = 60 * 60 * 1000;

/** True when the selected hour is served by the current model (null means live values). */
export function withinCurrentHorizon(validTime: string | null, now: number = Date.now()): boolean {
  if (!validTime) return true;
  const at = Date.parse(validTime);
  if (Number.isNaN(at)) return false;
  return at <= now + CURRENT_HORIZON_HOURS * HOUR_MS;
}

/** Keep at most `max` points, evenly sampled, so a dense view stays readable. */
export function capPoints(points: CurrentPoint[], max: number = MAX_CURRENT_MARKERS): CurrentPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, index) => index % step === 0);
}

/**
 * Ocean-current points for the visible map area, at the hour selected in the forecast time bar
 * (SCRUM-99). Fetched only while the layer is on; a newer request aborts the previous one, and a
 * failed request leaves the layer empty rather than showing an error (the ticket's choice).
 *
 * Hours past the currents' 240-hour horizon are not requested at all: the layer simply hides,
 * because the wind timeline can reach further than the current model does.
 */
export function useCurrentGrid(
  map: L.Map | null,
  enabled: boolean,
  validTime: string | null = null,
): CurrentPoint[] {
  const [points, setPoints] = useState<CurrentPoint[]>([]);

  useEffect(() => {
    if (!map) return;
    if (!enabled || !withinCurrentHorizon(validTime)) {
      setPoints([]);
      return;
    }

    let lastKey = '';
    let controller: AbortController | null = null;

    const refresh = async () => {
      const bounds = map.getBounds();
      const { cols, rows } = gridDimensions(map.getSize());
      const box = {
        min_lat: Number(bounds.getSouth().toFixed(4)),
        max_lat: Number(bounds.getNorth().toFixed(4)),
        min_lon: Number(bounds.getWest().toFixed(4)),
        max_lon: Number(bounds.getEast().toFixed(4)),
      };
      const key = `${box.min_lat},${box.max_lat},${box.min_lon},${box.max_lon},${cols},${rows},${validTime ?? 'current'}`;
      if (key === lastKey) return;
      lastKey = key;

      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetchCurrentGrid(
          { ...box, cols, rows, time: validTime },
          { signal: current.signal },
        );
        if (!current.signal.aborted) setPoints(capPoints(response.points));
      } catch (err) {
        if (current.signal.aborted) return; // superseded or unmounted
        if (lastKey === key) lastKey = ''; // let the next pan retry this view
        setPoints([]);
        console.error('Failed to load ocean currents:', err);
      }
    };

    refresh();
    map.on('moveend', refresh);
    map.on('zoomend', refresh);
    return () => {
      map.off('moveend', refresh);
      map.off('zoomend', refresh);
      controller?.abort();
    };
  }, [map, enabled, validTime]);

  return points;
}
