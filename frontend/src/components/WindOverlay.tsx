import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fetchWindGrid, GridWindPoint } from '../api/client';
import { generateWindBarbSvg } from './WindBarb';

export interface SelectedGridPoint {
  latitude: number;
  longitude: number;
  wind_speed_knots: number;
}

interface WindOverlayProps {
  map: L.Map | null;
  model: string;
  visible: boolean;
  selectedPoint: SelectedGridPoint | null;
  onGridPointSelect: (pt: GridWindPoint) => void;
}

const BARB_SPACING_PX = 80;
const MAX_GRID_DIM = 30;

function gridDimensions(map: L.Map): { cols: number; rows: number } {
  const size = map.getSize();
  const cols = Math.min(Math.max(2, Math.round(size.x / BARB_SPACING_PX)), MAX_GRID_DIM);
  const rows = Math.min(Math.max(2, Math.round(size.y / BARB_SPACING_PX)), MAX_GRID_DIM);
  return { cols, rows };
}

function isSamePoint(a: SelectedGridPoint | null, lat: number, lon: number): boolean {
  if (!a) return false;
  return Math.abs(a.latitude - lat) < 0.001 && Math.abs(a.longitude - lon) < 0.001;
}

/** Fallback color when a grid point has no temperature. */
export const GRID_BARB_FALLBACK_COLOR = '#4ade80';
const BARB_SIZE = 32;
const SELECTED_BARB_SIZE = 40;

/**
 * SVG for a grid barb — the same drawing and temperature colors the drawer uses.
 * Falls back to green when the temperature is unknown.
 */
export function generateGridBarbSvg(
  speedKnots: number,
  directionDeg: number,
  tempF: number | null | undefined,
  size: number = BARB_SIZE,
): string {
  const hasTemp = typeof tempF === 'number';
  return generateWindBarbSvg(
    speedKnots,
    directionDeg,
    hasTemp ? tempF : 0,
    size,
    false,
    hasTemp ? undefined : GRID_BARB_FALLBACK_COLOR,
  );
}

export function buildGridBarbIcon(pt: GridWindPoint, isSelected: boolean): L.DivIcon {
  const size = isSelected ? SELECTED_BARB_SIZE : BARB_SIZE;
  const svgHtml = generateGridBarbSvg(pt.wind_speed_knots, pt.wind_direction_deg, pt.temperature_f, size);
  // Selected barb gets a white highlight ring.
  const ringStyle = isSelected
    ? 'border-radius:50%;box-shadow:0 0 0 2px #ffffff;background:rgba(255,255,255,0.12);'
    : '';
  return L.divIcon({
    className: 'wind-grid-barb-marker',
    html: `<div data-wind-barb data-selected="${isSelected}" style="cursor:pointer;line-height:0;${ringStyle}">${svgHtml}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function WindOverlay({ map, model, visible, selectedPoint, onGridPointSelect }: WindOverlayProps) {
  const markersRef = useRef<L.Marker[]>([]);
  const pointsRef = useRef<GridWindPoint[]>([]);
  const lastFetchKeyRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // Keep the callback in a ref so marker click handlers always call the latest
  // version without needing to be re-registered on every render.
  const onGridPointSelectRef = useRef(onGridPointSelect);
  useEffect(() => { onGridPointSelectRef.current = onGridPointSelect; }, [onGridPointSelect]);

  // Keep selectedPoint in a ref so icon updates don't require re-registering handlers.
  const selectedPointRef = useRef(selectedPoint);
  useEffect(() => { selectedPointRef.current = selectedPoint; }, [selectedPoint]);

  function clearMarkers() {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  }

  function renderMarkers(points: GridWindPoint[]) {
    if (!map) return;
    clearMarkers();
    points.forEach((pt) => {
      const isSelected = isSamePoint(selectedPointRef.current, pt.latitude, pt.longitude);
      const marker = L.marker([pt.latitude, pt.longitude], {
        icon: buildGridBarbIcon(pt, isSelected),
        interactive: true,
      }).addTo(map);

      // Handler reads from ref — always calls the latest callback, never stale.
      marker.on('click', () => onGridPointSelectRef.current(pt));
      markersRef.current.push(marker);
    });
  }

  async function refresh() {
    if (!map || !visible) {
      clearMarkers();
      pointsRef.current = [];
      return;
    }
    const bounds = map.getBounds();
    const { cols, rows } = gridDimensions(map);
    const minLat = parseFloat(bounds.getSouth().toFixed(4));
    const maxLat = parseFloat(bounds.getNorth().toFixed(4));
    const minLon = parseFloat(bounds.getWest().toFixed(4));
    const maxLon = parseFloat(bounds.getEast().toFixed(4));

    const fetchKey = `${minLat},${maxLat},${minLon},${maxLon},${cols},${rows},${model}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    // Cancel the previous request; only the latest response may draw markers.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let points: GridWindPoint[];
    try {
      points = await fetchWindGrid(
        { min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon, cols, rows, model },
        { signal: controller.signal },
      );
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer request
      console.error('Failed to load wind grid:', err);
      // Forget the key so the same viewport is retried on the next pan/zoom.
      if (lastFetchKeyRef.current === fetchKey) lastFetchKeyRef.current = '';
      return;
    }
    if (controller.signal.aborted || abortRef.current !== controller) return;

    pointsRef.current = points;
    renderMarkers(points);
  }

  // Update icons when selected point changes — reads latest selectedPoint from ref,
  // no need to re-register click handlers.
  useEffect(() => {
    if (!map || !visible || pointsRef.current.length === 0) return;
    // Only update the icon of affected markers rather than rebuilding all of them.
    markersRef.current.forEach((marker, i) => {
      const pt = pointsRef.current[i];
      if (!pt) return;
      const isSelected = isSamePoint(selectedPoint, pt.latitude, pt.longitude);
      marker.setIcon(buildGridBarbIcon(pt, isSelected));
    });
  }, [map, visible, selectedPoint]);

  useEffect(() => {
    if (!map) return;
    if (!visible) {
      clearMarkers();
      pointsRef.current = [];
      lastFetchKeyRef.current = '';
      return;
    }
    refresh();
    map.on('moveend', refresh);
    map.on('zoomend', refresh);
    return () => {
      map.off('moveend', refresh);
      map.off('zoomend', refresh);
      clearMarkers();
      pointsRef.current = [];
      abortRef.current?.abort();
      lastFetchKeyRef.current = '';
    };
    // `refresh` closes over map/model/visible, which are the dependencies here, so the
    // listener is re-registered whenever they change. SCRUM-92 phase 5 (F5) moves this
    // into a useWindGrid hook with a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, model, visible]);

  return null;
}
