import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import downloadIcon from '../assets/download-icon.png';
import { DEFAULT_JPEG_QUALITY, type MapImageFormat } from '../utils/captureMap';
import { sanitizeExportFileName } from '../utils/mapExport';
import {
  RANGE_INTERVAL_HOURS,
  planExportRange,
  type RangeIntervalHours,
} from '../utils/exportRange';
import { formatStepLabel } from '../utils/forecastWindow';
import { PDF_PAGE_BOX, type PdfOrientation, type PdfPageSize } from '../utils/pdfExport';
import type { RangeProgress } from '../utils/rangeCapture';

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
  /** Range frames are images: ZIP and multi-page PDF are SCRUM-156. */
  format: MapImageFormat;
  jpegQuality: number;
  /** The hours to capture, from `planExportRange` (SCRUM-155). */
  hours: string[];
}

export type MapExportOptions = MapExportViewOptions | MapExportRangeOptions;

export type MapExportError = {
  message: string;
  /** Frames captured before the failure, offered for download. */
  frames: number;
};

interface MapExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: MapExportOptions) => void;
  /** Generated file name without its extension, e.g. "wind-map_2026-11-18_1400PST". */
  fileBaseName: string;
  /** True while the capture and encode run. */
  busy: boolean;
  /** Display timezone for the range labels (SCRUM-155). */
  timezone: string;
  /** Selectable hours: the current hour through the model's horizon, hour-aligned. */
  rangeHours: string[];
  /** Set while a range export runs, e.g. "3 of 12". */
  progress?: RangeProgress | null;
  /** Set when a range export stops on an error. */
  error?: MapExportError | null;
  onCancelRange?: () => void;
  onSaveCaptured?: () => void;
}

const VIEW_FORMATS: ReadonlyArray<{ id: MapExportFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'Lossless' },
  { id: 'jpeg', label: 'JPEG', hint: 'Smaller file' },
  { id: 'pdf', label: 'PDF', hint: 'One page' },
];

