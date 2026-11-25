import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import {
  attributionText,
  CHART_BOUNDS,
  CHART_COVERAGE_MAX_LAT,
  CHART_EDGE_NOTICE,
  CHART_EDGE_PANE,
  CHART_MIN_ZOOM,
  CHART_PANE,
  CHART_TILE_CLASS,
  CHART_TILE_FAILURE_NOTICE,
  CHART_TILE_FAILURE_THRESHOLD,
  CHART_TILE_FAILURE_WINDOW_MS,
  NOAA_ATTRIBUTION_TEXT,
  NOAA_NOTICE,
  NONNA_ATTRIBUTION_TEXT,
  NONNA_DERIVATIVE_NOTICE,
  NONNA_LAYERS,
  NONNA_MAX_NATIVE_ZOOM,
  NONNA_MIN_ZOOM,
  NONNA_NOTICE,
  NONNA_OPACITY,
  NONNA_PANE,
  nonnaLayerConfig,
  isLightBase,
  SEAMAP_ATTRIBUTION_TEXT,
  SEAMAP_MAX_NATIVE_ZOOM,
  SEAMAP_NOTICE,
  SEAMAP_PANE,
  SEAMAP_STYLE_URL,
  seamapLayerConfig,
  SEAMARK_ATTRIBUTION_TEXT,
  SEAMARK_NOTICE,
  SEAMARK_PANE,
  seamarkLayerConfig,
  seamarksShownFor,
  SEAMARK_HIDDEN_ON_CHART,
  tileLayerConfig,
} from './mapTiles';
import { gridDimensions, MAX_GRID_DIM } from '../hooks/useWindGrid';

describe('seamapLayerConfig (SCRUM-206)', () => {
  it('hands MapLibre the vector style and records the z14 tile ceiling', () => {
    const config = tileLayerConfig('seamap');
    expect(config.kind).toBe('vector');
    expect(config.url).toBe(SEAMAP_STYLE_URL);
    expect(SEAMAP_STYLE_URL).toBe('https://tiles.openwaters.io/seamap/style.json');
    expect(SEAMAP_MAX_NATIVE_ZOOM).toBe(14);
    expect(config).toEqual(seamapLayerConfig());
    // Above the base tiles (200), below the depth shading (208) and the seamarks (210).
    expect(SEAMAP_PANE).toBe(CHART_PANE);
  });

  it('credits both licences and repeats the navigation notice in the settings and the footer', () => {
    expect(SEAMAP_ATTRIBUTION_TEXT).toBe('© Open Waters: Seamap · © OpenStreetMap contributors');
    expect(SEAMAP_NOTICE).toBe('Not for navigation');
    expect(attributionText('seamap')).toBe(`${SEAMAP_ATTRIBUTION_TEXT} · ${SEAMAP_NOTICE}`);
    const config = seamapLayerConfig();
    expect(config.kind === 'vector' && config.attribution).toContain('OpenStreetMap');
  });

  it('leaves the four existing attribution strings untouched', () => {
    expect(attributionText('paper_chart')).toBe('© NOAA Office of Coast Survey · Not for navigation');
    expect(attributionText('carto_dark')).toBe('© OpenStreetMap contributors © CARTO');
    expect(attributionText('osm_dark')).toBe('© OpenStreetMap contributors');
    expect(attributionText('osm_standard')).toBe('© OpenStreetMap contributors');
  });
});

describe('isLightBase (SCRUM-206)', () => {
  it('marks both light sheets, and no dark base', () => {
    expect(isLightBase('paper_chart')).toBe(true);
    expect(isLightBase('seamap')).toBe(true);
    for (const layer of ['carto_dark', 'osm_dark', 'osm_standard'] as const) {
      expect(isLightBase(layer)).toBe(false);
    }
  });
});

