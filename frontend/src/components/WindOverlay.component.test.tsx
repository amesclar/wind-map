import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { WindOverlay } from './WindOverlay';
import * as api from '../api/client';
import type { GridWindPoint } from '../api/client';
import { createdMarkers as created, resetLeafletMock } from '../test/leafletMock';

// SCRUM-92 phase 1 (F): grid requests are cancellable, stale responses are dropped,
// and a failed request is retried for the same viewport.

vi.mock('leaflet', () => import('../test/leafletMock'));

vi.mock('../api/client', () => ({ fetchWindGrid: vi.fn() }));

// WindOverlay only needs bounds, size and event registration from the map.
function fakeMap() {
  const handlers: Record<string, () => void> = {};
  const map = {
    getBounds: () => ({ getSouth: () => 47, getNorth: () => 49, getWest: () => -123, getEast: () => -121 }),
    getSize: () => ({ x: 800, y: 600 }),
    on: vi.fn((event: string, fn: () => void) => {
      handlers[event] = fn;
    }),
    off: vi.fn(),
  };
  return { map: map as unknown as L.Map, fire: (event: string) => handlers[event]?.() };
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
  resetLeafletMock();
  vi.mocked(api.fetchWindGrid).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const props = { model: 'best_match', visible: true, selectedPoint: null, onGridPointSelect: () => {} };

describe('WindOverlay grid fetching (SCRUM-92)', () => {
  it('passes an AbortSignal and aborts it when the overlay unmounts', async () => {
    vi.mocked(api.fetchWindGrid).mockReturnValue(new Promise(() => {}));
    const { map } = fakeMap();
    const { unmount } = render(<WindOverlay {...props} map={map} />);

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
    const { rerender } = render(<WindOverlay {...props} map={map} />);
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));

    // A model change starts a new request and aborts the first one.
    rerender(<WindOverlay {...props} model="gfs_seamless" map={map} />);
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.fetchWindGrid).mock.calls[0][1]?.signal?.aborted).toBe(true);

    second.resolve([point(48)]);
    await waitFor(() => expect(created.map((m) => m.latlng[0])).toEqual([48]));

    // The old request finally answers; it must not replace the newer markers.
    first.resolve([point(47.5)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(created.map((m) => m.latlng[0])).toEqual([48]);
  });

  it('retries the same viewport after a failed request', async () => {
    vi.mocked(api.fetchWindGrid)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([point(48)]);

    const { map, fire } = fakeMap();
    render(<WindOverlay {...props} map={map} />);
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalled();

    // Same bounds: previously skipped forever because the failed key was remembered.
    fire('moveend');
    await waitFor(() => expect(api.fetchWindGrid).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(created).toHaveLength(1));
  });
});
