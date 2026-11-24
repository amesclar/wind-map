import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeocodeResult, GridWindPoint, SavedLocation, SelectedGridPoint, WeatherModelInfo } from './types';
import { fetchAppConfig, fetchModels } from './api/client';
import { DEFAULT_MODEL } from './constants';
import { useMapSettings, useTimezone, useUnitPreferences } from './hooks/useSettings';
import { useLocations } from './hooks/useLocations';
import { type Selection, useAllWeather } from './hooks/useForecast';
import { useMapExport } from './hooks/useMapExport';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { ForecastTimeSelector } from './components/ForecastTimeSelector';
import { formatStepLabel } from './utils/forecastWindow';
import { MapExportDialog } from './components/MapExportDialog';
import { SavedLocationsModal } from './components/SavedLocationsModal';
import { MapSettingsModal } from './components/MapSettingsModal';
import { PreferencesModal } from './components/PreferencesModal';
import { WeatherModelGuideModal } from './components/WeatherModelGuideModal';
import { QuotaWarningDialog } from './components/QuotaWarningDialog';

const GEOLOCATION_TIMEOUT_MS = 4000;

/** Resolve with the user's position, or null if unavailable/denied/timed out. */
function getCurrentPosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      timeout: GEOLOCATION_TIMEOUT_MS,
    });
  });
}

