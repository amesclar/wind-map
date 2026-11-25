import React from 'react';
import { APP_VERSION } from '../version';
import {
  Wind,
  Layers,
  MapPin,
  Map,
  Settings,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react';
import { WeatherModel, GeocodeResult } from '../types';
import { AutocompleteDropdown } from './AutocompleteDropdown';
import { MapExportControl } from './MapExportControl';

interface NavbarProps {
  models: WeatherModel[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  savedLocationsCount: number;
  onOpenSavedLocations: () => void;
  onSelectAndAddLocation: (result: GeocodeResult) => void;
  onOpenMapSettings: () => void;
  onOpenPreferences: () => void;
  hasCartoKey: boolean;
  /** Opens the export dialog (SCRUM-117). */
  onOpenExportDialog: () => void;
  /** True while an export is being captured. */
  savingMap: boolean;
  /** The server can file feedback in Jira, so the feedback button is shown (SCRUM-179). */
  feedbackEnabled: boolean;
  onOpenFeedback: () => void;
  /** A newer run is published than the data on screen, so a click is worth a call (SCRUM-113). */
  canRefresh?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Tooltip: why the button is disabled, or what it will do. */
  refreshTitle?: string;
  /** Non-blocking failure of the last click; the old data stays on screen. */
  refreshError?: string | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  models,
  selectedModel,
  onSelectModel,
  savedLocationsCount,
  onOpenSavedLocations,
  onSelectAndAddLocation,
  onOpenMapSettings,
  onOpenPreferences,
  hasCartoKey,
  onOpenExportDialog,
  savingMap,
  feedbackEnabled,
  onOpenFeedback,
  canRefresh = false,
  refreshing = false,
  onRefresh,
  refreshTitle,
  refreshError = null,
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
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-center max-w-md">
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

      {/* Right Controls: Model, feedback, export, Preferences */}
      <div className="flex items-center gap-2 shrink-0">
        {refreshError && (
          <span
            data-testid="refresh-error"
            role="status"
            title={refreshError}
            className="hidden xl:inline text-[11px] text-amber-300 max-w-[14rem] truncate"
          >
            {refreshError}
          </span>
        )}

        {/* Refresh (SCRUM-113): its own visibility rule, since the model dropdown hides below lg */}
        <button
          onClick={() => onRefresh?.()}
          disabled={!canRefresh || refreshing}
          aria-busy={refreshing}
          aria-label="Refresh data now"
          title={refreshTitle ?? 'Refresh data now'}
          data-testid="refresh-data"
          className="flex items-center justify-center p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 text-sky-400${refreshing ? ' animate-spin' : ''}`} />
        </button>

        {/* Weather Model Dropdown */}
        <div className="hidden lg:flex items-center gap-1 text-xs">
          <Layers className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            className="bg-dark-800 text-gray-200 text-xs border border-dark-600 rounded-lg px-2 py-1 focus:outline-hidden focus:border-sky-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Feedback (SCRUM-179): left of export so export stays immediately left of the gear */}
        {feedbackEnabled && (
          <button
            onClick={onOpenFeedback}
            title="Send feedback"
            aria-label="Send feedback"
            aria-haspopup="dialog"
            className="flex items-center justify-center p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 border border-dark-600 transition"
          >
            <MessageSquareText className="w-4 h-4 text-sky-400" />
          </button>
        )}
        {/* Export trigger: download icon beside Preferences (SCRUM-157) */}
        <MapExportControl onOpen={onOpenExportDialog} busy={savingMap} />

        {/* Preferences: timezone and units (SCRUM-107) */}
        <button
          onClick={onOpenPreferences}
          title="Preferences"
          aria-label="Preferences"
          className="flex items-center justify-center p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-200 border border-dark-600 transition"
        >
          <Settings className="w-4 h-4 text-sky-400" />
        </button>
      </div>
    </header>
  );
};

