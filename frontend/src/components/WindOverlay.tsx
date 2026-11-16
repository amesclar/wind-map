import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { fetchWindGrid, GridWindPoint } from '../api/client';
import { generateWindChevronSvg, generateSelectedChevronSvg } from './WindChevron';

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
  onChevronClick: (pt: GridWindPoint) => void;
}

const CHEVRON_SPACING_PX = 80;
const MAX_GRID_DIM = 30;

function gridDimensions(map: L.Map): { cols: number; rows: number } {
  const size = map.getSize();
  const cols = Math.min(Math.max(2, Math.round(size.x / CHEVRON_SPACING_PX)), MAX_GRID_DIM);
  const rows = Math.min(Math.max(2, Math.round(size.y / CHEVRON_SPACING_PX)), MAX_GRID_DIM);
  return { cols, rows };
}

function isSamePoint(a: SelectedGridPoint | null, lat: number, lon: number): boolean {
  if (!a) return false;
  return Math.abs(a.latitude - lat) < 0.001 && Math.abs(a.longitude - lon) < 0.001;
}

function buildIcon(pt: GridWindPoint, isSelected: boolean): L.DivIcon {
  const svgHtml = isSelected
    ? generateSelectedChevronSvg(pt.wind_speed_knots, 32)
    : generateWindChevronSvg(pt.wind_speed_knots, pt.wind_direction_deg, 28);
  const size: [number, number] = isSelected ? [32, 32] : [28, 28];
  const anchor: [number, number] = isSelected ? [16, 16] : [14, 14];
  return L.divIcon({
    className: 'wind-chevron-marker',
    html: `<div style="cursor:pointer">${svgHtml}</div>`,
    iconSize: size,
    iconAnchor: anchor,
  });
}

export function WindOverlay({ map, model, visible, selectedPoint, onChevronClick }: WindOverlayProps) {
  const markersRef = useRef<L.Marker[]>([]);
  const pointsRef = useRef<GridWindPoint[]>([]);
  const lastFetchKeyRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // Keep the callback in a ref so marker click handlers always call the latest
  // version without needing to be re-registered on every render.
  const onChevronClickRef = useRef(onChevronClick);
  useEffect(() => { onChevronClickRef.current = onChevronClick; }, [onChevronClick]);

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
        icon: buildIcon(pt, isSelected),
        interactive: true,
      }).addTo(map);

      // Handler reads from ref — always calls the latest callback, never stale.
      marker.on('click', () => onChevronClickRef.current(pt));
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

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    let points: GridWindPoint[];
    try {
      points = await fetchWindGrid({ min_lat: minLat, max_lat: maxLat, min_lon: minLon, max_lon: maxLon, cols, rows, model });
    } catch {
      return;
    }

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
      marker.setIcon(buildIcon(pt, isSelected));
    });
  }, [selectedPoint]);

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
  }, [map, model, visible]);

  return null;
}
