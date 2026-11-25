import { describe, expect, it } from 'vitest';
import { tileLayerConfig } from './mapTiles';
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
