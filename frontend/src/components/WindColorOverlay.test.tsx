import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import {
  WIND_COLOR_OPACITY,
  WIND_COLOR_PANE,
  WIND_COLOR_PANE_Z_INDEX,
  WindColorOverlay,
} from './WindColorOverlay';
import type { GridWindPoint } from '../types';

function fakeMap() {
  const handlers: Record<string, (() => void)[]> = {};
  const pane = document.createElement('div');
  const map = {
    getSize: () => ({ x: 800, y: 600 }),
    // Screen points map linearly onto 47..49 lat and -123..-121 lon.
    containerPointToLatLng: ([x, y]: [number, number]) => ({
      lat: 49 - (y / 600) * 2,
      lng: -123 + (x / 800) * 2,
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
    fire: (event: string) => (handlers[event] ?? []).forEach((fn) => fn()),
  };
}

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

beforeEach(() => {
  ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const canvasOf = (pane: HTMLElement) => pane.querySelector('canvas')!;

describe('WindColorOverlay (SCRUM-123)', () => {
  it('creates its pane and canvas without taking pointer events', () => {
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
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillRect.mock.calls[0].slice(2)).toEqual([1, 1]);
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

  it('redraws on moveend, zoomend and resize without clearing the previous frame', () => {
    const { map, fire } = fakeMap();
    render(<WindColorOverlay map={map} points={points} visible />);
    ctx.fillRect.mockClear();
    ctx.clearRect.mockClear();

    for (const event of ['moveend', 'zoomend', 'resize']) fire(event);

    expect(ctx.fillRect).toHaveBeenCalledTimes(3 * 200 * 150);
    expect(ctx.clearRect).not.toHaveBeenCalled();
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

  it('removes its canvas and pane, and stops listening, on unmount', () => {
    const { map, pane, fire } = fakeMap();
    const { unmount } = render(<WindColorOverlay map={map} points={points} visible />);
    unmount();

    expect(map.off).toHaveBeenCalledWith('moveend', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('zoomend', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(pane.querySelector('canvas')).toBeNull();
    expect(pane.childElementCount).toBe(0);

    ctx.fillRect.mockClear();
    fire('moveend');
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
