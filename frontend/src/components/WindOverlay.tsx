import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GridWindPoint, SelectedGridPoint, UnitSystem, WindDirDisplay, WindSpeedUnit } from '../types';
import { generateWindBarbSvg } from './WindBarb';
import { useLatest } from '../hooks/useLatest';
import { degreesToCardinal, formatDegreesTrue, formatKnotsInUnit, formatTemperatureFromF } from '../utils/units';

interface WindOverlayProps {
  map: L.Map | null;
  /** Grid points fetched once by MapView and shared by every layer that draws them (SCRUM-122). */
  points: GridWindPoint[];
  selectedPoint: SelectedGridPoint | null;
  onGridPointSelect: (pt: GridWindPoint) => void;
  /** Dark halo so temperature colors stay readable over the gradient (SCRUM-123). */
  halo?: boolean;
  /** Units and direction display for the barb pop-up (SCRUM-126), the user's settings. */
  unitSystem?: UnitSystem;
  speedUnit?: WindSpeedUnit;
  dirDisplay?: WindDirDisplay;
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

export function buildGridBarbIcon(pt: GridWindPoint, isSelected: boolean, halo = false): L.DivIcon {
  const size = isSelected ? SELECTED_BARB_SIZE : BARB_SIZE;
  const svgHtml = generateGridBarbSvg(pt.wind_speed_knots, pt.wind_direction_deg, pt.temperature_f, size);
  // Selected barb gets a white highlight ring.
  const ringStyle = isSelected
    ? 'border-radius:50%;box-shadow:0 0 0 2px #ffffff;background:rgba(255,255,255,0.12);'
    : '';
  return L.divIcon({
    className: 'wind-grid-barb-marker',
    html: `<div data-wind-barb data-selected="${isSelected}" class="${halo ? 'wind-barb-halo' : ''}" style="cursor:pointer;line-height:0;${ringStyle}">${svgHtml}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Pop-up for a clicked grid barb (SCRUM-126): the point's own values, already in the grid
 * response, so opening it costs no request. A grid point carries knots and °F only.
 */
export function buildGridPointPopup(
  pt: GridWindPoint,
  unitSystem: UnitSystem = 'imperial',
  speedUnit: WindSpeedUnit = 'knots',
  dirDisplay: WindDirDisplay = 'barb',
): string {
  const speed = formatKnotsInUnit(pt.wind_speed_knots, speedUnit);
  const temperature =
    typeof pt.temperature_f === 'number' ? formatTemperatureFromF(pt.temperature_f, unitSystem) : '--';
  const direction =
    dirDisplay === 'barb'
      ? generateGridBarbSvg(pt.wind_speed_knots, pt.wind_direction_deg, pt.temperature_f, 28)
      : dirDisplay === 'cardinal'
        ? `${degreesToCardinal(pt.wind_direction_deg)} (${Math.round(pt.wind_direction_deg)}°)`
        : formatDegreesTrue(pt.wind_direction_deg);
  return `
    <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
      <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">Wind point</div>
      <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">${pt.latitude.toFixed(2)}°, ${pt.longitude.toFixed(2)}°</div>
      <div style="display: flex; gap: 8px; font-weight: 600;">
        <span style="color: #38bdf8;">💨 ${speed}</span>
        <span style="color: #4ade80;">🌡️ ${temperature}</span>
      </div>
      <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px; display: flex; align-items: center; gap: 4px;">🧭 ${direction}</div>
    </div>
  `;
}

/** Draws the shared wind grid as clickable barb markers. Never fetches (SCRUM-122). */
export function WindOverlay({
  map,
  points,
  selectedPoint,
  onGridPointSelect,
  halo = false,
  unitSystem = 'imperial',
  speedUnit = 'knots',
  dirDisplay = 'barb',
}: WindOverlayProps) {
  // Each point is stored with its marker, so icon updates can't get out of step.
  const entriesRef = useRef<{ point: GridWindPoint; marker: L.Marker }[]>([]);
  const onSelectRef = useLatest(onGridPointSelect);
  const selectedRef = useLatest(selectedPoint);
  const haloRef = useLatest(halo);

  // Draw one barb marker per grid point; replaced whenever the points change.
  useEffect(() => {
    if (!map) return;
    const entries = points.map((point) => {
      const marker = L.marker([point.latitude, point.longitude], {
        icon: buildGridBarbIcon(
          point,
          isSamePoint(selectedRef.current, point.latitude, point.longitude),
          haloRef.current,
        ),
        interactive: true,
      }).addTo(map);
      // Leaflet opens a bound pop-up on click, so a click shows the point's values and selects it.
      marker.bindPopup(buildGridPointPopup(point, unitSystem, speedUnit, dirDisplay));
      marker.on('click', () => onSelectRef.current(point));
      return { point, marker };
    });
    entriesRef.current = entries;
    return () => {
      entries.forEach(({ marker }) => marker.remove());
      if (entriesRef.current === entries) entriesRef.current = [];
    };
  }, [map, points, selectedRef, haloRef, onSelectRef, unitSystem, speedUnit, dirDisplay]);

  // Highlight the selected point without recreating markers.
  useEffect(() => {
    entriesRef.current.forEach(({ point, marker }) => {
      marker.setIcon(
        buildGridBarbIcon(point, isSamePoint(selectedPoint, point.latitude, point.longitude), halo),
      );
    });
  }, [selectedPoint, halo]);

  return null;
}
