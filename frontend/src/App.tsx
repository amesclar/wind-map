import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeocodeResult, GridWindPoint, SavedLocation, SelectedGridPoint, WeatherModelInfo } from './types';
import { fetchAppConfig, fetchModels } from './api/client';
import { DEFAULT_MODEL } from './constants';
import { useMapSettings, useTimezone, useUnitPreferences } from './hooks/useSettings';
import { useLocations } from './hooks/useLocations';
import { type Selection, useAllWeather } from './hooks/useForecast';
import { useDataRefresh } from './hooks/useDataRefresh';
import { useMapExport } from './hooks/useMapExport';
import { useModelAvailability } from './hooks/useModelAvailability';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { ForecastTimeSelector } from './components/ForecastTimeSelector';
import { formatStepLabel } from './utils/forecastWindow';
import { buildRefreshHint } from './utils/refreshHint';
import {
  GOOGLE_MAP_EXPORT_DISABLED_REASON,
  GOOGLE_MAP_EXPORT_DISABLED_TOOLTIP,
} from './components/mapTiles';
import { MapExportDialog } from './components/MapExportDialog';
import { SavedLocationsModal } from './components/SavedLocationsModal';
import { MapSettingsModal } from './components/MapSettingsModal';
import { PreferencesModal } from './components/PreferencesModal';
import { FeedbackModal } from './components/FeedbackModal';
import { QuotaWarningDialog } from './components/QuotaWarningDialog';

