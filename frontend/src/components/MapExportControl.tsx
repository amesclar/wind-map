import React, { useEffect, useRef, useState } from 'react';
import { ImageDown } from 'lucide-react';
import type { MapImageFormat } from '../utils/captureMap';

interface MapExportControlProps {
  /** Called with the chosen format; the dialog with ranges and PDF comes later (SCRUM-117). */
  onSave: (format: MapImageFormat) => void;
  /** True while the capture runs, so the menu can't start a second one. */
  busy: boolean;
}

const FORMAT_LABEL: Record<MapImageFormat, string> = { png: 'PNG', jpeg: 'JPEG' };

/**
 * "Save image" button with a small PNG/JPEG menu (SCRUM-116). A plain button and two options
 * for now; SCRUM-117 replaces it with the full export dialog.
 */
export const MapExportControl: React.FC<MapExportControlProps> = ({ onSave, busy }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        title="Save the map as an image"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 disabled:opacity-60 disabled:cursor-wait text-gray-200 border border-dark-600 text-xs font-medium transition"
      >
        <ImageDown className="w-3.5 h-3.5 text-sky-400" />
        <span className="hidden md:inline">{busy ? 'Saving…' : 'Save'}</span>
      </button>
      {open && !busy && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 min-w-24 rounded-lg border border-dark-600 bg-dark-800 p-1 shadow-xl"
        >
          {(Object.keys(FORMAT_LABEL) as MapImageFormat[]).map((format) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSave(format);
              }}
              className="block w-full text-left px-2 py-1.5 rounded-md text-xs text-gray-200 hover:bg-dark-700"
            >
              {FORMAT_LABEL[format]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
