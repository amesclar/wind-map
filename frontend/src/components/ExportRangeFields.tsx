import React from 'react';
import { formatStepLabel } from '../utils/forecastWindow';
import { RANGE_INTERVAL_HOURS, type ExportRangePlan, type RangeIntervalHours } from '../utils/exportRange';
import { LABEL_CLASS, SELECT_CLASS } from './mapExportOptions';

interface ExportRangeFieldsProps {
  /** Selectable hours: the current hour through the model's horizon, hour-aligned. */
  rangeHours: string[];
  timezone: string;
  start: string;
  end: string;
  intervalHours: RangeIntervalHours;
  busy: boolean;
  /** The plan for the current choice; its summary or its message is shown below the fields. */
  plan: ExportRangePlan;
  onStart: (hour: string) => void;
  onEnd: (hour: string) => void;
  onInterval: (hours: RangeIntervalHours) => void;
}

/** Start, end and interval for a range export, with the live plan summary (SCRUM-155). */
export const ExportRangeFields: React.FC<ExportRangeFieldsProps> = ({
  rangeHours,
  timezone,
  start,
  end,
  intervalHours,
  busy,
  plan,
  onStart,
  onEnd,
  onInterval,
}) => (
  <>
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label htmlFor="export-range-start" className={LABEL_CLASS}>
          Start
        </label>
        <select
          id="export-range-start"
          value={start}
          onChange={(e) => onStart(e.target.value)}
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
          onChange={(e) => onEnd(e.target.value)}
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
        onChange={(e) => onInterval(Number(e.target.value) as RangeIntervalHours)}
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
      PNG and JPEG arrive as one ZIP with a file per hour, and PDF as one page per hour;
      a single-hour range downloads that image directly. Frames are named after their hour.
    </p>
  </>
);
