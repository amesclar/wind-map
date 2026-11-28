import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { makeLocation } from '../test/fixtures';
import { useLocations } from './useLocations';

vi.mock('../api/client', () => ({
  fetchLocations: vi.fn(),
  deleteLocation: vi.fn(),
}));

const oak = makeLocation();
const seattle = makeLocation({ id: 2, name: 'Seattle, WA', is_default: false });

beforeEach(() => {
  vi.mocked(api.fetchLocations).mockReset().mockResolvedValue([oak, seattle]);
  vi.mocked(api.deleteLocation).mockReset().mockResolvedValue(undefined);
});

async function loaded() {
  const hook = renderHook(() => useLocations());
  await act(async () => {
    await hook.result.current.load();
  });
  return hook;
}

describe('useLocations (SCRUM-92, SCRUM-344)', () => {
  it('loads saved locations', async () => {
    const { result } = await loaded();
    expect(result.current.locations.map((l) => l.id)).toEqual([1, 2]);
  });

  it('has no way to add a location: entry is lookup-only (SCRUM-344)', async () => {
    const { result } = await loaded();
    expect('add' in result.current).toBe(false);
    expect('addLocation' in api).toBe(false);
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
