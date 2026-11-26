import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { fetchWaveGrid } from '../api/client';
import type { WavePoint } from '../types';
import { gridDimensions } from './useWindGrid';

/** The Marine wave field covers 10 days, independent of the selected weather model. */
export const WAVE_HORIZON_HOURS = 240;
/** The ticket's density cap: one arrow per 80 px, at most 120 per view. */
export const MAX_WAVE_MARKERS = 120;

const HOUR_MS = 60 * 60 * 1000;

/** True when the selected hour is served by the wave model (null means live values). */
export function withinWaveHorizon(validTime: string | null, now: number = Date.now()): boolean {
  if (!validTime) return true;
  const at = Date.parse(validTime);
  if (Number.isNaN(at)) return false;
  return at <= now + WAVE_HORIZON_HOURS * HOUR_MS;
}

/** Keep at most `max` points, evenly sampled, so a dense view stays readable. */
export function capWavePoints(points: WavePoint[], max: number = MAX_WAVE_MARKERS): WavePoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, index) => index % step === 0);
}

/**
 * Ocean-wave points for the visible map area, at the hour selected in the forecast time bar
 * (SCRUM-234). Fetched only while the layer is on; a newer request aborts the previous one, and a
 * failed request leaves the layer empty rather than showing an error, as the currents do.
 *
 * Hours past the waves' 240-hour horizon are not requested at all: the layer hides, because the
 * wind timeline can reach further than the wave model does.
 */
export function useWaveGrid(
  map: L.Map | null,
  enabled: boolean,
  validTime: string | null = null,
): WavePoint[] {
  const [points, setPoints] = useState<WavePoint[]>([]);

  useEffect(() => {
    if (!map) return;
    if (!enabled || !withinWaveHorizon(validTime)) {
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
        const response = await fetchWaveGrid(
          { ...box, cols, rows, time: validTime },
          { signal: current.signal },
        );
        if (!current.signal.aborted) setPoints(capWavePoints(response.points));
      } catch (err) {
        if (current.signal.aborted) return; // superseded or unmounted
        if (lastKey === key) lastKey = ''; // let the next pan retry this view
        setPoints([]);
        console.error('Failed to load ocean waves:', err);
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
