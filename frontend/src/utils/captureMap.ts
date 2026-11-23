/**
 * Canvas capture and composition for "Save map as image" (SCRUM-116).
 *
 * Only the Leaflet map container is captured (tiles, barbs, gradient, markers); the header,
 * legend and footer are drawn here on a 2D canvas, so the text stays crisp and the layout is
 * independent of the on-screen chrome. `modern-screenshot` is imported lazily: it is only
 * needed when the user saves an image.
 */
import type { BarbLegendEntry, ExportHeader, TemperatureBand } from './mapExport';
import { barbFeatures } from './windBarb';

export interface CaptureContent {
  fileName: string;
  header: ExportHeader;
  footer: string;
  barbs: BarbLegendEntry[];
  temperatures: TemperatureBand[];
  speedUnitLabel: string;
  temperatureUnitLabel: string;
}

export type MapImageFormat = 'png' | 'jpeg';

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

const BACKGROUND = '#0d1117';
const STRIP = '#161b22';
const TEXT = '#f3f4f6';
const MUTED = '#9ca3af';
const RULE = '#30363d';

/** CSS-pixel heights of the chrome drawn around the map, scaled with the capture. */
export const HEADER_PX = 74;
export const LEGEND_PX = 78;
export const FOOTER_PX = 30;
const PADDING = 14;

const MIME: Record<MapImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

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

/** Tiles that are still loading, if the layer is mid-load. */
export function pendingTiles(container: HTMLElement): number {
  return container.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').length;
}

/**
 * Wait (bounded) for the base map to finish loading, so a capture right after a pan or a layer
 * change is not blank. Resolves on the timeout as well: an image that never loads must not block
 * the save.
 */
export async function waitForTiles(container: HTMLElement, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tiles = container.querySelectorAll('img.leaflet-tile').length;
    if (tiles > 0 && pendingTiles(container) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Paint the tiles under the overlay, applying the dark-map filter where the layer has it. */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  tiles: TileFrame[],
  unit: number,
): void {
  for (const tile of tiles) {
    ctx.save();
    if (tile.dark) ctx.filter = DARK_TILE_FILTER;
    ctx.drawImage(tile.image, tile.x * unit, tile.y * unit, tile.width * unit, tile.height * unit);
    ctx.restore();
  }
}

async function loadDomToCanvas(deps?: CaptureDeps): Promise<DomToCanvas> {
  if (deps?.domToCanvas) return deps.domToCanvas;
  const module = await import('modern-screenshot');
  return module.domToCanvas as DomToCanvas;
}

/** Draw one barb glyph, using the same feathers as the map (see `barbFeatures`). */
export function drawBarb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  speedKnots: number,
  color = TEXT,
): void {
  const { calm, pennants, fullBarbs, halfBarbs } = barbFeatures(speedKnots);
  const half = size / 2;
  const base = y + half;
  const top = y - half;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.5, size / 16);

  if (calm) {
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, size / 7, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Staff, with the feathers pointing to the right and stacking down from the top.
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x, top);
  ctx.stroke();

  const feather = size / 3;
  let cursor = top;
  const gap = size / 5;
  for (let i = 0; i < pennants; i++) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather, cursor + gap / 2);
    ctx.lineTo(x, cursor + gap);
    ctx.closePath();
    ctx.fill();
    cursor += gap;
  }
  for (let i = 0; i < fullBarbs; i++) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather, cursor - gap / 2);
    ctx.stroke();
    cursor += gap;
  }
  if (halfBarbs) {
    ctx.beginPath();
    ctx.moveTo(x, cursor);
    ctx.lineTo(x + feather / 2, cursor - gap / 4);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, base, Math.max(1.5, size / 12), 0, Math.PI * 2);
  ctx.fill();
}

