/** Base map tile layers (SCRUM-92: one table instead of three if/else branches). */
import type L from 'leaflet';
import type { MapTileLayer } from '../types';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface TileLayerConfig {
  url: string;
  options: L.TileLayerOptions;
}

/** Plain-text attribution for the exported image (SCRUM-116); OSM and CARTO require it. */
export function attributionText(layer: MapTileLayer): string {
  return layer === 'carto_dark' ? '© OpenStreetMap contributors © CARTO' : '© OpenStreetMap contributors';
}

/** URL and options for a tile layer. CARTO uses the key-authenticated URL when a key is set. */
export function tileLayerConfig(layer: MapTileLayer, cartoApiKey = ''): TileLayerConfig {
  switch (layer) {
    case 'carto_dark': {
      const key = cartoApiKey.trim();
      return {
        url: key
          ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
          : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: { attribution: CARTO_ATTRIBUTION, subdomains: 'abcd', maxZoom: 19, crossOrigin: true },
      };
    }
    case 'osm_dark':
      // Same OSM tiles, darkened by the .osm-dark-tiles CSS filter.
      return {
        url: OSM_URL,
        options: { attribution: OSM_ATTRIBUTION, className: 'osm-dark-tiles', maxZoom: 19, crossOrigin: true },
      };
    case 'osm_standard':
      return { url: OSM_URL, options: { attribution: OSM_ATTRIBUTION, maxZoom: 19, crossOrigin: true } };
  }
}
