import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { fetchWindGrid, parseQuotaExhausted } from '../api/client';
import type { GridWindPoint } from '../types';

/**
 * About one barb per 80px; the backend caps each axis at 20 (SCRUM-194).
 *
 * The same grid feeds every layer that draws it (the barbs now, the color gradient in
 * SCRUM-123), so density is one shared decision rather than a per-layer detail. It is
 * not raised further: data resolution is limited by the weather model (about 1 to 11 km),
 * so a finer grid repeats values instead of adding detail, and the smoothness comes from
 * client-side interpolation. Revisit only if verification shows blockiness at zoom 8-12.
 *
 * The 20-per-axis cap comes from Open-Meteo's budget, not from density (SCRUM-194): it charges one
 * call per point against 600 per minute, so 20 x 20 = 400 points per view leaves room for a pan in
 * the same window, while 30 x 30 = 900 could never fit.
 */
export const BARB_SPACING_PX = 80;
export const MAX_GRID_DIM = 20;

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
  /** Called once when Open-Meteo's request limit stops the grid (SCRUM-170). */
  onQuotaExhausted?: (resetAt: string | null) => void,
  /**
   * In-flight report for the single-view export (SCRUM-242): true from the moment a view's grid
   * request starts until its points have been drawn. Reported from an effect, so `false` arrives
   * after the commit that creates the barbs and an export waiting on it cannot capture first.
   */
  onLoadingChange?: (loading: boolean) => void,
): GridWindPoint[] {
  const [points, setPoints] = useState<GridWindPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      setPoints([]);
      setLoading(false);
      return;
    }

    let lastKey = '';
    let controller: AbortController | null = null;
    let disposed = false;

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
      setLoading(true);
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
        if (lastKey === key) lastKey = ''; // allow a retry of the same view
        const quota = parseQuotaExhausted(err);
        if (quota) {
          onQuotaExhausted?.(quota.resetAt);
          return;
        }
        console.error('Failed to load wind grid:', err);
      } finally {
        // A superseded request must not report the newer one as finished, and a torn-down
        // effect must not report anything at all.
        if (!disposed && controller === current) {
          controller = null;
          setLoading(false);
        }
      }
    };

    // Leaflet auto-pans a marker pop-up that would overflow the viewport. That pan fires
    // `moveend`, and refetching here would replace `points`, rebuild every marker and close
    // the pop-up the pan was making room for (SCRUM-251). The pop-up's own pan is skipped; the
    // next real pan or zoom refreshes as usual. A drag clears the flag too, in case an
    // `autopanstart` never produces its `moveend`.
    let autoPanning = false;
    const onAutoPanStart = () => {
      autoPanning = true;
    };
    const onDragStart = () => {
      autoPanning = false;
    };
    const onMoveEnd = () => {
      if (autoPanning) {
        autoPanning = false;
        return;
      }
      refresh();
    };
    const onZoomEnd = () => {
      autoPanning = false;
      refresh();
    };

    refresh();
    map.on('autopanstart', onAutoPanStart);
    map.on('dragstart', onDragStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onZoomEnd);
    return () => {
      disposed = true;
      map.off('autopanstart', onAutoPanStart);
      map.off('dragstart', onDragStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
      controller?.abort();
    };
  }, [map, model, enabled, validTime, onLoaded, onQuotaExhausted]);

  return points;
}
