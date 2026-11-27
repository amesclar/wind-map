/** Base map tile layers (SCRUM-92: one table instead of three if/else branches). */
import L from 'leaflet';
import type { MapTileLayer } from '../types';

/**
 * Light bases (SCRUM-221): the Map Settings modal follows the tone of the selected base. Seamap
 * draws over the dark substrate, so it stays dark.
 */
const LIGHT_TILE_LAYERS: ReadonlySet<MapTileLayer> = new Set<MapTileLayer>(['paper_chart']);

export const isLightTileLayer = (layer: MapTileLayer): boolean => LIGHT_TILE_LAYERS.has(layer);

/**
 * Short names shown in the base-map radios and on the navbar button (SCRUM-322, SCRUM-326).
 * One table so the button cannot drift from the chosen layer's label.
 */
export const TILE_LAYER_NAMES: Record<MapTileLayer, string> = {
  carto_dark: 'CARTO',
  paper_chart: 'NOAA',
  seamap: 'OpenWater',
  google_satellite: 'Satellite',
};

export const tileLayerName = (layer: MapTileLayer): string => TILE_LAYER_NAMES[layer];

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

/**
 * One layer from the table. `kind` lets the mount code tell a WMS from an XYZ template and from the
 * vector style, which MapLibre renders instead of Leaflet.
 */
export type TileLayerConfig =
  | { kind: 'xyz'; url: string; options: L.TileLayerOptions }
  | { kind: 'wms'; url: string; options: L.WMSOptions }
  | { kind: 'vector'; url: string; attribution: string; maxZoom: number };

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

/**
 * What the tile-failure chip says (SCRUM-217). The substrate is still there, so the message names
 * what is actually on screen rather than claiming the map is broken.
 */
export const CHART_TILE_FAILURE_NOTICE =
  "Chart tiles unavailable — the base map is showing instead. NOAA's service may be busy or down.";
/** One stray tile from panning is normal; a run of them means the service is failing. */
export const CHART_TILE_FAILURE_THRESHOLD = 3;
export const CHART_TILE_FAILURE_WINDOW_MS = 10_000;

/** Coverage box the chart layer is clipped to; shared by the mount and its tests. */
export const CHART_BOUNDS = { south: -85, west: -180, north: CHART_COVERAGE_MAX_LAT, east: -60 };

/**
 * Open Waters: Seamap as a base style (SCRUM-206). Kept as an option rather than the chart
 * substitute (SCRUM-200): vector navigation aids and depth shading, no soundings, and tiles that
 * stop at z14. MapLibre overzooms them past that, which keeps vector labels crisp where a raster
 * base would blur, so the layer is not cut in at the tile ceiling.
 */
export const SEAMAP_STYLE_URL = 'https://tiles.openwaters.io/seamap/style.json';
export const SEAMAP_ATTRIBUTION_TEXT = '© Open Waters: Seamap · © OpenStreetMap contributors';
export const SEAMAP_NOTICE = 'Not for navigation';
export const SEAMAP_MAX_NATIVE_ZOOM = 14;
/** The chart pane: above the base tiles (200), below the depth shading (208) and aids (210). */
export const SEAMAP_PANE = CHART_PANE;

/**
 * The clip at 49.6 N is a data limit, not a rendering fault, so the edge is drawn as a chart-ink
 * dashed rule in its own pane: above the chart (205) and below the depth shading (208). SCRUM-215.
 */
export const CHART_EDGE_PANE = 'chartEdgePane';
/** Names the limit where the rule crosses the viewport, so the cut explains itself without a hover. */
export const CHART_EDGE_NOTICE =
  'NOAA chart coverage ends at 49.6° N. Canadian waters north of it show the base map.';

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

/** The vector style for the fifth base radio; the URL goes to MapLibre, not a Leaflet tile layer. */
export function seamapLayerConfig(): TileLayerConfig {
  return {
    kind: 'vector',
    url: SEAMAP_STYLE_URL,
    attribution: `&copy; <a href="https://openwaters.io/">Open Waters: Seamap</a> &middot; ${OSM_ATTRIBUTION}`,
    maxZoom: SEAMAP_MAX_NATIVE_ZOOM,
  };
}

