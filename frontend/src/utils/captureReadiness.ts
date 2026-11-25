/**
 * What a map export must wait for before it reads the DOM (SCRUM-204).
 *
 * `waitForTiles` can see the tiles Leaflet has already put in the DOM, but not the window before
 * they exist (a `GridLayer` knows: `isLoading()`), and a vector renderer keeps painting in WebGL
 * with no `<img>` tiles at all. `MapView` registers the map here, and a vector layer registers its
 * map, so the capture can ask instead of guessing from one DOM sample.
 */

/** The part of `L.Map` the capture needs: every layer, so tile layers can report their loading. */
export interface CaptureMapLike {
  eachLayer: (fn: (layer: unknown) => void) => void;
}

/** The part of a MapLibre map the capture needs to know when it has finished painting. */
export interface VectorMapLike {
  loaded?: () => boolean;
  areTilesLoaded?: () => boolean;
  once: (event: 'idle', listener: () => void) => unknown;
  off?: (event: 'idle', listener: () => void) => unknown;
}

interface TileLayerLike {
  isLoading?: () => boolean;
}

const captureMaps = new Set<CaptureMapLike>();
const vectorMaps = new Set<VectorMapLike>();

/** Register the Leaflet map whose tile layers the export must wait for; returns the unregister. */
export function registerCaptureMap(map: CaptureMapLike): () => void {
  captureMaps.add(map);
  return () => {
    captureMaps.delete(map);
  };
}

/** Register a vector renderer (MapLibre) that paints outside the DOM; returns the unregister. */
export function registerVectorMap(map: VectorMapLike): () => void {
  vectorMaps.add(map);
  return () => {
    vectorMaps.delete(map);
  };
}

/** How many tile layers are still fetching, across every registered map. */
export function loadingTileLayers(): number {
  let loading = 0;
  captureMaps.forEach((map) => {
    map.eachLayer((layer) => {
      const candidate = layer as TileLayerLike;
      if (typeof candidate.isLoading === 'function' && candidate.isLoading()) loading += 1;
    });
  });
  return loading;
}

/** A vector map is idle once its style is loaded and every tile it asked for has arrived. */
function isVectorIdle(map: VectorMapLike): boolean {
  if (map.loaded && !map.loaded()) return false;
  if (map.areTilesLoaded && !map.areTilesLoaded()) return false;
  return true;
}

/**
 * Resolve once every registered vector renderer has painted, or at `timeoutMs`. A renderer that is
 * already idle resolves immediately; one that never idles must not hold the export open, so the
 * timeout bounds the wait exactly as it does for raster tiles.
 */
export async function waitForVectorIdle(timeoutMs: number): Promise<void> {
  if (vectorMaps.size === 0) return;
  await Promise.all(
    [...vectorMaps].map(
      (map) =>
        new Promise<void>((resolve) => {
          if (isVectorIdle(map)) {
            resolve();
            return;
          }
          // `timer` exists before either branch can run: the timeout is scheduled first and the
          // listener is registered after it, so `finish` never reads it early.
          const finish = () => {
            map.off?.('idle', finish);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(finish, Math.max(0, timeoutMs));
          map.once('idle', finish);
        }),
    ),
  );
}

/** Forget every registration (tests only). */
export function resetCaptureReadiness(): void {
  captureMaps.clear();
  vectorMaps.clear();
}
