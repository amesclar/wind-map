import { useEffect } from 'react';
import L from 'leaflet';
import type { UnitSystem, WavePoint, WaveSeriesPoint } from '../types';
import { fetchPointWaves } from '../api/client';
import { buildWaveArrowIcon, buildWavePopup } from './WaveArrow';
import { POPUP_OPTIONS } from '../utils/popupPlacement';

interface WaveOverlayProps {
  map: L.Map | null;
  /** Points fetched by `useWaveGrid`; nothing is fetched here until an arrow is clicked. */
  points: WavePoint[];
  unitSystem?: UnitSystem;
  /** Selected hour for the pop-up, e.g. "Mon 23 Nov 12:00 PST". */
  timeLabel?: string | null;
}

/**
 * One promise per rounded point, successes only (SCRUM-234): reopening a pop-up does not spend
 * another request, while a failure is retried on the next click.
 */
const seriesCache = new Map<string, Promise<WaveSeriesPoint[]>>();

/** Test helper: forget cached series so each test starts from the network. */
export function clearWaveSeriesCache(): void {
  seriesCache.clear();
}

function seriesFor(pt: WavePoint): Promise<WaveSeriesPoint[]> {
  const key = `${pt.latitude.toFixed(2)},${pt.longitude.toFixed(2)}`;
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const request = fetchPointWaves(pt.latitude, pt.longitude).then((response) => response.points);
  request.catch(() => seriesCache.delete(key));
  seriesCache.set(key, request);
  return request;
}

/**
 * Draws ocean waves as clickable arrows (SCRUM-234). A click opens a pop-up with the arrow's own
 * height, period and direction immediately, then fills in the next 48 hours from
 * `/api/waves/point`; a failed series leaves the summary intact rather than the whole pop-up.
 */
export function WaveOverlay({ map, points, unitSystem = 'imperial', timeLabel = null }: WaveOverlayProps) {
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const markers = points.map((point) => {
      const marker = L.marker([point.latitude, point.longitude], {
        icon: buildWaveArrowIcon(point),
        interactive: true,
      }).addTo(map);
      marker.bindPopup(buildWavePopup(point, unitSystem, timeLabel), POPUP_OPTIONS);
      marker.on('popupopen', () => {
        seriesFor(point)
          .then((series) => {
            if (!cancelled) marker.setPopupContent(buildWavePopup(point, unitSystem, timeLabel, series));
          })
          .catch(() => {
            if (!cancelled) marker.setPopupContent(buildWavePopup(point, unitSystem, timeLabel, null, true));
          });
      });
      return marker;
    });
    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.remove());
    };
  }, [map, points, unitSystem, timeLabel]);

  return null;
}