const RANGE_FORMATS: ReadonlyArray<{ id: MapImageFormat; label: string; hint: string }> = [
  { id: 'png', label: 'PNG', hint: 'Lossless' },
  { id: 'jpeg', label: 'JPEG', hint: 'Smaller file' },
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
const KNOWN_EXTENSION = /\.(?:png|jpe?g|pdf)$/i;

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

const extensionFor = (format: MapExportFormat) => (format === 'jpeg' ? 'jpeg' : format) as 'png' | 'jpeg' | 'pdf';

/**
 * Export dialog for the view currently on screen (SCRUM-117, SCRUM-162) and, since SCRUM-155, for
 * an hour range captured one frame per hour. Range frames are images only: ZIP and multi-page PDF
 * arrive in SCRUM-156.
 */
export const MapExportDialog: React.FC<MapExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  fileBaseName,
  busy,
  timezone,
  rangeHours,
  progress = null,
  error = null,
  onCancelRange,
  onSaveCaptured,
}) => {
  const [mode, setMode] = useState<'view' | 'range'>('view');
  const [format, setFormat] = useState<MapExportFormat>('png');
  const [jpegQuality, setJpegQuality] = useState<number>(DEFAULT_JPEG_QUALITY);
  const [pageSize, setPageSize] = useState<PdfPageSize>('letter');
  const [orientation, setOrientation] = useState<PdfOrientation>('portrait');
  const [start, setStart] = useState<string>(rangeHours[0] ?? '');
  const [end, setEnd] = useState<string>(rangeHours[Math.min(2, Math.max(0, rangeHours.length - 1))] ?? '');
  const [intervalHours, setIntervalHours] = useState<RangeIntervalHours>(1);
  const extension = extensionFor(format);
  const [fileName, setFileName] = useState(`${fileBaseName}.${extension}`);
  const [wasOpen, setWasOpen] = useState(false);

  // Each opening starts from the generated name and a fresh range, so stale edits never leak in.
  useEffect(() => {
    if (isOpen && !wasOpen) {
      setFileName(`${fileBaseName}.${extension}`);
      if (rangeHours.length > 0) {
        setStart(rangeHours[0]);
        setEnd(rangeHours[Math.min(2, rangeHours.length - 1)]);
        setIntervalHours(1);
      }
    }
    setWasOpen(isOpen);
  }, [isOpen, wasOpen, fileBaseName, extension, rangeHours]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const plan = useMemo(
    () =>
      planExportRange(
        {
          start,
          end,
          intervalHours,
          windowStart: rangeHours[0] ?? '',
          windowEnd: rangeHours[rangeHours.length - 1] ?? '',
        },
        timezone,
      ),
    [start, end, intervalHours, rangeHours, timezone],
  );

  if (!isOpen) return null;

  const selectFormat = (next: MapExportFormat) => {
    setFormat(next);
    setFileName((current) => `${current.replace(KNOWN_EXTENSION, '')}.${extensionFor(next)}`);
  };

  const switchMode = (next: 'view' | 'range') => {
    setMode(next);
    if (next === 'range' && format === 'pdf') setFormat('png');
  };

  const rangeReady = mode === 'range' && plan.ok && !busy;
  const rangeFormat = format === 'pdf' ? 'png' : format;

  const exportNow = () => {
    if (mode === 'range') {
      if (plan.ok) onExport({ mode: 'range', format: rangeFormat, jpegQuality, hours: plan.hours });
      return;
    }
    onExport({
      mode: 'view',
      format,
      jpegQuality,
      pageSize,
      orientation,
      fileName: sanitizeExportFileName(fileName, extension, fileBaseName),
    });
  };

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
            <img src={downloadIcon} alt="" aria-hidden="true" className="w-5 h-5 object-contain" />
            <h2 id="export-dialog-title" className="text-base font-semibold text-gray-100">
              Download map image
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
            <span id="export-mode" className={LABEL_CLASS}>
              Capture
            </span>
            <div role="radiogroup" aria-labelledby="export-mode" className="flex gap-2">
              {[
                { id: 'view' as const, label: 'Current view', hint: 'One image' },
                { id: 'range' as const, label: 'Range', hint: 'One per hour' },
              ].map((option) => {
                const active = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => switchMode(option.id)}
                    disabled={busy}
                    className={`${optionClass(active)} disabled:opacity-60`}
                  >
                    <span className="block">{option.label}</span>
                    <span className="block text-[10px] font-normal opacity-70">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {mode === 'range' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="export-range-start" className={LABEL_CLASS}>
                    Start
                  </label>
                  <select
                    id="export-range-start"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    disabled={busy}
                    className={SELECT_CLASS}
                  >
                    {rangeHours.map((hour) => (
                      <option key={hour} value={hour}>
                        {formatStepLabel(hour, timezone)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="export-range-end" className={LABEL_CLASS}>
                    End
                  </label>
                  <select
                    id="export-range-end"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    disabled={busy}
                    className={SELECT_CLASS}
                  >
                    {rangeHours.map((hour) => (
                      <option key={hour} value={hour}>
                        {formatStepLabel(hour, timezone)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="export-range-interval" className={LABEL_CLASS}>
                  Interval
                </label>
                <select
                  id="export-range-interval"
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Number(e.target.value) as RangeIntervalHours)}
                  disabled={busy}
                  className={SELECT_CLASS}
                >
                  {RANGE_INTERVAL_HOURS.map((hours) => (
                    <option key={hours} value={hours}>
                      Every {hours} {hours === 1 ? 'hour' : 'hours'}
                    </option>
                  ))}
                </select>
              </div>

              {plan.ok ? (
                <p data-testid="range-summary" className="text-xs text-gray-300">
                  {plan.summary}
                </p>
              ) : (
                <p data-testid="range-summary" role="alert" className="text-xs text-amber-300">
                  {plan.message}
                </p>
              )}

              <p className="text-[11px] text-gray-400">
                Each frame is named after its own hour. Browsers may ask to allow multiple downloads;
                a ZIP or multi-page PDF comes in SCRUM-156.
              </p>
            </>
          )}

          <div>
            <span id="export-format" className={LABEL_CLASS}>
              Format
            </span>
            <div role="radiogroup" aria-labelledby="export-format" className="flex gap-2">
              {(mode === 'range' ? RANGE_FORMATS : VIEW_FORMATS).map((option) => {
                const active = rangeFormat === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectFormat(option.id)}
                    disabled={busy}
                    className={`${optionClass(active)} disabled:opacity-60`}
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
                disabled={busy}
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

          {mode === 'view' && format === 'pdf' && (
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

          {mode === 'view' && (
            <div className="pt-2 border-t border-dark-600/70">
              <label htmlFor="export-file-name" className={LABEL_CLASS}>
                File name
              </label>
              <input
                id="export-file-name"
                data-testid="export-file-name"
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="export-file-name-hint"
                className={SELECT_CLASS}
              />
              <p id="export-file-name-hint" className="mt-1 text-[11px] text-gray-400">
                The extension follows the chosen format; an empty name uses the generated one.
              </p>
            </div>
          )}

          {progress && (
            <div
              data-testid="range-progress"
              role="status"
              className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-gray-200"
            >
              {progress.done} of {progress.total} · capturing {formatStepLabel(progress.time, timezone)}
            </div>
          )}

          {error && (
            <div
              data-testid="range-error"
              role="alert"
              className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <p>{error.message}</p>
              {error.frames > 0 && (
                <button
                  type="button"
                  onClick={onSaveCaptured}
                  disabled={busy}
                  className="mt-2 rounded-lg border border-amber-400/60 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
                >
                  Save captured frames ({error.frames})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 bg-dark-900 border-t border-dark-600 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-200 transition"
          >
            Cancel
          </button>
          {mode === 'range' && busy && onCancelRange && (
            <button
              onClick={onCancelRange}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-amber-500/60 text-amber-200 hover:bg-amber-500/10 transition"
            >
              Stop capturing
            </button>
          )}
          <button
            onClick={exportNow}
            disabled={busy || (mode === 'range' && !rangeReady)}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-wait text-white transition"
          >
            {busy ? (mode === 'range' && progress ? `Exporting ${progress.done}/${progress.total}…` : 'Exporting…') : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
