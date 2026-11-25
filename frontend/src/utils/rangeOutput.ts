/**
 * Whole-range outputs for the export dialog (SCRUM-156): one ZIP of per-hour images for PNG/JPEG,
 * or one multi-page PDF with a page per hour.
 *
 * `fflate` (jsPDF's own dependency) and `jspdf` are imported lazily, so neither reaches the main
 * bundle and an image-only range never downloads the PDF code.
 */
import { downloadBlob, type MapImageFormat } from './download';
import { buildExportFileName, buildRangeArchiveName } from './mapExport';
import {
  encodeCanvasJpeg,
  fitToPage,
  loadJsPdf,
  pageBox,
  type PdfOrientation,
  type PdfPageSize,
} from './pdfExport';
import type { RangeFrame } from './rangeCapture';

/** Range PDF pages re-encode at 0.9, as the ticket asks; single-page PDFs keep 0.92. */
export const RANGE_PDF_IMAGE_QUALITY = 0.9;

const MIME: Record<MapImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

export interface RangeImageOptions {
  modelId: string;
  timezone: string;
  format: MapImageFormat;
  /** JPEG quality; PNG ignores it. */
  jpegQuality: number;
}

export interface RangePdfOptions {
  modelId: string;
  timezone: string;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
}

/** Encode a composed canvas as a blob, rejecting when the browser cannot encode it. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: MapImageFormat,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The map image could not be encoded'))),
      MIME[format],
      format === 'jpeg' ? quality : undefined,
    );
  });
}

/**
 * Save a completed range as images: one image per hour inside one ZIP, or the image itself when
 * the range has a single hour. Entry names are the same per-hour names a single export uses.
 */
export async function saveRangeImages(frames: RangeFrame[], options: RangeImageOptions): Promise<void> {
  if (frames.length === 0) return;
  const names = frames.map((frame) =>
    buildExportFileName({
      modelId: options.modelId,
      validTime: frame.time,
      timezone: options.timezone,
      extension: options.format,
    }),
  );

  if (frames.length === 1) {
    downloadBlob(await canvasToBlob(frames[0].canvas, options.format, options.jpegQuality), names[0]);
    return;
  }

  const entries: Record<string, Uint8Array> = {};
  for (let index = 0; index < frames.length; index++) {
    const blob = await canvasToBlob(frames[index].canvas, options.format, options.jpegQuality);
    entries[names[index]] = new Uint8Array(await blob.arrayBuffer());
  }
  const { zipSync } = await import('fflate');
  // The images are already compressed; storing them keeps the archive quick and smaller than deflate.
  const zipped = zipSync(entries, { level: 0 });
  downloadBlob(
    new Blob([zipped], { type: 'application/zip' }),
    buildRangeArchiveName({
      modelId: options.modelId,
      hours: frames.map((frame) => frame.time),
      timezone: options.timezone,
      extension: 'zip',
    }),
  );
}

/**
 * Save a completed range as one PDF with a page per hour: `addPage()` before each page after the
 * first, `fitToPage` for the same margins as the single-page PDF, then one `save()`.
 */
export async function saveRangePdf(frames: RangeFrame[], options: RangePdfOptions): Promise<void> {
  if (frames.length === 0) return;
  const { jsPDF } = await loadJsPdf();
  const page = pageBox(options.pageSize, options.orientation);
  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'pt',
    format: [page.width, page.height],
  });
  frames.forEach((frame, index) => {
    if (index > 0) doc.addPage();
    const placement = fitToPage(frame.canvas.width, frame.canvas.height, page);
    doc.addImage(
      encodeCanvasJpeg(frame.canvas, RANGE_PDF_IMAGE_QUALITY),
      'JPEG',
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
  });
  doc.save(
    buildRangeArchiveName({
      modelId: options.modelId,
      hours: frames.map((frame) => frame.time),
      timezone: options.timezone,
      extension: 'pdf',
    }),
  );
}