export const App: React.FC = () => {
  const [models, setModels] = useState<WeatherModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const { timezone, setTimezone } = useTimezone();
  const mapSettings = useMapSettings();
  const units = useUnitPreferences();
  const { locations, load: loadLocations, add: addLocation, remove: removeLocation } = useLocations();

  // Selected saved location or clicked map point (never both): it drives the marker highlight
  // and the map's fly-to, and the barb pop-up carries the point's own values (SCRUM-126).
  const [selection, setSelection] = useState<Selection | null>(null);

  // Selected forecast hour (null = now). Memory only: the app opens at "now" (SCRUM-127).
  const [forecastTime, setForecastTime] = useState<string | null>(null);

  // The map element, captured when the user saves an image (SCRUM-116).
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const allWeather = useAllWeather(selectedModel, timezone, forecastTime);

  const selectedModelInfo = models.find((m) => m.id === selectedModel) ?? null;
  const validTimeLabel = forecastTime ? formatStepLabel(forecastTime, timezone) : null;

  // Image export, range capture and their dialog state (SCRUM-174: own hook).
  const mapExport = useMapExport({
    mapContainerRef,
    forecastTime,
    setForecastTime,
    timezone,
    selectedModel,
    selectedModelInfo,
    unitSystem: units.unitSystem,
    speedUnit: units.speedUnit,
    tileLayer: mapSettings.tileLayer,
    windOverlayVisible: mapSettings.windOverlayVisible,
    windColorOverlayVisible: mapSettings.windColorOverlayVisible,
    weatherLoading: allWeather.loading,
  });

  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [isMapSettingsOpen, setIsMapSettingsOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isModelGuideOpen, setIsModelGuideOpen] = useState(false);
  // Open-Meteo quota warning: shown once per reset window, however many grid requests fail.
  const [quotaWarning, setQuotaWarning] = useState<{ resetAt: string | null } | null>(null);
  const warnedQuotaRef = useRef<string | null>(null);

  const selectedLocation = selection?.kind === 'saved' ? selection.location : null;
  const selectedGridPoint = useMemo<SelectedGridPoint | null>(
    () => (selection?.kind === 'point' ? { latitude: selection.latitude, longitude: selection.longitude } : null),
    [selection],
  );

  const selectSaved = useCallback((location: SavedLocation) => {
    setSelection({ kind: 'saved', location });
  }, []);

  // Startup: config, models, saved locations, then the user's position.
  const { applyServerConfig } = mapSettings;
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        applyServerConfig(await fetchAppConfig());
        const availableModels = await fetchModels();
        if (!cancelled) setModels(availableModels);

        const saved = await loadLocations();
        const fallback = saved[0] ?? null;
        const position = await getCurrentPosition();
        if (cancelled) return;
        if (!position) {
          if (fallback) setSelection({ kind: 'saved', location: fallback });
          return;
        }
        try {
          const here = await addLocation(
            { name: 'My Current Location', latitude: position.coords.latitude, longitude: position.coords.longitude },
            'first',
          );
          if (!cancelled) setSelection({ kind: 'saved', location: here });
        } catch {
          if (!cancelled && fallback) setSelection({ kind: 'saved', location: fallback });
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
    // Startup runs once. applyServerConfig changes identity when the user saves a CARTO
    // key, and re-running startup then would re-add "My Current Location".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectAndAddLocation = useCallback(
    async (result: GeocodeResult) => {
      try {
        const created = await addLocation({
          name: result.name,
          latitude: result.latitude,
          longitude: result.longitude,
          admin1: result.admin1,
          country: result.country,
        });
        selectSaved(created);
      } catch (err) {
        console.error('Failed to add location:', err);
      }
    },
    [addLocation, selectSaved],
  );

  const handleDeleteLocation = useCallback(
    async (id: number) => {
      try {
        const remaining = await removeLocation(id);
        allWeather.remove(id);
        if (selectedLocation?.id === id) {
          setSelection(remaining[0] ? { kind: 'saved', location: remaining[0] } : null);
        }
      } catch (err) {
        console.error('Failed to delete location:', err);
      }
    },
    [removeLocation, allWeather, selectedLocation?.id],
  );

  const handleGridPointSelect = useCallback((pt: GridWindPoint) => {
    setSelection({ kind: 'point', latitude: pt.latitude, longitude: pt.longitude });
  }, []);

  /** Show the quota dialog once per reset instant; panning must not reopen a dismissed one. */
  const handleGridQuotaExhausted = useCallback((resetAt: string | null) => {
    const key = resetAt ?? 'unknown';
    if (warnedQuotaRef.current === key) return;
    warnedQuotaRef.current = key;
    setQuotaWarning({ resetAt });
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-900 text-gray-100 overflow-hidden font-sans">
      <Navbar
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        savedLocationsCount={locations.length}
        onOpenSavedLocations={() => setIsLocationsModalOpen(true)}
        onSelectAndAddLocation={handleSelectAndAddLocation}
        onOpenMapSettings={() => setIsMapSettingsOpen(true)}
        onOpenPreferences={() => setIsPreferencesOpen(true)}
        onOpenModelGuide={() => setIsModelGuideOpen(true)}
        hasCartoKey={Boolean(mapSettings.cartoApiKey)}
        onOpenExportDialog={mapExport.openDialog}
        savingMap={mapExport.savingMap}
      />

      <main className="flex-1 flex flex-col min-h-0 w-full">
        <div className="relative flex-1 min-h-0">
          <MapView
            locations={locations}
            selectedLocation={selectedLocation}
            onSelectLocation={selectSaved}
            weatherMap={allWeather.weatherMap}
            tileLayerType={mapSettings.tileLayer}
            cartoApiKey={mapSettings.cartoApiKey}
            selectedModel={selectedModel}
            windOverlayVisible={mapSettings.windOverlayVisible}
            windColorOverlayVisible={mapSettings.windColorOverlayVisible}
            waterCurrentsVisible={mapSettings.waterCurrentsVisible}
            selectedGridPoint={selectedGridPoint}
            onGridPointSelect={handleGridPointSelect}
            unitSystem={units.unitSystem}
            speedUnit={units.speedUnit}
            dirDisplay={units.dirDisplay}
            validTime={forecastTime}
            validTimeLabel={validTimeLabel}
            containerRef={mapContainerRef}
            onGridLoaded={mapExport.handleGridLoaded}
            onGridQuotaExhausted={handleGridQuotaExhausted}
          />
        </div>
        <ForecastTimeSelector
          model={selectedModelInfo}
          forecastTime={forecastTime}
          onChange={setForecastTime}
          timezone={timezone}
          loading={allWeather.loading}
        />
      </main>

      <SavedLocationsModal
        isOpen={isLocationsModalOpen}
        onClose={() => setIsLocationsModalOpen(false)}
        locations={locations}
        selectedLocationId={selectedLocation?.id ?? null}
        onSelectLocation={selectSaved}
        onDeleteLocation={handleDeleteLocation}
      />

      <MapSettingsModal
        isOpen={isMapSettingsOpen}
        onClose={() => setIsMapSettingsOpen(false)}
        tileLayer={mapSettings.tileLayer}
        onChangeTileLayer={mapSettings.setTileLayer}
        cartoApiKey={mapSettings.cartoApiKey}
        onSaveCartoApiKey={mapSettings.saveCartoApiKey}
        windOverlayVisible={mapSettings.windOverlayVisible}
        onToggleWindOverlay={mapSettings.setWindOverlayVisible}
        windColorOverlayVisible={mapSettings.windColorOverlayVisible}
        onToggleWindColorOverlay={mapSettings.setWindColorOverlayVisible}
      />

      <WeatherModelGuideModal
        isOpen={isModelGuideOpen}
        onClose={() => setIsModelGuideOpen(false)}
      />

      <QuotaWarningDialog
        isOpen={quotaWarning !== null}
        resetAt={quotaWarning?.resetAt ?? null}
        timezone={timezone}
        onClose={() => setQuotaWarning(null)}
      />

      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        timezone={timezone}
        onSelectTimezone={setTimezone}
        unitSystem={units.unitSystem}
        onSelectUnitSystem={units.setUnitSystem}
        speedUnit={units.speedUnit}
        onSelectSpeedUnit={units.setSpeedUnit}
        dirDisplay={units.dirDisplay}
        onSelectDirDisplay={units.setDirDisplay}
      />

      <MapExportDialog
        isOpen={mapExport.isDialogOpen}
        onClose={mapExport.closeDialog}
        onExport={mapExport.handleExport}
        fileBaseName={mapExport.fileBaseName}
        busy={mapExport.savingMap}
        timezone={timezone}
        rangeHours={mapExport.rangeHours}
        progress={mapExport.rangeProgress}
        error={mapExport.rangeError}
        onCancelRange={mapExport.handleCancelRange}
        onSaveCaptured={mapExport.handleSaveCaptured}
      />
    </div>
  );
};

export default App;
