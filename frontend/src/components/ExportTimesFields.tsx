import React from 'react';
import { formatStepLabel } from '../utils/forecastWindow';
import { MAX_RANGE_CAPTURES, RANGE_PACE_MS, type ExportTimesPlan } from '../utils/exportRange';
import { LABEL_CLASS } from './mapExportOptions';

interface ExportTimesFieldsProps {
  /** Selectable times: the current hour through the model's horizon, hour-aligned. */
  rangeHours: string[];
  timezone: string;
  /** Ticked times, in the window's order. */
  selected: string[];
  busy: boolean;
  /** The plan for the current choice; its summary or its message is shown below the list. */
  plan: ExportTimesPlan;
  onToggle: (time: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

/**
 * The times to capture, one checkbox each (SCRUM-332). Replaces the start/end/interval picker:
 * the user says which frames they want instead of describing a slice of hours and a multiplier,
 * and a gap becomes a normal choice rather than something only two ends can express.
 */
export const ExportTimesFields: React.FC<ExportTimesFieldsProps> = ({
  rangeHours,
  timezone,
  selected,
  busy,
  plan,
  onToggle,
  onSelectAll,
  onSelectNone,
}) => {
  // A window longer than the capture cap (SCRUM-334): the shortcut selects the cap, and says so
  // rather than offering an "All" that the plan would have to refuse.
  const overCap = rangeHours.length > MAX_RANGE_CAPTURES;
  return (
    <>
      <div>
        <div className="flex items-center justify-between">
          <span id="export-times-label" className={LABEL_CLASS}>
            Times
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="export-times-all"
              onClick={onSelectAll}
              disabled={busy}
              title={
                overCap
                  ? `Select the first ${MAX_RANGE_CAPTURES} times: one export captures at most ${MAX_RANGE_CAPTURES}`
                  : 'Select every time in the window'
              }
              className="rounded-md border border-dark-500 px-2 py-0.5 text-[11px] text-gray-300 transition hover:border-sky-500/60 hover:text-white disabled:opacity-60"
            >
              {overCap ? `First ${MAX_RANGE_CAPTURES}` : 'All'}
            </button>
            <button
              type="button"
              data-testid="export-times-none"
              onClick={onSelectNone}
              disabled={busy}
              className="rounded-md border border-dark-500 px-2 py-0.5 text-[11px] text-gray-300 transition hover:border-sky-500/60 hover:text-white disabled:opacity-60"
            >
              None
            </button>
          </div>
        </div>
        <div
          data-testid="export-times-list"
          role="group"
          aria-labelledby="export-times-label"
          className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-dark-600 bg-dark-900/60 p-1"
        >
          {rangeHours.map((hour) => (
            <label
              key={hour}
              data-testid={`export-time-${hour}`}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-gray-200 transition hover:bg-dark-700/60"
            >
              <input
                type="checkbox"
                checked={selected.includes(hour)}
                onChange={() => onToggle(hour)}
                disabled={busy}
                className="text-sky-500 focus:ring-sky-500"
              />
              <span>{formatStepLabel(hour, timezone)}</span>
            </label>
          ))}
          {rangeHours.length === 0 && (
            <p className="px-1.5 py-1 text-xs text-gray-400">The forecast window is not ready yet.</p>
          )}
        </div>
        <p data-testid="export-times-count" className="mt-1 text-[11px] text-gray-400">
          {selected.length} of {rangeHours.length} chosen
          {overCap && ` · up to ${MAX_RANGE_CAPTURES} per export`}
          {' · frames are paced at least '}
          {RANGE_PACE_MS >= 1000 ? `${RANGE_PACE_MS / 1000} s` : `${RANGE_PACE_MS} ms`} apart
        </p>
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
        PNG and JPEG arrive as one ZIP with a file per time, and PDF as one page per time; a single
        time downloads that image directly. Frames are named after their time.
      </p>
    </>
  );
};
