import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { CurrentLegend } from './CurrentLegend';
import type { GridWindPoint, SelectedGridPoint } from '../types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../constants';
import { escapeHtml } from '../utils/html';
import { useLatest } from '../hooks/useLatest';
import { useWindGrid } from '../hooks/useWindGrid';
import { useCurrentGrid } from '../hooks/useCurrentGrid';
import {
  CHART_BOUNDS,
  CHART_COVERAGE_MAX_LAT,
  CHART_EDGE_NOTICE,
  CHART_EDGE_PANE,
  CHART_MIN_ZOOM,
  CHART_PANE,
  CHART_TILE_FAILURE_NOTICE,
  CHART_TILE_FAILURE_THRESHOLD,
  CHART_TILE_FAILURE_WINDOW_MS,
  isLightBase,
  nonnaLayerConfig,
  NONNA_PANE,
  NOAA_COVERAGE_NOTICE,
  seamarkLayerConfig,
  seamarksShownFor,
  SEAMARK_PANE,
  tileLayerConfig,
} from './mapTiles';
import { registerCaptureMap } from '../utils/captureReadiness';
import { createSeamapLayer, mountSeamapLayer, type SeamapLayer } from './seamapLayer';
import { formatDirection, formatSpeed, formatTemperature } from '../utils/units';

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
  onGridLoadingChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<number, LocationMarker>());

  // SCRUM-203: the NOAA paper chart is a base map, not an overlay, and it is clipped to its
  // coverage, so the notice below has to follow pans and zooms.
  const chartBase = tileLayerType === 'paper_chart';
  // SCRUM-206: Seamap is a light sheet too, so barbs, currents and the gradient get the same
  // light-base treatment as the paper chart; only the chart's own coverage rules are chart-only.
  const lightBase = isLightBase(tileLayerType);
  // SCRUM-214: the chart carries its own aids, so the seamark overlay is suppressed on it without
  // changing the stored toggle; it returns as soon as another base is chosen.
  const seamarksShown = seamarksShownFor(tileLayerType, seamarksVisible);
  const [chartOutsideCoverage, setChartOutsideCoverage] = useState(false);
  // SCRUM-215: a view that crosses the clip shows where the chart ends instead of an unexplained cut.
  const [chartStraddlesEdge, setChartStraddlesEdge] = useState(false);
  // SCRUM-217: the chart service failing is a state of its own, separate from being out of range.
  const [chartTilesFailed, setChartTilesFailed] = useState(false);
  const [chartRetryCount, setChartRetryCount] = useState(0);

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

  // Expose the live map instance to child components via state so React
  // re-renders WindOverlay once the map is ready.
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

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
  );
  // Currents have their own fetch and horizon: the layer follows the same selected hour
  // (SCRUM-99) but not the weather model or the wind layers.
  const currentPoints = useCurrentGrid(mapInstance, waterCurrentsVisible, validTime);

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

    L.control.zoom({ position: 'topright' }).addTo(map);

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

  // Swap the base tile layer when the layer or CARTO key changes. The paper chart is a pair
  // (SCRUM-203): a keyless dark substrate plus the opaque chart in its own pane, clipped to the
  // service's coverage, so the clip edge reveals a working map instead of a blank canvas.
  // SCRUM-217: the chart layer's tile failures are counted here, and Retry remounts this effect.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const layers: L.Layer[] = [];
    // Counted per tile batch, not per tile: one stray tile from a pan is not an outage.
    let failures = 0;
    let windowStartedAt = 0;
    const noteTileError = () => {
      const now = Date.now();
      if (now - windowStartedAt > CHART_TILE_FAILURE_WINDOW_MS) {
        failures = 0;
        windowStartedAt = now;
      }
      failures += 1;
      if (failures >= CHART_TILE_FAILURE_THRESHOLD) setChartTilesFailed(true);
    };
    const noteBatchLoaded = () => {
      // Only a batch with no failures clears the notice: the load that follows an outage's failed
      // tiles must not hide it again immediately, but a recovered service clears it with no click.
      if (failures === 0) setChartTilesFailed(false);
      failures = 0;
      windowStartedAt = 0;
    };

    if (tileLayerType === 'paper_chart') {
      const substrate = tileLayerConfig('osm_dark');
      if (substrate.kind === 'xyz') {
        layers.push(L.tileLayer(substrate.url, substrate.options).addTo(map));
      }
      if (!map.getPane(CHART_PANE)) {
        const pane = map.createPane(CHART_PANE);
        pane.style.zIndex = '205';
        // Tiles only paint here: clicks must still reach the map and the barbs.
        pane.style.pointerEvents = 'none';
      }
      const chart = tileLayerConfig('paper_chart');
      if (chart.kind === 'wms') {
        const chartLayer = L.tileLayer.wms(chart.url, {
          ...chart.options,
          pane: CHART_PANE,
          minZoom: CHART_MIN_ZOOM,
          bounds: L.latLngBounds(
            [CHART_BOUNDS.south, CHART_BOUNDS.west],
            [CHART_BOUNDS.north, CHART_BOUNDS.east],
          ),
        });
        chartLayer.on('tileerror', noteTileError);
        chartLayer.on('load', noteBatchLoaded);
        layers.push(chartLayer.addTo(map));
      }
    } else if (tileLayerType === 'seamap') {
      // SCRUM-206: a keyless dark substrate under a lazily loaded MapLibre style. The pane is the
      // chart's (205): above the base tiles, below the depth shading and the seamarks.
      const substrate = tileLayerConfig('osm_dark');
      if (substrate.kind === 'xyz') {
        layers.push(L.tileLayer(substrate.url, substrate.options).addTo(map));
      }
      if (!map.getPane(CHART_PANE)) {
        const pane = map.createPane(CHART_PANE);
        pane.style.zIndex = '205';
        pane.style.pointerEvents = 'none';
      }
      // The first selection downloads MapLibre; switching away, or a map React StrictMode already
      // replaced, while it loads must leave no layer behind, so the layer is only mounted on a
      // map that is still this effect's own.
      let disposed = false;
      let seamapLayer: SeamapLayer | null = null;
      let unregisterVector = () => {};
      void createSeamapLayer()
        .then((created) => {
          if (disposed) return;
          unregisterVector = mountSeamapLayer(map, created);
          seamapLayer = created;
        })
        .catch((err) => {
          // The substrate still shows, so the map stays usable; the console names the cause.
          console.error('The Seamap base style could not be loaded:', err);
        });
      return () => {
        disposed = true;
        unregisterVector();
        seamapLayer?.remove();
        layers.forEach((layer) => layer.remove());
      };
    } else {
      const base = tileLayerConfig(tileLayerType, cartoApiKey);
      if (base.kind === 'xyz') layers.push(L.tileLayer(base.url, base.options).addTo(map));
    }

    return () => {
      layers.forEach((layer) => layer.remove());
    };
  }, [tileLayerType, cartoApiKey, chartRetryCount]);

  // The chart draws only inside the clip; outside it the substrate shows, which is accurate but
  // needs saying, because the service has no "no chart here" tile to speak for itself.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !chartBase) {
      setChartOutsideCoverage(false);
      setChartStraddlesEdge(false);
      setChartTilesFailed(false);
      return;
    }
    // The app opens below the chart's zoom floor, so selecting the mode would otherwise show a
    // notice and no chart at all; zoom to the floor once, which the user can undo.
    if (map.getZoom() < CHART_MIN_ZOOM) map.setZoom(CHART_MIN_ZOOM);
    const update = () => {
      const bounds = map.getBounds();
      const belowFloor = map.getZoom() < CHART_MIN_ZOOM;
      setChartOutsideCoverage(bounds.getSouth() > CHART_BOUNDS.north || belowFloor);
      setChartStraddlesEdge(
        !belowFloor && bounds.getSouth() <= CHART_BOUNDS.north && bounds.getNorth() > CHART_BOUNDS.north,
      );
    };
    update();
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [chartBase, mapInstance]);

  // SCRUM-215: draw the 49.6 N clip as a rule, so the chart does not simply stop in the middle of
  // the water. It spans the chart's own coverage box and only paints while the chart base is on.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !chartBase) return;
    if (!map.getPane(CHART_EDGE_PANE)) {
      const pane = map.createPane(CHART_EDGE_PANE);
      pane.style.zIndex = '206';
      pane.style.pointerEvents = 'none';
    }
    const boundary = L.polyline(
      [
        [CHART_COVERAGE_MAX_LAT, CHART_BOUNDS.west],
        [CHART_COVERAGE_MAX_LAT, CHART_BOUNDS.east],
      ],
      {
        pane: CHART_EDGE_PANE,
        color: '#161b22',
        weight: 1.2,
        opacity: 0.5,
        dashArray: '6 6',
        interactive: false,
      },
    ).addTo(map);
    return () => {
      boundary.remove();
    };
  }, [chartBase, mapInstance, chartRetryCount]);

  // Nautical seamark overlay (SCRUM-175): its own pane, so the base map, the seamarks and the
  // wind layers stack in a fixed order however they are toggled.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !seamarksShown) return;
    if (!map.getPane(SEAMARK_PANE)) {
      const pane = map.createPane(SEAMARK_PANE);
      pane.style.zIndex = '210';
      // Tiles only paint here: clicks must still reach the map and the barbs.
      pane.style.pointerEvents = 'none';
    }
    const { url, options } = seamarkLayerConfig();
    const layer = L.tileLayer(url, options).addTo(map);
    return () => {
      layer.remove();
    };
    // The map is created by the effect above, before this one runs, so the ref is current; adding
    // the map instance as a dependency would add the layer twice on the first render.
  }, [seamarksShown]);

  // CHS NONNA bathymetry (SCRUM-205): its own pane above the chart and under the seamarks, so the
  // depth shading never covers the aids it gives context to, whichever toggle ran last.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !bcDepthVisible) return;
    if (!map.getPane(NONNA_PANE)) {
      const pane = map.createPane(NONNA_PANE);
      pane.style.zIndex = '208';
      // Tiles only paint here: clicks must still reach the map and the barbs.
      pane.style.pointerEvents = 'none';
    }
    const config = nonnaLayerConfig();
    if (config.kind !== 'wms') return;
    const layer = L.tileLayer.wms(config.url, config.options).addTo(map);
    return () => {
      layer.remove();
    };
  }, [bcDepthVisible]);

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
      entry.marker.bindPopup(popup);
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

    // The chart does not draw below its floor, so the initial flight has to land where it does
    // (SCRUM-203); every other base keeps the original zoom.
    const zoom = chartBaseRef.current ? CHART_MIN_ZOOM : 9;
    map.flyTo([target.latitude, target.longitude], zoom, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    if (selectedLocation) markersRef.current.get(selectedLocation.id)?.marker.openPopup();
  }, [selectedLocation, focusLocation, chartBaseRef]);

  // Hand the node to both the internal ref (used to create the map) and the export's ref.
  const setContainer = (node: HTMLDivElement | null) => {
    mapContainerRef.current = node;
    if (containerRef) containerRef.current = node;
  };

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
                onClick={() => {
                  setChartTilesFailed(false);
                  setChartRetryCount((count) => count + 1);
                }}
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
        halo={lightBase}
      />
      {waterCurrentsVisible && <CurrentLegend speedUnit={speedUnit} />}
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
