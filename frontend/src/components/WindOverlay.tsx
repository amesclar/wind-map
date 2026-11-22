import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GridWindPoint, SelectedGridPoint } from '../types';
import { generateWindBarbSvg } from './WindBarb';
import { useLatest } from '../hooks/useLatest';
import { useWindGrid } from '../hooks/useWindGrid';

interface WindOverlayProps {
  map: L.Map | null;
  model: string;
  visible: boolean;
  selectedPoint: SelectedGridPoint | null;
  onGridPointSelect: (pt: GridWindPoint) => void;
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
  return generateWindBarbSvg({
    speedKnots,
    directionDeg,
    tempF: hasTemp ? tempF : 0,
    size,
    showLabel: false,
    colorOverride: hasTemp ? undefined : GRID_BARB_FALLBACK_COLOR,
  });
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
  const points = useWindGrid(map, model, visible);
  // Each point is stored with its marker, so icon updates can't get out of step.
  const entriesRef = useRef<{ point: GridWindPoint; marker: L.Marker }[]>([]);
  const onSelectRef = useLatest(onGridPointSelect);
  const selectedRef = useLatest(selectedPoint);

  // Draw one barb marker per grid point; replaced whenever the points change.
  useEffect(() => {
    if (!map) return;
    const entries = points.map((point) => {
      const marker = L.marker([point.latitude, point.longitude], {
        icon: buildGridBarbIcon(point, isSamePoint(selectedRef.current, point.latitude, point.longitude)),
        interactive: true,
      }).addTo(map);
      marker.on('click', () => onSelectRef.current(point));
      return { point, marker };
    });
    entriesRef.current = entries;
    return () => {
      entries.forEach(({ marker }) => marker.remove());
      if (entriesRef.current === entries) entriesRef.current = [];
    };
  }, [map, points, selectedRef, onSelectRef]);

  // Highlight the selected point without recreating markers.
  useEffect(() => {
    entriesRef.current.forEach(({ point, marker }) => {
      marker.setIcon(buildGridBarbIcon(point, isSamePoint(selectedPoint, point.latitude, point.longitude)));
    });
  }, [selectedPoint]);

  return null;
}
