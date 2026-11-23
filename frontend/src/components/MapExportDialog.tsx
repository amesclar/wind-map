import React, { useEffect, useState } from 'react';
import { ImageDown, X } from 'lucide-react';
import { DEFAULT_JPEG_QUALITY, type MapImageFormat } from '../utils/captureMap';
import { PDF_PAGE_BOX, type PdfOrientation, type PdfPageSize } from '../utils/pdfExport';

export type MapExportFormat = MapImageFormat | 'pdf';

export interface MapExportOptions {
  format: MapExportFormat;
  /** JPEG quality between 0 and 1; the PDF page uses its own fixed quality. */
  jpegQuality: number;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
}

interface MapExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: MapExportOptions) => void;
  /** File name without its extension, e.g. "wind-map_2026-11-18_1400PST". */
  fileBaseName: string;
  /** True while the capture and encode run. */
  busy: boolean;
}

const FORMATS: ReadonlyArray<{ id: MapExportFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'Lossless' },
  { id: 'jpeg', label: 'JPEG', hint: 'Smaller file' },
  { id: 'pdf', label: 'PDF', hint: 'One page' },
];

const JPEG_QUALITIES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.8, label: 'Smaller file (0.8)' },
  { value: DEFAULT_JPEG_QUALITY, label: 'Balanced (0.92)' },
  { value: 1, label: 'Best quality (1.0)' },
];

const PAGE_SIZES: ReadonlyArray<{ id: PdfPageSize; label: string }> = [
  { id: 'letter', label: 'Letter' },
  { id: 'a4', label: 'A4' },
];

const ORIENTATIONS: ReadonlyArray<{ id: PdfOrientation; label: string }> = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];

const LABEL_CLASS =
  'block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5';
const SELECT_CLASS =
  'w-full bg-dark-900 text-gray-100 text-xs border border-dark-600 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-sky-500';

const optionClass = (active: boolean) =>
  `flex-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
    active ? 'bg-sky-600 border-sky-500 text-white' : 'bg-dark-900 border-dark-600 text-gray-300 hover:bg-dark-700'
  }`;

/** "8.5 × 11 in" / "210 × 297 mm", from the page's point size. */
const pageDimensions = (size: PdfPageSize) => {
  const { width, height } = PDF_PAGE_BOX[size];
  return size === 'letter'
    ? `${(width / 72).toFixed(1)} × ${(height / 72).toFixed(1)} in`
    : `${Math.round((width / 72) * 25.4)} × ${Math.round((height / 72) * 25.4)} mm`;
};

/**
 * Export dialog for the view currently on screen (SCRUM-117): PNG, JPEG (with a quality
 * choice) or one-page PDF on Letter/A4 in portrait or landscape, plus the file name preview.
 */
export const MapExportDialog: React.FC<MapExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  fileBaseName,
  busy,
}) => {
  const [format, setFormat] = useState<MapExportFormat>('png');
  const [jpegQuality, setJpegQuality] = useState<number>(DEFAULT_JPEG_QUALITY);
  const [pageSize, setPageSize] = useState<PdfPageSize>('letter');
  const [orientation, setOrientation] = useState<PdfOrientation>('portrait');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const extension = format === 'jpeg' ? 'jpeg' : format;
  const fileName = `${fileBaseName}.${extension}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-full"
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <ImageDown className="w-5 h-5 text-sky-400" />
            <h2 id="export-dialog-title" className="text-base font-semibold text-gray-100">
              Export map image
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close export dialog"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <span id="export-format" className={LABEL_CLASS}>
              Format
            </span>
            <div role="radiogroup" aria-labelledby="export-format" className="flex gap-2">
              {FORMATS.map((option) => {
                const active = format === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFormat(option.id)}
                    className={optionClass(active)}
                  >
                    <span className="block">{option.label}</span>
                    <span className="block text-[10px] font-normal opacity-70">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {format === 'jpeg' && (
            <div>
              <label htmlFor="export-quality" className={LABEL_CLASS}>
                JPEG quality
              </label>
              <select
                id="export-quality"
                value={jpegQuality}
                onChange={(e) => setJpegQuality(Number(e.target.value))}
                className={SELECT_CLASS}
              >
                {JPEG_QUALITIES.map((quality) => (
                  <option key={quality.value} value={quality.value}>
                    {quality.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {format === 'pdf' && (
            <>
              <div>
                <span id="export-page-size" className={LABEL_CLASS}>
                  Page size
                </span>
                <div role="radiogroup" aria-labelledby="export-page-size" className="flex gap-2">
                  {PAGE_SIZES.map((option) => {
                    const active = pageSize === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPageSize(option.id)}
                        className={optionClass(active)}
                      >
                        <span className="block">{option.label}</span>
                        <span className="block text-[10px] font-normal opacity-70">
                          {pageDimensions(option.id)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span id="export-orientation" className={LABEL_CLASS}>
                  Orientation
                </span>
                <div role="radiogroup" aria-labelledby="export-orientation" className="flex gap-2">
                  {ORIENTATIONS.map((option) => {
                    const active = orientation === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setOrientation(option.id)}
                        className={optionClass(active)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-gray-400">
                One page: the view currently on screen, fitted and centred with its aspect ratio kept.
              </p>
            </>
          )}

          <div className="pt-2 border-t border-dark-600/70">
            <span className={LABEL_CLASS}>File</span>
            <p
              data-testid="export-file-name"
              title={fileName}
              className="text-xs text-gray-200 bg-dark-900 border border-dark-600 rounded-lg px-2.5 py-1.5 truncate"
            >
              {fileName}
            </p>
          </div>
        </div>

        <div className="shrink-0 px-5 py-3 bg-dark-900 border-t border-dark-600 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onExport({ format, jpegQuality, pageSize, orientation })}
            disabled={busy}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-wait text-white transition"
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
