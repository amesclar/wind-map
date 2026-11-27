import { describe, expect, it } from 'vitest';
import {
  attributionText,
  isLightBase,
  isLightTileLayer,
  isOsmLayer,
  OSM_ATTRIBUTION_TEXT,
  OSM_RANGE_EXPORT_NOTE,
  OSM_RANGE_EXPORT_REASON,
  OSM_TILE_URL,
  osmRangeExportBlockedReason,
  TILE_LAYER_NAMES,
  tileLayerConfig,
  tileLayerName,
} from './mapTiles';

describe('OpenStreetMap bases (SCRUM-333)', () => {
  it('asks for the exact URL the policy names, with attribution', () => {
    for (const layer of ['osm_dark', 'osm_standard'] as const) {
      const config = tileLayerConfig(layer);
      expect(config.kind).toBe('xyz');
      if (config.kind !== 'xyz') return;
      expect(config.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
      expect(config.url).toBe(OSM_TILE_URL);
      expect(config.options.attribution).toContain('OpenStreetMap');
      expect(config.options.maxZoom).toBe(19);
      expect(config.options.crossOrigin).toBe(true);
    }
  });

  it('darkens the light tiles with the filter SCRUM-301 left in place, and only there', () => {
    const dark = tileLayerConfig('osm_dark');
    const light = tileLayerConfig('osm_standard');
    expect(dark.kind === 'xyz' ? dark.options.className : undefined).toBe('osm-dark-tiles');
    expect(light.kind === 'xyz' ? light.options.className : undefined).toBeUndefined();
  });

  it('names both bases and credits them in the export footer', () => {
    expect(TILE_LAYER_NAMES.osm_dark).toBe('OSM Dark');
    expect(TILE_LAYER_NAMES.osm_standard).toBe('OSM Light');
    expect(tileLayerName('osm_standard')).toBe('OSM Light');
    expect(attributionText('osm_dark')).toBe(OSM_ATTRIBUTION_TEXT);
    expect(attributionText('osm_standard')).toBe(OSM_ATTRIBUTION_TEXT);
  });

  it('treats OSM Light as a light sheet and OSM Dark as a dark one', () => {
    // Barbs, the temperature ramp and the settings dialog all follow this.
    expect(isLightBase('osm_standard')).toBe(true);
    expect(isLightTileLayer('osm_standard')).toBe(true);
    expect(isLightBase('osm_dark')).toBe(false);
    expect(isLightTileLayer('osm_dark')).toBe(false);
  });

  it('blocks the range export on them with the owner copy, and nowhere else', () => {
    expect(isOsmLayer('osm_dark')).toBe(true);
    expect(isOsmLayer('osm_standard')).toBe(true);
    expect(osmRangeExportBlockedReason('osm_dark')).toBe(OSM_RANGE_EXPORT_REASON);
    expect(OSM_RANGE_EXPORT_REASON).toContain(OSM_RANGE_EXPORT_NOTE);

    for (const layer of ['carto_dark', 'paper_chart', 'seamap', 'google_satellite'] as const) {
      expect(osmRangeExportBlockedReason(layer)).toBeUndefined();
    }
  });
});
