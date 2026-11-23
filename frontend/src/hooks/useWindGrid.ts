import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { fetchWindGrid } from '../api/client';
import type { GridWindPoint } from '../types';

/**
 * About one barb per 80px; the backend caps each axis at 30.
 *
 * The same grid feeds every layer that draws it (the barbs now, the color gradient in
 * SCRUM-123), so density is one shared decision rather than a per-layer detail. It is
 * not raised further: data resolution is limited by the weather model (about 1 to 11 km),
 * so a finer grid repeats values instead of adding detail, and the smoothness comes from
 * client-side interpolation. Revisit only if verification shows blockiness at zoom 8-12.
 */
export const BARB_SPACING_PX = 80;
export const MAX_GRID_DIM = 30;

export function gridDimensions(size: { x: number; y: number }): { cols: number; rows: number } {
  const dim = (px: number) => Math.min(Math.max(2, Math.round(px / BARB_SPACING_PX)), MAX_GRID_DIM);
  return { cols: dim(size.x), rows: dim(size.y) };
}

/**
 * Wind grid points for the visible map area, refetched after every pan or zoom
 * (SCRUM-92). Called once in `MapView` and shared with every layer that draws the grid
 * (SCRUM-122), so turning another layer on never adds a request. `enabled` is true when
 * at least one such layer is on; otherwise the points are cleared and nothing is fetched.
 *
 * A newer request aborts the previous one, so only the latest response is used; a failed
 * request is retried on the next pan or zoom, even for the same view.
 *
 * `validTime` (SCRUM-115) is the selected forecast hour; null means current conditions. A new
 * hour refetches the same view, and hours are cached separately by the backend.
 */
export function useWindGrid(
  map: L.Map | null,
  model: string,
  enabled: boolean,
  validTime: string | null = null,
  /** Readiness report for the range export (SCRUM-155): the hour and points just accepted. */
  onLoaded?: (frame: { validTime: string | null; points: GridWindPoint[] }) => void,
): GridWindPoint[] {
  const [points, setPoints] = useState<GridWindPoint[]>([]);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
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
      if (key === lastKey) return; // same view and hour as the last request
      lastKey = key;

      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const next = await fetchWindGrid(
          { ...box, cols, rows, model, time: validTime }, 
          { signal: current.signal },
        );
        if (!current.signal.aborted) {
          setPoints(next);
          onLoaded?.({ validTime, points: next });
        }
      } catch (err) {
        if (current.signal.aborted) return; // superseded or unmounted
        console.error('Failed to load wind grid:', err);
        if (lastKey === key) lastKey = ''; // allow a retry of the same view
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
  }, [map, model, enabled, validTime, onLoaded]);

  return points;
}