export const GOOGLE_SATELLITE_ATTRIBUTION = '&copy; <a href="https://www.google.com/maps">Google</a>';
export const GOOGLE_SATELLITE_ATTRIBUTION_TEXT = '© Google';
export const GOOGLE_MAP_EXPORT_DISABLED_TOOLTIP =
  'Export is disabled on Google Maps. Switch to OSM, CARTO, or NOAA chart to export.';
export const GOOGLE_MAP_EXPORT_DISABLED_REASON =
  'Map image/PDF export is disabled on Google Maps due to licensing restrictions. Switch to OSM, CARTO, or NOAA chart to export.';

export interface GoogleSessionData {
  session: string;
  expiry: number;
  tile_url: string;
  attribution: string;
}

let sessionPromise: Promise<GoogleSessionData> | null = null;

export async function fetchGoogleSession(): Promise<GoogleSessionData> {
  if (!sessionPromise) {
    sessionPromise = fetch('/api/map/google-session')
      .then((res) => {
        if (!res.ok) throw new Error(`Google session failed: ${res.status}`);
        return res.json() as Promise<GoogleSessionData>;
      })
      .catch((err) => {
        sessionPromise = null;
        throw err;
      });
  }
  return sessionPromise;
}

export function resetGoogleSessionCache(): void {
  sessionPromise = null;
}

/**
 * Bases drawn on a light sheet. They get the darker temperature ramp and the darker barb ring, and
 * the gradient is attenuated so their own symbols stay readable (SCRUM-203, SCRUM-206).
 */
export function isLightBase(layer: MapTileLayer): boolean {
  return layer === 'paper_chart' || layer === 'seamap';
}

/** Plain-text attribution for the exported image (SCRUM-116); every provider requires it. */
export function attributionText(layer: MapTileLayer): string {
  if (layer === 'paper_chart') return `${NOAA_ATTRIBUTION_TEXT} · ${NOAA_NOTICE}`;
  if (layer === 'seamap') return `${SEAMAP_ATTRIBUTION_TEXT} · ${SEAMAP_NOTICE}`;
  if (layer === 'google_satellite') return GOOGLE_SATELLITE_ATTRIBUTION_TEXT;
  // CARTO's credit is ODbL on its data, so both names are required (SCRUM-301).
  return '© OpenStreetMap contributors © CARTO';
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
export function seamarkLayerConfig(): Extract<TileLayerConfig, { kind: 'xyz' }> {
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

/**
 * URL and options for a tile layer. CARTO uses the key-authenticated URL when a key is set; without
 * one it builds the unkeyed URL, which CARTO answers with its `API KEY REQUIRED` tile (SCRUM-301).
 * The overloads keep the shape for a known layer, so callers do not have to re-narrow the union.
 */
export function tileLayerConfig(
  layer: 'paper_chart',
  cartoApiKey?: string,
): Extract<TileLayerConfig, { kind: 'wms' }>;
export function tileLayerConfig(
  layer: 'seamap',
  cartoApiKey?: string,
): Extract<TileLayerConfig, { kind: 'vector' }>;
export function tileLayerConfig(
  layer: 'carto_dark' | 'google_satellite',
  cartoApiKey?: string,
  googleTileUrl?: string,
): Extract<TileLayerConfig, { kind: 'xyz' }>;
export function tileLayerConfig(
  layer: MapTileLayer,
  cartoApiKey?: string,
  googleTileUrl?: string,
): TileLayerConfig;
export function tileLayerConfig(
  layer: MapTileLayer,
  cartoApiKey = '',
  googleTileUrl = '',
): TileLayerConfig {
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
    case 'paper_chart':
      return chartLayerConfig();
    case 'seamap':
      return seamapLayerConfig();
    case 'google_satellite':
      return {
        kind: 'xyz',
        url: googleTileUrl || '',
        options: { attribution: GOOGLE_SATELLITE_ATTRIBUTION, maxZoom: 21, crossOrigin: true },
      };
  }
}
