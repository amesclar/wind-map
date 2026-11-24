/**
 * Encoding and delivery for the map export (SCRUM-178, extracted from `captureMap.ts`): a canvas
 * becomes a PNG or JPEG blob and is handed to the browser as a file.
 */

export type MapImageFormat = 'png' | 'jpeg';

const MIME: Record<MapImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' };

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

  downloadBlob(blob, fileName);
}

/** Hand `blob` to the browser as `fileName` (shared by images, ZIPs and PDFs). */
export function downloadBlob(blob: Blob, fileName: string): void {
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
