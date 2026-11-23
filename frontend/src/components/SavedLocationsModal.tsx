import React from 'react';
import { SavedLocation } from '../types';
import { X, Minus, MapPin } from 'lucide-react';

interface SavedLocationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  locations: SavedLocation[];
  selectedLocationId: number | null;
  onSelectLocation: (location: SavedLocation) => void;
  onDeleteLocation: (id: number) => void;
}

export const SavedLocationsModal: React.FC<SavedLocationsModalProps> = ({
  isOpen,
  onClose,
  locations,
  selectedLocationId,
  onSelectLocation,
  onDeleteLocation,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-gray-100">Saved Locations</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-dark-700 text-gray-400">
              {locations.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-dark-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Location List */}
        <div className="p-4 overflow-y-auto flex-1 divide-y divide-dark-700/60">
          {locations.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No saved locations. Use the search bar to add one!
            </div>
          ) : (
            locations.map((loc) => {
              const isSelected = loc.id === selectedLocationId;
              return (
                <div
                  key={loc.id}
                  className={`flex items-center justify-between py-3 px-3 rounded-lg transition group ${
                    isSelected
                      ? 'bg-sky-950/40 border border-sky-800/50'
                      : 'hover:bg-dark-700/50'
                  }`}
                >
                  <button
                    onClick={() => {
                      onSelectLocation(loc);
                      onClose();
                    }}
                    className="flex-1 text-left min-w-0 pr-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-100 truncate">
                        {loc.name}
                      </span>
                      {loc.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-dark-600 text-sky-400 rounded">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {[loc.admin1, loc.country].filter(Boolean).join(', ') ||
                        `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`}
                    </div>
                  </button>

                  {/* Minus button for removal */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteLocation(loc.id);
                    }}
                    title="Remove location"
                    aria-label={`Remove ${loc.name}`}
                    className="p-1.5 rounded-md bg-red-950/30 text-red-400 hover:bg-red-900/50 hover:text-red-300 border border-red-800/30 transition flex items-center justify-center shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-dark-900 border-t border-dark-600 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-dark-700 hover:bg-dark-600 text-gray-200 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

