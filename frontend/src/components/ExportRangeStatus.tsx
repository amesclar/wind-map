import React from 'react';
import { formatStepLabel } from '../utils/forecastWindow';
import type { RangeProgress } from '../utils/rangeCapture';
import type { MapExportError } from './mapExportOptions';

interface ExportRangeStatusProps {
  /** Set while a range export runs, e.g. "3 of 12". */
  progress: RangeProgress | null;
  /** Set when a range export stops on an error. */
  error: MapExportError | null;
  timezone: string;
  busy: boolean;
  onSaveCaptured?: () => void;
}

/** Live range progress and, after a failure, the message plus the frames captured so far. */
export const ExportRangeStatus: React.FC<ExportRangeStatusProps> = ({
  progress,
  error,
  timezone,
  busy,
  onSaveCaptured,
}) => (
  <>
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
  </>
);
