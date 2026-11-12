import React, { useState, useEffect, useCallback } from 'react';
import {
  SavedLocation,
  WeatherModel,
  WeatherForecastResponse,
  UnitSystem,
  WindSpeedUnit,
  WindDirDisplay,
  GeocodeResult,
  MapTileLayer,
} from './types';
import {
  fetchLocations,
  addLocation,
  deleteLocation,
  fetchModels,
  fetchWeather,
  fetchAllWeather,
  fetchAppConfig,
} from './api/client';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { TimelineDrawer } from './components/TimelineDrawer';
import { SavedLocationsModal } from './components/SavedLocationsModal';
import { MapSettingsModal } from './components/MapSettingsModal';

export const App: React.FC = () => {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);
  const [models, setModels] = useState<WeatherModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('best_match');
  const [timezone, setTimezone] = useState<string>('America/Los_Angeles');

  // Map Tile & API Key settings
  const [tileLayerType, setTileLayerType] = useState<MapTileLayer>(() => {
    return (localStorage.getItem('map_tile_layer') as MapTileLayer) || 'osm_dark';
  });
  const [cartoApiKey, setCartoApiKey] = useState<string>(() => {
    return localStorage.getItem('carto_api_key') || '';
  });
  const [isMapSettingsOpen, setIsMapSettingsOpen] = useState(false);

  // Units
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [speedUnit, setSpeedUnit] = useState<WindSpeedUnit>('knots');
  const [dirDisplay, setDirDisplay] = useState<WindDirDisplay>('barb');

  // Weather data
  const [weatherMap, setWeatherMap] = useState<Record<number, WeatherForecastResponse>>({});
  const [selectedWeather, setSelectedWeather] = useState<WeatherForecastResponse | null>(null);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);

  // Modals
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);

  // Load weather for a specific location
  const loadWeatherForLocation = useCallback(
    async (locationId: number, model: string, tz: string) => {
      setIsTimelineLoading(true);
      try {
        const data = await fetchWeather(locationId, model, tz);
        setSelectedWeather(data);
        setWeatherMap((prev) => ({ ...prev, [locationId]: data }));
      } catch (err) {
        console.error('Failed to load weather:', err);
      } finally {
        setIsTimelineLoading(false);
      }
    },
    []
  );

  // Load initial data and geolocation
  useEffect(() => {
    async function init() {
      try {
        // Fetch server config for CARTO API Key
        const cfg = await fetchAppConfig();
        if (cfg.carto_api_key && !localStorage.getItem('carto_api_key')) {
          setCartoApiKey(cfg.carto_api_key);
          setTileLayerType('carto_dark');
        }

        // Load models
        const availableModels = await fetchModels();
        setModels(availableModels);

        // Load saved locations
        const saved = await fetchLocations();
        setLocations(saved);

        let initialLoc = saved.length > 0 ? saved[0] : null;

        // Try HTML5 geolocation if available
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              try {
                const userLoc = await addLocation({
                  name: 'My Current Location',
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                });
                setLocations((prev) => {
                  const exists = prev.some((l) => l.id === userLoc.id);
                  return exists ? prev : [userLoc, ...prev];
                });
                setSelectedLocation(userLoc);
              } catch {
                if (initialLoc) setSelectedLocation(initialLoc);
              }
            },
            () => {
              if (initialLoc) setSelectedLocation(initialLoc);
            },
            { timeout: 4000 }
          );
        } else if (initialLoc) {
          setSelectedLocation(initialLoc);
        }

        // Fetch all weather for markers
        const allW = await fetchAllWeather('best_match', 'America/Los_Angeles');
        const mapObj: Record<number, WeatherForecastResponse> = {};
        allW.forEach((w) => {
          mapObj[w.location_id] = w;
        });
        setWeatherMap(mapObj);
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }
    init();
  }, []);

  // Whenever selected location, model, or timezone changes, refresh forecast
  useEffect(() => {
    if (selectedLocation) {
      loadWeatherForLocation(selectedLocation.id, selectedModel, timezone);
    }
  }, [selectedLocation, selectedModel, timezone, loadWeatherForLocation]);

  // Handle location selection
  const handleSelectLocation = (loc: SavedLocation) => {
    setSelectedLocation(loc);
  };

  // Handle add location from autocomplete
  const handleSelectAndAddLocation = async (result: GeocodeResult) => {
    try {
      const created = await addLocation({
        name: result.name,
        latitude: result.latitude,
        longitude: result.longitude,
        admin1: result.admin1,
        country: result.country,
      });

      setLocations((prev) => {
        const filtered = prev.filter((l) => l.id !== created.id);
        return [...filtered, created];
      });

      setSelectedLocation(created);
    } catch (err) {
      console.error('Failed to add location:', err);
    }
  };

  // Handle delete location
  const handleDeleteLocation = async (id: number) => {
    try {
      await deleteLocation(id);
      setLocations((prev) => prev.filter((l) => l.id !== id));
      setWeatherMap((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

      if (selectedLocation?.id === id) {
        const remaining = locations.filter((l) => l.id !== id);
        if (remaining.length > 0) {
          setSelectedLocation(remaining[0]);
        } else {
          setSelectedLocation(null);
          setSelectedWeather(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete location:', err);
    }
  };

  // Toggle unit system between Metric and Imperial
  const handleToggleUnitSystem = () => {
    if (unitSystem === 'imperial') {
      setUnitSystem('metric');
      setSpeedUnit('kmh');
    } else {
      setUnitSystem('imperial');
      setSpeedUnit('knots');
    }
  };

  // Handle saving CARTO API Key
  const handleSaveCartoApiKey = (key: string) => {
    setCartoApiKey(key);
    if (key) {
      localStorage.setItem('carto_api_key', key);
      setTileLayerType('carto_dark');
      localStorage.setItem('map_tile_layer', 'carto_dark');
    } else {
      localStorage.removeItem('carto_api_key');
    }
  };

  // Handle changing map tile layer
  const handleChangeTileLayer = (layer: MapTileLayer) => {
    setTileLayerType(layer);
    localStorage.setItem('map_tile_layer', layer);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-900 text-gray-100 overflow-hidden font-sans">
      {/* Top Navbar */}
      <Navbar
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        timezone={timezone}
        onSelectTimezone={setTimezone}
        unitSystem={unitSystem}
        onToggleUnitSystem={handleToggleUnitSystem}
        speedUnit={speedUnit}
        onSelectSpeedUnit={setSpeedUnit}
        dirDisplay={dirDisplay}
        onSelectDirDisplay={setDirDisplay}
        savedLocationsCount={locations.length}
        onOpenSavedLocations={() => setIsLocationsModalOpen(true)}
        onSelectAndAddLocation={handleSelectAndAddLocation}
        onOpenMapSettings={() => setIsMapSettingsOpen(true)}
        hasCartoKey={Boolean(cartoApiKey)}
      />

      {/* Main Map View */}
      <main className="flex-1 relative w-full h-[calc(100vh-56px)]">
        <MapView
          locations={locations}
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectLocation}
          weatherMap={weatherMap}
          tileLayerType={tileLayerType}
          cartoApiKey={cartoApiKey}
        />

        {/* Bottom Timeline Drawer */}
        <TimelineDrawer
          weatherData={selectedWeather}
          isLoading={isTimelineLoading}
          unitSystem={unitSystem}
          speedUnit={speedUnit}
          dirDisplay={dirDisplay}
        />
      </main>

      {/* Saved Locations Modal */}
      <SavedLocationsModal
        isOpen={isLocationsModalOpen}
        onClose={() => setIsLocationsModalOpen(false)}
        locations={locations}
        selectedLocationId={selectedLocation?.id ?? null}
        onSelectLocation={handleSelectLocation}
        onDeleteLocation={handleDeleteLocation}
      />

      {/* Map Settings & API Key Modal */}
      <MapSettingsModal
        isOpen={isMapSettingsOpen}
        onClose={() => setIsMapSettingsOpen(false)}
        tileLayer={tileLayerType}
        onChangeTileLayer={handleChangeTileLayer}
        cartoApiKey={cartoApiKey}
        onSaveCartoApiKey={handleSaveCartoApiKey}
      />
    </div>
  );
};

export default App;
