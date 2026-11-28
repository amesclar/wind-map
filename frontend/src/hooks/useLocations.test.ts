import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { makeLocation } from '../test/fixtures';
import { useLocations } from './useLocations';

vi.mock('../api/client', () => ({
  fetchLocations: vi.fn(),
}));

const oak = makeLocation();
const seattle = makeLocation({ id: 2, name: 'Seattle, WA', is_default: false });

beforeEach(() => {
  vi.mocked(api.fetchLocations).mockReset().mockResolvedValue([oak, seattle]);
});

async function loaded() {
  const hook = renderHook(() => useLocations());
  await act(async () => {
    await hook.result.current.load();
  });
  return hook;
}

describe('useLocations (SCRUM-92, SCRUM-344, SCRUM-345)', () => {
  it('loads the saved rows so the map can draw them', async () => {
    const { result } = await loaded();
    expect(result.current.locations.map((l) => l.id)).toEqual([1, 2]);
  });

  it('offers no way to add or delete: the list is read-only (SCRUM-344, SCRUM-345)', async () => {
    const { result } = await loaded();
    expect('add' in result.current).toBe(false);
    expect('remove' in result.current).toBe(false);
    expect('addLocation' in api).toBe(false);
    expect('deleteLocation' in api).toBe(false);
  });
});
