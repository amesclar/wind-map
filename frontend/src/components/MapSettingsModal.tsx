import React, { useState } from 'react';
import { X, Key, Map, ExternalLink, Check, AlertCircle, Wind, Palette } from 'lucide-react';
import { MapTileLayer } from '../types';

interface MapSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tileLayer: MapTileLayer;
  onChangeTileLayer: (layer: MapTileLayer) => void;
  cartoApiKey: string;
  onSaveCartoApiKey: (key: string) => void;
  windOverlayVisible: boolean;
  onToggleWindOverlay: (visible: boolean) => void;
  windColorOverlayVisible: boolean;
  onToggleWindColorOverlay: (visible: boolean) => void;
}

export const MapSettingsModal: React.FC<MapSettingsModalProps> = ({
  isOpen,
  onClose,
  tileLayer,
  onChangeTileLayer,
  cartoApiKey,
  onSaveCartoApiKey,
  windOverlayVisible,
  onToggleWindOverlay,
  windColorOverlayVisible,
  onToggleWindColorOverlay,
}) => {
  const [inputKey, setInputKey] = useState(cartoApiKey);
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCartoApiKey(inputKey.trim());
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <Map className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-gray-100">Map Settings & API Key</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Tile Layer Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
              Base Map Style
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-2.5 rounded-lg border border-dark-600 hover:bg-dark-700/50 cursor-pointer transition">
                <input
                  type="radio"
                  name="tileLayer"
                  checked={tileLayer === 'osm_dark'}
                  onChange={() => onChangeTileLayer('osm_dark')}
                  className="mt-0.5 text-sky-500 focus:ring-sky-500"
                />
                <div>
                  <div className="text-xs font-medium text-gray-100 flex items-center gap-2">
                    OpenStreetMap Dark
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40">
                      Free • No Key Needed
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Clean, high-contrast dark theme without any watermark or API key limits.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-lg border border-dark-600 hover:bg-dark-700/50 cursor-pointer transition">
                <input
                  type="radio"
                  name="tileLayer"
                  checked={tileLayer === 'carto_dark'}
                  onChange={() => onChangeTileLayer('carto_dark')}
                  className="mt-0.5 text-sky-500 focus:ring-sky-500"
                />
                <div>
                  <div className="text-xs font-medium text-gray-100 flex items-center gap-2">
                    CARTO Dark Matter
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800/40">
                      API Key Required
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    CARTO requires an API key to remove the "API KEY REQUIRED" watermark.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-lg border border-dark-600 hover:bg-dark-700/50 cursor-pointer transition">
                <input
                  type="radio"
                  name="tileLayer"
                  checked={tileLayer === 'osm_standard'}
                  onChange={() => onChangeTileLayer('osm_standard')}
                  className="mt-0.5 text-sky-500 focus:ring-sky-500"
                />
                <div>
                  <div className="text-xs font-medium text-gray-100">
                    OpenStreetMap Standard (Light)
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Default light road map, completely keyless.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Wind Grid Overlay Toggle */}
          <div className="pt-2 border-t border-dark-600/70">
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Wind className="w-3.5 h-3.5 text-sky-400" />
              Wind Grid Overlay
            </label>
            <div className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 hover:bg-dark-700/50 transition">
              <div>
                <div className="text-xs font-medium text-gray-100">
                  Show wind barbs across map
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Displays a continuous grid of wind direction and speed indicators over the visible viewport.
                </div>
              </div>
              <button
                data-testid="wind-overlay-toggle"
                type="button"
                onClick={() => onToggleWindOverlay(!windOverlayVisible)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                  windOverlayVisible ? 'bg-sky-500' : 'bg-dark-600'
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
          <div className="pt-2 border-t border-dark-600/70">
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-sky-400" />
              Wind Color Gradient
            </label>
            <div className="flex items-center justify-between p-2.5 rounded-lg border border-dark-600 hover:bg-dark-700/50 transition">
              <div>
                <div className="text-xs font-medium text-gray-100">
                  Color the map by wind speed
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Smooth gradient with a legend, drawn from the same grid as the barbs. Barbs gain a dark halo to stay readable.
                </div>
              </div>
              <button
                data-testid="wind-color-overlay-toggle"
                type="button"
                onClick={() => onToggleWindColorOverlay(!windColorOverlayVisible)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-hidden ml-3 ${
                  windColorOverlayVisible ? 'bg-sky-500' : 'bg-dark-600'
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
          </div>

          {/* CARTO API Key Section */}
          <div className="pt-2 border-t border-dark-600/70">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-sky-400" />
                CARTO API Key
              </label>
              <a
                href="https://carto.com/basemaps/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 hover:underline"
              >
                <span>Get free key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <p className="text-[11px] text-gray-400 mb-2.5">
              Get an instant free key from CARTO (up to 5 million requests/month) and paste it below to unlock watermark-free CARTO tiles.
            </p>

            <form onSubmit={handleSave} className="space-y-2.5">
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="Paste CARTO API Key here..."
                className="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-xs font-mono text-gray-100 placeholder:text-gray-500 focus:outline-hidden focus:border-sky-500"
              />

              <div className="flex items-center justify-between">
                <div className="text-[11px]">
                  {cartoApiKey ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Key active
                    </span>
                  ) : (
                    <span className="text-gray-500 flex items-center gap-1">
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
                      className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/40 rounded transition"
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

        {/* Footer */}
        <div className="px-5 py-3 bg-dark-900 border-t border-dark-600 flex justify-end">
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

