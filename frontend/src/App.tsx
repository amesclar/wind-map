import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  fetchPointWeather,
} from './api/client';
import type { GridWindPoint, SelectedGridPoint } from './types';
import { DEFAULT_MODEL, DEFAULT_TIMEZONE, STORAGE_KEYS } from './constants';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { TimelineDrawer } from './components/TimelineDrawer';
import { SavedLocationsModal } from './components/SavedLocationsModal';
import { MapSettingsModal } from './components/MapSettingsModal';

export const App: React.FC = () => {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);
  const [models, setModels] = useState<WeatherModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);

  // Map Tile & API Key settings
  const [tileLayerType, setTileLayerType] = useState<MapTileLayer>(() => {
    return (localStorage.getItem(STORAGE_KEYS.tileLayer) as MapTileLayer) || 'osm_dark';
  });
  const [cartoApiKey, setCartoApiKey] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.cartoApiKey) || '';
  });
  const [isMapSettingsOpen, setIsMapSettingsOpen] = useState(false);

  // Wind grid overlay visibility — default on, persisted to localStorage
  const [windOverlayVisible, setWindOverlayVisible] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.windOverlayVisible);
    return stored === null ? true : stored === 'true';
  });

  // Selected ephemeral grid point (grid barb click) — cleared when a saved location is selected
  const [selectedGridPoint, setSelectedGridPoint] = useState<SelectedGridPoint | null>(null);

  // Units
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [speedUnit, setSpeedUnit] = useState<WindSpeedUnit>('knots');
  const [dirDisplay, setDirDisplay] = useState<WindDirDisplay>('barb');

  // Weather data
  const [weatherMap, setWeatherMap] = useState<Record<number, WeatherForecastResponse>>({});
  const [selectedWeather, setSelectedWeather] = useState<WeatherForecastResponse | null>(null);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);

  // Monotonic id of the latest drawer weather request; stale responses are dropped.
  const weatherRequestRef = useRef(0);

  // Modals
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);

  // Load weather for a specific location (drives the timeline drawer)
  const loadWeatherForLocation = useCallback(
    async (locationId: number, model: string, tz: string) => {
      const requestId = ++weatherRequestRef.current;
      setIsTimelineLoading(true);
      try {
        const data = await fetchWeather(locationId, model, tz);
        setWeatherMap((prev) => ({ ...prev, [locationId]: data }));
        // Ignore stale responses (e.g. a grid barb was clicked while this was in flight)
        if (requestId === weatherRequestRef.current) setSelectedWeather(data);
      } catch (err) {
        console.error('Failed to load weather:', err);
      } finally {
        if (requestId === weatherRequestRef.current) setIsTimelineLoading(false);
      }
    },
    []
  );

  // Refresh wind barb markers for all saved locations (background, no loading state)
  const loadAllWeather = useCallback(async (model: string, tz: string) => {
    try {
      const allW = await fetchAllWeather(model, tz);
      setWeatherMap((prev) => {
        const updated = { ...prev };
        allW.forEach((w) => { updated[w.location_id] = w; });
        return updated;
      });
    } catch (err) {
      console.error('Failed to refresh all weather:', err);
    }
  }, []);

  // Initial load: config, models, locations, weather for all markers
  useEffect(() => {
    async function init() {
      try {
        const cfg = await fetchAppConfig();
        if (cfg.carto_api_key && !localStorage.getItem(STORAGE_KEYS.cartoApiKey)) {
          setCartoApiKey(cfg.carto_api_key);
          setTileLayerType('carto_dark');
        }

        const availableModels = await fetchModels();
        setModels(availableModels);

        const saved = await fetchLocations();
        setLocations(saved);

        const initialLoc = saved.length > 0 ? saved[0] : null;

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

        // Use current selectedModel / timezone (defaults at mount time)
        const allW = await fetchAllWeather(DEFAULT_MODEL, DEFAULT_TIMEZONE);
        const mapObj: Record<number, WeatherForecastResponse> = {};
        allW.forEach((w) => { mapObj[w.location_id] = w; });
        setWeatherMap(mapObj);

        if (initialLoc && mapObj[initialLoc.id] && weatherRequestRef.current === 0) {
          setSelectedWeather(mapObj[initialLoc.id]);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }
    init();
  }, []);

  // Whenever the selected location changes, refresh its forecast
  useEffect(() => {
    if (selectedLocation) {
      loadWeatherForLocation(selectedLocation.id, selectedModel, timezone);
    }
    // Intentionally keyed on the location id only: model/timezone changes are handled by
    // the effect below. Replaced by useForecast in SCRUM-92 phase 5 (F1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation?.id, loadWeatherForLocation]);

  // When model or timezone changes, refresh both the drawer and all markers.
  // Skipped on mount: init() already loads all weather (SCRUM-92: avoid a duplicate fetch).
  const isFirstModelTzRun = useRef(true);
  useEffect(() => {
    if (isFirstModelTzRun.current) {
      isFirstModelTzRun.current = false;
      return;
    }
    if (selectedLocation) {
      loadWeatherForLocation(selectedLocation.id, selectedModel, timezone);
    }
    loadAllWeather(selectedModel, timezone);
    // Intentionally not keyed on selectedLocation: selection changes are handled by the
    // effect above. Replaced by useForecast in SCRUM-92 phase 5 (F1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, timezone, loadWeatherForLocation, loadAllWeather]);

  const handleSelectLocation = (loc: SavedLocation) => {
    setSelectedGridPoint(null); // clear ephemeral grid barb selection
    if (weatherMap[loc.id]) setSelectedWeather(weatherMap[loc.id]);
    if (selectedLocation?.id === loc.id) {
      loadWeatherForLocation(loc.id, selectedModel, timezone);
    } else {
      setSelectedLocation(loc);
    }
  };

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
      setSelectedGridPoint(null);
      if (selectedLocation?.id === created.id) {
        // Same location (e.g. the backend matched an existing one): the selection effect
        // won't fire, so refresh explicitly.
        loadWeatherForLocation(created.id, selectedModel, timezone);
      } else {
        // The selectedLocation effect loads the forecast (SCRUM-92: avoid a duplicate fetch).
        setSelectedLocation(created);
      }
    } catch (err) {
      console.error('Failed to add location:', err);
    }
  };

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

  const handleToggleUnitSystem = () => {
    if (unitSystem === 'imperial') {
      setUnitSystem('metric');
      setSpeedUnit('kmh');
    } else {
      setUnitSystem('imperial');
      setSpeedUnit('knots');
    }
  };

  const handleSaveCartoApiKey = (key: string) => {
    setCartoApiKey(key);
    if (key) {
      localStorage.setItem(STORAGE_KEYS.cartoApiKey, key);
      setTileLayerType('carto_dark');
      localStorage.setItem(STORAGE_KEYS.tileLayer, 'carto_dark');
    } else {
      localStorage.removeItem(STORAGE_KEYS.cartoApiKey);
    }
  };

  const handleChangeTileLayer = (layer: MapTileLayer) => {
    setTileLayerType(layer);
    localStorage.setItem(STORAGE_KEYS.tileLayer, layer);
  };

  const handleToggleWindOverlay = (visible: boolean) => {
    setWindOverlayVisible(visible);
    localStorage.setItem(STORAGE_KEYS.windOverlayVisible, String(visible));
  };

  const handleGridPointSelect = useCallback(async (pt: GridWindPoint) => {
    const requestId = ++weatherRequestRef.current;
    setSelectedGridPoint({ latitude: pt.latitude, longitude: pt.longitude });
    // Clear the saved selection so the drawer header uses the point's own name/coordinates.
    setSelectedLocation(null);
    setIsTimelineLoading(true);
    try {
      const data = await fetchPointWeather(pt.latitude, pt.longitude, selectedModel, timezone);
      if (requestId === weatherRequestRef.current) setSelectedWeather(data);
    } catch (err) {
      console.error('Failed to load point weather:', err);
    } finally {
      if (requestId === weatherRequestRef.current) setIsTimelineLoading(false);
    }
  }, [selectedModel, timezone]);

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-900 text-gray-100 overflow-hidden font-sans">
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

      <main className="flex-1 relative w-full h-[calc(100vh-56px)]">
        <MapView
          locations={locations}
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectLocation}
          weatherMap={weatherMap}
          tileLayerType={tileLayerType}
          cartoApiKey={cartoApiKey}
          selectedModel={selectedModel}
          windOverlayVisible={windOverlayVisible}
          selectedGridPoint={selectedGridPoint}
          onGridPointSelect={handleGridPointSelect}
          unitSystem={unitSystem}
          speedUnit={speedUnit}
        />

        <TimelineDrawer
          selectedLocation={selectedLocation}
          weatherData={selectedWeather}
          isLoading={isTimelineLoading}
          unitSystem={unitSystem}
          speedUnit={speedUnit}
          dirDisplay={dirDisplay}
        />
      </main>

      <SavedLocationsModal
        isOpen={isLocationsModalOpen}
        onClose={() => setIsLocationsModalOpen(false)}
        locations={locations}
        selectedLocationId={selectedLocation?.id ?? null}
        onSelectLocation={handleSelectLocation}
        onDeleteLocation={handleDeleteLocation}
      />

      <MapSettingsModal
        isOpen={isMapSettingsOpen}
        onClose={() => setIsMapSettingsOpen(false)}
        tileLayer={tileLayerType}
        onChangeTileLayer={handleChangeTileLayer}
        cartoApiKey={cartoApiKey}
        onSaveCartoApiKey={handleSaveCartoApiKey}
        windOverlayVisible={windOverlayVisible}
        onToggleWindOverlay={handleToggleWindOverlay}
      />
    </div>
  );
};

export default App;
