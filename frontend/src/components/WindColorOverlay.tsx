import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GridWindPoint } from '../types';
import { buildWindGrid, interpolateWindSpeed, windSpeedToColor } from '../utils/windColorScale';

/** Dedicated pane above the tiles but below the barbs, labels and popups. */
export const WIND_COLOR_PANE = 'windColorPane';
export const WIND_COLOR_PANE_Z_INDEX = 250;
/**
 * Low enough that coastlines, roads and place labels stay readable through the color,
 * high enough that the speed field still reads at a glance (SCRUM-143).
 */
export const WIND_COLOR_OPACITY = 0.55;
/** One sample per 4 CSS pixels; the browser smooths the upscaled canvas. */
export const WIND_COLOR_SAMPLE_PX = 4;

/** Map events after which the viewport has settled and the field must be redrawn. */
const VIEW_EVENTS = ['moveend', 'zoomend', 'viewreset', 'resize'] as const;

interface WindColorOverlayProps {
  map: L.Map | null;
  /** The same shared grid the barbs use (SCRUM-122); nothing is fetched here. */
  points: GridWindPoint[];
  visible: boolean;
}

/**
 * Paints the shared wind grid as a smooth color gradient (SCRUM-123).
 *
 * Samples every 4 CSS pixels and lets CSS scale the result, so a 1400×800 view costs
 * about 350×200 fills per redraw. Longitude depends only on x and latitude only on y in
 * Web Mercator, so the projection runs once per column and row instead of per pixel.
 *
 * The canvas is pinned to the viewport on every paint (SCRUM-143): Leaflet keeps the pan
 * offset as a transform on the map pane, so a pane child would otherwise drift away from
 * the viewport after every drag. A container resize repaints through a ResizeObserver,
 * because the map can change size without any pan or zoom.
 */
export function WindColorOverlay({ map, points, visible }: WindColorOverlayProps) {
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const paintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!map) return;

    const container = map.getContainer();
    const pane = map.createPane(WIND_COLOR_PANE);
    pane.style.zIndex = String(WIND_COLOR_PANE_Z_INDEX);
    pane.style.pointerEvents = 'none';

    const canvas = document.createElement('canvas');
    canvas.className = 'wind-color-canvas';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.opacity = String(WIND_COLOR_OPACITY);
    pane.appendChild(canvas);

    /** Place the canvas exactly over the map viewport, whatever the pane is offset by. */
    const anchorToViewport = () => {
      const viewport = container.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      canvas.style.left = `${Math.round(viewport.left - paneBox.left)}px`;
      canvas.style.top = `${Math.round(viewport.top - paneBox.top)}px`;
      canvas.style.width = `${map.getSize().x}px`;
      canvas.style.height = `${map.getSize().y}px`;
    };

    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!visibleRef.current) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        return;
      }
      canvas.style.display = 'block';
      anchorToViewport();

      const size = map.getSize();
      const width = Math.max(1, Math.ceil(size.x / WIND_COLOR_SAMPLE_PX));
      const height = Math.max(1, Math.ceil(size.y / WIND_COLOR_SAMPLE_PX));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height); // every paint is a full frame (SCRUM-143)

      const grid = buildWindGrid(pointsRef.current); // null below 2 by 2: draw nothing
      if (!grid) return;

      const centre = [size.x / 2, size.y / 2] as [number, number];
      const lons: number[] = [];
      for (let x = 0; x < width; x++) {
        lons[x] = map.containerPointToLatLng([x * WIND_COLOR_SAMPLE_PX, centre[1]]).lng;
      }
      const lats: number[] = [];
      for (let y = 0; y < height; y++) {
        lats[y] = map.containerPointToLatLng([centre[0], y * WIND_COLOR_SAMPLE_PX]).lat;
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const speed = interpolateWindSpeed(grid, lats[y], lons[x]);
          if (speed === null) continue;
          const [r, g, b, a] = windSpeedToColor(speed);
          if (a === 0) continue;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    paintRef.current = paint;
    paint();

    const repaint = () => paint();
    VIEW_EVENTS.forEach((event) => map.on(event, repaint));
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => repaint());
    observer?.observe(container);

    return () => {
      VIEW_EVENTS.forEach((event) => map.off(event, repaint));
      observer?.disconnect();
      canvas.remove();
      pane.remove();
      paintRef.current = null;
    };
  }, [map]);

  // New data or a visibility change replaces the frame outright.
  useEffect(() => {
    paintRef.current?.();
  }, [points, visible]);

  return null;
}
