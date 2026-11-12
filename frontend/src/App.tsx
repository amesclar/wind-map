import React, { useState, useEffect, useCallback } from 'react';
import {
  SavedLocation,
  WeatherModel,
  WeatherForecastResponse,
  UnitSystem,
  WindSpeedUnit,
  WindDirDisplay,
  GeocodeResult,
} from './types';
import {
  fetchLocations,
  addLocation,
  deleteLocation,
  fetchModels,
  fetchWeather,
  fetchAllWeather,
} from './api/client';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { TimelineDrawer } from './components/TimelineDrawer';
import { SavedLocationsModal } from './components/SavedLocationsModal';

export const App: React.FC = () => {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);
  const [models, setModels] = useState<WeatherModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('best_match');
  const [timezone, setTimezone] = useState<string>('America/Los_Angeles');

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
                // If geocoding add fails, fall back to default
                if (initialLoc) setSelectedLocation(initialLoc);
              }
            },
            () => {
              // Geolocation denied or unavailable -> use Oak Harbor default
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
      />

      {/* Main Map View */}
      <main className="flex-1 relative w-full h-[calc(100vh-56px)]">
        <MapView
          locations={locations}
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectLocation}
          weatherMap={weatherMap}
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
    </div>
  );
};

export default App;
