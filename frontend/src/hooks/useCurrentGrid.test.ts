import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import {
  capPoints,
  CURRENT_HORIZON_HOURS,
  MAX_CURRENT_MARKERS,
  useCurrentGrid,
  withinCurrentHorizon,
} from './useCurrentGrid';
import * as api from '../api/client';
import type { CurrentPoint } from '../types';

vi.mock('../api/client', () => ({ fetchCurrentGrid: vi.fn() }));

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

const point = (lat: number): CurrentPoint => ({
  latitude: lat,
  longitude: -124.6,
  velocity_knots: 1.2,
  direction_deg: 333,
});

const response = (points: CurrentPoint[]) => ({ points, time: null });

beforeEach(() => {
  vi.mocked(api.fetchCurrentGrid).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withinCurrentHorizon (SCRUM-99)', () => {
  it('accepts live values and hours inside the 240-hour horizon', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(withinCurrentHorizon(null, now)).toBe(true);
    expect(withinCurrentHorizon('2026-11-24T12:00:00Z', now)).toBe(true);
    expect(withinCurrentHorizon('2026-12-04T12:00:00Z', now)).toBe(true);
  });

  it('rejects hours past the horizon and unparseable hours', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(withinCurrentHorizon('2026-12-04T13:00:00Z', now)).toBe(false);
    expect(withinCurrentHorizon('not-a-time', now)).toBe(false);
  });

  it('matches the backend horizon', () => {
    expect(CURRENT_HORIZON_HOURS).toBe(240);
  });
});

describe('capPoints (SCRUM-99)', () => {
  it('leaves a small view untouched', () => {
    const points = Array.from({ length: 20 }, (_, i) => point(47 + i * 0.01));
    expect(capPoints(points)).toEqual(points);
  });

  it('samples a dense view down to the cap', () => {
    const points = Array.from({ length: 900 }, (_, i) => point(47 + i * 0.001));
    const capped = capPoints(points);

    // A cap, not an exact target: the even-sampling step can leave a few unused slots.
    expect(capped.length).toBeLessThanOrEqual(MAX_CURRENT_MARKERS);
    expect(capped.length).toBeGreaterThan(MAX_CURRENT_MARKERS - 20);
    expect(capped[0]).toBe(points[0]);
  });
});

describe('useCurrentGrid (SCRUM-99)', () => {
  it('requests the view once and refetches when the forecast hour changes', async () => {
    vi.mocked(api.fetchCurrentGrid).mockResolvedValue(response([point(48)]));
    const { map } = fakeMap();
    const { result, rerender } = renderHook(
      ({ time }: { time: string | null }) => useCurrentGrid(map, true, time),
      { initialProps: { time: null as string | null } },
    );

    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(api.fetchCurrentGrid).toHaveBeenCalledWith(
      {
        min_lat: 47,
        max_lat: 49,
        min_lon: -123,
        max_lon: -121,
        cols: 10,
        rows: 8,
        time: null,
      },
      { signal: expect.any(AbortSignal) },
    );

    rerender({ time: '2026-11-25T12:00:00Z' });
    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.fetchCurrentGrid).mock.calls[1][0]).toMatchObject({
      time: '2026-11-25T12:00:00Z',
    });
  });

  it('fetches nothing while the layer is off', async () => {
    const { map } = fakeMap();
    const { result } = renderHook(() => useCurrentGrid(map, false));

    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchCurrentGrid).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('hides the layer beyond the current horizon instead of calling the API', async () => {
    vi.mocked(api.fetchCurrentGrid).mockResolvedValue(response([point(48)]));
    const { map } = fakeMap();
    const beyond = new Date(Date.now() + (CURRENT_HORIZON_HOURS + 24) * 3600_000).toISOString();
    const { result, rerender } = renderHook(
      ({ time }: { time: string | null }) => useCurrentGrid(map, true, time),
      { initialProps: { time: beyond as string | null } },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchCurrentGrid).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);

    // Moving back inside the horizon brings it back.
    rerender({ time: null });
    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(1));
  });

  it('refetches on a pan and ignores an unchanged viewport', async () => {
    vi.mocked(api.fetchCurrentGrid).mockResolvedValue(response([point(48)]));
    const { map, fire, setBounds } = fakeMap();
    renderHook(() => useCurrentGrid(map, true));

    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(1));
    fire('moveend');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(1);

    setBounds({ south: 46, north: 50, west: -124, east: -120 });
    fire('moveend');
    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(2));
  });

  it('aborts the in-flight request on unmount', async () => {
    vi.mocked(api.fetchCurrentGrid).mockReturnValue(new Promise(() => {}));
    const { map } = fakeMap();
    const { unmount } = renderHook(() => useCurrentGrid(map, true));

    await waitFor(() => expect(api.fetchCurrentGrid).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.fetchCurrentGrid).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('clears the layer and logs, without a dialog, when the request fails', async () => {
    vi.mocked(api.fetchCurrentGrid).mockRejectedValueOnce(new Error('upstream down'));
    const { map } = fakeMap();
    const { result } = renderHook(() => useCurrentGrid(map, true));

    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
