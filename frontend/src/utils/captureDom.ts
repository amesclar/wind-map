/**
 * What the DOM capture keeps and how the base map is painted into it (SCRUM-178, extracted from
 * `captureMap.ts`). Chrome is filtered out, Leaflet's tiles leave the DOM for the capture and are
 * drawn from their loaded images instead.
 */
import { loadingTileLayers, waitForVectorIdle } from './captureReadiness';

/** The CSS filter `.osm-dark-tiles` puts on the keyless OSM layer. */
export const DARK_TILE_FILTER = 'invert(100%) hue-rotate(185deg) brightness(92%) contrast(90%)';

/**
 * Controls, pop-ups and base-map tiles stay out of the DOM capture: chrome is unwanted, and
 * tiles are drawn from the loaded images instead. `modern-screenshot` waits on `img.decode()`
 * for every image in the subtree, which never settles for Leaflet's already-decoded tiles.
 */
export function includeInCapture(node: Node): boolean {
  if (node instanceof HTMLImageElement && node.classList.contains('leaflet-tile')) return false;
  const className = (node as HTMLElement).className;
  if (typeof className !== 'string') return true;
  return !className.includes('leaflet-control') && !className.includes('leaflet-popup');
}

export interface TileFrame {
  image: HTMLImageElement;
  /** Position and size in CSS pixels, relative to the map container. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The keyless OSM layer is darkened by a CSS filter that has to be applied while drawing. */
  dark: boolean;
}

/** The tiles currently on screen, with where they sit in the container. */
export function collectTiles(container: HTMLElement): TileFrame[] {
  const bounds = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll<HTMLImageElement>('img.leaflet-tile'))
    .filter((image) => image.complete && image.naturalWidth > 0)
    .map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        image,
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
        // Tiles fade in with an inline opacity; the export draws the loaded tiles as they end
        // up, so a tile captured mid-fade is not left half-transparent on paper.
        dark: Boolean(image.closest('.osm-dark-tiles')),
      };
    })
    .filter((tile) => tile.width > 0 && tile.height > 0);
}

/**
 * Tiles that are still loading: Leaflet adds `leaflet-tile-loaded` only once a tile has decoded or
 * failed, so a tile that exists but has not painted yet is counted here too (SCRUM-204).
 */
export function pendingTiles(container: HTMLElement): number {
  return container.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').length;
}

/**
 * Wait (bounded) for the map to finish painting, so a capture right after a pan or a layer change
 * is not blank. Three signals, because a DOM snapshot alone is not enough (SCRUM-204):
 *
 * - tiles already in the DOM that have not decoded yet (`pendingTiles`);
 * - tile layers that are fetching, including the window before Leaflet creates their `<img>`
 *   nodes, which only the layer itself knows (`isLoading()`);
 * - vector renderers, which have no `<img>` tiles at all and paint in WebGL (`idle`).
 *
 * Resolves on the timeout as well: a layer that never settles must not block the save.
 */
export async function waitForTiles(container: HTMLElement, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tiles = container.querySelectorAll('img.leaflet-tile').length;
    if (tiles > 0 && pendingTiles(container) === 0 && loadingTileLayers() === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Vector paint is not observable in the DOM; the renderer reports when it has finished.
  await waitForVectorIdle(Math.max(0, deadline - Date.now()));
}

/** Paint the tiles under the overlay, applying the dark-map filter where the layer has it. */
export function drawTiles(ctx: CanvasRenderingContext2D, tiles: TileFrame[], unit: number): void {
  for (const tile of tiles) {
    ctx.save();
    if (tile.dark) ctx.filter = DARK_TILE_FILTER;
    ctx.drawImage(tile.image, tile.x * unit, tile.y * unit, tile.width * unit, tile.height * unit);
    ctx.restore();
  }
}