const GEOLOCATION_TIMEOUT_MS = 4000;
/** Longest a refresh click keeps the button busy waiting for its responses (SCRUM-113). */
const REFRESH_TIMEOUT_MS = 20_000;

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

  // Where the map looks at startup, separate from what is selected (SCRUM-248): the app opens
  // centred on the current location, but no marker is highlighted and no pop-up opens.
  const [focus, setFocus] = useState<SavedLocation | null>(null);

  // Selected forecast hour (null = now). Memory only: the app opens at "now" (SCRUM-127).
  const [forecastTime, setForecastTime] = useState<string | null>(null);

  // The map element, captured when the user saves an image (SCRUM-116).
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // One-shot refresh (SCRUM-113): a click bumps this, and the fetches below send `refresh` once.
  const [refreshSeq, setRefreshSeq] = useState(0);
  const allWeather = useAllWeather(selectedModel, timezone, forecastTime, refreshSeq);

  const selectedModelInfo = models.find((m) => m.id === selectedModel) ?? null;
  // Publication times of the selected model, when Open-Meteo exposes them (SCRUM-256).
  const modelAvailability = useModelAvailability(selectedModel);
  const validTimeLabel = forecastTime ? formatStepLabel(forecastTime, timezone) : null;

  // The gate reads the newest server `cached_at` among the responses on screen, so it never
  // trusts the browser's clock about how old the data is (SCRUM-113).
  const dataAsOf = useMemo(() => {
    const stamps = Object.values(allWeather.weatherMap).map((w) => w.cached_at * 1000);
    return stamps.length ? Math.max(...stamps) : null;
  }, [allWeather.weatherMap]);
  // The published run is the real clock; the derived cycle is the fallback (SCRUM-256).
  const refreshRunUtc = modelAvailability?.available_utc ?? selectedModelInfo?.last_run_utc ?? null;
  const nextRunUtc = modelAvailability?.next_available_utc ?? selectedModelInfo?.next_run_utc ?? null;

  const pendingRefresh = useRef<{ sawLoading: boolean; timer: ReturnType<typeof setTimeout>; resolve: () => void } | null>(
    null,
  );
  const finishRefresh = useCallback(() => {
    const pending = pendingRefresh.current;
    if (!pending) return;
    pendingRefresh.current = null;
    clearTimeout(pending.timer);
    pending.resolve();
  }, []);
  // Resolves when the refreshed responses have landed, so the button stays busy meanwhile.
  const handleRefresh = useCallback((): Promise<void> => {
    if (pendingRefresh.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(finishRefresh, REFRESH_TIMEOUT_MS);
      pendingRefresh.current = { sawLoading: false, timer, resolve };
      setRefreshSeq((seq) => seq + 1);
    });
  }, [finishRefresh]);

  const dataRefresh = useDataRefresh({ dataAsOf, runUtc: refreshRunUtc, onRefresh: handleRefresh });

  useEffect(() => {
    const pending = pendingRefresh.current;
    if (!pending) return;
    if (allWeather.loading) {
      pending.sawLoading = true;
      return;
    }
    if (pending.sawLoading) finishRefresh();
  }, [allWeather.loading, finishRefresh]);

  // The disabled button's hint (SCRUM-257): four truthful states, and never a run time it lacks.
  const refreshHint = buildRefreshHint({
    refreshing: dataRefresh.refreshing,
    canRefresh: dataRefresh.canRefresh,
    dataAsOf,
    nextRunUtc,
    timezone,
  });
  const refreshError =
    dataRefresh.error ?? (allWeather.error ? 'Could not refresh from the source; the data on screen is unchanged.' : null);

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
    bcDepthVisible: mapSettings.bcDepthVisible,
    seamarksVisible: mapSettings.seamarksVisible,
    wavesVisible: mapSettings.wavesVisible,
    weatherLoading: allWeather.loading,
  });

  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [isMapSettingsOpen, setIsMapSettingsOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  // The server holds a Google Maps key, so the hybrid base map can be offered (SCRUM-311).
  const [googleSatelliteEnabled, setGoogleSatelliteEnabled] = useState(false);
  // Open-Meteo quota warning: shown once per reset window, however many grid requests fail.
  const [quotaWarning, setQuotaWarning] = useState<{ resetAt: string | null } | null>(null);
  const warnedQuotaRef = useRef<string | null>(null);

  const selectedLocation = selection?.kind === 'saved' ? selection.location : null;
  const selectedGridPoint = useMemo<SelectedGridPoint | null>(
    () => (selection?.kind === 'point' ? { latitude: selection.latitude, longitude: selection.longitude } : null),
    [selection],
  );

  const selectSaved = useCallback((location: SavedLocation) => {
    // A user selection owns the map from now on, so the startup focus is no longer needed.
    setFocus(null);
    setSelection({ kind: 'saved', location });
  }, []);

  // Startup: config, models, saved locations and the user's position.
  const { applyServerConfig } = mapSettings;
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // The four independent requests go out together (SCRUM-284): they used to run strictly in
        // series, so the map focus and the model selector waited for the sum of every round trip —
        // each of which is a Basic Auth challenge on the public deployment.
        const positionPromise = getCurrentPosition();
        const [config, availableModels, saved] = await Promise.all([
          fetchAppConfig(),
          fetchModels(),
          loadLocations(),
        ]);
        if (cancelled) return;
        // Config still lands before the map needs the CARTO key; it just no longer holds up the
        // other two requests.
        applyServerConfig(config);
        setFeedbackEnabled(Boolean(config.feedback_enabled));
        setGoogleSatelliteEnabled(Boolean(config.google_satellite_enabled));
        setModels(availableModels);

        const fallback = saved[0] ?? null;
        const position = await positionPromise;
        if (cancelled) return;
        // Startup only focuses the map: selecting here would open a details pop-up the user
        // never asked for (SCRUM-248).
        if (!position) {
          if (fallback) setFocus(fallback);
          return;
        }
        try {
          const here = await addLocation(
            { name: 'My Current Location', latitude: position.coords.latitude, longitude: position.coords.longitude },
            'first',
          );
          if (!cancelled) setFocus(here);
        } catch {
          if (!cancelled && fallback) setFocus(fallback);
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
        await removeLocation(id);
        allWeather.remove(id);
        // Deleting is a removal, never a selection: the highlight goes and no other
        // location's pop-up opens (SCRUM-248).
        if (selectedLocation?.id === id) setSelection(null);
        if (focus?.id === id) setFocus(null);
      } catch (err) {
        console.error('Failed to delete location:', err);
      }
    },
    [removeLocation, allWeather, selectedLocation?.id, focus?.id],
  );

  const handleGridPointSelect = useCallback((pt: GridWindPoint) => {
    setFocus(null);
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
        hasCartoKey={Boolean(mapSettings.cartoApiKey)}
        onOpenExportDialog={mapExport.openDialog}
        savingMap={mapExport.savingMap}
        exportDisabled={mapSettings.tileLayer === 'google_satellite'}
        exportDisabledTooltip={GOOGLE_MAP_EXPORT_DISABLED_TOOLTIP}
        feedbackEnabled={feedbackEnabled}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
        onRefresh={dataRefresh.refresh}
        canRefresh={dataRefresh.canRefresh}
        refreshing={dataRefresh.refreshing}
        refreshHint={refreshHint}
        refreshError={refreshError}
      />

      <main className="flex-1 flex flex-col min-h-0 w-full">
        <div className="relative flex-1 min-h-0">
          <MapView
            locations={locations}
            selectedLocation={selectedLocation}
            focusLocation={focus}
            onSelectLocation={selectSaved}
            weatherMap={allWeather.weatherMap}
            tileLayerType={mapSettings.tileLayer}
            cartoApiKey={mapSettings.cartoApiKey}
            selectedModel={selectedModel}
            modelName={selectedModelInfo?.name ?? selectedModel}
            windOverlayVisible={mapSettings.windOverlayVisible}
            windColorOverlayVisible={mapSettings.windColorOverlayVisible}
            windColorHighContrast={mapSettings.windColorHighContrast}
            waterCurrentsVisible={mapSettings.waterCurrentsVisible}
            wavesVisible={mapSettings.wavesVisible}
            seamarksVisible={mapSettings.seamarksVisible}
            bcDepthVisible={mapSettings.bcDepthVisible}
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
            onGridLoadingChange={mapExport.handleGridLoadingChange}
            refreshSeq={refreshSeq}
          />
        </div>
        <ForecastTimeSelector
          model={selectedModelInfo}
          availability={modelAvailability}
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
        googleSatelliteEnabled={googleSatelliteEnabled}
        windOverlayVisible={mapSettings.windOverlayVisible}
        onToggleWindOverlay={mapSettings.setWindOverlayVisible}
        windColorOverlayVisible={mapSettings.windColorOverlayVisible}
        onToggleWindColorOverlay={mapSettings.setWindColorOverlayVisible}
        windColorHighContrast={mapSettings.windColorHighContrast}
        onToggleWindColorHighContrast={mapSettings.setWindColorHighContrast}
        waterCurrentsVisible={mapSettings.waterCurrentsVisible}
        onToggleWaterCurrents={mapSettings.setWaterCurrentsVisible}
        wavesVisible={mapSettings.wavesVisible}
        onToggleWaves={mapSettings.setWavesVisible}
        seamarksVisible={mapSettings.seamarksVisible}
        onToggleSeamarks={mapSettings.setSeamarksVisible}
        bcDepthVisible={mapSettings.bcDepthVisible}
        onToggleBcDepth={mapSettings.setBcDepthVisible}
      />

      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
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
        error={mapExport.exportError}
        onCancelRange={mapExport.handleCancelRange}
        onSaveCaptured={mapExport.handleSaveCaptured}
        disabled={mapSettings.tileLayer === 'google_satellite'}
        disabledReason={GOOGLE_MAP_EXPORT_DISABLED_REASON}
      />
    </div>
  );
};

export default App;
