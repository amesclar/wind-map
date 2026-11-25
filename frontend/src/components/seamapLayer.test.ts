import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({ maplibreGL: vi.fn(), setWorkerUrl: vi.fn() }));

vi.mock('@maplibre/maplibre-gl-leaflet', () => ({ default: plugin.maplibreGL }));
vi.mock('maplibre-gl', () => ({ setWorkerUrl: plugin.setWorkerUrl }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/maplibre-gl-worker.js',
}));

import {
  createSeamapLayer,
  mountSeamapLayer,
  seamapLayerOptions,
  type SeamapLayer,
} from './seamapLayer';
import { CHART_PANE, SEAMAP_STYLE_URL } from './mapTiles';
import { resetCaptureReadiness, waitForVectorIdle } from '../utils/captureReadiness';

function fakeGlMap() {
  return {
    loaded: vi.fn(() => true),
    areTilesLoaded: vi.fn(() => true),
    once: vi.fn(),
    off: vi.fn(),
  };
}

beforeEach(() => {
  plugin.maplibreGL.mockReset();
  plugin.setWorkerUrl.mockReset();
  resetCaptureReadiness();
});

describe('seamapLayerOptions (SCRUM-206)', () => {
  it('draws the style in the chart pane with the capture-safe WebGL context', () => {
    expect(seamapLayerOptions()).toEqual({
      style: SEAMAP_STYLE_URL,
      pane: CHART_PANE,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
  });
});

describe('createSeamapLayer (SCRUM-206)', () => {
  it('loads nothing until the style is chosen, then builds one layer with the bundled worker', async () => {
    const layer = { addTo: vi.fn(), remove: vi.fn(), getMaplibreMap: () => fakeGlMap() };
    plugin.maplibreGL.mockReturnValue(layer);

    // Importing the module is not enough: the renderer arrives with the first selection.
    expect(plugin.maplibreGL).not.toHaveBeenCalled();

    await expect(createSeamapLayer()).resolves.toBe(layer);

    expect(plugin.maplibreGL).toHaveBeenCalledTimes(1);
    expect(plugin.maplibreGL.mock.calls[0][0]).toMatchObject({
      style: SEAMAP_STYLE_URL,
      pane: CHART_PANE,
    });
    // Without this URL MapLibre's worker 404s and the style paints nothing.
    expect(plugin.setWorkerUrl).toHaveBeenCalledWith('/assets/maplibre-gl-worker.js');
    // Building is not mounting: a map that went away in the meantime must stay untouched.
    expect(layer.addTo).not.toHaveBeenCalled();
  });

  it('builds a fresh layer every time, with its own unregister', async () => {
    const first = { addTo: vi.fn(), remove: vi.fn(), getMaplibreMap: () => fakeGlMap() };
    const second = { addTo: vi.fn(), remove: vi.fn(), getMaplibreMap: () => fakeGlMap() };
    first.addTo.mockReturnValue(first);
    second.addTo.mockReturnValue(second);
    plugin.maplibreGL.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const a = await createSeamapLayer();
    const b = await createSeamapLayer();

    expect(a).not.toBe(b);
    expect(plugin.maplibreGL).toHaveBeenCalledTimes(2);
  });
});

describe('mountSeamapLayer (SCRUM-206)', () => {
  it('adds the layer and registers its GL map for exports until the unregister runs', async () => {
    const layer = { addTo: vi.fn(), remove: vi.fn(), getMaplibreMap: () => fakeGlMap() };
    layer.addTo.mockReturnValue(layer);
    const map = {} as never;

    const unregister = mountSeamapLayer(map, layer as unknown as SeamapLayer);

    expect(layer.addTo).toHaveBeenCalledWith(map);
    // The export wait sees the GL map while it is registered.
    await expect(waitForVectorIdle(50)).resolves.toBeUndefined();

    unregister();
    await expect(waitForVectorIdle(50)).resolves.toBeUndefined();
  });
});
