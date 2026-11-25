import { describe, expect, it } from 'vitest';
import {
  SEAMARK_ATTRIBUTION_TEXT,
  SEAMARK_NOTICE,
  SEAMARK_PANE,
  seamarkLayerConfig,
  tileLayerConfig,
} from './mapTiles';
import { gridDimensions, MAX_GRID_DIM } from '../hooks/useWindGrid';

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