/** Fill `text` at `px`, shrinking the font until it fits `maxWidth`. */
export function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  px: number,
  weight = 'normal',
): void {
  let size = px;
  for (;;) {
    ctx.font = `${weight} ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || size <= 7) break;
    size -= 0.5;
  }
  ctx.fillText(text, x, y);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  header: ExportHeader,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = TEXT;
  drawFittedText(ctx, header.title, pad, 26 * unit, width - pad * 2, 15 * unit, 'bold');
  ctx.fillStyle = MUTED;
  header.lines.forEach((line, index) => {
    drawFittedText(ctx, line, pad, (44 + index * 15) * unit, width - pad * 2, 10 * unit);
  });
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  content: CaptureContent,
  top: number,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = STRIP;
  ctx.fillRect(0, top, width, LEGEND_PX * unit);
  ctx.fillStyle = RULE;
  ctx.fillRect(0, top, width, Math.max(1, unit));

  ctx.fillStyle = MUTED;
  ctx.font = `normal ${8.5 * unit}px sans-serif`;
  ctx.fillText(`Wind barbs (${content.speedUnitLabel})`, pad, top + 12 * unit);
  const barbsWidth = Math.max(width * 0.52, 240 * unit);
  const slot = barbsWidth / content.barbs.length;
  content.barbs.forEach((entry, index) => {
    const cx = pad + slot * index + 14 * unit;
    drawBarb(ctx, cx, top + 30 * unit, 26 * unit, entry.knots);
    ctx.fillStyle = TEXT;
    ctx.font = `normal ${8.5 * unit}px sans-serif`;
    ctx.fillText(entry.caption, cx + 18 * unit, top + 34 * unit);
  });

  ctx.fillStyle = MUTED;
  ctx.font = `normal ${8.5 * unit}px sans-serif`;
  ctx.fillText(`Temperature (${content.temperatureUnitLabel})`, pad, top + 56 * unit);
  const swatchWidth = Math.min(30 * unit, (width - pad * 2) / content.temperatures.length - 6 * unit);
  const captionWidth = (width - pad * 2) / content.temperatures.length;
  content.temperatures.forEach((band, index) => {
    const x = pad + captionWidth * index;
    ctx.fillStyle = band.color;
    ctx.fillRect(x, top + 62 * unit, swatchWidth, 8 * unit);
    ctx.fillStyle = TEXT;
    ctx.font = `normal ${7.5 * unit}px sans-serif`;
    ctx.fillText(band.caption, x, top + 76 * unit);
  });
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  footer: string,
  top: number,
  width: number,
  unit: number,
): void {
  const pad = PADDING * unit;
  ctx.fillStyle = RULE;
  ctx.fillRect(0, top, width, Math.max(1, unit));
  ctx.fillStyle = MUTED;
  drawFittedText(ctx, footer, pad, top + 19 * unit, width - pad * 2, 9 * unit);
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

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawHeader(ctx, content.header, canvas.width, unit);

  // Map pixels: base tiles first, then the captured barbs, markers and gradient over them.
  const mapPixels = document.createElement('canvas');
  mapPixels.width = map.width;
  mapPixels.height = map.height;
  const mapCtx = mapPixels.getContext('2d');
  if (!mapCtx) throw new Error('Canvas 2D context unavailable');
  mapCtx.fillStyle = BACKGROUND;
  mapCtx.fillRect(0, 0, mapPixels.width, mapPixels.height);
  drawTiles(mapCtx, tiles, unit);
  mapCtx.drawImage(map, 0, 0);
  ctx.drawImage(mapPixels, 0, headerHeight);
  const legendTop = headerHeight + map.height;
  drawLegend(ctx, content, legendTop, canvas.width, unit);
  drawFooter(ctx, content.footer, legendTop + legendHeight, canvas.width, unit);

  // Header and footer rules keep the three bands visually separate on paper.
  ctx.fillStyle = RULE;
  ctx.fillRect(0, headerHeight - Math.max(1, unit), canvas.width, Math.max(1, unit));

  return canvas;
}

/** JPEG quality used when the caller does not choose one. */
export const DEFAULT_JPEG_QUALITY = 0.92;

export interface SaveImageOptions {
  format: MapImageFormat;
  /** JPEG quality between 0 and 1; PNG is lossless and ignores it. */
  quality?: number;
}

/**
 * Download an already-composed canvas as PNG or JPEG (SCRUM-155 extracts this so a range frame is
 * captured once and saved later, instead of capturing again after the hour was restored).
 */
export async function downloadCanvas(
  canvas: HTMLCanvasElement,
  fileName: string,
  options: SaveImageOptions,
): Promise<void> {
  const { format } = options;
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      resolve,
      MIME[format],
      format === 'jpeg' ? (options.quality ?? DEFAULT_JPEG_QUALITY) : undefined,
    );
  });
  if (!blob) throw new Error('The map image could not be encoded');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has the blob by now; releasing the URL keeps memory flat.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
