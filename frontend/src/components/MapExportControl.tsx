import React from 'react';
import downloadIcon from '../assets/download-icon.png';

interface MapExportControlProps {
  /** Opens the export dialog (SCRUM-117). */
  onOpen: () => void;
  /** True while an export runs, so a second one cannot start. */
  busy: boolean;
  /** True when export is disabled (e.g. for Google Satellite licensing, SCRUM-311). */
  disabled?: boolean;
  /** Tooltip and aria-label when disabled. */
  disabledTooltip?: string;
}

/**
 * Entry point to the map export (SCRUM-116, SCRUM-157): the supplied download artwork in an
 * icon-only square that matches the model-guide and Preferences buttons. It sits immediately left
 * of the gear in the ribbon; the dialog it opens carries the format, PDF page and file name
 * options (SCRUM-117).
 */
export const MapExportControl: React.FC<MapExportControlProps> = ({
  onOpen,
  busy,
  disabled = false,
  disabledTooltip,
}) => {
  const label = disabled
    ? (disabledTooltip ?? 'Export disabled')
    : busy
      ? 'Exporting…'
      : 'Export map image';
  const isDisabled = busy || disabled;
  const cursorClass = busy ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed';

  return (
    <button
      onClick={onOpen}
      disabled={isDisabled}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-busy={busy}
      className={`flex items-center justify-center p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 border border-dark-600 transition disabled:opacity-60 ${cursorClass}`}
    >
      <img src={downloadIcon} alt="" aria-hidden="true" className="w-4 h-4 object-contain" />
    </button>
  );
};
