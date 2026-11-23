/**
 * Single-page PDF export for the map view (SCRUM-117).
 *
 * The composed canvas from `captureMapCanvas` goes on one page, fitted into the margins with its
 * aspect ratio kept, so a wide map is never stretched to a portrait sheet. `jspdf` is imported
 * lazily: the library is only downloaded when the user picks PDF.
 */
import { captureMapCanvas, type CaptureContent, type CaptureDeps } from './captureMap';

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

/** Capture the current view and save it as a one-page PDF. */
export async function saveMapPdf(
  element: HTMLElement,
  content: CaptureContent,
  options: PdfSaveOptions,
  deps?: CaptureDeps,
): Promise<void> {
  const canvas = await captureMapCanvas(element, content, deps);
  const page = pageBox(options.pageSize, options.orientation);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'pt',
    format: [page.width, page.height],
  });
  const placement = fitToPage(canvas.width, canvas.height, page);
  doc.addImage(
    canvas.toDataURL('image/jpeg', PDF_IMAGE_QUALITY),
    'JPEG',
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  );
  doc.save(options.fileName);
}
