import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import {
  WIND_COLOR_OPACITY,
  WIND_COLOR_OPACITY_ON_CHART,
  WIND_COLOR_PANE,
  WIND_COLOR_PANE_Z_INDEX,
  WindColorOverlay,
  windColorOpacity,
} from './WindColorOverlay';
import type { GridWindPoint } from '../types';

function fakeMap() {
  const handlers: Record<string, (() => void)[]> = {};
  const pane = document.createElement('div');
  const container = document.createElement('div');
  const state = { size: { x: 800, y: 600 } };
  const map = {
    getContainer: () => container,
    getSize: () => state.size,
    // Screen points map linearly onto 47..49 lat and -123..-121 lon.
    containerPointToLatLng: ([x, y]: [number, number]) => ({
      lat: 49 - (y / state.size.y) * 2,
      lng: -123 + (x / state.size.x) * 2,
    }),
    createPane: vi.fn(() => pane),
    on: vi.fn((event: string, fn: () => void) => {
      (handlers[event] ??= []).push(fn);
    }),
    off: vi.fn((event: string, fn: () => void) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
    }),
  };
  return {
    map: map as unknown as L.Map,
    pane,
    container,
    state,
    fire: (event: string) => (handlers[event] ?? []).forEach((fn) => fn()),
  };
}

const box = (left: number, top: number, width = 0, height = 0) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

/** jsdom has no layout, so place an element by stubbing its viewport rect. */
const placeAt = (el: HTMLElement, left: number, top: number) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(box(left, top));

/** The gradient covers the whole fake viewport. */
const points: GridWindPoint[] = [
  { latitude: 47, longitude: -123, wind_speed_knots: 10, wind_direction_deg: 90, temperature_f: 60 },
  { latitude: 47, longitude: -121, wind_speed_knots: 20, wind_direction_deg: 90, temperature_f: 60 },
  { latitude: 49, longitude: -123, wind_speed_knots: 30, wind_direction_deg: 90, temperature_f: 60 },
  { latitude: 49, longitude: -121, wind_speed_knots: 40, wind_direction_deg: 90, temperature_f: 60 },
];

let ctx: {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillStyle: string;
};

let resizeCallbacks: (() => void)[] = [];

beforeEach(() => {
  ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  resizeCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const canvasOf = (pane: HTMLElement) => pane.querySelector('canvas')!;

describe('WindColorOverlay (SCRUM-123, SCRUM-143)', () => {
  it('puts its canvas in a dedicated pane without taking pointer events', () => {
    const { map, pane } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);

    expect((map.createPane as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(WIND_COLOR_PANE);
    expect(pane.style.zIndex).toBe(String(WIND_COLOR_PANE_Z_INDEX));
    expect(pane.style.pointerEvents).toBe('none');
    const canvas = canvasOf(pane);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.style.opacity).toBe(String(WIND_COLOR_OPACITY));
  });

  it('fills a sample per 4 CSS pixels over the grid', () => {
    const { map, pane } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);

    const canvas = canvasOf(pane);
    expect(canvas.width).toBe(200); // 800 / 4
    expect(canvas.height).toBe(150); // 600 / 4
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillRect.mock.calls[0].slice(2)).toEqual([1, 1]);
  });

  it('pins the canvas over the viewport even when Leaflet has offset the map pane', () => {
    const { map, pane, container, fire } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);
    // A real drag leaves a translate on .leaflet-map-pane; the pane inherits it.
    placeAt(pane, -341620, -114102);
    placeAt(container, 0, 56);

    fire('moveend');

    const canvas = canvasOf(pane);
    expect(canvas.style.left).toBe('341620px');
    expect(canvas.style.top).toBe('114158px');
    expect(canvas.style.width).toBe('800px');
  });

  it('repaints after every view settle, clearing the previous frame', () => {
    const { map, fire } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);
    ctx.fillRect.mockClear();
    ctx.clearRect.mockClear();

    for (const event of ['moveend', 'zoomend', 'viewreset', 'resize']) fire(event);

    expect(ctx.fillRect).toHaveBeenCalledTimes(4 * 200 * 150);
    expect(ctx.clearRect).toHaveBeenCalledTimes(4);
  });

  it('repaints when only the map container changes size', () => {
    const { map, pane, state } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);
    ctx.fillRect.mockClear();

    state.size = { x: 400, y: 300 };
    resizeCallbacks[0]();

    const canvas = canvasOf(pane);
    expect(canvas.width).toBe(100); // 400 / 4
    expect(canvas.height).toBe(75); // 300 / 4
    expect(canvas.style.width).toBe('400px');
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('draws nothing with fewer than 2 by 2 points, clearing the frame', () => {
    const { map, pane } = fakeMap();
    const { rerender } = render(<WindColorOverlay map={map} points={points} visible />);
    expect(ctx.fillRect).toHaveBeenCalled();
    ctx.fillRect.mockClear();
    ctx.clearRect.mockClear();

    rerender(<WindColorOverlay map={map} points={points.slice(0, 3)} visible />);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(pane.querySelector('canvas')).not.toBeNull(); // the layer stays mounted
  });

  it('hides and clears itself when the layer is off', () => {
    const { map, pane } = fakeMap();
    const { rerender } = render(<WindColorOverlay map={map} points={points} visible={false} />);

    const canvas = canvasOf(pane);
    expect(canvas.style.display).toBe('none');
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();

    rerender(<WindColorOverlay map={map} points={points} visible />);
    expect(canvas.style.display).toBe('block');
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('reduces the wash on the chart or when high contrast is chosen (SCRUM-213)', () => {
    expect(windColorOpacity({ onChart: false, highContrast: false })).toBe(WIND_COLOR_OPACITY);
    expect(windColorOpacity({ onChart: true, highContrast: false })).toBe(
      WIND_COLOR_OPACITY_ON_CHART,
    );
    expect(windColorOpacity({ onChart: false, highContrast: true })).toBe(
      WIND_COLOR_OPACITY_ON_CHART,
    );
    expect(windColorOpacity({ onChart: true, highContrast: true })).toBe(WIND_COLOR_OPACITY_ON_CHART);
  });

  it('draws lighter on the paper chart base, and follows a change back (SCRUM-203)', () => {
    const { map, pane } = fakeMap();
    const { rerender } = render(
      <WindColorOverlay map={map} points={points} visible opacity={WIND_COLOR_OPACITY_ON_CHART} />,
    );
    expect(WIND_COLOR_OPACITY_ON_CHART).toBeLessThan(WIND_COLOR_OPACITY);
    expect(canvasOf(pane).style.opacity).toBe(String(WIND_COLOR_OPACITY_ON_CHART));

    rerender(<WindColorOverlay map={map} points={points} visible />);
    expect(canvasOf(pane).style.opacity).toBe(String(WIND_COLOR_OPACITY));
  });

  it('removes its canvas, pane, listeners and observer on unmount', () => {
    const { map, pane, fire } = fakeMap();
    const { unmount } = render(<WindColorOverlay map={map} points={points} visible />);
    const observer = resizeCallbacks[0];
    unmount();

    for (const event of ['moveend', 'zoomend', 'viewreset', 'resize']) {
      expect(map.off).toHaveBeenCalledWith(event, expect.any(Function));
    }
    expect(pane.querySelector('canvas')).toBeNull();
    expect(pane.childElementCount).toBe(0);
    expect(observer).toBeTypeOf('function');

    ctx.fillRect.mockClear();
    fire('moveend');
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
