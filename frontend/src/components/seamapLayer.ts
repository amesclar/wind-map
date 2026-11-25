/**
 * The Seamap base style (SCRUM-206): Open Waters' vector nautical rendering through MapLibre, with
 * the renderer imported only when the style is chosen, so the initial bundle stays as it was.
 *
 * The GL map registers with the export readiness (SCRUM-204), so a capture taken right after
 * switching styles waits for its first paint. `preserveDrawingBuffer` keeps the WebGL canvas
 * readable, without which an export would show a blank base (SCRUM-201).
 */
import type L from 'leaflet';
import type { MapOptions } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { registerVectorMap, type VectorMapLike } from '../utils/captureReadiness';
import { SEAMAP_PANE, SEAMAP_STYLE_URL } from './mapTiles';

/** The Leaflet layer the plugin returns; the extra accessor is what the export wait needs. */
export type SeamapLayer = L.Layer & { getMaplibreMap?: () => VectorMapLike | undefined };

/** MapLibre options plus the Leaflet pane the GL container is appended to. */
export type SeamapLayerOptions = Omit<MapOptions, 'container'> & { pane: string };

/** Everything the style needs: its own pane, no interaction or attribution control of its own. */
export function seamapLayerOptions(): SeamapLayerOptions {
  return {
    style: SEAMAP_STYLE_URL,
    pane: SEAMAP_PANE,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  };
}

/**
 * Build the GL layer without putting it on a map yet, so the caller can drop it if the map goes
 * away while the renderer downloads. A second call builds a second layer, never a shared one.
 *
 * MapLibre looks for its worker next to its own module, and both of Vite's module layouts hide it
 * there (the pre-bundled dependency in development, the hashed chunk in the build), which leaves
 * a style that never paints and fetches no tiles. Handing it a bundled worker URL avoids that.
 */
export async function createSeamapLayer(): Promise<SeamapLayer> {
  const [{ default: maplibreGL }, { setWorkerUrl }] = await Promise.all([
    import('@maplibre/maplibre-gl-leaflet'),
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  setWorkerUrl(maplibreWorkerUrl);
  return maplibreGL(
    seamapLayerOptions() as unknown as Parameters<typeof maplibreGL>[0],
  ) as unknown as SeamapLayer;
}

/**
 * Put a layer from `createSeamapLayer` on `map` and register its GL map for export readiness;
 * returns the unregister. Only mount while the map is live: the layer keeps a reference to it.
 */
export function mountSeamapLayer(map: L.Map, layer: SeamapLayer): () => void {
  layer.addTo(map);
  const glMap = layer.getMaplibreMap?.();
  return glMap ? registerVectorMap(glMap) : () => {};
}
