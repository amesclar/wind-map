import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeocodeResult, GridWindPoint, SavedLocation, SelectedGridPoint, WeatherModelInfo } from './types';
import { fetchAppConfig, fetchModels } from './api/client';
import { DEFAULT_MODEL } from './constants';
import { useMapSettings, useTimezone, useUnitPreferences } from './hooks/useSettings';
import { useLocations } from './hooks/useLocations';
import { type Selection, useAllWeather } from './hooks/useForecast';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { ForecastTimeSelector } from './components/ForecastTimeSelector';
import { buildSteps, floorToHour, formatStepLabel } from './utils/forecastWindow';
import {
  barbLegendEntries,
  buildExportBaseName,
  buildExportFileName,
  buildExportFooter,
  buildExportHeader,
  temperatureBands,
} from './utils/mapExport';
import { captureMapCanvas, saveMapImage, waitForTiles } from './utils/captureMap';
import { saveMapPdf, type PdfOrientation, type PdfPageSize } from './utils/pdfExport';
import { saveRangeImages, saveRangePdf } from './utils/rangeOutput';
import {
  MapExportDialog,
  type MapExportError,
  type MapExportFormat,
  type MapExportOptions,
  type MapExportRangeOptions,
} from './components/MapExportDialog';
import { captureRange, RangeCaptureError, type RangeFrame, type RangeProgress } from './utils/rangeCapture';
import { attributionText } from './components/mapTiles';
import { SPEED_UNIT_LABEL } from './utils/units';
import { APP_VERSION } from './version';
import { SavedLocationsModal } from './components/SavedLocationsModal';
import { MapSettingsModal } from './components/MapSettingsModal';
import { PreferencesModal } from './components/PreferencesModal';
import { WeatherModelGuideModal } from './components/WeatherModelGuideModal';

const GEOLOCATION_TIMEOUT_MS = 4000;
/**
 * How long one hour of a range may take to show its grid before the export fails (SCRUM-155).
 * Raised from 15 s to 60 s in SCRUM-164: slow model responses were aborting otherwise valid ranges.
 */
