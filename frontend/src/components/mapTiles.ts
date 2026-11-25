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

/**
 * The seamark overlay's own pane (SCRUM-175): above the base tiles (200), below the wind colour
 * gradient (250), so the gradient and barbs always read on top of the nautical detail.
 */
export const SEAMARK_PANE = 'seamarkPane';
const SEAMARK_ATTRIBUTION =
  'Seamarks &copy; <a href="https://www.openseamap.org">OpenSeaMap</a> contributors';
/** Plain-text seamark credit for the exported footer and the settings toggle (licence condition). */
export const SEAMARK_ATTRIBUTION_TEXT = 'Seamarks © OpenSeaMap contributors';
/** OpenSeaMap data is not surveyed for navigation; the toggle and the export both say so. */
export const SEAMARK_NOTICE = 'Not for navigation';

/**
 * URL and options for the OpenSeaMap seamark overlay (SCRUM-175). It is an overlay, so it stays
 * out of `MapTileLayer` and the base-map radios. Measured 2026-11-25: z12 to z19 all answer 200
 * with `access-control-allow-origin: *`, so `maxZoom` matches the base layers and `crossOrigin`
 * keeps the tiles usable in the canvas export. Nearly empty tiles are normal outside Europe.
 */
export function seamarkLayerConfig(): TileLayerConfig {
  return {
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    options: {
      attribution: SEAMARK_ATTRIBUTION,
      pane: SEAMARK_PANE,
      maxZoom: 19,
      crossOrigin: true,
    },
  };
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
