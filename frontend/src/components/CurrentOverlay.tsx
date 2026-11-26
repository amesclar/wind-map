import { useEffect } from 'react';
import L from 'leaflet';
import type { CurrentPoint, WindSpeedUnit } from '../types';
import { buildCurrentChevronIcon, buildCurrentPopup } from './WaterCurrentChevron';
import { POPUP_OPTIONS } from '../utils/popupPlacement';

interface CurrentOverlayProps {
  map: L.Map | null;
  /** Points fetched by `useCurrentGrid`; nothing is fetched here. */
  points: CurrentPoint[];
  speedUnit?: WindSpeedUnit;
  /** Selected hour for the pop-up, e.g. "Mon 23 Nov 12:00 PST". */
  timeLabel?: string | null;
}

/**
 * Draws ocean currents as clickable chevrons (SCRUM-99). Every point already carries its speed
 * and direction, so a click opens a pop-up without another request — the wind barbs' pattern.
 */
export function CurrentOverlay({ map, points, speedUnit = 'knots', timeLabel = null }: CurrentOverlayProps) {
  useEffect(() => {
    if (!map) return;
    const markers = points.map((point) => {
      const marker = L.marker([point.latitude, point.longitude], {
        icon: buildCurrentChevronIcon(point),
        interactive: true,
      }).addTo(map);
      marker.bindPopup(buildCurrentPopup(point, speedUnit, timeLabel), POPUP_OPTIONS);
      return marker;
    });
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [map, points, speedUnit, timeLabel]);

  return null;
}
