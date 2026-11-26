import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import {
  capWavePoints,
  MAX_WAVE_MARKERS,
  useWaveGrid,
  WAVE_HORIZON_HOURS,
  withinWaveHorizon,
} from './useWaveGrid';
import * as api from '../api/client';
import type { WavePoint } from '../types';

vi.mock('../api/client', () => ({ fetchWaveGrid: vi.fn() }));

function fakeMap() {
  const handlers: Record<string, () => void> = {};
  const state = {
    bounds: { south: 47, north: 49, west: -123, east: -121 },
    size: { x: 800, y: 600 },
  };
  const map = {
    getBounds: () => ({
      getSouth: () => state.bounds.south,
      getNorth: () => state.bounds.north,
      getWest: () => state.bounds.west,
      getEast: () => state.bounds.east,
    }),
    getSize: () => state.size,
    on: vi.fn((event: string, fn: () => void) => {
      handlers[event] = fn;
    }),
    off: vi.fn(),
  };
  return {
    map: map as unknown as L.Map,
    fire: (event: string) => handlers[event]?.(),
    setBounds: (bounds: typeof state.bounds) => {
      state.bounds = bounds;
    },
  };
}

const point = (lat: number): WavePoint => ({
  latitude: lat,
  longitude: -124.6,
  height_m: 1.4,
  direction_deg: 240,
  period_s: 8,
});

const response = (points: WavePoint[]) => ({ points, time: null });

beforeEach(() => {
  vi.mocked(api.fetchWaveGrid).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withinWaveHorizon (SCRUM-234)', () => {
  it('accepts live values and hours inside the 240-hour horizon', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(withinWaveHorizon(null, now)).toBe(true);
    expect(withinWaveHorizon('2026-12-04T12:00:00Z', now)).toBe(true);
  });

  it('rejects hours past the horizon and unparseable hours', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(withinWaveHorizon('2026-12-04T13:00:00Z', now)).toBe(false);
    expect(withinWaveHorizon('not-a-time', now)).toBe(false);
    expect(WAVE_HORIZON_HOURS).toBe(240);
  });
});

describe('capWavePoints (SCRUM-234)', () => {
  it('samples a dense view down to the marker cap', () => {
    const points = Array.from({ length: 900 }, (_, i) => point(47 + i * 0.001));
    const capped = capWavePoints(points);

    expect(capped.length).toBeLessThanOrEqual(MAX_WAVE_MARKERS);
    expect(capped[0]).toBe(points[0]);
  });
});

describe('useWaveGrid (SCRUM-234)', () => {
  it('requests the view at the selected hour and refetches when the hour changes', async () => {
    vi.mocked(api.fetchWaveGrid).mockResolvedValue(response([point(48)]));
    const { map } = fakeMap();
    const { result, rerender } = renderHook(
      ({ time }: { time: string | null }) => useWaveGrid(map, true, time),
      { initialProps: { time: null as string | null } },
    );

    await waitFor(() => expect(api.fetchWaveGrid).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(api.fetchWaveGrid).toHaveBeenCalledWith(
      { min_lat: 47, max_lat: 49, min_lon: -123, max_lon: -121, cols: 10, rows: 8, time: null },
      { signal: expect.any(AbortSignal) },
    );

    rerender({ time: '2026-11-25T12:00:00Z' });
    await waitFor(() => expect(api.fetchWaveGrid).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.fetchWaveGrid).mock.calls[1][0]).toMatchObject({
      time: '2026-11-25T12:00:00Z',
    });
  });

  it('fetches nothing while the layer is off', async () => {
    const { map } = fakeMap();
    const { result } = renderHook(() => useWaveGrid(map, false));

    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWaveGrid).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('hides the layer beyond the wave horizon instead of calling the API', async () => {
    const { map } = fakeMap();
    const beyond = new Date(Date.now() + (WAVE_HORIZON_HOURS + 24) * 3600_000).toISOString();
    const { result } = renderHook(() => useWaveGrid(map, true, beyond));

    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWaveGrid).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('aborts the in-flight request on unmount and clears the layer on failure', async () => {
    vi.mocked(api.fetchWaveGrid).mockReturnValue(new Promise(() => {}));
    const { map } = fakeMap();
    const { unmount } = renderHook(() => useWaveGrid(map, true));

    await waitFor(() => expect(api.fetchWaveGrid).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.fetchWaveGrid).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);

    vi.mocked(api.fetchWaveGrid).mockRejectedValueOnce(new Error('upstream down'));
    const failing = renderHook(() => useWaveGrid(map, true));
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(failing.result.current).toEqual([]);
  });
});
