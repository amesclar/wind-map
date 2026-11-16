import React from 'react';
import { APP_VERSION } from '../version';
import {
  Wind,
  Layers,
  MapPin,
  Settings,
  Clock,
  Map,
} from 'lucide-react';
import {
  WeatherModel,
  UnitSystem,
  WindSpeedUnit,
  WindDirDisplay,
  GeocodeResult,
  MapTileLayer,
} from '../types';
import { AutocompleteDropdown } from './AutocompleteDropdown';

interface NavbarProps {
  models: WeatherModel[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  timezone: string;
  onSelectTimezone: (tz: string) => void;
  unitSystem: UnitSystem;
  onToggleUnitSystem: () => void;
  speedUnit: WindSpeedUnit;
  onSelectSpeedUnit: (unit: WindSpeedUnit) => void;
  dirDisplay: WindDirDisplay;
  onSelectDirDisplay: (display: WindDirDisplay) => void;
  savedLocationsCount: number;
  onOpenSavedLocations: () => void;
  onSelectAndAddLocation: (result: GeocodeResult) => void;
  onOpenMapSettings: () => void;
  hasCartoKey: boolean;
}

const TIMEZONES = [
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { id: 'America/Denver', label: 'Mountain (MT)' },
  { id: 'America/Chicago', label: 'Central (CT)' },
  { id: 'America/New_York', label: 'Eastern (ET)' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Europe/London', label: 'London (GMT)' },
  { id: 'Europe/Paris', label: 'Paris (CET)' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

export const Navbar: React.FC<NavbarProps> = ({
  models,
  selectedModel,
  onSelectModel,
  timezone,
  onSelectTimezone,
  unitSystem,
  onToggleUnitSystem,
  speedUnit,
  onSelectSpeedUnit,
  dirDisplay,
  onSelectDirDisplay,
  savedLocationsCount,
  onOpenSavedLocations,
  onSelectAndAddLocation,
  onOpenMapSettings,
  hasCartoKey,
}) => {
  return (
    <header className="h-14 bg-dark-900/90 backdrop-blur-md border-b border-dark-600 px-4 flex items-center justify-between z-40 relative gap-3">
      {/* Brand & Title */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
          <Wind className="w-5 h-5 animate-pulse" />
        </div>
        <div className="hidden sm:block">
          <h1 className="text-sm font-bold text-gray-100 tracking-wide flex items-center gap-1.5">
            Wind Map
            <span
              data-testid="app-version"
              className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-800/40"
            >
              v{APP_VERSION}
            </span>
          </h1>
        </div>
      </div>

      {/* Center: Search & Add Location Box */}
      <div className="flex items-center gap-2 flex-1 justify-center max-w-md">
        <AutocompleteDropdown onSelectAndAdd={onSelectAndAddLocation} />

        {/* Saved locations list button */}
        <button
          onClick={onOpenSavedLocations}
          title="List saved locations"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 text-xs font-medium transition shrink-0"
        >
          <MapPin className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden md:inline">Locations</span>
          <span className="px-1.5 py-0.2 rounded-full bg-dark-600 text-[10px] text-gray-300">
            {savedLocationsCount}
          </span>
        </button>

        {/* Map Layers & API Key Settings */}
        <button
          onClick={onOpenMapSettings}
          title="Map Layers & CARTO API Key"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 text-xs font-medium transition shrink-0"
        >
          <Map className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden md:inline">Map</span>
          {hasCartoKey && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="API key active" />
          )}
        </button>
      </div>

      {/* Right Controls: Model, Timezone, Units */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Weather Model Dropdown */}
        <div className="hidden lg:flex items-center gap-1 text-xs">
          <Layers className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            className="bg-dark-800 text-gray-200 text-xs border border-dark-600 rounded-lg px-2 py-1 focus:outline-none focus:border-sky-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Timezone Selector */}
        <div className="hidden md:flex items-center gap-1 text-xs">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={timezone}
            onChange={(e) => onSelectTimezone(e.target.value)}
            className="bg-dark-800 text-gray-200 text-xs border border-dark-600 rounded-lg px-2 py-1 focus:outline-none focus:border-sky-500"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.id} value={tz.id}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        {/* Metric / Imperial Unit Toggle */}
        <button
          onClick={onToggleUnitSystem}
          title={`Toggle units (currently ${unitSystem === 'imperial' ? 'Imperial °F/knots' : 'Metric °C/kmh'})`}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-dark-800 hover:bg-dark-700 text-xs font-semibold text-gray-200 border border-dark-600 transition"
        >
          <span className={unitSystem === 'imperial' ? 'text-sky-400' : 'text-gray-400'}>°F</span>
          <span className="text-gray-500">/</span>
          <span className={unitSystem === 'metric' ? 'text-sky-400' : 'text-gray-400'}>°C</span>
        </button>

        {/* Speed unit selector */}
        <select
          value={speedUnit}
          onChange={(e) => onSelectSpeedUnit(e.target.value as WindSpeedUnit)}
          className="bg-dark-800 text-gray-200 text-xs border border-dark-600 rounded-lg px-2 py-1 focus:outline-none focus:border-sky-500 hidden sm:block"
        >
          <option value="knots">knots</option>
          <option value="kmh">km/h</option>
          <option value="mph">mph</option>
          <option value="ms">m/s</option>
        </select>

        {/* Wind direction format selector */}
        <select
          value={dirDisplay}
          onChange={(e) => onSelectDirDisplay(e.target.value as WindDirDisplay)}
          className="bg-dark-800 text-gray-200 text-xs border border-dark-600 rounded-lg px-2 py-1 focus:outline-none focus:border-sky-500 hidden xl:block"
        >
          <option value="barb">Barbs (feathers)</option>
          <option value="cardinal">Cardinal (N, SW)</option>
          <option value="deg">Degrees (0°-360°)</option>
        </select>
      </div>
    </header>
  );
};

