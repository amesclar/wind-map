import { useEffect, useRef, useState } from 'react';
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

/**
 * Coarse grid drawn while a gesture is still going (SCRUM-196). 160 px gives a quarter of the
 * barbs (10 x 5 = 50 points on a 1600 x 800 window against 200 at 80 px), which is enough to read
 * the field mid-pan without paying for the fine grid twice.
 */
export const PREVIEW_SPACING_PX = 160;
/** A pan or zoom must last this long before the preview fires, so a flick costs one request. */
export const PREVIEW_DELAY_MS = 350;
/** The settle request waits out a burst of pans, so dragging across the map costs one request. */
export const SETTLE_DEBOUNCE_MS = 300;
/** One retry after a failed settle request, before the stale barbs are cleared (SCRUM-196). */
export const RETRY_DELAY_MS = 1500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function gridDimensions(
  size: { x: number; y: number },
  spacing = BARB_SPACING_PX,
): { cols: number; rows: number } {
  const dim = (px: number) => Math.min(Math.max(2, Math.round(px / spacing)), MAX_GRID_DIM);
  return { cols: dim(size.x), rows: dim(size.y) };
}

/**
 * Wind grid points for the visible map area, refetched after every pan or zoom
 * (SCRUM-92). Called once in `MapView` and shared with every layer that draws the grid
 * (SCRUM-122), so turning another layer on never adds a request. `enabled` is true when
 * at least one such layer is on; otherwise the points are cleared and nothing is fetched.
 *
 * Two tiers (SCRUM-196). A gesture that lasts `PREVIEW_DELAY_MS` draws one coarse grid at
 * `PREVIEW_SPACING_PX`, so the barbs are never blank while the map is still moving; the fine
 * grid follows the gesture end, debounced by `SETTLE_DEBOUNCE_MS` so a burst of pans costs one
 * request. The preview is never repeated within a gesture and never starts while a settle
 * request is in flight. A request sequence number means a preview answered late is discarded
 * instead of overwriting the finer points that arrived after it.
 *
 * A settle request that fails is retried once after `RETRY_DELAY_MS`; a second failure clears the
 * points, so a broken grid shows an empty layer rather than barbs from an earlier view, and
 * reports through `onError`. The Open-Meteo quota path is not retried: it is not a transient
 * failure and the dialog already explains it (SCRUM-170).
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
  /** One-shot refresh trigger (SCRUM-113): a new value sends `refresh=true` exactly once. */
  refreshSeq = 0,
  /** A settle request failed twice and the barbs were cleared; `MapView` says so (SCRUM-196). */
  onError?: () => void,
): GridWindPoint[] {
  const [points, setPoints] = useState<GridWindPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const servedRefresh = useRef(0);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    // Read before the early returns: a click while the layer is off must not fire later.
    const refreshOnce = refreshSeq !== servedRefresh.current;
    servedRefresh.current = refreshSeq;
    if (!map) return;
    if (!enabled) {
      setPoints([]);
      setLoading(false);
      return;
    }

    let disposed = false;
    /** View and hour of the last accepted settle request, so a repeat view costs nothing. */
    let settledKey = '';
    /** Bumped by every request; only the latest one is allowed to replace the points. */
    let seq = 0;
    let settleController: AbortController | null = null;
    let previewController: AbortController | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    let settleInFlight = false;
    let previewedThisGesture = false;

    const requestFor = (spacing: number) => {
      const bounds = map.getBounds();
      const { cols, rows } = gridDimensions(map.getSize(), spacing);
      const box = {
        min_lat: Number(bounds.getSouth().toFixed(4)),
        max_lat: Number(bounds.getNorth().toFixed(4)),
        min_lon: Number(bounds.getWest().toFixed(4)),
        max_lon: Number(bounds.getEast().toFixed(4)),
      };
      const key = `${box.min_lat},${box.max_lat},${box.min_lon},${box.max_lon},${cols},${rows},${validTime ?? 'current'}`;
      return { box, cols, rows, key };
    };

    /**
     * One grid request. A `preview` adopts its points but never reports them: the range export
     * waits on the settle response, so it cannot capture the coarse grid. A preview is not
     * retried and does not report a failure either, because the settle right behind it decides.
     */
    const load = async (spacing: number, options: { preview: boolean; refresh: boolean }) => {
      const { box, cols, rows, key } = requestFor(spacing);
      if (!options.preview) {
        if (key === settledKey) return; // same view and hour as the last accepted request
        settledKey = key;
      }

      const current = new AbortController();
      if (options.preview) {
        previewController?.abort();
        previewController = current;
      } else {
        settleController?.abort();
        settleController = current;
        settleInFlight = true;
      }
      const mySeq = ++seq;
      const send = (refresh: boolean) =>
        fetchWindGrid({ ...box, cols, rows, model, time: validTime }, { signal: current.signal, refresh });

      setLoading(true);
      try {
        let next: GridWindPoint[];
        try {
          next = await send(options.refresh);
        } catch (err) {
          if (current.signal.aborted) return; // superseded or unmounted
          const quota = parseQuotaExhausted(err);
          if (quota) {
            onQuotaExhausted?.(quota.resetAt);
            return;
          }
          if (options.preview) return;
          // The request is over, so an export waiting on the barbs must not sit out its deadline;
          // the retry below sets the flag again when it starts.
          if (mySeq === seq) setLoading(false);
          await wait(RETRY_DELAY_MS);
          if (current.signal.aborted || disposed) return;
          setLoading(true);
          try {
            next = await send(false);
          } catch (retryErr) {
            if (current.signal.aborted) return;
            // Two failures in a row: the old points are what made the layer look frozen.
            if (mySeq === seq) {
              settledKey = ''; // a later pan or zoom may retry this view
              setPoints([]);
            }
            console.error('Failed to load wind grid:', retryErr);
            onError?.();
            return;
          }
        }
        if (current.signal.aborted || mySeq !== seq) return; // a newer request owns the points
        setPoints(next);
        if (!options.preview) onLoaded?.({ validTime, points: next });
      } finally {
        if (!disposed) {
          if (options.preview) {
            if (previewController === current) previewController = null;
          } else if (settleController === current) {
            settleController = null;
            settleInFlight = false;
          }
          if (mySeq === seq) setLoading(false);
        }
      }
    };

    /** The fine grid, after the user lets go: a burst of pans collapses into one request. */
    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        load(BARB_SPACING_PX, { preview: false, refresh: false });
      }, SETTLE_DEBOUNCE_MS);
    };

    /** A gesture that lasts gets a coarse grid once; a flick is over before the timer fires. */
    const startGesture = () => {
      previewedThisGesture = false;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = null;
        if (disposed || previewedThisGesture || settleInFlight) return;
        previewedThisGesture = true;
        load(PREVIEW_SPACING_PX, { preview: true, refresh: false });
      }, PREVIEW_DELAY_MS);
    };

    const endGesture = () => {
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
      previewedThisGesture = false;
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
    const onMoveStart = () => {
      startGesture();
    };
    const onMoveEnd = () => {
      // Before the auto-pan check: a pop-up's pan must cancel a pending preview too.
      endGesture();
      if (autoPanning) {
        autoPanning = false;
        return;
      }
      scheduleSettle();
    };
    const onZoomEnd = () => {
      endGesture();
      autoPanning = false;
      scheduleSettle();
    };

    // The first view is fetched at once; only gesture-driven settles are debounced. Only this
    // request can carry the refresh click: a settle in the same effect must not repeat it.
    load(BARB_SPACING_PX, { preview: false, refresh: refreshOnce });

    map.on('autopanstart', onAutoPanStart);
    map.on('dragstart', onDragStart);
    map.on('movestart', onMoveStart);
    map.on('zoomstart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onZoomEnd);
    return () => {
      disposed = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (previewTimer) clearTimeout(previewTimer);
      map.off('autopanstart', onAutoPanStart);
      map.off('dragstart', onDragStart);
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
      settleController?.abort();
      previewController?.abort();
    };
  }, [map, model, enabled, validTime, onLoaded, onQuotaExhausted, refreshSeq, onError]);

  return points;
}
