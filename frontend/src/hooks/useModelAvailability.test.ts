import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVAILABILITY_REFRESH_MS, useModelAvailability } from './useModelAvailability';
import { fetchModelAvailability } from '../api/client';
import type { ModelAvailability } from '../types';

vi.mock('../api/client', () => ({ fetchModelAvailability: vi.fn() }));

const gfsMeta: ModelAvailability = {
  model: 'gfs_seamless',
  run_utc: '2026-11-25T12:00:00Z',
  available_utc: '2026-11-25T18:17:00Z',
  next_available_utc: '2026-11-26T00:17:00Z',
};

const noMeta: ModelAvailability = {
  model: 'best_match',
  run_utc: null,
  available_utc: null,
  next_available_utc: null,
};

/** Let the pending fetch's promise callbacks run. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchModelAvailability).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useModelAvailability (SCRUM-256)', () => {
  it('loads the times of the selected model', async () => {
    vi.mocked(fetchModelAvailability).mockResolvedValue(gfsMeta);

    const { result } = renderHook(() => useModelAvailability('gfs_seamless'));
    await flush();

    expect(fetchModelAvailability).toHaveBeenCalledWith('gfs_seamless');
    expect(result.current).toEqual(gfsMeta);
  });

  it('re-reads them every ten minutes', async () => {
    vi.mocked(fetchModelAvailability).mockResolvedValue(gfsMeta);

    renderHook(() => useModelAvailability('gfs_seamless'));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVAILABILITY_REFRESH_MS);
    });

    expect(fetchModelAvailability).toHaveBeenCalledTimes(2);
  });

  it('forgets the previous model and loads the new one', async () => {
    vi.mocked(fetchModelAvailability).mockResolvedValue(gfsMeta);
    const { result, rerender } = renderHook(({ model }) => useModelAvailability(model), {
      initialProps: { model: 'gfs_seamless' },
    });
    await flush();
    expect(result.current).toEqual(gfsMeta);

    vi.mocked(fetchModelAvailability).mockResolvedValue(noMeta);
    rerender({ model: 'best_match' });
    await flush();

    expect(fetchModelAvailability).toHaveBeenLastCalledWith('best_match');
    expect(result.current).toBeNull();
  });

  it('settles on null when the model has no publication time', async () => {
    vi.mocked(fetchModelAvailability).mockResolvedValue(noMeta);

    const { result } = renderHook(() => useModelAvailability('best_match'));
    await flush();

    expect(result.current).toBeNull();
  });

  it('keeps the derived clock when the request fails, without throwing', async () => {
    vi.mocked(fetchModelAvailability).mockRejectedValue(new Error('availability is down'));

    const { result } = renderHook(() => useModelAvailability('gfs_seamless'));
    await flush();

    expect(result.current).toBeNull();
  });
});