describe('tileLayerConfig (SCRUM-92)', () => {
  it('uses the keyed CARTO URL only when a key is set', () => {
    expect(tileLayerConfig('carto_dark', '').url).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
    expect(tileLayerConfig('carto_dark', ' a b ').url).toContain('/rastertiles/dark_all/{z}/{x}/{y}.png?key=a%20b');
    expect(tileLayerConfig('carto_dark').options.attribution).toContain('CARTO');
  });

  it('darkens OSM tiles only for the dark layer', () => {
    expect(tileLayerConfig('osm_dark').options.className).toBe('osm-dark-tiles');
    expect(tileLayerConfig('osm_standard').options.className).toBeUndefined();
    expect(tileLayerConfig('osm_standard').url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });
});

describe('seamarkLayerConfig (SCRUM-175)', () => {
  it('draws OpenSeaMap tiles in their own pane, above the base map and below the wind layers', () => {
    const { url, options } = seamarkLayerConfig();
    expect(url).toBe('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png');
    expect(options.pane).toBe(SEAMARK_PANE);
    expect(options.crossOrigin).toBe(true);
    // Measured 2026-11-25: z12 to z19 all answer 200, so the overlay follows the base layers.
    expect(options.maxZoom).toBe(19);
    expect(options.attribution).toContain('OpenSeaMap');
  });

  it('carries the licence credit and the navigation notice for the toggle and the export', () => {
    expect(SEAMARK_ATTRIBUTION_TEXT).toBe('Seamarks © OpenSeaMap contributors');
    expect(SEAMARK_NOTICE).toBe('Not for navigation');
  });
});

describe('seamarksShownFor (SCRUM-214)', () => {
  it('hides the overlay on the paper chart and keeps it on every other base', () => {
    expect(seamarksShownFor('paper_chart', true)).toBe(false);
    for (const layer of ['osm_dark', 'carto_dark', 'osm_standard'] as const) {
      expect(seamarksShownFor(layer, true)).toBe(true);
    }
    // The stored toggle still decides for every base; it is only overridden on the chart.
    expect(seamarksShownFor('osm_dark', false)).toBe(false);
  });

  it('explains why the toggle does nothing on the chart', () => {
    expect(SEAMARK_HIDDEN_ON_CHART).toContain('aids to navigation');
    expect(SEAMARK_HIDDEN_ON_CHART).toContain('other base maps');
  });
});

describe('nonnaLayerConfig (SCRUM-205)', () => {
  const nonna = () => {
    const config = nonnaLayerConfig();
    if (config.kind !== 'wms') throw new Error('NONNA must be a WMS layer');
    return config;
  };

  it('asks for NONNA 10 as WMS 1.3.0 in EPSG:3857, transparent and cross-origin', () => {
    const { url, options } = nonna();
    expect(url).toBe('https://nonna-geoserver.data.chs-shc.ca/geoserver/wms');
    expect(options.layers).toBe(NONNA_LAYERS);
    expect(options.format).toBe('image/png');
    expect(options.transparent).toBe(true);
    // NONNA runs 1.3.0 and takes `CRS=`; the NOAA chart's 1.1.1 takes `SRS=` (SCRUM-202).
    expect(options.version).toBe('1.3.0');
    expect(options.crs).toBe(L.CRS.EPSG3857);
    expect(options.crossOrigin).toBe(true);
    expect(options.opacity).toBe(NONNA_OPACITY);
  });

  it('stacks between the chart and the seamarks and caps at its native zoom', () => {
    const { options } = nonna();
    expect(options.pane).toBe(NONNA_PANE);
    // A separate pane from the seamarks, so toggle order cannot bury the aids under the depth.
    expect(NONNA_PANE).not.toBe(SEAMARK_PANE);
    expect(options.minZoom).toBe(NONNA_MIN_ZOOM);
    expect(options.maxNativeZoom).toBe(NONNA_MAX_NATIVE_ZOOM);
    expect(options.maxZoom).toBe(19);
    expect(NONNA_MAX_NATIVE_ZOOM).toBeLessThan(19);
  });

  it('carries the CHS credit, the navigation notice and the derivative notice', () => {
    expect(NONNA_ATTRIBUTION_TEXT).toBe('Bathymetry © CHS NONNA');
    expect(NONNA_NOTICE).toBe('Not for navigation');
    expect(NONNA_DERIVATIVE_NOTICE).toContain('Canadian Hydrographic Service');
    expect(NONNA_DERIVATIVE_NOTICE).toContain('does NOT constitute an endorsement');
  });
});

describe('paper chart tile config (SCRUM-203)', () => {
  it('asks for the NOAA chart as WMS 1.1.1 in EPSG:3857, never through the dark filter', () => {
    const chart = tileLayerConfig('paper_chart');
    if (chart.kind !== 'wms') throw new Error('the paper chart must be a WMS layer');

    expect(chart.kind).toBe('wms');
    expect(chart.url).toContain('NOAAChartDisplay');
    expect(chart.options.layers).toBe('0,1,2,3,6');
    expect(chart.options.format).toBe('image/png');
    expect(chart.options.version).toBe('1.1.1');
    // Default 4326 returns blank tiles: the service wants the Web Mercator CRS (SCRUM-202).
    expect(chart.options.crs).toBe(L.CRS.EPSG3857);
    expect(chart.options.crossOrigin).toBe(true);
    expect(chart.options.maxZoom).toBe(19);
    expect(chart.options.className).toBe(CHART_TILE_CLASS);
    expect(chart.options.className).not.toContain('osm-dark-tiles');
  });

  it('counts a batch of failures, not one stray tile, as an outage (SCRUM-217)', () => {
    expect(CHART_TILE_FAILURE_THRESHOLD).toBeGreaterThan(1);
    expect(CHART_TILE_FAILURE_WINDOW_MS).toBeGreaterThan(0);
    expect(CHART_TILE_FAILURE_NOTICE).toContain('base map');
  });

  it('exports the clip and zoom floor the mount and the notice share', () => {
    expect(CHART_COVERAGE_MAX_LAT).toBe(49.6);
    expect(CHART_MIN_ZOOM).toBe(12);
    expect(CHART_PANE).toBe('chartPane');
    expect(CHART_BOUNDS.north).toBe(CHART_COVERAGE_MAX_LAT);
  });

  it('names the edge treatment and its limit (SCRUM-215)', () => {
    expect(CHART_EDGE_PANE).toBe('chartEdgePane');
    expect(CHART_EDGE_NOTICE).toContain('49.6');
    expect(CHART_EDGE_NOTICE).toContain('base map');
  });

  it('credits NOAA with the navigation notice and leaves the other three strings unchanged', () => {
    expect(attributionText('paper_chart')).toBe(`${NOAA_ATTRIBUTION_TEXT} · ${NOAA_NOTICE}`);
    expect(attributionText('osm_dark')).toBe('© OpenStreetMap contributors');
    expect(attributionText('osm_standard')).toBe('© OpenStreetMap contributors');
    expect(attributionText('carto_dark')).toBe('© OpenStreetMap contributors © CARTO');
  });

  it('never puts the dark filter on a chart or a standard layer', () => {
    expect(tileLayerConfig('paper_chart').options.className).not.toContain('osm-dark-tiles');
    for (const layer of ['osm_standard', 'carto_dark'] as const) {
      expect(tileLayerConfig(layer).options.className ?? '').not.toContain('osm-dark-tiles');
    }
    expect(tileLayerConfig('osm_dark').options.className).toContain('osm-dark-tiles');
  });
});

describe('gridDimensions', () => {
  it('targets one barb per 80px, between 2 and 20 per axis', () => {
    expect(gridDimensions({ x: 800, y: 600 })).toEqual({ cols: 10, rows: 8 });
    expect(gridDimensions({ x: 50, y: 50 })).toEqual({ cols: 2, rows: 2 });
    expect(gridDimensions({ x: 5000, y: 5000 })).toEqual({ cols: 20, rows: 20 });
  });

  it('caps a full view inside the Open-Meteo per-minute budget (SCRUM-194)', () => {
    // One call per point against 600 per minute, so a full view must stay well below it.
    expect(MAX_GRID_DIM * MAX_GRID_DIM).toBeLessThanOrEqual(600);
  });
});
