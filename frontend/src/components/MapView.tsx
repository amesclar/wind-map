import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  SavedLocation,
  WeatherForecastResponse,
  MapTileLayer,
  UnitSystem,
  WindDirDisplay,
  WindSpeedUnit,
} from '../types';
import { generateWindBarbSvg } from './WindBarb';
import { BARB_OUTLINES, hasWindData, WindOverlay } from './WindOverlay';
import { windColorOpacity, WindColorOverlay } from './WindColorOverlay';
import { WindColorLegend } from './WindColorLegend';
import { CurrentOverlay } from './CurrentOverlay';
import { WaveOverlay } from './WaveOverlay';
import { MapLegend } from './MapLegend';
import type { GridWindPoint, SelectedGridPoint } from '../types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../constants';
import { escapeHtml } from '../utils/html';
import { buildTideBlockHtml, buildTideUnavailableHtml, loadPointTide } from '../utils/tideBlock';
import { POPUP_OPTIONS, placePopupInView } from '../utils/popupPlacement';
import { useLatest } from '../hooks/useLatest';
import { useWindGrid } from '../hooks/useWindGrid';
import { useCurrentGrid } from '../hooks/useCurrentGrid';
import { useWaveGrid } from '../hooks/useWaveGrid';
import {
  CHART_EDGE_NOTICE,
  CHART_MIN_ZOOM,
  CHART_TILE_FAILURE_NOTICE,
  isLightBase,
  NOAA_COVERAGE_NOTICE,
  seamarksShownFor,
} from './mapTiles';
import { registerCaptureMap } from '../utils/captureReadiness';
import { formatDirection, formatSpeed, formatTemperature } from '../utils/units';
import { useBaseLayers } from '../hooks/useBaseLayers';
import googleMapsLogo from '../assets/google-maps-logo.png';

interface MapViewProps {
  locations: SavedLocation[];
  selectedLocation: SavedLocation | null;
  /** Where to look at startup without selecting it (SCRUM-248); flies, opens no pop-up. */
  focusLocation?: SavedLocation | null;
  onSelectLocation: (loc: SavedLocation) => void;
  weatherMap: Record<number, WeatherForecastResponse>;
  tileLayerType: MapTileLayer;
  cartoApiKey: string;
  selectedModel: string;
  /** Display name of the selected model, for notices (SCRUM-225). */
  modelName?: string;
  windOverlayVisible: boolean;
  /** Color gradient layer and its legend (SCRUM-124); off unless turned on. */
  windColorOverlayVisible: boolean;
  /** Draws the gradient at the chart's lighter strength on every base (SCRUM-213). */
  windColorHighContrast?: boolean;
  /** Nautical seamark overlay (SCRUM-175); off unless turned on. */
  seamarksVisible?: boolean;
  /** CHS NONNA bathymetry for B.C. waters (SCRUM-205); off unless turned on. */
  bcDepthVisible?: boolean;
  /** Ocean-current chevrons (SCRUM-99); off unless turned on. */
  waterCurrentsVisible?: boolean;
  /** Ocean-wave arrows (SCRUM-234); off unless turned on. */
  wavesVisible?: boolean;
  selectedGridPoint: SelectedGridPoint | null;
  onGridPointSelect: (pt: GridWindPoint) => void;
  /** Popup units follow the user's settings (SCRUM-92); default imperial / knots. */
  unitSystem?: UnitSystem;
  speedUnit?: WindSpeedUnit;
  /** How the barb pop-up shows direction (SCRUM-126); default barb. */
  dirDisplay?: WindDirDisplay;
  /** Selected forecast hour, ISO 8601 (SCRUM-115); null or absent means current conditions. */
  validTime?: string | null;
  /** Human-readable selected hour for the pop-ups (SCRUM-127), e.g. "Mon 23 Nov 12:00 PST". */
  validTimeLabel?: string | null;
  /** The map container, so the image export can capture it (SCRUM-116). */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** The hour and points of each accepted grid response, for the range export (SCRUM-155). */
  onGridLoaded?: (frame: { validTime: string | null; points: GridWindPoint[] }) => void;
  /** Open-Meteo's request limit stopped the grid; carries its reset instant (SCRUM-170). */
  onGridQuotaExhausted?: (resetAt: string | null) => void;
  /** Whether the current view's grid is in flight, so an export can wait for its barbs (SCRUM-242). */
  onGridLoadingChange?: (loading: boolean) => void;
  /** One-shot refresh trigger for the visible grid (SCRUM-113). */
  refreshSeq?: number;
}

