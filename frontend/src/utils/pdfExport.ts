/**
 * Single-page PDF export for the map view (SCRUM-117).
 *
 * The composed canvas from `captureMapCanvas` goes on one page, fitted into the margins with its
 * aspect ratio kept, so a wide map is never stretched to a portrait sheet. `jspdf` is imported
 * lazily: the library is only downloaded when the user picks PDF.
 */
import { captureMapCanvas, type CaptureDeps } from './captureMap';
import type { CaptureContent } from './captureChrome';

export type PdfPageSize = 'letter' | 'a4';
export type PdfOrientation = 'portrait' | 'landscape';

export interface PageBox {
  width: number;
  height: number;
}

/** Portrait page sizes in PostScript points (1 pt = 1/72 in). */
export const PDF_PAGE_BOX: Record<PdfPageSize, PageBox> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

/** Quiet margin around the image, in points (about 6 mm). */
export const PDF_MARGIN_PT = 18;

/** JPEG quality for the page image: one page only, so keep the header text crisp. */
export const PDF_IMAGE_QUALITY = 0.92;

export interface PdfPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shown when the lazily imported library cannot be fetched, usually a tab left across a rebuild. */
export const PDF_LIBRARY_ERROR = 'The PDF library could not be loaded. Reload the page and try again.';

/** Shown when the browser hands back no usable JPEG for the composed map (an oversized canvas). */
export const PDF_ENCODE_ERROR =
  'The map image could not be encoded for the PDF: it may be too large. Try a smaller window or the PNG format.';

const JPEG_DATA_URL_PREFIX = 'data:image/jpeg';

/**
 * Load jsPDF lazily, turning a failed chunk fetch into a message the dialog can show
 * (SCRUM-241). A rebuild renames the chunk, so an open tab can ask for a name that is gone.
 * The loader is a parameter so the failure path can be tested without a broken network.
 */
export async function loadJsPdf(
  load: () => Promise<typeof import('jspdf')> = () => import('jspdf'),
): Promise<typeof import('jspdf')> {
  try {
    return await load();
  } catch (err) {
    const detail = err instanceof Error ? ` (${err.message})` : '';
    const error = new Error(`${PDF_LIBRARY_ERROR}${detail}`);
    (error as Error & { cause?: unknown }).cause = err;
    throw error;
  }
}

/**
 * `canvas.toDataURL()` as JPEG, rejecting when the browser returns nothing usable (SCRUM-241).
 * An oversized canvas yields `data:,`, which jsPDF would otherwise accept and save as a page
 * that cannot be decoded.
 */
export function encodeCanvasJpeg(canvas: HTMLCanvasElement, quality = PDF_IMAGE_QUALITY): string {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith(JPEG_DATA_URL_PREFIX) || comma === -1 || comma === dataUrl.length - 1) {
    throw new Error(PDF_ENCODE_ERROR);
  }
  return dataUrl;
}

/** The page in points, swapped for landscape. */
export function pageBox(size: PdfPageSize, orientation: PdfOrientation): PageBox {
  const portrait = PDF_PAGE_BOX[size];
  return orientation === 'landscape'
    ? { width: portrait.height, height: portrait.width }
    : { ...portrait };
}

/**
 * Fit `imageWidth x imageHeight` inside `page` minus the margin, centred, aspect ratio kept.
 * The image is anchored on the limiting dimension, so both wide and tall maps stay undistorted.
 */
export function fitToPage(
  imageWidth: number,
  imageHeight: number,
  page: PageBox,
  margin = PDF_MARGIN_PT,
): PdfPlacement {
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error('The map image has no size');
  const availableWidth = Math.max(1, page.width - margin * 2);
  const availableHeight = Math.max(1, page.height - margin * 2);
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
}

export interface PdfSaveOptions {
  /** Full file name, e.g. "wind-map_2026-11-18_1400PST.pdf". */
  fileName: string;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
}

/** Capture dependencies plus a test seam for the lazy `jspdf` import. */
export interface PdfDeps extends CaptureDeps {
  loadJsPdf?: typeof loadJsPdf;
}

/** Capture the current view and save it as a one-page PDF (SCRUM-117, SCRUM-241). */
export async function saveMapPdf(
  element: HTMLElement,
  content: CaptureContent,
  options: PdfSaveOptions,
  deps?: PdfDeps,
): Promise<void> {
  const canvas = await captureMapCanvas(element, content, deps);
  const page = pageBox(options.pageSize, options.orientation);
  const { jsPDF } = await (deps?.loadJsPdf ?? loadJsPdf)();
  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'pt',
    format: [page.width, page.height],
  });
  const placement = fitToPage(canvas.width, canvas.height, page);
  doc.addImage(
    encodeCanvasJpeg(canvas),
    'JPEG',
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  );
  doc.save(options.fileName);
}
