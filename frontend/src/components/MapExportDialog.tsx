import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import downloadIcon from '../assets/download-icon.png';
import { DEFAULT_JPEG_QUALITY } from '../utils/download';
import { sanitizeExportFileName } from '../utils/mapExport';
import { planExportTimes } from '../utils/exportRange';
import type { PdfOrientation, PdfPageSize } from '../utils/pdfExport';
import type { RangeProgress } from '../utils/rangeCapture';
import { ExportFormatFields } from './ExportFormatFields';
import { ExportModeField } from './ExportModeField';
import { ExportTimesFields } from './ExportTimesFields';
import { ExportRangeStatus } from './ExportRangeStatus';
import {
  extensionFor,
  LABEL_CLASS,
  SELECT_CLASS,
  withExtension,
  type MapExportError,
  type MapExportFormat,
  type MapExportOptions,
} from './mapExportOptions';

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
  /** Base-map tiles one captured frame asks for (SCRUM-299); 0 while the map size is unknown. */
  viewportTiles?: number;
  /** Set while a range export runs, e.g. "3 of 12". */
  progress?: RangeProgress | null;
  /** Set when a range export stops on an error. */
  error?: MapExportError | null;
  onCancelRange?: () => void;
  onSaveCaptured?: () => void;
  /** True when export is disabled (SCRUM-311). */
  disabled?: boolean;
  /** Reason shown in warning banner when export is disabled (SCRUM-311). */
  disabledReason?: string;
  /** Set on a base whose terms forbid a time-lapsed export (SCRUM-333); the view export stays. */
  rangeDisabledReason?: string;
}

/**
 * Export dialog for the view currently on screen (SCRUM-117, SCRUM-162) and, since SCRUM-155, for
 * an hour range captured one frame per hour. Since SCRUM-156 a range saves as one ZIP of images or
 * one multi-page PDF. The fields live in `ExportRangeFields`/`ExportFormatFields` (SCRUM-178).
 */
export const MapExportDialog: React.FC<MapExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  fileBaseName,
  busy,
  timezone,
  rangeHours,
  viewportTiles = 0,
  progress = null,
  error = null,
  onCancelRange,
  onSaveCaptured,
  disabled = false,
  disabledReason,
  rangeDisabledReason,
}) => {
  const [mode, setMode] = useState<'view' | 'range'>('view');
  const [format, setFormat] = useState<MapExportFormat>('png');
  const [jpegQuality, setJpegQuality] = useState<number>(DEFAULT_JPEG_QUALITY);
  const [pageSize, setPageSize] = useState<PdfPageSize>('letter');
  // A map view is wide, so a PDF opens on landscape (SCRUM-243); Portrait stays one click away.
  const [orientation, setOrientation] = useState<PdfOrientation>('landscape');
  // The times the user ticked (SCRUM-332). A fresh dialog starts on the first three, which is what
  // the old default three-hour range captured.
  const [selectedTimes, setSelectedTimes] = useState<string[]>(() => rangeHours.slice(0, 3));
  const extension = extensionFor(format);
  const [fileName, setFileName] = useState(`${fileBaseName}.${extension}`);
  const [wasOpen, setWasOpen] = useState(false);

  // Each opening starts from the generated name and a fresh range, so stale edits never leak in.
  useEffect(() => {
    if (isOpen && !wasOpen) {
      setFileName(`${fileBaseName}.${extension}`);
      if (rangeHours.length > 0) setSelectedTimes(rangeHours.slice(0, 3));
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

  // A base that forbids time-lapsed exports can never leave the dialog in range mode, even if the
  // prop arrives while it is open (SCRUM-333).
  const rangeBlocked = Boolean(rangeDisabledReason);
  useEffect(() => {
    if (rangeBlocked && mode === 'range') setMode('view');
  }, [rangeBlocked, mode]);

  // Times the window no longer offers are ignored rather than planned, so a window that shifts
  // under an open dialog cannot ask for a frame outside it.
  const chosenTimes = useMemo(
    () => selectedTimes.filter((time) => rangeHours.includes(time)),
    [selectedTimes, rangeHours],
  );

  const plan = useMemo(
    () =>
      planExportTimes(
        {
          times: chosenTimes,
          windowStart: rangeHours[0] ?? '',
          windowEnd: rangeHours[rangeHours.length - 1] ?? '',
          tilesPerFrame: viewportTiles,
        },
        timezone,
      ),
    [chosenTimes, rangeHours, timezone, viewportTiles],
  );

  if (!isOpen) return null;

  const selectFormat = (next: MapExportFormat) => {
    setFormat(next);
    setFileName((current) => withExtension(current, next));
  };

  const rangeReady = mode === 'range' && plan.ok && !busy;

  const toggleTime = (time: string) =>
    setSelectedTimes((current) =>
      current.includes(time) ? current.filter((t) => t !== time) : [...current, time],
    );

  const exportNow = () => {
    if (mode === 'range') {
      if (plan.ok) {
        onExport({
          mode: 'range',
          format,
          jpegQuality,
          pageSize,
          orientation,
          hours: plan.times,
        });
      }
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
          {disabled && (
            <div
              data-testid="export-disabled-banner"
              className="p-3 rounded-lg bg-amber-950/40 border border-amber-600/50 text-amber-200 text-xs"
            >
              {disabledReason ??
                'Map image/PDF export is disabled on Google Maps due to licensing restrictions.'}
            </div>
          )}
          <ExportModeField
            mode={mode}
            busy={busy}
            onChange={setMode}
            rangeDisabledReason={rangeDisabledReason}
          />

          {mode === 'range' && (
            <ExportTimesFields
              rangeHours={rangeHours}
              timezone={timezone}
              selected={chosenTimes}
              busy={busy}
              plan={plan}
              onToggle={toggleTime}
              onSelectAll={() => setSelectedTimes(rangeHours)}
              onSelectNone={() => setSelectedTimes([])}
            />
          )}

          <ExportFormatFields
            mode={mode}
            format={format}
            jpegQuality={jpegQuality}
            pageSize={pageSize}
            orientation={orientation}
            busy={busy}
            onFormat={selectFormat}
            onJpegQuality={setJpegQuality}
            onPageSize={setPageSize}
            onOrientation={setOrientation}
          />

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

          <ExportRangeStatus
            progress={progress}
            error={error}
            timezone={timezone}
            busy={busy}
            onSaveCaptured={onSaveCaptured}
          />
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
            disabled={busy || disabled || (mode === 'range' && !rangeReady)}
            title={disabled ? (disabledReason ?? 'Export disabled') : undefined}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 disabled:cursor-not-allowed text-white transition"
          >
            {busy ? (mode === 'range' && progress ? `Exporting ${progress.done}/${progress.total}…` : 'Exporting…') : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};
