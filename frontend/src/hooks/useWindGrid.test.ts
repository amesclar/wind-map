import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { gridDimensions, MAX_GRID_DIM, useWindGrid } from './useWindGrid';
import * as api from '../api/client';
import type { GridWindPoint } from '../types';

// SCRUM-122: the grid hook lives in MapView, so its fetch behavior is tested here rather
// than through WindOverlay.
vi.mock('../api/client', () => ({ fetchWindGrid: vi.fn(), parseQuotaExhausted: vi.fn() }));

/** Only bounds, size and event registration are used by the hook. */
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

const point = (lat: number): GridWindPoint => ({
  latitude: lat,
  longitude: -122,
  wind_speed_knots: 10,
  wind_direction_deg: 90,
  temperature_f: 60,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(api.fetchWindGrid).mockReset();
  vi.mocked(api.parseQuotaExhausted).mockReset().mockReturnValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gridDimensions (SCRUM-92)', () => {
  it('uses one point per 80px, with a floor of 2 and the backend cap', () => {
    expect(gridDimensions({ x: 800, y: 600 })).toEqual({ cols: 10, rows: 8 });
    expect(gridDimensions({ x: 10, y: 10 })).toEqual({ cols: 2, rows: 2 });
    expect(gridDimensions({ x: 5000, y: 5000 })).toEqual({ cols: MAX_GRID_DIM, rows: MAX_GRID_DIM });
  });
});

describe('useWindGrid shared fetch (SCRUM-92, SCRUM-122)', () => {
  it('requests each view once and only refetches when the view changes', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([point(48)]);
    const { map, fire, setBounds } = fakeMap();
    const { result } = renderHook(() => useWindGrid(map, 'best_match', true));

    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(api.fetchWindGrid).toHaveBeenCalledWith(
      {
        min_lat: 47,
        max_lat: 49,
        min_lon: -123,
        max_lon: -121,
        cols: 10,
        rows: 8,
        model: 'best_match',
        time: null,
      },
      { signal: expect.any(AbortSignal) },
    );

    // Same bounds: the view did not change, so no second request.
    fire('moveend');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(1);

    setBounds({ south: 46, north: 50, west: -124, east: -120 });
    fire('moveend');
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
  });

  it('fetches nothing and clears the points while no layer needs the grid', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([point(48)]);
    const { map } = fakeMap();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useWindGrid(map, 'best_match', enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current).toEqual([]));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(1);
  });

  it('does not fetch at all when it starts disabled', async () => {
    const { map } = fakeMap();
    const { result } = renderHook(() => useWindGrid(map, 'best_match', false));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  it('passes an AbortSignal and aborts it on unmount', async () => {
    vi.mocked(api.fetchWindGrid).mockReturnValue(new Promise(() => {}));
    const { map } = fakeMap();
    const { unmount } = renderHook(() => useWindGrid(map, 'best_match', true));

    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.fetchWindGrid).mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);

    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('ignores a stale response that arrives after a newer request', async () => {
    const first = deferred<GridWindPoint[]>();
    const second = deferred<GridWindPoint[]>();
    vi.mocked(api.fetchWindGrid).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { map } = fakeMap();
    const { result, rerender } = renderHook(
      ({ model }: { model: string }) => useWindGrid(map, model, true),
      { initialProps: { model: 'best_match' } },
    );
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));

    rerender({ model: 'gfs_seamless' });
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.fetchWindGrid).mock.calls[0][1]?.signal?.aborted).toBe(true);

    second.resolve([point(48)]);
    await waitFor(() => expect(result.current.map((p) => p.latitude)).toEqual([48]));

    first.resolve([point(47.5)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.map((p) => p.latitude)).toEqual([48]);
  });

  it('requests the selected forecast hour and refetches when it changes (SCRUM-115)', async () => {
    vi.mocked(api.fetchWindGrid).mockResolvedValue([point(48)]);
    const { map } = fakeMap();
    const { rerender } = renderHook(
      ({ time }: { time: string | null }) => useWindGrid(map, 'best_match', true, time),
      { initialProps: { time: null as string | null } },
    );

    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.fetchWindGrid).mock.calls[0][0]).toMatchObject({ time: null });

    rerender({ time: '2026-11-25T12:00:00Z' });
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.fetchWindGrid).mock.calls[1][0]).toMatchObject({ time: '2026-11-25T12:00:00Z' });

    // Same hour again: no new request.
    rerender({ time: '2026-11-25T12:00:00Z' });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.fetchWindGrid).toHaveBeenCalledTimes(2);
  });

  it('reports a quota-exhausted grid failure instead of logging it (SCRUM-170)', async () => {
    vi.mocked(api.parseQuotaExhausted).mockReturnValue({ resetAt: '2026-11-24T00:00:29+00:00' });
    vi.mocked(api.fetchWindGrid).mockRejectedValueOnce(new Error('limit reached'));
    const onQuotaExhausted = vi.fn();
    const { map } = fakeMap();

    renderHook(() => useWindGrid(map, 'best_match', true, null, undefined, onQuotaExhausted));

    await waitFor(() => expect(onQuotaExhausted).toHaveBeenCalledWith('2026-11-24T00:00:29+00:00'));
    expect(console.error).not.toHaveBeenCalled();
  });

  it('retries the same viewport after a failed request', async () => {
    vi.mocked(api.fetchWindGrid)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([point(48)]);

    const { map, fire } = fakeMap();
    const { result } = renderHook(() => useWindGrid(map, 'best_match', true));
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalled();

    // Same bounds: the failed key must not be remembered.
    fire('moveend');
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.map((p) => p.latitude)).toEqual([48]));
  });
});
