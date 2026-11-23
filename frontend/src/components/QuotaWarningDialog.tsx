import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface QuotaWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** ISO instant Open-Meteo says its limit resets, when it sent one (SCRUM-170). */
  resetAt: string | null;
  timezone: string;
}

/** "4:00 PM PST" in the user's timezone, or null for a missing/invalid instant. */
export function formatQuotaReset(resetAt: string, timezone: string): string | null {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const period = get('dayPeriod');
  return `${get('hour')}:${get('minute')}${period ? ` ${period}` : ''} ${get('timeZoneName')}`;
}

/**
 * Explains that Open-Meteo's request limit stopped the wind grid (SCRUM-170). It names the
 * reset time, so the missing gradient and barbs are not mistaken for a broken overlay.
 */
export const QuotaWarningDialog: React.FC<QuotaWarningDialogProps> = ({ isOpen, onClose, resetAt, timezone }) => {
  if (!isOpen) return null;
  const resetLabel = resetAt ? formatQuotaReset(resetAt, timezone) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-warning-title"
        data-testid="quota-warning"
        className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-dark-600">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h2 id="quota-warning-title" className="text-base font-semibold text-gray-100">
              Wind data temporarily unavailable
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              Open-Meteo&apos;s request limit has been reached, so the wind barbs and colour gradient
              can&apos;t load right now.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-2 text-sm text-gray-300">
          <p>
            {resetLabel
              ? `Wind data should return at ${resetLabel}.`
              : "Wind data will return when Open-Meteo's limit resets."}
          </p>
          <p className="text-gray-500">Your saved locations, units and preferences are unaffected.</p>
        </div>

        <div className="flex justify-end px-5 py-4 border-t border-dark-600">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
