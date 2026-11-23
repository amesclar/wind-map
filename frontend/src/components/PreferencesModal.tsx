import React from 'react';
import { X, Settings, Clock, Thermometer, Wind, Compass } from 'lucide-react';
import type { UnitSystem, WindDirDisplay, WindSpeedUnit } from '../types';
import { TIMEZONES } from '../constants';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  timezone: string;
  onSelectTimezone: (tz: string) => void;
  unitSystem: UnitSystem;
  onSelectUnitSystem: (system: UnitSystem) => void;
  speedUnit: WindSpeedUnit;
  onSelectSpeedUnit: (unit: WindSpeedUnit) => void;
  dirDisplay: WindDirDisplay;
  onSelectDirDisplay: (display: WindDirDisplay) => void;
}

const TEMPERATURE_OPTIONS: ReadonlyArray<{ id: UnitSystem; label: string }> = [
  { id: 'imperial', label: '°F' },
  { id: 'metric', label: '°C' },
];

const SELECT_CLASS =
  'w-full bg-dark-900 text-gray-100 text-xs border border-dark-600 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-sky-500';
const LABEL_CLASS =
  'block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5';

/** Timezone, temperature unit, wind speed unit and direction display (SCRUM-107). */
export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  isOpen,
  onClose,
  timezone,
  onSelectTimezone,
  unitSystem,
  onSelectUnitSystem,
  speedUnit,
  onSelectSpeedUnit,
  dirDisplay,
  onSelectDirDisplay,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-full">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-gray-100">Preferences</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close preferences"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
          <div>
            <label htmlFor="pref-timezone" className={LABEL_CLASS}>
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              Timezone
            </label>
            <select
              id="pref-timezone"
              value={timezone}
              onChange={(e) => onSelectTimezone(e.target.value)}
              className={SELECT_CLASS}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 border-t border-dark-600/70">
            <span id="pref-temperature" className={LABEL_CLASS}>
              <Thermometer className="w-3.5 h-3.5 text-sky-400" />
              Temperature
            </span>
            <div role="radiogroup" aria-labelledby="pref-temperature" className="flex gap-2">
              {TEMPERATURE_OPTIONS.map((opt) => {
                const active = unitSystem === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectUnitSystem(opt.id)}
                    className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                      active
                        ? 'bg-sky-600 border-sky-500 text-white'
                        : 'bg-dark-900 border-dark-600 text-gray-300 hover:bg-dark-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-dark-600/70">
            <label htmlFor="pref-speed" className={LABEL_CLASS}>
              <Wind className="w-3.5 h-3.5 text-sky-400" />
              Wind speed
            </label>
            <select
              id="pref-speed"
              value={speedUnit}
              onChange={(e) => onSelectSpeedUnit(e.target.value as WindSpeedUnit)}
              className={SELECT_CLASS}
            >
              <option value="knots">knots</option>
              <option value="kmh">km/h</option>
              <option value="mph">mph</option>
              <option value="ms">m/s</option>
            </select>
          </div>

          <div className="pt-2 border-t border-dark-600/70">
            <label htmlFor="pref-direction" className={LABEL_CLASS}>
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              Wind direction display
            </label>
            <select
              id="pref-direction"
              value={dirDisplay}
              onChange={(e) => onSelectDirDisplay(e.target.value as WindDirDisplay)}
              className={SELECT_CLASS}
            >
              <option value="barb">Barbs (feathers)</option>
              <option value="cardinal">Cardinal (N, SW)</option>
              <option value="deg">Degrees (0°-360°)</option>
            </select>
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
