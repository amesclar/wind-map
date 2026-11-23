import React from 'react';
import { ImageDown } from 'lucide-react';

interface MapExportControlProps {
  /** Opens the export dialog (SCRUM-117); SCRUM-157 owns the icon and its place in the ribbon. */
  onOpen: () => void;
  /** True while an export runs, so a second one cannot start. */
  busy: boolean;
}

/**
 * Entry point to the map export (SCRUM-116). The button keeps its SCRUM-116 look; the dialog it
 * opens carries the format, PDF page and file name options (SCRUM-117).
 */
export const MapExportControl: React.FC<MapExportControlProps> = ({ onOpen, busy }) => (
  <button
    onClick={onOpen}
    disabled={busy}
    title="Save the map as an image"
    aria-haspopup="dialog"
    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 disabled:opacity-60 disabled:cursor-wait text-gray-200 border border-dark-600 text-xs font-medium transition"
  >
    <ImageDown className="w-3.5 h-3.5 text-sky-400" />
    <span className="hidden md:inline">{busy ? 'Saving…' : 'Save'}</span>
  </button>
);
