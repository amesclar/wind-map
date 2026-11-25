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
 * The paper chart draws NOAA's own aids to navigation, so the OpenSeaMap overlay would put a second,
 * possibly disagreeing set of buoys and lights on top of it (SCRUM-214). The stored toggle is never
 * changed: the overlay comes back as soon as another base map is chosen.
 */
export function seamarksShownFor(layer: MapTileLayer, seamarksVisible: boolean): boolean {
  return seamarksVisible && layer !== 'paper_chart';
}

/** Why the seamark toggle is inert on the chart; shown in Map Settings and nowhere else. */
export const SEAMARK_HIDDEN_ON_CHART =
  "Hidden on the paper chart, which already draws NOAA's aids to navigation. Your seamark setting applies on the other base maps.";

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

/**
 * CHS NONNA bathymetry (SCRUM-205): depth context for B.C. waters, where the NOAA chart has no
 * coverage. Unlike the chart it is a true overlay - measured 23-81 % clear pixels per tile - so it
 * draws over a base map instead of replacing one, and at 0.7 the base map, labels and contours all
 * stay legible. It is a bathymetric overview: shaded depth and contours, no soundings and no aids.
 */
export const NONNA_URL = 'https://nonna-geoserver.data.chs-shc.ca/geoserver/wms';
/** `NONNA 10` is the 10 m product; `NONNA 100` carries nothing at chart zooms that this one lacks. */
export const NONNA_LAYERS = 'nonna:NONNA 10';
const NONNA_ATTRIBUTION =
  'Bathymetry &copy; <a href="https://data.chs-shc.ca/">CHS NONNA</a>';
/** Plain-text credit for the exported footer and the settings toggle (licence condition). */
export const NONNA_ATTRIBUTION_TEXT = 'Bathymetry © CHS NONNA';
/** NONNA is explicitly non-navigational; the toggle and the export both say so. */
export const NONNA_NOTICE = 'Not for navigation';
/**
 * The CHS clickwrap requires a derivative notice wherever its data appears in another product, and
 * that the inclusion must not read as an endorsement by CHS or DFO. The full wording is in
 * `requirements.md`; this is the sentence the toggle carries.
 */
export const NONNA_DERIVATIVE_NOTICE =
  'This product has been produced by Wind Map and includes data provided by the Canadian Hydrographic Service of the Department of Fisheries and Oceans. The incorporation of that data does NOT constitute an endorsement by CHS or DFO of this product.';
/**
 * Between the chart (205) and the seamarks (210) in its own pane, not the seamark pane: the depth
 * shading then stays under the aids whatever order the two overlays are toggled in.
 */
export const NONNA_PANE = 'nonnaPane';
/** Measured in SCRUM-200: contours stay legible and the dark base map still reads through. */
export const NONNA_OPACITY = 0.7;
/** Below z8 the layer carries nothing useful, so it is not requested at all. */
export const NONNA_MIN_ZOOM = 8;
/** NONNA 10 is published to z12; above that the z12 tiles upscale instead of coming back blank. */
export const NONNA_MAX_NATIVE_ZOOM = 12;

/** WMS request for the CHS NONNA overlay, drawn at `NONNA_OPACITY` in its own pane. */
export function nonnaLayerConfig(): TileLayerConfig {
  return {
    kind: 'wms',
    url: NONNA_URL,
    options: {
      layers: NONNA_LAYERS,
      format: 'image/png',
      transparent: true,
      // NONNA runs 1.3.0, where EPSG:3857 goes in `CRS=`; NOAA's 1.1.1 chart wants `SRS=`.
      version: '1.3.0',
      crs: L.CRS.EPSG3857,
      attribution: NONNA_ATTRIBUTION,
      pane: NONNA_PANE,
      opacity: NONNA_OPACITY,
      crossOrigin: true,
      minZoom: NONNA_MIN_ZOOM,
      maxNativeZoom: NONNA_MAX_NATIVE_ZOOM,
      maxZoom: 19,
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
