import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { SavedLocation, WeatherForecastResponse, MapTileLayer } from '../types';
import { generateWindBarbSvg } from './WindBarb';

interface MapViewProps {
  locations: SavedLocation[];
  selectedLocation: SavedLocation | null;
  onSelectLocation: (loc: SavedLocation) => void;
  weatherMap: Record<number, WeatherForecastResponse>;
  tileLayerType: MapTileLayer;
  cartoApiKey: string;
}

export const MapView: React.FC<MapViewProps> = ({
  locations,
  selectedLocation,
  onSelectLocation,
  weatherMap,
  tileLayerType,
  cartoApiKey,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Record<number, L.Marker>>({});

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center: Oak Harbor, WA
    const initialLat = selectedLocation ? selectedLocation.latitude : 48.2939;
    const initialLon = selectedLocation ? selectedLocation.longitude : -122.6064;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 8,
      zoomControl: false,
    });

    // Zoom controls positioned at top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
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

  // Update Markers whenever locations or weather data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    locations.forEach((loc) => {
      const weather = weatherMap[loc.id];
      const isSelected = selectedLocation?.id === loc.id;

      // Extract current conditions or fallback
      const speedKnots = weather?.current?.wind_speed_knots ?? 10;
      const dirDeg = weather?.current?.wind_direction_deg ?? 180;
      const tempF = weather?.current?.temperature_f ?? 50;
      const tempDisplay = weather ? `${Math.round(tempF)}°F` : '--';
      const speedDisplay = weather ? `${Math.round(speedKnots)} kt` : '--';
      const gustKnots = weather?.current?.wind_gust_knots ?? 0;
      const gustDisplay = weather ? `${Math.round(gustKnots)} kt` : '--';
      const windDirDeg = weather?.current?.wind_direction_deg ?? 0;
      const windDirCard = weather?.current?.wind_direction_cardinal ?? '--';
      const windDirDisplay = weather ? `${windDirCard} (${Math.round(windDirDeg)}°)` : '--';

      // SVG Wind Barb icon
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

      // Popup
      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: 700; color: #f3f4f6; margin-bottom: 2px;">${loc.name}</div>
          <div style="color: #9ca3af; font-size: 11px; margin-bottom: 6px;">
            ${[loc.admin1, loc.country].filter(Boolean).join(', ') || `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`}
          </div>
          <div style="display: flex; gap: 8px; font-weight: 600;">
            <span style="color: #38bdf8;">💨 ${speedDisplay}</span>
            <span style="color: #fb923c;">⚡ G: ${gustDisplay}</span>
            <span style="color: #4ade80;">🌡️ ${tempDisplay}</span>
          </div>
          <div style="margin-top: 4px; color: #a3a3a3; font-size: 11px;">
            🧭 ${windDirDisplay}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('click', () => {
        onSelectLocation(loc);
      });

      markersRef.current[loc.id] = marker;
    });
  }, [locations, weatherMap, selectedLocation, onSelectLocation]);

  // Center map on selected location change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedLocation) return;

    map.flyTo([selectedLocation.latitude, selectedLocation.longitude], 9, {
      duration: 1.2,
      easeLinearity: 0.25,
    });

    const marker = markersRef.current[selectedLocation.id];
    if (marker) {
      marker.openPopup();
    }
  }, [selectedLocation]);

  // Leaflet panes and zoom controls use z-index 400–1000 and are position:absolute.
  // Without a stacking context on this root, those layers paint above the
  // timeline drawer (z-40) and hide the forecast.
  return (
    <div
      ref={mapContainerRef}
      data-testid="map-canvas"
      className="w-full h-full relative isolate"
    />
  );
};
