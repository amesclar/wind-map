/** Base map tile layers (SCRUM-92: one table instead of three if/else branches). */
import L from 'leaflet';
import type { MapTileLayer } from '../types';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** One layer from the table. `kind` lets the mount code tell a WMS from an XYZ template. */
export type TileLayerConfig =
  | { kind: 'xyz'; url: string; options: L.TileLayerOptions }
  | { kind: 'wms'; url: string; options: L.WMSOptions };

/**
 * NOAA Chart Display (SCRUM-203). The only candidate that rendered a real paper chart, and it is
 * fully opaque: measured 0 % transparent pixels, and `TRANSPARENT=true` returns a byte-identical
 * image to `false`. It therefore replaces the base map instead of overlaying one.
 */
const NOAA_CHART_URL =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer';
/**
 * Chart information, features, soundings, obstructions and aids to navigation. SCRUM-202 measured
 * every layer alone: 8 (data-quality polygons) is 28.1 KB of a 112 KB tile and unwanted, and
 * 4, 5, 7 and 9-12 were blank at the control views.
 */
export const NOAA_CHART_LAYERS = '0,1,2,3,6';
export const NOAA_ATTRIBUTION =
  '&copy; <a href="https://nauticalcharts.noaa.gov/">NOAA Office of Coast Survey</a>';
/** Plain-text credit for the export footer and the settings note. */
export const NOAA_ATTRIBUTION_TEXT = '© NOAA Office of Coast Survey';
export const NOAA_NOTICE = 'Not for navigation';
export const NOAA_COVERAGE_NOTICE =
  'NOAA chart coverage stops at the Canadian border. North of it, and below zoom 12, the normal base map shows instead. Not for navigation.';
/** Never `.osm-dark-tiles`: the chart is a light map and the dark filter would invert it. */
export const CHART_TILE_CLASS = 'noaa-chart-tiles';
/**
 * The chart is clipped at this latitude and this zoom (SCRUM-203, from SCRUM-200). Outside its
 * coverage the service answers with one uniform cream tile - 0 % ink at z10, z12 and z14 over the
 * Strait of Georgia - which as a layer hides the base map instead of leaving a hole.
 */
export const CHART_COVERAGE_MAX_LAT = 49.6;
export const CHART_MIN_ZOOM = 12;
/** Above the base tiles (200) and below the seamarks (210). */
export const CHART_PANE = 'chartPane';

/** Coverage box the chart layer is clipped to; shared by the mount and its tests. */
export const CHART_BOUNDS = { south: -85, west: -180, north: CHART_COVERAGE_MAX_LAT, east: -60 };

/** WMS request for the paper chart, clipped by the caller to `CHART_BOUNDS`. */
export function chartLayerConfig(): TileLayerConfig {
  return {
    kind: 'wms',
    url: NOAA_CHART_URL,
    options: {
      layers: NOAA_CHART_LAYERS,
      format: 'image/png',
      version: '1.1.1',
      // The service defaults to 4326, whose lat,lon axis order returns blank tiles (SCRUM-202).
      crs: L.CRS.EPSG3857,
      attribution: NOAA_ATTRIBUTION,
      className: CHART_TILE_CLASS,
      maxZoom: 19,
      crossOrigin: true,
      // No `transparent: true`: the service ignores it, and the tiles carry no alpha to give back.
    },
  };
}

/** Plain-text attribution for the exported image (SCRUM-116); every provider requires it. */
export function attributionText(layer: MapTileLayer): string {
  if (layer === 'paper_chart') return `${NOAA_ATTRIBUTION_TEXT} · ${NOAA_NOTICE}`;
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
    kind: 'xyz',
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
        kind: 'xyz',
        url: key
          ? `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
          : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: { attribution: CARTO_ATTRIBUTION, subdomains: 'abcd', maxZoom: 19, crossOrigin: true },
      };
    }
    case 'osm_dark':
      // Same OSM tiles, darkened by the .osm-dark-tiles CSS filter.
      return {
        kind: 'xyz',
        url: OSM_URL,
        options: { attribution: OSM_ATTRIBUTION, className: 'osm-dark-tiles', maxZoom: 19, crossOrigin: true },
      };
    case 'osm_standard':
      return {
        kind: 'xyz',
        url: OSM_URL,
        options: { attribution: OSM_ATTRIBUTION, maxZoom: 19, crossOrigin: true },
      };
    case 'paper_chart':
      return chartLayerConfig();
  }
}
