import React from 'react';
import { LABEL_CLASS, optionClass } from './mapExportOptions';

const MODES: ReadonlyArray<{ id: 'view' | 'range'; label: string; hint: string }> = [
  { id: 'view', label: 'Current view', hint: 'One image' },
  { id: 'range', label: 'Range', hint: 'One per hour' },
];

interface ExportModeFieldProps {
  mode: 'view' | 'range';
  busy: boolean;
  onChange: (mode: 'view' | 'range') => void;
  /** Set on a base whose terms forbid a time-lapsed export (SCRUM-333); the view mode stays. */
  rangeDisabledReason?: string;
}

/** "Current view" or "Range" (SCRUM-155), disabled while a capture runs. */
export const ExportModeField: React.FC<ExportModeFieldProps> = ({
  mode,
  busy,
  onChange,
  rangeDisabledReason,
}) => (
  <div>
    <span id="export-mode" className={LABEL_CLASS}>
      Capture
    </span>
    <div role="radiogroup" aria-labelledby="export-mode" className="flex gap-2">
      {MODES.map((option) => {
        const active = mode === option.id;
        const unavailable = option.id === 'range' && Boolean(rangeDisabledReason);
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={unavailable || undefined}
            title={unavailable ? rangeDisabledReason : undefined}
            onClick={() => onChange(option.id)}
            disabled={busy || unavailable}
            className={`${optionClass(active)} disabled:opacity-60`}
          >
            <span className="block">{option.label}</span>
            <span className="block text-[10px] font-normal opacity-70">{option.hint}</span>
          </button>
        );
      })}
    </div>
    {rangeDisabledReason && (
      <p
        data-testid="export-range-disabled-note"
        className="mt-1 text-[10px] leading-snug text-amber-300/90"
      >
        {rangeDisabledReason}
      </p>
    )}
  </div>
);
