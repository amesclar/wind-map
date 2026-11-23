import React from 'react';
import { X, RefreshCw } from 'lucide-react';
import guideMarkdown from '../assets/weather-models.md?raw';
import { parseModelGuide, type ModelCadence } from '../utils/modelGuide';

interface WeatherModelGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Markdown source; defaults to the bundled ticket attachment (SCRUM-110). */
  markdown?: string;
}

const CADENCE_BADGE: Record<ModelCadence, string> = {
  '1h': 'bg-sky-950 text-sky-400 border-sky-800/40',
  '3h': 'bg-emerald-950 text-emerald-400 border-emerald-800/40',
  '6h': 'bg-amber-950 text-amber-400 border-amber-800/40',
};

const HEAD_CELL = 'px-3 py-2 text-[10px] font-semibold text-gray-300 uppercase tracking-wider whitespace-nowrap';
const BODY_CELL = 'px-3 py-2 align-top';

/** Read-only reference of when each weather model publishes a new run (SCRUM-110). */
export const WeatherModelGuideModal: React.FC<WeatherModelGuideModalProps> = ({
  isOpen,
  onClose,
  markdown = guideMarkdown,
}) => {
  if (!isOpen) return null;

  const guide = parseModelGuide(markdown);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl max-h-full bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-gray-100">Model Update Cycles &amp; Frequency</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close model update guide"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: scrolls vertically; the table scrolls sideways on narrow screens */}
        <div
          data-testid="model-guide-body"
          className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0"
        >
          <p className="text-[11px] text-gray-400">
            Reference guide to how often each prediction model publishes a new run. The model selector offers a
            subset of these families; models listed here are not all selectable in this app.
          </p>

          <div
            data-testid="model-guide-table"
            className="overflow-x-auto rounded-lg border border-dark-600"
          >
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="bg-dark-900/80">
                  {guide.headers.map((header) => (
                    <th key={header} scope="col" className={HEAD_CELL}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guide.rows.map((row) => (
                  <tr key={row.model} className="border-t border-dark-600/70">
                    <td className={`${BODY_CELL} text-xs font-medium text-gray-100`}>{row.model}</td>
                    <td className={`${BODY_CELL} text-[11px] text-gray-300 whitespace-nowrap`}>{row.region}</td>
                    <td className={`${BODY_CELL} whitespace-nowrap`}>
                      {row.cadence ? (
                        <span
                          data-testid={`cadence-${row.cadence}`}
                          className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${CADENCE_BADGE[row.cadence]}`}
                        >
                          {row.cadence}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">{row.frequency}</span>
                      )}
                    </td>
                    <td className={`${BODY_CELL} text-[11px] text-gray-400`}>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 bg-dark-900 border-t border-dark-600 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-200 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