interface LocationMarker {
  location: SavedLocation;
  marker: L.Marker;
}

const LOCATION_BARB_SIZE = 44;
const SELECTED_LOCATION_BARB_SIZE = 52;
// Drawn until a location's forecast has loaded.
const PLACEHOLDER_WIND = { speedKnots: 10, directionDeg: 180, tempF: 50 };

/** Marker for a location the model has no wind for (SCRUM-225): a neutral no-data glyph,
 * never a calm barb that claims the wind is 0 kn. */
function noWindBarbSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 50 50" role="img" aria-label="No wind data" focusable="false"><title>No wind data</title><circle cx="25" cy="25" r="9" fill="none" stroke="#9ca3af" stroke-width="2.5"/><line x1="18.6" y1="18.6" x2="31.4" y2="31.4" stroke="#9ca3af" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

/**
 * Saved-location marker: a labelled wind barb, larger and glowing when selected. It carries the same
 * crisp outline as the grid barbs (SCRUM-218), so one look covers every base map.
 */
export function buildLocationIcon(
  weather: WeatherForecastResponse | undefined,
  isSelected: boolean,
): L.DivIcon {
  const size = isSelected ? SELECTED_LOCATION_BARB_SIZE : LOCATION_BARB_SIZE;
  const current = weather?.current;
  const noData =
    current !== undefined &&
    (typeof current.wind_speed_knots !== 'number' || typeof current.wind_direction_deg !== 'number');
  const svg = noData
    ? noWindBarbSvg(size)
    : generateWindBarbSvg({
        speedKnots: current?.wind_speed_knots ?? PLACEHOLDER_WIND.speedKnots,
        directionDeg: current?.wind_direction_deg ?? PLACEHOLDER_WIND.directionDeg,
        tempF: current?.temperature_f ?? PLACEHOLDER_WIND.tempF,
        size,
        showLabel: true,
        outlines: BARB_OUTLINES,
      });
  const glow = isSelected ? 'scale-110 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]' : '';
  return L.divIcon({
    className: 'wind-barb-marker',
    html: `<div class="relative cursor-pointer transition-transform duration-200 ${glow}">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Popup HTML for a saved location. All location text is escaped. */
export function buildLocationPopup(
  loc: SavedLocation,
  weather: WeatherForecastResponse | undefined,
  unitSystem: UnitSystem,
  speedUnit: WindSpeedUnit,
  validTimeLabel: string | null = null,
): string {
  const current = weather?.current;
  const temp = current ? formatTemperature(current, unitSystem) : '--';
  const speed = current ? formatSpeed(current, 'speed', speedUnit) : '--';
  const gust = current ? formatSpeed(current, 'gust', speedUnit) : '--';
  const direction = current ? formatDirection(current) : '--';
  const region =
    [loc.admin1, loc.country].filter(Boolean).join(', ') ||
    `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`;
  return `
    <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
      <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">${escapeHtml(loc.name)}</div>
      <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">${escapeHtml(region)}</div>
      <div style="display: flex; gap: 8px; font-weight: 600;">
        <span style="color: #38bdf8;">💨 ${speed}</span>
        <span style="color: #fb923c;">⚡ G: ${gust}</span>
        <span style="color: #4ade80;">🌡️ ${temp}</span>
      </div>
      <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px;">🧭 ${escapeHtml(direction)}</div>
      ${validTimeLabel ? `<div style="margin-top: 2px; color: #9ca3af; font-size: 11px;">🕒 ${escapeHtml(validTimeLabel)}</div>` : ''}
      <div data-tide-slot data-tide-lat="${loc.latitude}" data-tide-lon="${loc.longitude}"></div>
    </div>
  `;
}

export const MapView: React.FC<MapViewProps> = ({
  locations,
  selectedLocation,
  focusLocation = null,
  onSelectLocation,
  weatherMap,
  tileLayerType,
  cartoApiKey,
  selectedModel,
  modelName,
  windOverlayVisible,
  windColorOverlayVisible,
  windColorHighContrast = false,
  waterCurrentsVisible = false,
  wavesVisible = false,
  seamarksVisible = false,
  bcDepthVisible = false,
  selectedGridPoint,
  onGridPointSelect,
  unitSystem = 'imperial',
  speedUnit = 'knots',
  dirDisplay = 'barb',
  validTime = null,
  validTimeLabel = null,
  containerRef,
  onGridLoaded,
  onGridQuotaExhausted,
  refreshSeq,
  onGridLoadingChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<number, LocationMarker>());

  // SCRUM-206: Seamap is a light sheet too, so barbs, currents and the gradient get the same
  // light-base treatment as the paper chart; only the chart's own coverage rules are chart-only.
  const lightBase = isLightBase(tileLayerType);
  // SCRUM-214: the chart carries its own aids, so the seamark overlay is suppressed on it without
  // changing the stored toggle; it returns as soon as another base is chosen.
  const seamarksShown = seamarksShownFor(tileLayerType, seamarksVisible);

  // Expose the live map instance to child components via state so React
  // re-renders WindOverlay once the map is ready.
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // SCRUM-275: the base map, the paper chart and its edge rule, the Seamap style, the seamarks and
  // the depth shading live in their own hook. What stays here is the map itself, the markers and
  // pop-ups, and the wind, current and wave layers.
  const { chartBase, chartOutsideCoverage, chartStraddlesEdge, chartTilesFailed, retryChart } =
    useBaseLayers(mapInstance, { tileLayerType, cartoApiKey, seamarksShown, bcDepthVisible });

  // Latest click handler, so marker click listeners never go stale (SCRUM-92).
  const onSelectLocationRef = useLatest(onSelectLocation);
  // Read at fly time without re-flying when the base map changes.
  const chartBaseRef = useLatest(chartBase);
  // SCRUM-211: a saved location draws its own labelled barb, so the grid steps aside for it. Kept
  // memoised because the overlay rebuilds its icons whenever this identity changes.
  const chartKeepOut = useMemo(
    () => locations.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [locations],
  );


  // One grid fetch per view change, shared by every layer that draws it (SCRUM-122);
  // either layer keeps it alive (SCRUM-124).
  const gridPoints = useWindGrid(
    mapInstance,
    selectedModel,
    windOverlayVisible || windColorOverlayVisible,
    validTime,
    onGridLoaded,
    onGridQuotaExhausted,
    onGridLoadingChange,
    refreshSeq,
  );
  // Currents have their own fetch and horizon: the layer follows the same selected hour
  // (SCRUM-99) but not the weather model or the wind layers.
  const currentPoints = useCurrentGrid(mapInstance, waterCurrentsVisible, validTime);
  // Waves mirror the currents: their own field, horizon and fetch, following the same hour.
  const wavePoints = useWaveGrid(mapInstance, wavesVisible, validTime);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = selectedLocation ? selectedLocation.latitude : DEFAULT_MAP_CENTER[0];
    const initialLon = selectedLocation ? selectedLocation.longitude : DEFAULT_MAP_CENTER[1];

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
    });

    mapInstanceRef.current = map;
    setMapInstance(map);
    // The export waits on this map's tile layers, including the window before new tiles exist
    // (SCRUM-204): a capture right after a layer is enabled must not miss it.
    const unregisterCapture = registerCaptureMap(map);

    return () => {
      unregisterCapture();
      map.remove();
      mapInstanceRef.current = null;
      setMapInstance(null);
    };
    // The Leaflet map is created once; selectedLocation only sets its initial center.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SCRUM-319: the zoom control shows the level it is at. Leaflet's own control has no room for a
  // value, so the readable copy lives in the app's control and follows every zoom (wheel, buttons,
  // keyboard), not just its own buttons.
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!mapInstance) return;
    const update = () => setZoomLevel(mapInstance.getZoom());
    update();
    mapInstance.on('zoom', update);
    mapInstance.on('zoomend', update);
    return () => {
      mapInstance.off('zoom', update);
      mapInstance.off('zoomend', update);
    };
  }, [mapInstance]);

  // Fill a pop-up's tide slot when it opens (SCRUM-195). The slot carries only the point; the
  // hour is this render's `validTime`, so the tide matches the rest of the pop-up.
  useEffect(() => {
    if (!mapInstance) return;
    let cancelled = false;
    const onPopupOpen = (event: L.PopupEvent) => {
      const element = event.popup.getElement();
      // Keep the whole card inside the panel even when the marker sits at an edge (SCRUM-252).
      placePopupInView(mapInstance, element);
      // Leaflet animates its own auto-pan after this event; settle the card once it stops.
      mapInstance.once('moveend', () => placePopupInView(mapInstance, element));
      const slot = element?.querySelector<HTMLElement>('[data-tide-slot]');
      if (!slot) return;
      const lat = Number(slot.dataset.tideLat);
      const lon = Number(slot.dataset.tideLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      loadPointTide(lat, lon, validTime)
        .then((tide) => {
          if (!cancelled) {
            slot.innerHTML = buildTideBlockHtml(tide, unitSystem, validTime === null, validTimeLabel);
            // The tide block can make the card taller than the space the pan left it.
            placePopupInView(mapInstance, element);
          }
        })
        .catch(() => {
          // A failed load says so (SCRUM-316); only a point with no water stays silent.
          if (!cancelled) {
            slot.innerHTML = buildTideUnavailableHtml();
            placePopupInView(mapInstance, element);
          }
        });
    };
    mapInstance.on('popupopen', onPopupOpen);
    return () => {
      cancelled = true;
      mapInstance.off('popupopen', onPopupOpen);
    };
  }, [mapInstance, unitSystem, validTime, validTimeLabel]);

  // Saved-location markers, updated in place by location id (SCRUM-92): only added or
  // removed locations create or remove markers; the rest get a new icon and popup.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const ids = new Set(locations.map((loc) => loc.id));

    markers.forEach((entry, id) => {
      if (!ids.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    });

    locations.forEach((loc) => {
      const weather = weatherMap[loc.id];
      const icon = buildLocationIcon(weather, selectedLocation?.id === loc.id);
      const popup = buildLocationPopup(loc, weather, unitSystem, speedUnit, validTimeLabel);
      const existing = markers.get(loc.id);
      if (existing) {
        existing.location = loc;
        existing.marker.setLatLng([loc.latitude, loc.longitude]);
        existing.marker.setIcon(icon);
        existing.marker.setPopupContent(popup);
        return;
      }
      const entry: LocationMarker = {
        location: loc,
        marker: L.marker([loc.latitude, loc.longitude], { icon }).addTo(map),
      };
      entry.marker.bindPopup(popup, POPUP_OPTIONS);
      // Reads the entry and handler at click time, so neither goes stale.
      entry.marker.on('click', () => onSelectLocationRef.current(entry.location));
      markers.set(loc.id, entry);
    });
  }, [
    locations,
    weatherMap,
    selectedLocation,
    unitSystem,
    speedUnit,
    validTimeLabel,
    onSelectLocationRef,
    chartBase,
  ]);

  // Remove all saved-location markers when the map goes away
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => entry.marker.remove());
      markers.clear();
    };
  }, []);

  // Fly to the selection, or to the startup focus (SCRUM-248): the focus only moves the map, so
  // the app opens on the current location with no marker highlighted and no details pop-up.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const target = selectedLocation ?? focusLocation;
    if (!map || !target) return;

    // SCRUM-319: a selection moves the map, it does not reset the zoom. The flight keeps the level
    // the user set; on the chart, which does not draw below its floor (SCRUM-203), it is raised to
    // that floor and never lowered further.
    const current = map.getZoom();
    const zoom = chartBaseRef.current ? Math.max(current, CHART_MIN_ZOOM) : current;
    map.flyTo([target.latitude, target.longitude], zoom, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    if (selectedLocation) markersRef.current.get(selectedLocation.id)?.marker.openPopup();
  }, [selectedLocation, focusLocation, chartBaseRef]);

  // Hand the node to both the internal ref (used to create the map) and the export's ref.
  // Memoised (SCRUM-283): a fresh function on every render makes React treat it as a different
  // ref, detaching and reattaching the node — and MapView re-renders on every grid update, so
  // the export hook's containerRef kept going null.
  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      mapContainerRef.current = node;
      if (containerRef) containerRef.current = node;
    },
    [containerRef],
  );

  // Nothing drawable in the whole view (SCRUM-225): say so instead of showing an empty
  // "calm" map. Only when a wind layer is on, because otherwise absence is expected.
  const gridHasNoData =
    (windOverlayVisible || windColorOverlayVisible) &&
    gridPoints.length > 0 &&
    gridPoints.every((pt) => !hasWindData(pt));

  return (
    <div className={`w-full h-full relative isolate${chartBase ? ' chart-base' : ''}`}>
      <div
        ref={setContainer}
        data-testid="map-canvas"
        className="w-full h-full"
      />
      {/* SCRUM-319: +/- with the live level between them, where Leaflet put its own buttons. */}
      <div
        role="group"
        aria-label="Map zoom"
        data-testid="zoom-control"
        className="absolute right-3 top-3 z-[800] flex w-7 flex-col items-stretch overflow-hidden rounded-lg border border-dark-600 bg-dark-800 shadow-lg"
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => mapInstance?.zoomIn()}
          className="h-7 text-base leading-none text-gray-300 transition hover:bg-dark-700 hover:text-sky-400"
        >
          +
        </button>
        <span
          data-testid="zoom-level"
          aria-live="polite"
          className="flex h-6 items-center justify-center border-y border-dark-600 text-[11px] tabular-nums text-gray-300"
        >
          {zoomLevel ?? '–'}
        </span>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => mapInstance?.zoomOut()}
          className="h-7 text-base leading-none text-gray-300 transition hover:bg-dark-700 hover:text-sky-400"
        >
          −
        </button>
      </div>
      {gridHasNoData && (
        <div
          data-testid="no-wind-data-notice"
          role="note"
          className="absolute left-1/2 top-20 z-[750] -translate-x-1/2 rounded-lg border border-dark-600 bg-dark-800/95 px-3 py-2 text-[11px] leading-snug text-gray-300 shadow-lg pointer-events-none"
        >
          No data from {modelName ?? selectedModel} for this area
        </div>
      )}
      {chartBase && (chartOutsideCoverage || chartTilesFailed || chartStraddlesEdge) && (
        <div className="absolute right-3 top-24 z-[750] flex max-w-[260px] flex-col items-end gap-2">
          {chartTilesFailed && (
            <div
              data-testid="chart-tile-error-notice"
              role="status"
              className="rounded-lg border border-dark-600 bg-dark-800/95 px-3 py-2 text-[11px] leading-snug text-gray-300 shadow-lg"
            >
              <div>{CHART_TILE_FAILURE_NOTICE}</div>
              <button
                type="button"
                data-testid="chart-retry"
                onClick={retryChart}
                className="mt-1.5 rounded-md border border-sky-500/60 bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-sky-500"
              >
                Retry chart tiles
              </button>
            </div>
          )}
          {chartStraddlesEdge && !chartOutsideCoverage && (
            <div
              data-testid="chart-edge-notice"
              role="note"
              className="rounded-lg border border-dark-600 bg-dark-800/95 px-3 py-2 text-[11px] leading-snug text-gray-300 shadow-lg pointer-events-none"
            >
              {CHART_EDGE_NOTICE}
            </div>
          )}
          {chartOutsideCoverage && (
            <div
              data-testid="chart-coverage-notice"
              role="note"
              className="rounded-lg border border-dark-600 bg-dark-800/95 px-3 py-2 text-[11px] leading-snug text-gray-300 shadow-lg pointer-events-none"
            >
              {NOAA_COVERAGE_NOTICE}
            </div>
          )}
        </div>
      )}
      {/* The grid is shared with the gradient, so the barbs must hide on their own toggle
          (SCRUM-185): only the gradient keeping the fetch alive does not mean barbs are on. */}
      {windOverlayVisible && (
        <WindOverlay
          map={mapInstance}
          points={gridPoints}
          selectedPoint={selectedGridPoint}
          onGridPointSelect={onGridPointSelect}
          lightBase={lightBase}
          declutter={chartBase}
          keepOut={chartBase ? chartKeepOut : undefined}
          unitSystem={unitSystem}
          speedUnit={speedUnit}
          dirDisplay={dirDisplay}
          timeLabel={validTimeLabel}
        />
      )}
      <CurrentOverlay
        map={mapInstance}
        points={currentPoints}
        speedUnit={speedUnit}
        timeLabel={validTimeLabel}
      />
      <WaveOverlay map={mapInstance} points={wavePoints} unitSystem={unitSystem} timeLabel={validTimeLabel} />
      {/* Google branding requirement (SCRUM-311): the official Google logo badge, bottom-left */}
      {tileLayerType === 'google_satellite' && (
        <div
          data-testid="google-maps-badge"
          className="absolute bottom-2 left-2 z-[400] pointer-events-none px-1.5 py-1 rounded bg-black/60 shadow"
        >
          <img src={googleMapsLogo} alt="Google" className="h-3.5 w-auto select-none" />
        </div>
      )}
      {/* One key for every layer (SCRUM-263): wind always, currents and waves only while shown. */}
      <MapLegend
        speedUnit={speedUnit}
        unitSystem={unitSystem}
        currents={waterCurrentsVisible}
        waves={wavesVisible}
      />
      {windColorOverlayVisible && (
        <>
          <WindColorOverlay
            map={mapInstance}
            points={gridPoints}
            visible
            opacity={windColorOpacity({ onChart: lightBase, highContrast: windColorHighContrast })}
          />
          <WindColorLegend speedUnit={speedUnit} />
        </>
      )}
    </div>
  );
};
