import React, { useState } from 'react';
import { X, Key, Map, ExternalLink, Check, AlertCircle, Wind, Palette, Waves, MoveRight, Anchor, Layers } from 'lucide-react';
import { MapTileLayer } from '../types';
import {
  isLightTileLayer,
  NOAA_ATTRIBUTION_TEXT,
  NOAA_COVERAGE_NOTICE,
  NOAA_NOTICE,
  NONNA_ATTRIBUTION_TEXT,
  NONNA_DERIVATIVE_NOTICE,
  NONNA_NOTICE,
  SEAMAP_ATTRIBUTION_TEXT,
  SEAMAP_NOTICE,
  SEAMARK_ATTRIBUTION_TEXT,
  SEAMARK_HIDDEN_ON_CHART,
  SEAMARK_NOTICE,
} from './mapTiles';

interface MapSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tileLayer: MapTileLayer;
  onChangeTileLayer: (layer: MapTileLayer) => void;
  cartoApiKey: string;
  onSaveCartoApiKey: (key: string) => void;
  /** The server holds a Google Maps key, so the hybrid layer can load (SCRUM-311). */
  googleSatelliteEnabled?: boolean;
  windOverlayVisible: boolean;
  onToggleWindOverlay: (visible: boolean) => void;
  windColorOverlayVisible: boolean;
  onToggleWindColorOverlay: (visible: boolean) => void;
  /** Forces the chart's reduced gradient opacity on every base (SCRUM-213). */
  windColorHighContrast: boolean;
  onToggleWindColorHighContrast: (enabled: boolean) => void;
  /** Ocean-current chevrons (SCRUM-100), independent of the wind layers. */
  waterCurrentsVisible: boolean;
  onToggleWaterCurrents: (visible: boolean) => void;
  /** Ocean-wave arrows (SCRUM-234), independent of the currents and the wind layers. */
  wavesVisible?: boolean;
  onToggleWaves?: (visible: boolean) => void;
  /** Nautical seamark overlay (SCRUM-175), off by default. */
  seamarksVisible: boolean;
  onToggleSeamarks: (visible: boolean) => void;
  /** CHS NONNA bathymetry for B.C. waters (SCRUM-205), off by default. */
  bcDepthVisible: boolean;
  onToggleBcDepth: (visible: boolean) => void;
}

/**
 * One class table instead of a ternary on every element (SCRUM-221). `light` follows the selected
 * base map, so the dialog reads on the OSM Standard roads and the white chart sheet as well as on
 * the dark bases; every pair was checked against its background at WCAG AA.
 */
interface ModalTheme {
  panel: string;
  headerBorder: string;
  title: string;
  icon: string;
  close: string;
  label: string;
  link: string;
  option: string;
  optionTitle: string;
  description: string;
  note: string;
  input: string;
  subPanel: string;
  footer: string;
  footerButton: string;
  toggleOff: string;
  badgeFree: string;
  badgeKey: string;
  positive: string;
  danger: string;
}

const DARK_THEME: ModalTheme = {
  panel: 'bg-dark-800 border-dark-600',
  headerBorder: 'border-dark-600',
  title: 'text-gray-100',
  icon: 'text-sky-400',
  close: 'text-gray-400 hover:text-gray-100 hover:bg-dark-700',
  label: 'text-gray-300',
  link: 'text-sky-400 hover:text-sky-300',
  option: 'border-dark-600 hover:bg-dark-700/50',
  optionTitle: 'text-gray-100',
  description: 'text-gray-400',
  note: 'text-gray-500',
  input: 'bg-dark-900 border-dark-600 text-gray-100 placeholder:text-gray-500',
  subPanel: 'border-dark-600/70 bg-dark-900/40',
  footer: 'bg-dark-900 border-dark-600',
  footerButton: 'bg-dark-700 hover:bg-dark-600 text-gray-200',
  toggleOff: 'bg-dark-600',
  badgeFree: 'bg-emerald-950 text-emerald-400 border-emerald-800/40',
  badgeKey: 'bg-amber-950 text-amber-400 border-amber-800/40',
  positive: 'text-emerald-400',
  danger: 'text-red-400 hover:bg-red-950/40',
};

const LIGHT_THEME: ModalTheme = {
  panel: 'bg-slate-50 border-slate-300',
  headerBorder: 'border-slate-300',
  title: 'text-slate-900',
  icon: 'text-sky-600',
  close: 'text-slate-500 hover:text-slate-900 hover:bg-slate-200',
  label: 'text-slate-600',
  link: 'text-sky-700 hover:text-sky-600',
  option: 'border-slate-300 hover:bg-slate-200/70',
  optionTitle: 'text-slate-900',
  description: 'text-slate-600',
  note: 'text-slate-500',
  input: 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400',
  subPanel: 'border-slate-300 bg-white',
  footer: 'bg-slate-100 border-slate-300',
  footerButton: 'bg-slate-200 hover:bg-slate-300 text-slate-800',
  toggleOff: 'bg-slate-300',
  badgeFree: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  badgeKey: 'bg-amber-100 text-amber-800 border-amber-300',
  positive: 'text-emerald-700',
  danger: 'text-red-700 hover:bg-red-100',
};

