import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { GridWindPoint, MapTileLayer, UnitSystem, WeatherModelInfo, WindSpeedUnit } from '../types';
import { attributionText, isLightBase, seamarksShownFor } from '../components/mapTiles';
import type {
  MapExportError,
  MapExportFormat,
  MapExportOptions,
  MapExportRangeOptions,
} from '../components/mapExportOptions';
import { captureMapCanvas, saveMapImage } from '../utils/captureMap';
import { waitForTiles } from '../utils/captureDom';
import { buildSteps, floorToHour, formatStepLabel } from '../utils/forecastWindow';
import {
  barbLegendEntries,
  buildExportBaseName,
  buildExportFileName,
  buildExportFooter,
  buildExportHeader,
  temperatureBands,
} from '../utils/mapExport';
import { saveMapPdf, type PdfOrientation, type PdfPageSize } from '../utils/pdfExport';
import { captureRange, RangeCaptureError, type RangeFrame, type RangeProgress } from '../utils/rangeCapture';
import { saveRangeImages, saveRangePdf } from '../utils/rangeOutput';
import { SPEED_UNIT_LABEL } from '../utils/units';
import { buildWindColorScale } from '../utils/windColorScale';
import { APP_VERSION } from '../version';

/**
 * How long one hour of a range may take to show its grid before the export fails (SCRUM-155).
 * Raised from 15 s to 60 s in SCRUM-164: slow model responses were aborting otherwise valid ranges.
 */
export const RANGE_FRAME_TIMEOUT_MS = 60_000;
const RANGE_POLL_MS = 100;

/**
 * How long a single-view export waits for the current view's wind grid before capturing anyway
 * (SCRUM-242). The barbs are drawn from that grid and a pan or zoom leaves them off the map until
 * it lands, so an export started too early used to save a barb-less image. A grid that never
 * settles must still not block the save.
 */
export const VIEW_GRID_TIMEOUT_MS = 5_000;
const VIEW_GRID_POLL_MS = 100;

/** Everything the export pipeline reads from the app (SCRUM-174). */
export interface MapExportSettings {
  /** The map element the image is captured from (SCRUM-116). */
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Selected forecast hour (null = now); a range moves it and restores it afterwards. */
  forecastTime: string | null;
  setForecastTime: (time: string | null) => void;
  timezone: string;
  selectedModel: string;
  selectedModelInfo: WeatherModelInfo | null;
  unitSystem: UnitSystem;
  speedUnit: WindSpeedUnit;
  tileLayer: MapTileLayer;
  windOverlayVisible: boolean;
  windColorOverlayVisible: boolean;
  /** CHS NONNA depth overlay on: the exported footer credits CHS (SCRUM-205). */
  bcDepthVisible: boolean;
  /** Seamark overlay on: the exported footer credits OpenSeaMap (SCRUM-175). */
  seamarksVisible: boolean;
  /** Wave layer on: the exported footer credits the Marine source (SCRUM-234). */
  wavesVisible: boolean;
  /** True while the saved-location data for the shown hour is in flight. */
  weatherLoading: boolean;
}

/**
 * The map export pipeline: dialog state, single-view capture and the multi-hour range loop
 * (SCRUM-116, SCRUM-117, SCRUM-155, SCRUM-156). Moved out of `App.tsx` in SCRUM-174 so the
 * component only wires hooks to components.
 */
