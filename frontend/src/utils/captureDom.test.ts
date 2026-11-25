import { afterEach, describe, expect, it } from 'vitest';
import { includeInCapture, pendingTiles, waitForTiles } from './captureDom';
import { registerCaptureMap, registerVectorMap, resetCaptureReadiness } from './captureReadiness';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function tile(loaded: boolean): HTMLImageElement {
  const image = document.createElement('img');
  image.className = loaded ? 'leaflet-tile leaflet-tile-loaded' : 'leaflet-tile';
  Object.defineProperty(image, 'complete', { value: loaded, configurable: true });
  Object.defineProperty(image, 'naturalWidth', { value: loaded ? 256 : 0, configurable: true });
  return image;
}

afterEach(resetCaptureReadiness);

describe('includeInCapture for the Seamap base (SCRUM-206)', () => {
  it('keeps the MapLibre container in the capture and still drops Leaflet chrome', () => {
    const glContainer = document.createElement('div');
    glContainer.className = 'maplibregl-map leaflet-maplibre-gl';
    expect(includeInCapture(glContainer)).toBe(true);

    const popup = document.createElement('div');
    popup.className = 'leaflet-popup';
    expect(includeInCapture(popup)).toBe(false);
  });
});

describe('waitForTiles readiness (SCRUM-204)', () => {
  it('counts a tile that exists but has not painted yet', () => {
    const container = document.createElement('div');
    container.append(tile(false), tile(true));
    expect(pendingTiles(container)).toBe(1);
  });

  it('waits for an in-flight tile that decodes late', async () => {
    const container = document.createElement('div');
    const inFlight = tile(false);
    container.append(inFlight);
    let settled = false;
    const waiting = waitForTiles(container, 2000).then(() => {
      settled = true;
    });

    await sleep(150);
    expect(settled).toBe(false);
    inFlight.classList.add('leaflet-tile-loaded');
    await waiting;
    expect(settled).toBe(true);
  });

  it('waits for a tile layer that is still fetching before its images exist', async () => {
    // The gap measured on SCRUM-199: Leaflet reports the layer as loading from the moment it
    // starts, while the DOM still has only the base map's tiles.
    const container = document.createElement('div');
    container.append(tile(true));
    let loading = true;
    registerCaptureMap({
      eachLayer: (fn) => fn({ isLoading: () => loading }),
    });

    let settled = false;
    const waiting = waitForTiles(container, 1500).then(() => {
      settled = true;
    });
    await sleep(150);
    expect(settled).toBe(false);

    loading = false;
    await waiting;
    expect(settled).toBe(true);
  });

  it('waits for a vector renderer to go idle', async () => {
    const container = document.createElement('div');
    container.append(tile(true));
    const listeners = new Set<() => void>();
    registerVectorMap({
      loaded: () => false,
      areTilesLoaded: () => false,
      once: (_event, listener) => {
        listeners.add(listener);
      },
      off: (_event, listener) => {
        listeners.delete(listener);
      },
    });

    let settled = false;
    const waiting = waitForTiles(container, 2000).then(() => {
      settled = true;
    });
    await sleep(150);
    expect(settled).toBe(false);

    [...listeners].forEach((listener) => listener());
    await waiting;
    expect(settled).toBe(true);
  });

  it('resolves at the deadline when a layer never settles', async () => {
    const container = document.createElement('div');
    container.append(tile(true));
    registerCaptureMap({ eachLayer: (fn) => fn({ isLoading: () => true }) });

    const started = Date.now();
    await waitForTiles(container, 200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('resolves without waiting when nothing is loading', async () => {
    const container = document.createElement('div');
    container.append(tile(true));
    registerCaptureMap({ eachLayer: (fn) => fn({ isLoading: () => false }) });

    const started = Date.now();
    await waitForTiles(container, 2000);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
