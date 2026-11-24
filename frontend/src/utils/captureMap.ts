/**
 * Canvas capture and composition for "Save map as image" (SCRUM-116).
 *
 * Only the Leaflet map container is captured (tiles, barbs, gradient, markers); the header,
 * legend and footer are drawn on a 2D canvas, so the text stays crisp and the layout is
 * independent of the on-screen chrome. `modern-screenshot` is imported lazily: it is only
 * needed when the user saves an image.
 *
 * The parts live next door (SCRUM-178): `captureDom.ts` collects and paints the base-map tiles,
 * `captureChrome.ts` draws the header, legend and footer, and `download.ts` encodes and saves.
 */
import { collectTiles, drawTiles, includeInCapture, waitForTiles } from './captureDom';
import {
  CAPTURE_BACKGROUND,
  drawFooter,
  drawHeader,
  drawLegend,
  drawRules,
  FOOTER_PX,
  HEADER_PX,
  LEGEND_PX,
  type CaptureContent,
} from './captureChrome';
import { downloadCanvas, type SaveImageOptions } from './download';

type DomToCanvas = (
  node: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

export interface CaptureDeps {
  /** Test seam: replaces the lazy `modern-screenshot` import. */
  domToCanvas?: DomToCanvas;
  /** How long to wait for base-map tiles; 0 skips the wait (tests). */
  tileTimeoutMs?: number;
}

async function loadDomToCanvas(deps?: CaptureDeps): Promise<DomToCanvas> {
  if (deps?.domToCanvas) return deps.domToCanvas;
  const module = await import('modern-screenshot');
  return module.domToCanvas as DomToCanvas;
}

/**
 * Capture the map element at 2x and compose header, legend and footer around it.
 * The returned canvas keeps the map's own pixel width, so the image is print-sized.
 */
export async function captureMapCanvas(
  element: HTMLElement,
  content: CaptureContent,
  deps?: CaptureDeps,
): Promise<HTMLCanvasElement> {
  const domToCanvas = await loadDomToCanvas(deps);
  const scale = 2;
  await waitForTiles(element, deps?.tileTimeoutMs ?? 5000);
  // Tiles are read before the capture, so a move during it cannot leave the two halves apart.
  const tiles = collectTiles(element);
  // The library waits on every <img> in the subtree before rendering, and `img.decode()` never
  // settles for Leaflet's tiles, so they leave the DOM for the capture and are drawn below.
  const placeholders = tiles.map(({ image }) => {
    const marker = document.createComment('map-tile');
    image.replaceWith(marker);
    return { image, marker };
  });
  let overlay: HTMLCanvasElement;
  // `.leaflet-container` paints an opaque background with !important, which would cover the
  // tiles drawn below; make it transparent for the capture and put it back afterwards.
  element.style.setProperty('background-color', 'transparent', 'important');
  try {
    overlay = await domToCanvas(element, {
      scale,
      filter: includeInCapture,
      backgroundColor: null,
    });
  } finally {
    placeholders.forEach(({ image, marker }) => marker.replaceWith(image));
    element.style.removeProperty('background-color');
  }
  const map = overlay;

  // Map pixels per CSS pixel: 2 as asked, or whatever the library produced.
  const unit = element.clientWidth > 0 ? map.width / element.clientWidth : scale;
  const headerHeight = Math.round(HEADER_PX * unit);
  const legendHeight = Math.round(LEGEND_PX * unit);
  const footerHeight = Math.round(FOOTER_PX * unit);

  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height + headerHeight + legendHeight + footerHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = CAPTURE_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawHeader(ctx, content.header, canvas.width, unit);

  // Map pixels: base tiles first, then the captured barbs, markers and gradient over them.
  const mapPixels = document.createElement('canvas');
  mapPixels.width = map.width;
  mapPixels.height = map.height;
  const mapCtx = mapPixels.getContext('2d');
  if (!mapCtx) throw new Error('Canvas 2D context unavailable');
  mapCtx.fillStyle = CAPTURE_BACKGROUND;
  mapCtx.fillRect(0, 0, mapPixels.width, mapPixels.height);
  drawTiles(mapCtx, tiles, unit);
  mapCtx.drawImage(map, 0, 0);
  ctx.drawImage(mapPixels, 0, headerHeight);
  const legendTop = headerHeight + map.height;
  drawLegend(ctx, content, legendTop, canvas.width, unit);
  drawFooter(ctx, content.footer, legendTop + legendHeight, canvas.width, unit);
  drawRules(ctx, canvas.width, headerHeight, unit);

  return canvas;
}

/** Capture and download the composed image as PNG or JPEG. */
export async function saveMapImage(
  element: HTMLElement,
  content: CaptureContent,
  options: SaveImageOptions,
  deps?: CaptureDeps,
): Promise<void> {
  const canvas = await captureMapCanvas(element, content, deps);
  await downloadCanvas(canvas, content.fileName, options);
}
