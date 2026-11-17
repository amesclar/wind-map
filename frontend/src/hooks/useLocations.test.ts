import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { makeLocation } from '../test/fixtures';
import { useLocations } from './useLocations';

vi.mock('../api/client', () => ({
  fetchLocations: vi.fn(),
  addLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const oak = makeLocation();
const seattle = makeLocation({ id: 2, name: 'Seattle, WA', is_default: false });
const here = makeLocation({ id: 3, name: 'My Current Location', is_default: false });

beforeEach(() => {
  vi.mocked(api.fetchLocations).mockReset().mockResolvedValue([oak, seattle]);
  vi.mocked(api.addLocation).mockReset();
  vi.mocked(api.deleteLocation).mockReset().mockResolvedValue(undefined);
});

async function loaded() {
  const hook = renderHook(() => useLocations());
  await act(async () => {
    await hook.result.current.load();
  });
  return hook;
}

describe('useLocations (SCRUM-92)', () => {
  it('loads saved locations', async () => {
    const { result } = await loaded();
    expect(result.current.locations.map((l) => l.id)).toEqual([1, 2]);
  });

  it('appends a new location from search, or moves a matched one to the end', async () => {
    const { result } = await loaded();
    vi.mocked(api.addLocation).mockResolvedValueOnce(here);
    await act(async () => {
      await result.current.add({ name: 'x', latitude: 1, longitude: 2 });
    });
    expect(result.current.locations.map((l) => l.id)).toEqual([1, 2, 3]);

    vi.mocked(api.addLocation).mockResolvedValueOnce(oak); // backend matched an existing one
    await act(async () => {
      await result.current.add({ name: 'x', latitude: 1, longitude: 2 });
    });
    expect(result.current.locations.map((l) => l.id)).toEqual([2, 3, 1]);
  });

  it('puts the current location first, without duplicating an existing one', async () => {
    const { result } = await loaded();
    vi.mocked(api.addLocation).mockResolvedValueOnce(here);
    await act(async () => {
      await result.current.add({ name: 'x', latitude: 1, longitude: 2 }, 'first');
    });
    expect(result.current.locations.map((l) => l.id)).toEqual([3, 1, 2]);

    vi.mocked(api.addLocation).mockResolvedValueOnce(seattle);
    await act(async () => {
      await result.current.add({ name: 'x', latitude: 1, longitude: 2 }, 'first');
    });
    expect(result.current.locations.map((l) => l.id)).toEqual([3, 1, 2]);
  });

  it('removes a location and returns what is left', async () => {
    const { result } = await loaded();
    let remaining: unknown;
    await act(async () => {
      remaining = await result.current.remove(1);
    });
    expect(api.deleteLocation).toHaveBeenCalledWith(1);
    expect(remaining).toEqual([seattle]);
    expect(result.current.locations).toEqual([seattle]);
  });
});