export const MapSettingsModal: React.FC<MapSettingsModalProps> = ({
  isOpen,
  onClose,
  tileLayer,
  onChangeTileLayer,
  cartoApiKey,
  onSaveCartoApiKey,
  googleSatelliteEnabled = true,
  windOverlayVisible,
  onToggleWindOverlay,
  windColorOverlayVisible,
  onToggleWindColorOverlay,
  windColorHighContrast,
  onToggleWindColorHighContrast,
  waterCurrentsVisible,
  onToggleWaterCurrents,
  wavesVisible = false,
  onToggleWaves = () => {},
  seamarksVisible,
  onToggleSeamarks,
  bcDepthVisible,
  onToggleBcDepth,
}) => {
  const [inputKey, setInputKey] = useState(cartoApiKey);
  const [isSaved, setIsSaved] = useState(false);
  // The chart carries NOAA's own aids, so the seamark overlay is suppressed there (SCRUM-214).
  const chartBase = tileLayer === 'paper_chart';
  const light = isLightTileLayer(tileLayer);
  const theme = light ? LIGHT_THEME : DARK_THEME;

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCartoApiKey(inputKey.trim());
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        data-testid="map-settings-panel"
        data-theme={light ? 'light' : 'dark'}
        className={`w-full max-w-2xl ${theme.panel} border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-full`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${theme.headerBorder} shrink-0`}
        >
          <div className="flex items-center gap-2">
            <Map className={`w-5 h-5 ${theme.icon}`} />
            <h2 className={`text-base font-semibold ${theme.title}`}>Map Settings & API Key</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg transition ${theme.close}`}
            aria-label="Close map settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: the body scrolls, so the footer below can never be pushed off screen */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0" data-testid="map-settings-body">
          <div className="grid gap-5 md:grid-cols-2" data-testid="map-settings-columns">
            {/* Column 1: map options and the CARTO key */}
            <div className="space-y-5" data-testid="map-settings-column-options">
              {/* Tile Layer Selector */}
              <div>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2`}
                >
                  Base Map Style
                </label>
                <div className="space-y-2">
                  <label
                    data-testid="tile-layer-osm-dark"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'osm_dark'}
                      onChange={() => onChangeTileLayer('osm_dark')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${theme.optionTitle} flex items-center gap-2`}
                      >
                        OSM-Dark
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded border ${theme.badgeFree}`}
                        >
                          Free • No Key Needed
                        </span>
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        Clean, high-contrast dark theme without any watermark or API key limits.
                      </div>
                    </div>
                  </label>

                  <label
                    data-testid="tile-layer-carto-dark"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'carto_dark'}
                      onChange={() => onChangeTileLayer('carto_dark')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${theme.optionTitle} flex items-center gap-2`}
                      >
                        CARTO
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded border ${theme.badgeKey}`}
                        >
                          API Key Required
                        </span>
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        CARTO requires an API key to remove the "API KEY REQUIRED" watermark.
                      </div>
                    </div>
                  </label>

                  <label
                    data-testid="tile-layer-osm-standard"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'osm_standard'}
                      onChange={() => onChangeTileLayer('osm_standard')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div className={`text-sm font-medium ${theme.optionTitle}`}>
                        OSM-Light
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        Default light road map, completely keyless.
                      </div>
                    </div>
                  </label>

                  <label
                    data-testid="tile-layer-paper-chart"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'paper_chart'}
                      onChange={() => onChangeTileLayer('paper_chart')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${theme.optionTitle} flex items-center gap-2`}
                      >
                        NOAA
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded border ${theme.badgeFree}`}
                        >
                          Free • No Key Needed
                        </span>
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        NOAA's official chart as the map itself: soundings, aids to navigation and
                        channels, at about 0.5 s per tile because nothing is cached.
                      </div>
                      <div className={`text-xs ${theme.note} mt-1`}>
                        {NOAA_ATTRIBUTION_TEXT} · {NOAA_NOTICE}. {NOAA_COVERAGE_NOTICE}
                      </div>
                    </div>
                  </label>

                  <label
                    data-testid="tile-layer-seamap"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'seamap'}
                      onChange={() => onChangeTileLayer('seamap')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${theme.optionTitle} flex items-center gap-2`}
                      >
                        OpenWater
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded border ${theme.badgeFree}`}
                        >
                          Free • No Key Needed
                        </span>
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        Vector nautical detail: navigation aids and depth shading, not soundings.
                        Its tiles stop at zoom 14 and overzoom beyond that.
                      </div>
                      <div className={`text-xs ${theme.note} mt-1`}>
                        {SEAMAP_ATTRIBUTION_TEXT} · {SEAMAP_NOTICE}. The wind gradient is drawn
                        lighter here so the aids stay crisp; turning it off helps further.
                      </div>
                    </div>
                  </label>

                  {googleSatelliteEnabled && (
                  <label
                    data-testid="tile-layer-google-satellite"
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${theme.option}`}
                  >
                    <input
                      type="radio"
                      name="tileLayer"
                      checked={tileLayer === 'google_satellite'}
                      onChange={() => onChangeTileLayer('google_satellite')}
                      className="mt-0.5 text-sky-500 focus:ring-sky-500"
                    />
                    <div>
                      <div
                        className={`text-sm font-medium ${theme.optionTitle} flex items-center gap-2`}
                      >
                        Satellite
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded border ${theme.badgeFree}`}
                        >
                          Satellite
                        </span>
                      </div>
                      <div className={`text-xs ${theme.description} mt-0.5`}>
                        High-resolution satellite imagery with coastal roads and place names.
                      </div>
                      <div className={`text-xs ${theme.note} mt-1`}>
                        Export unavailable on Google Maps due to licensing restrictions.
                      </div>
                    </div>
                  </label>
                  )}
                </div>
              </div>

              {/* CARTO API Key Section */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <div className="flex items-center justify-between mb-2">
                  <label
                    className={`text-xs font-semibold ${theme.label} uppercase tracking-wider flex items-center gap-1.5`}
                  >
                    <Key className={`w-3.5 h-3.5 ${theme.icon}`} />
                    CARTO API Key
                  </label>
                  <a
                    href="https://carto.com/basemaps/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs ${theme.link} flex items-center gap-1 hover:underline`}
                  >
                    <span>Get free key</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <p className={`text-xs ${theme.description} mb-1`}>
                  Get an instant free key from CARTO (up to 5 million requests/month) and paste it below to unlock watermark-free CARTO tiles.
                </p>
                <p className={`text-xs ${theme.note} mb-2.5`}>
                  The key applies to CARTO only.
                </p>

                <form onSubmit={handleSave} className="space-y-2.5">
                  <input
                    type="text"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    placeholder="Paste CARTO API Key here..."
                    aria-label="CARTO API Key"
                    className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono focus:outline-hidden focus:border-sky-500 ${theme.input}`}
                  />

                  <div className="flex items-center justify-between">
                    <div className="text-xs">
                      {cartoApiKey ? (
                        <span className={`${theme.positive} flex items-center gap-1`}>
                          <Check className="w-3 h-3" />
                          Key active
                        </span>
                      ) : (
                        <span className={`${theme.note} flex items-center gap-1`}>
                          <AlertCircle className="w-3 h-3" />
                          No key set
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {cartoApiKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setInputKey('');
                            onSaveCartoApiKey('');
                          }}
                          className={`px-2.5 py-1 text-xs rounded transition ${theme.danger}`}
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="submit"
                        className="px-3.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition flex items-center gap-1"
                      >
                        {isSaved ? <Check className="w-3.5 h-3.5" /> : null}
                        <span>{isSaved ? 'Saved!' : 'Save Key'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>

            {/* Column 2: map layers */}
            <div
              className={`space-y-5 border-t ${theme.headerBorder} pt-5 md:border-t-0 md:pt-0`}
              data-testid="map-settings-column-layers"
            >
              {/* Wind Grid Overlay Toggle */}
              <div>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <Wind className={`w-3.5 h-3.5 ${theme.icon}`} />
                  Wind Grid Overlay
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Show wind barbs across map
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Displays a continuous grid of wind direction and speed indicators over the visible viewport.
                    </div>
                  </div>
                  <button
                    data-testid="wind-overlay-toggle"
                    type="button"
                    onClick={() => onToggleWindOverlay(!windOverlayVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      windOverlayVisible ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={windOverlayVisible}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        windOverlayVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Wind Color Gradient Toggle (SCRUM-124) */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <Palette className={`w-3.5 h-3.5 ${theme.icon}`} />
                  Wind Color Gradient
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Color the map by wind speed
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Smooth gradient with a legend, drawn from the same grid as the barbs. Barbs keep a crisp outline so they stay readable.
                      On the Nautical Paper Chart base the gradient draws lighter; turning it off
                      keeps the chart's own symbols crisp.
                    </div>
                  </div>
                  <button
                    data-testid="wind-color-overlay-toggle"
                    type="button"
                    onClick={() => onToggleWindColorOverlay(!windColorOverlayVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      windColorOverlayVisible ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={windColorOverlayVisible}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        windColorOverlayVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* High contrast gradient (SCRUM-213): the chart's rule, available everywhere. */}
                <div
                  className={`mt-2 flex items-center justify-between p-2.5 rounded-lg border ${theme.subPanel}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      High contrast gradient
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Draws the gradient at the chart's lighter strength on every base. The Nautical
                      Paper Chart always does this so its soundings stay readable; turn this on for
                      the same on the other bases.
                    </div>
                  </div>
                  <button
                    data-testid="wind-color-high-contrast-toggle"
                    type="button"
                    onClick={() => onToggleWindColorHighContrast(!windColorHighContrast)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      windColorHighContrast ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={windColorHighContrast}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        windColorHighContrast ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Water Currents Toggle (SCRUM-100) */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <MoveRight className={`w-3.5 h-3.5 ${theme.icon}`} />
                  Water Currents
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Show ocean currents
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Chevrons point where the water flows, coloured by speed, and follow the selected forecast hour.
                    </div>
                  </div>
                  <button
                    data-testid="water-currents-toggle"
                    type="button"
                    onClick={() => onToggleWaterCurrents(!waterCurrentsVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      waterCurrentsVisible ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={waterCurrentsVisible}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        waterCurrentsVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <p
                  data-testid="currents-resolution-note"
                  className={`mt-2 text-xs ${theme.note}`}
                >
                  Currents come from a model with cells of about 6 to 9 km, so narrow waters such as
                  Port Susan may show no current.
                </p>
              </div>

              {/* Ocean Waves Toggle (SCRUM-234) */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <Waves className={`w-3.5 h-3.5 ${theme.icon}`} />
                  Ocean Waves
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Show wave height and direction
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Arrows point where the waves travel, sized and coloured by height, and follow
                      the selected forecast hour. They can be shown together with the currents.
                    </div>
                  </div>
                  <button
                    data-testid="waves-toggle"
                    type="button"
                    onClick={() => onToggleWaves(!wavesVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      wavesVisible ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={wavesVisible}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        wavesVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Nautical Seamarks Toggle (SCRUM-175) */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <Anchor className={`w-3.5 h-3.5 ${theme.icon}`} />
                  Nautical Seamarks
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Show buoys, beacons and lights
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      {chartBase ? (
                        SEAMARK_HIDDEN_ON_CHART
                      ) : (
                        <>
                          OpenSeaMap overlay drawn under the wind layers. {SEAMARK_ATTRIBUTION_TEXT} ·{' '}
                          {SEAMARK_NOTICE}.
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    data-testid="seamarks-toggle"
                    type="button"
                    disabled={chartBase}
                    onClick={() => onToggleSeamarks(!seamarksVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 disabled:opacity-40 disabled:cursor-not-allowed ${
                      seamarksVisible && !chartBase ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={seamarksVisible && !chartBase}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        seamarksVisible && !chartBase ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* B.C. Depth Toggle (SCRUM-205) */}
              <div className={`pt-2 border-t ${theme.headerBorder}`}>
                <label
                  className={`block text-xs font-semibold ${theme.label} uppercase tracking-wider mb-2 flex items-center gap-1.5`}
                >
                  <Layers className={`w-3.5 h-3.5 ${theme.icon}`} />
                  B.C. Depth (CHS NONNA)
                </label>
                <div
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition ${theme.option}`}
                >
                  <div>
                    <div className={`text-sm font-medium ${theme.optionTitle}`}>
                      Show bathymetry contours
                    </div>
                    <div className={`text-xs ${theme.description} mt-0.5`}>
                      Shaded depth and contours for B.C. waters, where the paper chart has no
                      coverage. Drawn under the seamarks and the wind layers. {NONNA_ATTRIBUTION_TEXT} ·{' '}
                      {NONNA_NOTICE}.
                    </div>
                    <div className={`text-xs ${theme.note} mt-1`}>{NONNA_DERIVATIVE_NOTICE}</div>
                  </div>
                  <button
                    data-testid="bc-depth-toggle"
                    type="button"
                    onClick={() => onToggleBcDepth(!bcDepthVisible)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                      bcDepthVisible ? 'bg-sky-500' : theme.toggleOff
                    }`}
                    aria-pressed={bcDepthVisible}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        bcDepthVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3 ${theme.footer} border-t flex justify-end shrink-0`}
          data-testid="map-settings-footer"
        >
          <button
            onClick={onClose}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition ${theme.footerButton}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
