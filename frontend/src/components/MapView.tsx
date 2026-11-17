import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { SavedLocation, WeatherForecastResponse, MapTileLayer, UnitSystem, WindSpeedUnit } from '../types';
import { generateWindBarbSvg } from './WindBarb';
import { WindOverlay } from './WindOverlay';
import type { GridWindPoint, SelectedGridPoint } from '../types';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../constants';
import { escapeHtml } from '../utils/html';
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
  selectedGridPoint: SelectedGridPoint | null;
  onGridPointSelect: (pt: GridWindPoint) => void;
  /** Popup units follow the user's settings (SCRUM-92); default imperial / knots. */
  unitSystem?: UnitSystem;
  speedUnit?: WindSpeedUnit;
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
  selectedGridPoint,
  onGridPointSelect,
  unitSystem = 'imperial',
  speedUnit = 'knots',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Record<number, L.Marker>>({});

  // Latest click handler, so marker click listeners never go stale (SCRUM-92).
  const onSelectLocationRef = useRef(onSelectLocation);
  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
  }, [onSelectLocation]);

  // Expose the live map instance to child components via state so React
  // re-renders WindOverlay once the map is ready.
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

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

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      setMapInstance(null);
    };
    // The Leaflet map is created once; selectedLocation only sets its initial center.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Tile Layer whenever tileLayerType or cartoApiKey changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
      tileLayerRef.current = null;
    }

    let newLayer: L.TileLayer;

    if (tileLayerType === 'carto_dark') {
      const trimmedKey = cartoApiKey.trim();
      const url = trimmedKey
        ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(trimmedKey)}`
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

      newLayer = L.tileLayer(url, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      });
    } else if (tileLayerType === 'osm_dark') {
      newLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        className: 'osm-dark-tiles',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      });
    } else {
      newLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      });
    }

    newLayer.addTo(map);
    tileLayerRef.current = newLayer;
  }, [tileLayerType, cartoApiKey]);

  // Update wind barb markers whenever locations or weather data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    locations.forEach((loc) => {
      const weather = weatherMap[loc.id];
      const isSelected = selectedLocation?.id === loc.id;

      const speedKnots = weather?.current?.wind_speed_knots ?? 10;
      const dirDeg = weather?.current?.wind_direction_deg ?? 180;
      const tempF = weather?.current?.temperature_f ?? 50;
      const current = weather?.current;
      const tempDisplay = current ? formatTemperature(current, unitSystem) : '--';
      const speedDisplay = current ? formatSpeed(current, 'speed', speedUnit) : '--';
      const gustDisplay = current ? formatSpeed(current, 'gust', speedUnit) : '--';
      const windDirDisplay = current ? formatDirection(current) : '--';

      const svgIconHtml = generateWindBarbSvg(
        speedKnots,
        dirDeg,
        tempF,
        isSelected ? 52 : 44,
        true
      );

      const customIcon = L.divIcon({
        className: 'wind-barb-marker',
        html: `
          <div class="relative cursor-pointer transition-transform duration-200 ${
            isSelected ? 'scale-110 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]' : ''
          }">
            ${svgIconHtml}
          </div>
        `,
        iconSize: [isSelected ? 52 : 44, isSelected ? 52 : 44],
        iconAnchor: [isSelected ? 26 : 22, isSelected ? 26 : 22],
      });

      const marker = L.marker([loc.latitude, loc.longitude], {
        icon: customIcon,
      }).addTo(map);

      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">${escapeHtml(loc.name)}</div>
          <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">
            ${escapeHtml([loc.admin1, loc.country].filter(Boolean).join(', ') || `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`)}
          </div>
          <div style="display: flex; gap: 8px; font-weight: 600;">
            <span style="color: #38bdf8;">💨 ${speedDisplay}</span>
            <span style="color: #fb923c;">⚡ G: ${gustDisplay}</span>
            <span style="color: #4ade80;">🌡️ ${tempDisplay}</span>
          </div>
          <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px;">
            🧭 ${escapeHtml(windDirDisplay)}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => onSelectLocationRef.current(loc));
      markersRef.current[loc.id] = marker;
    });
    // onSelectLocation is read through a ref so a new handler identity doesn't rebuild markers.
  }, [locations, weatherMap, selectedLocation, unitSystem, speedUnit]);

  // Fly to selected location
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedLocation) return;

    map.flyTo([selectedLocation.latitude, selectedLocation.longitude], 9, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    const marker = markersRef.current[selectedLocation.id];
    if (marker) marker.openPopup();
  }, [selectedLocation]);

  return (
    <div className="w-full h-full relative isolate">
      <div
        ref={mapContainerRef}
        data-testid="map-canvas"
        className="w-full h-full"
      />
      <WindOverlay
        map={mapInstance}
        model={selectedModel}
        visible={windOverlayVisible}
        selectedPoint={selectedGridPoint}
        onGridPointSelect={onGridPointSelect}
      />
    </div>
  );
};