export const RANGE_FRAME_TIMEOUT_MS = 60_000;
const RANGE_POLL_MS = 100;

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
  const [savingMap, setSavingMap] = useState(false);

  const allWeather = useAllWeather(selectedModel, timezone, forecastTime);

  // Range export state (SCRUM-155): progress, a failure with the frames captured so far, the
  // frames themselves and the cancellation handle.
  const [rangeProgress, setRangeProgress] = useState<RangeProgress | null>(null);
  const [rangeError, setRangeError] = useState<MapExportError | null>(null);
  const [rangeFrames, setRangeFrames] = useState<RangeFrame[]>([]);
  const rangeAbortRef = useRef<AbortController | null>(null);
  const rangeOptionsRef = useRef<{
    format: MapExportFormat;
    jpegQuality: number;
    pageSize: PdfPageSize;
    orientation: PdfOrientation;
  } | null>(null);
  // Latest accepted grid response per hour, the range loop's readiness signal.
  const gridFrameRef = useRef<{ validTime: string | null; points: GridWindPoint[] } | null>(null);
  const weatherLoadingRef = useRef(true);
  weatherLoadingRef.current = allWeather.loading;
  const selectedModelInfo = models.find((m) => m.id === selectedModel) ?? null;
  const validTimeLabel = forecastTime ? formatStepLabel(forecastTime, timezone) : null;

  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [isMapSettingsOpen, setIsMapSettingsOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isModelGuideOpen, setIsModelGuideOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  // Range window: model horizon from the hour the dialog opened (SCRUM-155).
  const [rangeWindowStart, setRangeWindowStart] = useState(() => floorToHour(new Date()).toISOString());
  useEffect(() => {
    if (isExportDialogOpen) setRangeWindowStart(floorToHour(new Date()).toISOString());
  }, [isExportDialogOpen]);
  const rangeHours = useMemo(
    () => buildSteps(rangeWindowStart, selectedModelInfo?.horizon_hours ?? 48),
    [rangeWindowStart, selectedModelInfo?.horizon_hours],
  );

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

  /** The header, footer and legend every export carries; the hour decides the header. */
  const buildContent = useCallback(
    (validTime: string | null, fileName: string, capturedAt: Date) => ({
      fileName,
      header: buildExportHeader({
        validTime,
        timezone,
        modelName: selectedModelInfo?.name ?? '',
        runTimeUtc: selectedModelInfo?.last_run_utc,
        capturedAt,
      }),
      footer: buildExportFooter({
        unitSystem: units.unitSystem,
        speedUnit: units.speedUnit,
        attribution: attributionText(mapSettings.tileLayer),
        version: APP_VERSION,
      }),
      barbs: barbLegendEntries(units.speedUnit),
      temperatures: temperatureBands(units.unitSystem),
      speedUnitLabel: SPEED_UNIT_LABEL[units.speedUnit],
      temperatureUnitLabel: units.unitSystem === 'imperial' ? '°F' : '°C',
    }),
    [timezone, selectedModelInfo, units.unitSystem, units.speedUnit, mapSettings.tileLayer],
  );

  /** Resolve once the map shows `hour` with that hour's grid data (when drawn) and its tiles. */
  const waitForHour = useCallback(
    async (element: HTMLElement, hour: string, signal: AbortSignal) => {
      const needsGrid = mapSettings.windOverlayVisible || mapSettings.windColorOverlayVisible;
      const deadline = Date.now() + RANGE_FRAME_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const frame = gridFrameRef.current;
        const shownHour = frame?.validTime ?? frame?.points[0]?.time ?? null;
        const gridReady =
          !needsGrid ||
          (shownHour !== null &&
            Date.parse(shownHour) === Date.parse(hour) &&
            !weatherLoadingRef.current);
        if (gridReady) {
          await waitForTiles(element, 5000);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RANGE_POLL_MS));
      }
      throw new Error('its grid data did not arrive in time');
    },
    [mapSettings.windOverlayVisible, mapSettings.windColorOverlayVisible],
  );

  /** One frame per hour, then one download per frame; the original hour is restored either way. */
  const runRangeExport = useCallback(
    async (options: MapExportRangeOptions, element: HTMLElement, capturedAt: Date) => {
      const controller = new AbortController();
      rangeAbortRef.current = controller;
      rangeOptionsRef.current = {
        format: options.format,
        jpegQuality: options.jpegQuality,
        pageSize: options.pageSize,
        orientation: options.orientation,
      };
      setSavingMap(true);
      setRangeError(null);
      setRangeProgress(null);
      setRangeFrames([]);
      const original = forecastTime;
      const modelId = selectedModelInfo?.id ?? selectedModel;
      try {
        const result = await captureRange(options.hours, {
          setHour: setForecastTime,
          waitForFrame: (hour, signal) => waitForHour(element, hour, signal),
          capture: (hour) =>
            captureMapCanvas(
              element,
              buildContent(
                hour,
                buildExportFileName({ modelId, validTime: hour, timezone, extension: options.format }),
                capturedAt,
              ),
              { tileTimeoutMs: 0 },
            ),
          labelHour: (hour) => formatStepLabel(hour, timezone),
          signal: controller.signal,
          onProgress: setRangeProgress,
        });
        setRangeFrames(result.frames);
        // Cancelling downloads nothing; a completed range saves one ZIP, image or PDF (SCRUM-156).
        if (result.status === 'cancelled') return;
        if (options.format === 'pdf') {
          await saveRangePdf(result.frames, {
            modelId,
            timezone,
            pageSize: options.pageSize,
            orientation: options.orientation,
          });
        } else {
          await saveRangeImages(result.frames, {
            modelId,
            timezone,
            format: options.format,
            jpegQuality: options.jpegQuality,
          });
        }
        setIsExportDialogOpen(false);
      } catch (err) {
        const frames = err instanceof RangeCaptureError ? err.frames : [];
        setRangeFrames(frames);
        setRangeError({
          message: err instanceof Error ? err.message : 'The range export failed.',
          frames: frames.length,
        });
      } finally {
        rangeAbortRef.current = null;
        setRangeProgress(null);
        setSavingMap(false);
        setForecastTime(original);
      }
    },
    [forecastTime, timezone, selectedModel, selectedModelInfo?.id, buildContent, waitForHour],
  );

  /** Capture the current view with its header, legend and footer, or run a range (SCRUM-116, SCRUM-117, SCRUM-155). */
  const handleExport = useCallback(
    async (options: MapExportOptions) => {
      const element = mapContainerRef.current;
      if (!element || !selectedModelInfo) return;
      const capturedAt = new Date();
      if (options.mode === 'range') {
        await runRangeExport(options, element, capturedAt);
        return;
      }
      setSavingMap(true);
      try {
        // The dialog cleans the user's name (SCRUM-162) and falls back to the generated one.
        const content = buildContent(forecastTime, options.fileName, capturedAt);
        if (options.format === 'pdf') {
          await saveMapPdf(element, content, {
            fileName: content.fileName,
            pageSize: options.pageSize,
            orientation: options.orientation,
          });
        } else {
          await saveMapImage(element, content, { format: options.format, quality: options.jpegQuality });
        }
        setIsExportDialogOpen(false);
      } catch (err) {
        console.error('Failed to export the map image:', err);
      } finally {
        setSavingMap(false);
      }
    },
    [forecastTime, selectedModelInfo, buildContent, runRangeExport],
  );

  /** Every accepted grid response doubles as the range loop's readiness signal (SCRUM-155). */
  const handleGridLoaded = useCallback(
    (frame: { validTime: string | null; points: GridWindPoint[] }) => {
      gridFrameRef.current = frame;
    },
    [],
  );

  const handleCancelRange = useCallback(() => rangeAbortRef.current?.abort(), []);

  const handleSaveCaptured = useCallback(async () => {
    const saveOptions = rangeOptionsRef.current;
    if (!saveOptions || rangeFrames.length === 0) return;
    setSavingMap(true);
    const modelId = selectedModelInfo?.id ?? selectedModel;
    try {
      // Recovery is always images: a failed PDF run saves its frames as a ZIP (or one PNG).
      await saveRangeImages(rangeFrames, {
        modelId,
        timezone,
        format: saveOptions.format === 'pdf' ? 'png' : saveOptions.format,
        jpegQuality: saveOptions.jpegQuality,
      });
    } finally {
      setSavingMap(false);
    }
  }, [rangeFrames, timezone, selectedModel, selectedModelInfo?.id]);

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
        onOpenExportDialog={() => setIsExportDialogOpen(true)}
        savingMap={savingMap}
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
            selectedGridPoint={selectedGridPoint}
            onGridPointSelect={handleGridPointSelect}
            unitSystem={units.unitSystem}
            speedUnit={units.speedUnit}
            dirDisplay={units.dirDisplay}
            validTime={forecastTime}
            validTimeLabel={validTimeLabel}
            containerRef={mapContainerRef}
            onGridLoaded={handleGridLoaded}
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
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExport}
        fileBaseName={buildExportBaseName({
          modelId: selectedModelInfo?.id ?? selectedModel,
          validTime: forecastTime,
          timezone,
        })}
        busy={savingMap}
        timezone={timezone}
        rangeHours={rangeHours}
        progress={rangeProgress}
        error={rangeError}
        onCancelRange={handleCancelRange}
        onSaveCaptured={handleSaveCaptured}
      />
    </div>
  );
};

export default App;
