/**
 * Shared vocabulary of the export dialog (SCRUM-178): the option types, the format/quality/page
 * tables, the field classes and the small helpers the dialog's pieces agree on.
 */
import { DEFAULT_JPEG_QUALITY, type MapImageFormat } from '../utils/download';
import { PDF_PAGE_BOX, type PdfOrientation, type PdfPageSize } from '../utils/pdfExport';

export type MapExportFormat = MapImageFormat | 'pdf';

export interface MapExportViewOptions {
  mode: 'view';
  format: MapExportFormat;
  /** JPEG quality between 0 and 1; the PDF page uses its own fixed quality. */
  jpegQuality: number;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
  /** Cleaned file name with its extension, ready to download (SCRUM-162). */
  fileName: string;
}

export interface MapExportRangeOptions {
  mode: 'range';
  /** PNG/JPEG become one ZIP (or a single image), PDF becomes one page per hour (SCRUM-156). */
  format: MapExportFormat;
  jpegQuality: number;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
  /** The times to capture, from `planExportTimes` (SCRUM-155, SCRUM-332). */
  hours: string[];
}

export type MapExportOptions = MapExportViewOptions | MapExportRangeOptions;

export type MapExportError = {
  message: string;
  /** Frames captured before the failure, offered for download. */
  frames: number;
};

export const VIEW_FORMATS: ReadonlyArray<{ id: MapExportFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'Lossless' },
  { id: 'jpeg', label: 'JPEG', hint: 'Smaller file' },
  { id: 'pdf', label: 'PDF', hint: 'One page' },
];

export const RANGE_FORMATS: ReadonlyArray<{ id: MapExportFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'ZIP of images' },
  { id: 'jpeg', label: 'JPEG', hint: 'ZIP of images' },
  { id: 'pdf', label: 'PDF', hint: 'Page per hour' },
];

export const JPEG_QUALITIES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.8, label: 'Smaller file (0.8)' },
  { value: DEFAULT_JPEG_QUALITY, label: 'Balanced (0.92)' },
  { value: 1, label: 'Best quality (1.0)' },
];

export const PAGE_SIZES: ReadonlyArray<{ id: PdfPageSize; label: string }> = [
  { id: 'letter', label: 'Letter' },
  { id: 'a4', label: 'A4' },
];

export const ORIENTATIONS: ReadonlyArray<{ id: PdfOrientation; label: string }> = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];

export const LABEL_CLASS =
  'block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5';
export const SELECT_CLASS =
  'w-full bg-dark-900 text-gray-100 text-xs border border-dark-600 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-sky-500';

const KNOWN_EXTENSION = /\.(?:png|jpe?g|pdf)$/i;

export const optionClass = (active: boolean) =>
  `flex-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
    active ? 'bg-sky-600 border-sky-500 text-white' : 'bg-dark-900 border-dark-600 text-gray-300 hover:bg-dark-700'
  }`;

/** "8.5 × 11 in" / "210 × 297 mm", from the page's point size. */
export const pageDimensions = (size: PdfPageSize) => {
  const { width, height } = PDF_PAGE_BOX[size];
  return size === 'letter'
    ? `${(width / 72).toFixed(1)} × ${(height / 72).toFixed(1)} in`
    : `${Math.round((width / 72) * 25.4)} × ${Math.round((height / 72) * 25.4)} mm`;
};

export const extensionFor = (format: MapExportFormat) =>
  (format === 'jpeg' ? 'jpeg' : format) as 'png' | 'jpeg' | 'pdf';

/** Swap the extension of a typed file name for the chosen format's (SCRUM-162). */
export const withExtension = (fileName: string, format: MapExportFormat) =>
  `${fileName.replace(KNOWN_EXTENSION, '')}.${extensionFor(format)}`;
