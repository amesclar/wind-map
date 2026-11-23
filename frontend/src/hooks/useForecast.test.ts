import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { makeForecast } from '../test/fixtures';
import { useAllWeather } from './useForecast';

vi.mock('../api/client', () => ({ fetchAllWeather: vi.fn() }));

const oakForecast = makeForecast();
const seattleForecast = makeForecast({ location_id: 2, location_name: 'Seattle, WA' }, { speed: 20 });

beforeEach(() => {
  vi.mocked(api.fetchAllWeather).mockReset().mockResolvedValue([oakForecast, seattleForecast]);
});

describe('useAllWeather (SCRUM-92)', () => {
  it('loads every location once and reloads when the model or timezone changes', async () => {
    const { result, rerender } = renderHook(({ model, tz }) => useAllWeather(model, tz), {
      initialProps: { model: 'best_match', tz: 'UTC' },
    });
    await waitFor(() => expect(Object.keys(result.current.weatherMap)).toEqual(['1', '2']));
    expect(api.fetchAllWeather).toHaveBeenCalledTimes(1);
    expect(api.fetchAllWeather).toHaveBeenCalledWith('best_match', 'UTC', { signal: expect.any(AbortSignal) });

    rerender({ model: 'gfs_seamless', tz: 'UTC' });
    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledTimes(2));

    rerender({ model: 'gfs_seamless', tz: 'Asia/Tokyo' });
    await waitFor(() => expect(api.fetchAllWeather).toHaveBeenCalledTimes(3));
  });

  it('drops a deleted location and keeps the rest', async () => {
    const { result } = renderHook(() => useAllWeather('best_match', 'UTC'));
    await waitFor(() => expect(Object.keys(result.current.weatherMap)).toEqual(['1', '2']));

    result.current.remove(1);
    await waitFor(() => expect(result.current.weatherMap[1]).toBeUndefined());
    expect(result.current.weatherMap[2]).toBe(seattleForecast);
  });

  it('logs a failed reload and keeps the forecasts it already has', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(({ model }) => useAllWeather(model, 'UTC'), {
      initialProps: { model: 'best_match' },
    });
    await waitFor(() => expect(Object.keys(result.current.weatherMap)).toEqual(['1', '2']));

    vi.mocked(api.fetchAllWeather).mockRejectedValueOnce(new Error('down'));
    rerender({ model: 'gfs_seamless' });

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(result.current.weatherMap[1]).toBe(oakForecast);
    expect(result.current.weatherMap[2]).toBe(seattleForecast);
    error.mockRestore();
  });
});