export function useMapExport({
  mapContainerRef,
  forecastTime,
  setForecastTime,
  timezone,
  selectedModel,
  selectedModelInfo,
  unitSystem,
  speedUnit,
  tileLayer,
  windOverlayVisible,
  windColorOverlayVisible,
  bcDepthVisible,
  seamarksVisible,
  wavesVisible,
  weatherLoading,
}: MapExportSettings) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  // A failed single-view export: shown in the dialog, which keeps every option (SCRUM-241).
  const [viewError, setViewError] = useState<MapExportError | null>(null);

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
  // The current view's grid request is in flight; the single-view export waits for it (SCRUM-242).
  const gridLoadingRef = useRef(false);
  const weatherLoadingRef = useRef(weatherLoading);
  weatherLoadingRef.current = weatherLoading;

  // Range window: model horizon from the hour the dialog opened (SCRUM-155).
  const [rangeWindowStart, setRangeWindowStart] = useState(() => floorToHour(new Date()).toISOString());
  useEffect(() => {
    if (isDialogOpen) setRangeWindowStart(floorToHour(new Date()).toISOString());
  }, [isDialogOpen]);
  const rangeHours = useMemo(
    () => buildSteps(rangeWindowStart, selectedModelInfo?.horizon_hours ?? 48),
    [rangeWindowStart, selectedModelInfo?.horizon_hours],
  );

  const modelId = selectedModelInfo?.id ?? selectedModel;

  const fileBaseName = useMemo(
    () => buildExportBaseName({ modelId, validTime: forecastTime, timezone }),
    [modelId, forecastTime, timezone],
  );

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
        unitSystem,
        speedUnit,
        attribution: attributionText(tileLayer),
        bcDepth: bcDepthVisible,
        // The chart draws its own aids, so the credit goes with the hidden overlay (SCRUM-214).
        seamarks: seamarksShownFor(tileLayer, seamarksVisible),
        waves: wavesVisible,
        version: APP_VERSION,
      }),
      barbs: barbLegendEntries(speedUnit),
      // The legend follows the ramp the barbs are drawn with: both light bases use the darker one.
      temperatures: temperatureBands(unitSystem, isLightBase(tileLayer)),
      speedUnitLabel: SPEED_UNIT_LABEL[speedUnit],
      temperatureUnitLabel: unitSystem === 'imperial' ? '°F' : '°C',
      // The export shows the same scale as the on-screen strip only when the gradient is on.
      windColorScale: windColorOverlayVisible ? buildWindColorScale(speedUnit) : undefined,
    }),
    [
      timezone,
      selectedModelInfo,
      unitSystem,
      speedUnit,
      tileLayer,
      windColorOverlayVisible,
      bcDepthVisible,
      seamarksVisible,
      wavesVisible,
    ],
  );

  /**
   * Wait (bounded) for the current view's grid, so the barbs are in the image (SCRUM-242). The
   * report comes from `useWindGrid` after the commit that draws the markers, so when this returns
   * the barbs are already on the map.
   */
  const waitForViewGrid = useCallback(async () => {
    if (!windOverlayVisible && !windColorOverlayVisible) return;
    const deadline = Date.now() + VIEW_GRID_TIMEOUT_MS;
    while (gridLoadingRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, VIEW_GRID_POLL_MS));
    }
  }, [windOverlayVisible, windColorOverlayVisible]);

  /** Resolve once the map shows `hour` with that hour's grid data (when drawn) and its tiles. */
  const waitForHour = useCallback(
    async (element: HTMLElement, hour: string, signal: AbortSignal) => {
      const needsGrid = windOverlayVisible || windColorOverlayVisible;
      const deadline = Date.now() + RANGE_FRAME_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const frame = gridFrameRef.current;
        const shownHour = frame?.validTime ?? frame?.points[0]?.time ?? null;
        const gridReady =
          !needsGrid ||
          (shownHour !== null && Date.parse(shownHour) === Date.parse(hour) && !weatherLoadingRef.current);
        if (gridReady) {
          await waitForTiles(element, 5000);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RANGE_POLL_MS));
      }
      throw new Error('its grid data did not arrive in time');
    },
    [windOverlayVisible, windColorOverlayVisible],
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
      setViewError(null);
      setRangeError(null);
      setRangeProgress(null);
      setRangeFrames([]);
      const original = forecastTime;
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
        setIsDialogOpen(false);
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
    [forecastTime, setForecastTime, timezone, modelId, buildContent, waitForHour],
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
      setViewError(null);
      try {
        // The dialog cleans the user's name (SCRUM-162) and falls back to the generated one.
        const content = buildContent(forecastTime, options.fileName, capturedAt);
        // The barbs come from a grid that is refetched after every pan or zoom; capture before
        // it lands and the image shows the chart without them (SCRUM-242).
        await waitForViewGrid();
        if (options.format === 'pdf') {
          await saveMapPdf(element, content, {
            fileName: content.fileName,
            pageSize: options.pageSize,
            orientation: options.orientation,
          });
        } else {
          await saveMapImage(element, content, { format: options.format, quality: options.jpegQuality });
        }
        setIsDialogOpen(false);
      } catch (err) {
        // The dialog stays open with the chosen options; the message names what went wrong.
        console.error('Failed to export the map image:', err);
        setViewError({
          message: err instanceof Error ? err.message : 'The map image could not be saved.',
          frames: 0,
        });
      } finally {
        setSavingMap(false);
      }
    },
    [mapContainerRef, forecastTime, selectedModelInfo, buildContent, runRangeExport, waitForViewGrid],
  );

  /** Every accepted grid response doubles as the range loop's readiness signal (SCRUM-155). */
  const handleGridLoaded = useCallback((frame: { validTime: string | null; points: GridWindPoint[] }) => {
    gridFrameRef.current = frame;
  }, []);

  /** Grid fetch state from `useWindGrid`, reported after the commit that draws the barbs (SCRUM-242). */
  const handleGridLoadingChange = useCallback((loading: boolean) => {
    gridLoadingRef.current = loading;
  }, []);

  const handleCancelRange = useCallback(() => rangeAbortRef.current?.abort(), []);

  const handleSaveCaptured = useCallback(async () => {
    const saveOptions = rangeOptionsRef.current;
    if (!saveOptions || rangeFrames.length === 0) return;
    setSavingMap(true);
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
  }, [rangeFrames, timezone, modelId]);

  const openDialog = useCallback(() => {
    setViewError(null);
    setIsDialogOpen(true);
  }, []);
  const closeDialog = useCallback(() => setIsDialogOpen(false), []);

  return {
    isDialogOpen,
    openDialog,
    closeDialog,
    fileBaseName,
    savingMap,
    rangeProgress,
    rangeError,
    /** The failure the dialog reports, whichever export path produced it (SCRUM-241). */
    exportError: rangeError ?? viewError,
    rangeFrames,
    rangeHours,
    handleExport,
    handleCancelRange,
    handleSaveCaptured,
    handleGridLoaded,
    handleGridLoadingChange,
  };
}
