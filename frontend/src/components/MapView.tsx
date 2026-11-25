import React, { useEffect, useRef, useState } from 'react';
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
import { WindOverlay } from './WindOverlay';
import { WindColorOverlay } from './WindColorOverlay';
import { WindColorLegend } from './WindColorLegend';
import { CurrentOverlay } from './CurrentOverlay';
import { CurrentLegend } from './CurrentLegend';
import type { GridWindPoint, SelectedGridPoint } from '../types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../constants';
import { escapeHtml } from '../utils/html';
import { useLatest } from '../hooks/useLatest';
import { useWindGrid } from '../hooks/useWindGrid';
import { useCurrentGrid } from '../hooks/useCurrentGrid';
import { seamarkLayerConfig, SEAMARK_PANE, tileLayerConfig } from './mapTiles';
import { registerCaptureMap } from '../utils/captureReadiness';
import { formatDirection, formatSpeed, formatTemperature } from '../utils/units';

interface MapViewProps {
  locations: SavedLocation[];
  selectedLocation: SavedLocation | null;
  onSelectLocation: (loc: SavedLocation) => void;
  weatherMap: Record<number, WeatherForecastResponse>;
  tileLayerType: MapTileLayer;
  cartoApiKey: string;
  selectedModel: string;
  windOverlayVisible: boolean;
  /** Color gradient layer and its legend (SCRUM-124); off unless turned on. */
  windColorOverlayVisible: boolean;
  /** Nautical seamark overlay (SCRUM-175); off unless turned on. */
  seamarksVisible?: boolean;
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
}

interface LocationMarker {
  location: SavedLocation;
  marker: L.Marker;
}

const LOCATION_BARB_SIZE = 44;
const SELECTED_LOCATION_BARB_SIZE = 52;
// Drawn until a location's forecast has loaded.
const PLACEHOLDER_WIND = { speedKnots: 10, directionDeg: 180, tempF: 50 };

/** Saved-location marker: a labelled wind barb, larger and glowing when selected. */
export function buildLocationIcon(weather: WeatherForecastResponse | undefined, isSelected: boolean): L.DivIcon {
  const size = isSelected ? SELECTED_LOCATION_BARB_SIZE : LOCATION_BARB_SIZE;
  const current = weather?.current;
  const svg = generateWindBarbSvg({
    speedKnots: current?.wind_speed_knots ?? PLACEHOLDER_WIND.speedKnots,
    directionDeg: current?.wind_direction_deg ?? PLACEHOLDER_WIND.directionDeg,
    tempF: current?.temperature_f ?? PLACEHOLDER_WIND.tempF,
    size,
    showLabel: true,
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
  onSelectLocation,
  weatherMap,
  tileLayerType,
  cartoApiKey,
  selectedModel,
  windOverlayVisible,
  windColorOverlayVisible,
  waterCurrentsVisible = false,
  seamarksVisible = false,
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
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef(new Map<number, LocationMarker>());

  // Latest click handler, so marker click listeners never go stale (SCRUM-92).
  const onSelectLocationRef = useLatest(onSelectLocation);

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

  // Swap the base tile layer when the layer or CARTO key changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const { url, options } = tileLayerConfig(tileLayerType, cartoApiKey);
    const layer = L.tileLayer(url, options);
    layer.addTo(map);
    tileLayerRef.current = layer;
    return () => {
      layer.remove();
      if (tileLayerRef.current === layer) tileLayerRef.current = null;
    };
  }, [tileLayerType, cartoApiKey]);

  // Nautical seamark overlay (SCRUM-175): its own pane, so the base map, the seamarks and the
  // wind layers stack in a fixed order however they are toggled.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !seamarksVisible) return;
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
  }, [seamarksVisible]);

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
  }, [locations, weatherMap, selectedLocation, unitSystem, speedUnit, validTimeLabel, onSelectLocationRef]);

  // Remove all saved-location markers when the map goes away
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => entry.marker.remove());
      markers.clear();
    };
  }, []);

  // Fly to selected location
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedLocation) return;

    map.flyTo([selectedLocation.latitude, selectedLocation.longitude], 9, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    markersRef.current.get(selectedLocation.id)?.marker.openPopup();
  }, [selectedLocation]);

  // Hand the node to both the internal ref (used to create the map) and the export's ref.
  const setContainer = (node: HTMLDivElement | null) => {
    mapContainerRef.current = node;
    if (containerRef) containerRef.current = node;
  };

  return (
    <div className="w-full h-full relative isolate">
      <div
        ref={setContainer}
        data-testid="map-canvas"
        className="w-full h-full"
      />
      {/* The grid is shared with the gradient, so the barbs must hide on their own toggle
          (SCRUM-185): only the gradient keeping the fetch alive does not mean barbs are on. */}
      {windOverlayVisible && (
        <WindOverlay
          map={mapInstance}
          points={gridPoints}
          selectedPoint={selectedGridPoint}
          onGridPointSelect={onGridPointSelect}
          halo={windColorOverlayVisible}
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
      {waterCurrentsVisible && <CurrentLegend speedUnit={speedUnit} />}
      {windColorOverlayVisible && (
        <>
          <WindColorOverlay map={mapInstance} points={gridPoints} visible />
          <WindColorLegend speedUnit={speedUnit} />
        </>
      )}
    </div>
  );
};
