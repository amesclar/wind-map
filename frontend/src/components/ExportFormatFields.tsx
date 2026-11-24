import React from 'react';
import type { PdfOrientation, PdfPageSize } from '../utils/pdfExport';
import {
  JPEG_QUALITIES,
  LABEL_CLASS,
  ORIENTATIONS,
  optionClass,
  PAGE_SIZES,
  pageDimensions,
  RANGE_FORMATS,
  SELECT_CLASS,
  VIEW_FORMATS,
  type MapExportFormat,
} from './mapExportOptions';

interface ExportFormatFieldsProps {
  mode: 'view' | 'range';
  format: MapExportFormat;
  jpegQuality: number;
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
  busy: boolean;
  onFormat: (format: MapExportFormat) => void;
  onJpegQuality: (quality: number) => void;
  onPageSize: (size: PdfPageSize) => void;
  onOrientation: (orientation: PdfOrientation) => void;
}

/** Format choice, JPEG quality and, for PDF, the page size and orientation. */
export const ExportFormatFields: React.FC<ExportFormatFieldsProps> = ({
  mode,
  format,
  jpegQuality,
  pageSize,
  orientation,
  busy,
  onFormat,
  onJpegQuality,
  onPageSize,
  onOrientation,
}) => (
  <>
    <div>
      <span id="export-format" className={LABEL_CLASS}>
        Format
      </span>
      <div role="radiogroup" aria-labelledby="export-format" className="flex gap-2">
        {(mode === 'range' ? RANGE_FORMATS : VIEW_FORMATS).map((option) => {
          const active = format === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onFormat(option.id)}
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
          onChange={(e) => onJpegQuality(Number(e.target.value))}
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
                  onClick={() => onPageSize(option.id)}
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
                  onClick={() => onOrientation(option.id)}
                  className={optionClass(active)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-gray-400">
          {mode === 'range'
            ? 'One page per hour, each fitted and centred with its aspect ratio kept.'
            : 'One page: the view currently on screen, fitted and centred with its aspect ratio kept.'}
        </p>
      </>
    )}
  </>
);
