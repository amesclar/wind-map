import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadingTileLayers,
  registerCaptureMap,
  registerVectorMap,
  resetCaptureReadiness,
  waitForVectorIdle,
  type VectorMapLike,
} from './captureReadiness';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mapOf = (...layers: unknown[]) => ({
  eachLayer: (fn: (layer: unknown) => void) => layers.forEach(fn),
});

interface FakeVectorMap extends VectorMapLike {
  idle: () => void;
}

function vectorMap(overrides: { loaded?: boolean; tiles?: boolean } = {}): FakeVectorMap {
  const listeners = new Set<() => void>();
  let loaded = overrides.loaded ?? true;
  let tiles = overrides.tiles ?? true;
  return {
    loaded: () => loaded,
    areTilesLoaded: () => tiles,
    once: (_event, listener) => {
      listeners.add(listener);
    },
    off: (_event, listener) => {
      listeners.delete(listener);
    },
    idle: () => {
      loaded = true;
      tiles = true;
      [...listeners].forEach((listener) => listener());
    },
  };
}

afterEach(resetCaptureReadiness);

describe('capture readiness (SCRUM-204)', () => {
  describe('loadingTileLayers', () => {
    it('counts only the layers that report loading', () => {
      registerCaptureMap(mapOf({ isLoading: () => true }, { isLoading: () => false }, { isLoading: undefined }, {}));
      expect(loadingTileLayers()).toBe(1);
    });

    it('counts across every registered map and stops after an unregister', () => {
      const unregister = registerCaptureMap(mapOf({ isLoading: () => true }));
      registerCaptureMap(mapOf({ isLoading: () => true }));
      expect(loadingTileLayers()).toBe(2);

      unregister();
      expect(loadingTileLayers()).toBe(1);
    });

    it('is zero when no map is registered', () => {
      expect(loadingTileLayers()).toBe(0);
    });
  });

  describe('waitForVectorIdle', () => {
    it('resolves at once when no vector map is registered', async () => {
      const started = Date.now();
      await waitForVectorIdle(1000);
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('resolves at once when the renderer is already idle', async () => {
      registerVectorMap(vectorMap());
      const started = Date.now();
      await waitForVectorIdle(1000);
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('waits for the idle event, then resolves', async () => {
      const map = vectorMap({ loaded: false, tiles: false });
      registerVectorMap(map);
      let settled = false;
      const waiting = waitForVectorIdle(2000).then(() => {
        settled = true;
      });

      await sleep(120);
      expect(settled).toBe(false);
      map.idle();
      await waiting;
      expect(settled).toBe(true);
    });

    it('gives up at the timeout instead of holding the export open', async () => {
      registerVectorMap(vectorMap({ loaded: false, tiles: false }));
      const started = Date.now();
      await waitForVectorIdle(120);
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    });

    it('stops waiting for a renderer that was unregistered', async () => {
      const map = vectorMap({ loaded: false, tiles: false });
      const unregister = registerVectorMap(map);
      unregister();
      const started = Date.now();
      await waitForVectorIdle(1000);
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('does not leave a listener behind after the timeout', async () => {
      const map = vectorMap({ loaded: false, tiles: false });
      const off = vi.spyOn(map, 'off');
      registerVectorMap(map);
      await waitForVectorIdle(60);
      expect(off).toHaveBeenCalledWith('idle', expect.any(Function));
    });
  });
});
