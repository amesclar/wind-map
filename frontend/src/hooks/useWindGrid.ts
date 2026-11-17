import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { fetchWindGrid } from '../api/client';
import type { GridWindPoint } from '../types';

/** About one barb per 80px; the backend caps each axis at 30. */
export const BARB_SPACING_PX = 80;
export const MAX_GRID_DIM = 30;

export function gridDimensions(size: { x: number; y: number }): { cols: number; rows: number } {
  const dim = (px: number) => Math.min(Math.max(2, Math.round(px / BARB_SPACING_PX)), MAX_GRID_DIM);
  return { cols: dim(size.x), rows: dim(size.y) };
}

/**
 * Wind grid points for the visible map area, refetched after every pan or zoom
 * (SCRUM-92). A newer request aborts the previous one, so only the latest response is
 * used; a failed request is retried on the next pan or zoom, even for the same view.
 */
export function useWindGrid(map: L.Map | null, model: string, visible: boolean): GridWindPoint[] {
  const [points, setPoints] = useState<GridWindPoint[]>([]);

  useEffect(() => {
    if (!map) return;
    if (!visible) {
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
      const key = `${box.min_lat},${box.max_lat},${box.min_lon},${box.max_lon},${cols},${rows}`;
      if (key === lastKey) return; // same view as the last request
      lastKey = key;

      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const next = await fetchWindGrid({ ...box, cols, rows, model }, { signal: current.signal });
        if (!current.signal.aborted) setPoints(next);
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
  }, [map, model, visible]);

  return points;
}
